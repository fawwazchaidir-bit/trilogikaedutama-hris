import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma, transaction } from "../db";
import { parseInput } from "../validate";
import type { Role } from "@/lib/permissions";
import { env } from "../env";
import { Errors } from "../errors";
import { writeAudit } from "../audit";
import type { Actor } from "../actor";
import type { RequestMeta } from "../request-context";
import { dummyHash, hashPassword, needsRehash, validatePasswordStrength, verifyPassword } from "../auth/password";
import { blockedSeconds, hashKey, recordFailure, resetBucket } from "../auth/rate-limit";
import { createSession, hashToken, purgeOldSessions, revokeAllSessions, revokeSessionByToken } from "../auth/session";
import { assertTwoFactorNotBlocked, recordTwoFactorFailure, twoFactorBucketKey, verifySecondFactor } from "./two-factor";

const GENERIC_FAIL = "Email atau password salah.";

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function limits() {
  const e = env();
  return {
    email: { max: e.LOGIN_MAX_ATTEMPTS, windowMs: e.LOGIN_WINDOW_MINUTES * 60_000, blockMs: e.LOGIN_LOCKOUT_MINUTES * 60_000 },
    // Batas per-IP lebih longgar (banyak pengguna bisa berbagi satu IP kantor).
    ip: { max: e.LOGIN_MAX_ATTEMPTS * 6, windowMs: e.LOGIN_WINDOW_MINUTES * 60_000, blockMs: e.LOGIN_LOCKOUT_MINUTES * 60_000 },
  };
}

export interface LoginUser { id: string; email: string; name: string; role: string; mustChangePassword: boolean }
export type LoginOutcome =
  | { requiresTwoFactor: false; token: string; expiresAt: Date; user: LoginUser }
  | { requiresTwoFactor: true; challenge: string; challengeExpiresAt: Date };

/** Tantangan 2FA berlaku singkat dan dibatasi percobaannya. */
const CHALLENGE_MINUTES = 5;
const CHALLENGE_MAX_ATTEMPTS = 5;

/**
 * Langkah 1 login: email + password. Bila akun memakai 2FA, mengembalikan tantangan (tanpa sesi); selain itu sesi langsung dibuat.
 */
export async function startLogin(input: { email: string; password: string }, meta: RequestMeta): Promise<LoginOutcome> {
  const email = normalizeEmail(input.email);
  const cfg = limits();
  const emailKey = `login:email:${hashKey(email)}`;
  const ipKey = meta.ip ? `login:ip:${hashKey(meta.ip)}` : null;

  const waits = await Promise.all([blockedSeconds(emailKey), ipKey ? blockedSeconds(ipKey) : Promise.resolve(0)]);
  const wait = Math.max(...waits);
  if (wait > 0) {
    throw Errors.rateLimited(`Terlalu banyak percobaan masuk. Coba lagi dalam ${Math.ceil(wait / 60)} menit.`, {
      retryAfterSeconds: wait,
    });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // Selalu jalankan verifikasi (hash dummy bila user tidak ada) agar waktu respons seragam.
  const ok = await verifyPassword(input.password, user?.passwordHash ?? (await dummyHash()));

  if (!user || !ok || !user.isActive) {
    const [e] = await Promise.all([recordFailure(emailKey, cfg.email), ipKey ? recordFailure(ipKey, cfg.ip) : null]);
    if (user) {
      await writeAudit(prisma, null, {
        action: "auth.login_failed",
        entityType: "User",
        entityId: user.id,
        summary: user.isActive ? "Percobaan masuk gagal (password salah)" : "Percobaan masuk ke akun nonaktif",
        after: { email, ip: meta.ip, lockedOut: e.blocked },
      });
    }
    throw Errors.unauthenticated(GENERIC_FAIL);
  }

  if (user.twoFactorEnabled) {
    // Password benar, tetapi sesi BELUM dibuat: perlu kode 2FA. Hash tantangan saja yang disimpan.
    const challenge = randomBytes(32).toString("base64url");
    const challengeExpiresAt = new Date(Date.now() + CHALLENGE_MINUTES * 60_000);
    await prisma.$transaction([
      prisma.loginChallenge.deleteMany({ where: { OR: [{ userId: user.id, createdAt: { lt: new Date(Date.now() - CHALLENGE_MINUTES * 60_000) } }, { expiresAt: { lt: new Date() } }] } }),
      prisma.loginChallenge.create({ data: { userId: user.id, tokenHash: hashToken(challenge), expiresAt: challengeExpiresAt, ip: meta.ip } }),
    ]);
    return { requiresTwoFactor: true, challenge, challengeExpiresAt };
  }
  return finishLogin(user, input.password, meta, emailKey);
}

/** Dipakai pemanggil yang tidak menangani 2FA (mis. tes lama): gagal tegas bila akun memakai 2FA. */
export async function login(input: { email: string; password: string }, meta: RequestMeta): Promise<{ token: string; expiresAt: Date; user: LoginUser }> {
  const r = await startLogin(input, meta);
  if (r.requiresTwoFactor) throw Errors.conflict("Akun ini memakai autentikasi dua langkah; selesaikan verifikasi kode.");
  return r;
}

async function finishLogin(
  user: { id: string; email: string; name: string; role: Role; passwordHash: string; mustChangePassword: boolean },
  plainPassword: string | null, meta: RequestMeta, emailKey: string, via?: string,
): Promise<Extract<LoginOutcome, { requiresTwoFactor: false }>> {
  await resetBucket(emailKey);
  const { token, expiresAt } = await createSession(user.id, meta.ip, meta.userAgent);
  await transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        // Naikkan parameter hash secara transparan bila kebijakan berubah.
        ...(plainPassword !== null && needsRehash(user.passwordHash) ? { passwordHash: await hashPassword(plainPassword) } : {}),
      },
    });
    await writeAudit(tx, { userId: user.id, email: user.email, name: user.name, role: user.role, employeeId: null, ...meta }, {
      action: "auth.login", entityType: "User", entityId: user.id, summary: via ? `Masuk (${via})` : "Masuk",
    });
  });
  void purgeOldSessions().catch(() => undefined);
  return {
    requiresTwoFactor: false, token, expiresAt,
    user: { id: user.id, email: user.email, name: user.name, role: user.role, mustChangePassword: user.mustChangePassword },
  };
}

const challengeSchema = z.object({ challenge: z.string().min(20).max(200), code: z.string().trim().min(6, "Masukkan kode verifikasi").max(20) });

/**
 * Langkah 2 login: tantangan + kode TOTP/pemulihan. Tantangan sekali pakai & maksimal 5 percobaan; gagal berulang memicu
 * penguncian per pengguna (bucket yang sama dengan tindakan keamanan akun).
 */
export async function completeLogin(raw: unknown, meta: RequestMeta): Promise<Extract<LoginOutcome, { requiresTwoFactor: false }>> {
  const input = parseInput(challengeSchema, raw);
  const ch = await prisma.loginChallenge.findUnique({ where: { tokenHash: hashToken(input.challenge) }, include: { user: true } });
  if (!ch || ch.expiresAt.getTime() <= Date.now() || !ch.user.isActive) {
    throw Errors.unauthenticated("Verifikasi kedaluwarsa. Masuk kembali dengan email dan password.");
  }
  await assertTwoFactorNotBlocked(ch.userId);
  if (ch.attempts >= CHALLENGE_MAX_ATTEMPTS) {
    await prisma.loginChallenge.deleteMany({ where: { id: ch.id } });
    throw Errors.unauthenticated("Terlalu banyak kode salah. Masuk kembali dengan email dan password.");
  }
  const v = await verifySecondFactor(ch.userId, input.code);
  if (!v.ok) {
    await Promise.all([
      prisma.loginChallenge.update({ where: { id: ch.id }, data: { attempts: { increment: 1 } } }),
      recordTwoFactorFailure(ch.userId),
    ]);
    await writeAudit(prisma, null, { action: "auth.2fa_failed", entityType: "User", entityId: ch.userId, summary: "Kode 2FA salah saat masuk", after: { ip: meta.ip } });
    throw Errors.unauthenticated("Kode verifikasi salah atau sudah dipakai.");
  }
  // Tantangan sekali pakai: hapus secara atomik; bila sudah terhapus oleh permintaan lain, tolak.
  const gone = await prisma.loginChallenge.deleteMany({ where: { id: ch.id } });
  if (gone.count === 0) throw Errors.unauthenticated("Verifikasi sudah dipakai. Masuk kembali.");
  await resetBucket(twoFactorBucketKey(ch.userId));
  const emailKey = `login:email:${hashKey(ch.user.email)}`;
  const out = await finishLogin(ch.user, null, meta, emailKey, v.method === "recovery" ? "2FA, kode pemulihan" : "2FA");
  if (v.method === "recovery") {
    const left = await prisma.twoFactorRecoveryCode.count({ where: { userId: ch.userId, usedAt: null } });
    await writeAudit(prisma, null, { action: "auth.2fa_recovery_used", entityType: "User", entityId: ch.userId, summary: `Kode pemulihan 2FA dipakai (sisa ${left})` });
  }
  return out;
}

export async function logout(token: string | undefined, actor: Actor | null): Promise<void> {
  if (token) await revokeSessionByToken(token);
  if (actor) {
    await writeAudit(prisma, actor, { action: "auth.logout", entityType: "User", entityId: actor.userId, summary: "Keluar" });
  }
}

export async function changeOwnPassword(
  actor: Actor & { sessionId?: string },
  input: { currentPassword: string; newPassword: string },
): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id: actor.userId } });
  if (!user) throw Errors.notFound("Pengguna");
  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    throw Errors.validation("Password saat ini salah.", { currentPassword: "Password saat ini salah." });
  }
  const weak = validatePasswordStrength(input.newPassword, { email: user.email, name: user.name });
  if (weak) throw Errors.validation(weak, { newPassword: weak });
  if (input.newPassword === input.currentPassword) {
    throw Errors.validation("Password baru harus berbeda.", { newPassword: "Password baru harus berbeda." });
  }
  const passwordHash = await hashPassword(input.newPassword);
  await transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
    await writeAudit(tx, actor, { action: "auth.password_changed", entityType: "User", entityId: user.id, summary: "Password diganti" });
  });
  // Cabut sesi lain; sesi saat ini tetap aktif.
  await revokeAllSessions(user.id, actor.sessionId);
}
