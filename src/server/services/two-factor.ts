import "server-only";
import { createHash } from "node:crypto";
import QRCode from "qrcode";
import { z } from "zod";
import { prisma, transaction } from "../db";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import { assertCan, type Actor } from "../actor";
import { writeAudit } from "../audit";
import { decryptField, encryptField } from "../crypto";
import { env } from "../env";
import { verifyPassword } from "../auth/password";
import { twoFactorRequired } from "@/lib/two-factor-policy";
import { blockedSeconds, recordFailure, resetBucket } from "../auth/rate-limit";
import { revokeAllSessions } from "../auth/session";
import { notifyUsers } from "./notifications";
import { generateRecoveryCode, generateTotpSecret, looksLikeRecoveryCode, normalizeRecoveryCode, otpauthUri, verifyTotp } from "@/lib/totp";

export const RECOVERY_CODE_COUNT = 10;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Batas percobaan kode 2FA / password pada tindakan keamanan akun: sama dengan batas login (per pengguna). */
export const twoFactorBucketKey = (userId: string) => `twofa:user:${userId}`;

function limitCfg() {
  const e = env();
  return { max: e.LOGIN_MAX_ATTEMPTS, windowMs: e.LOGIN_WINDOW_MINUTES * 60_000, blockMs: e.LOGIN_LOCKOUT_MINUTES * 60_000 };
}

export async function assertTwoFactorNotBlocked(userId: string): Promise<void> {
  const wait = await blockedSeconds(twoFactorBucketKey(userId));
  if (wait > 0) throw Errors.rateLimited(`Terlalu banyak percobaan salah. Coba lagi dalam ${Math.ceil(wait / 60)} menit.`, { retryAfterSeconds: wait });
}

export async function recordTwoFactorFailure(userId: string): Promise<void> {
  await recordFailure(twoFactorBucketKey(userId), limitCfg());
}

export interface SecondFactorResult { ok: boolean; method?: "totp" | "recovery" }

/**
 * Verifikasi faktor kedua: kode TOTP 6 digit ATAU kode pemulihan. Keduanya sekali pakai:
 *  - TOTP: langkah waktu harus lebih besar dari yang terakhir diterima (anti-replay, atomik di database).
 *  - Pemulihan: ditandai terpakai dengan UPDATE bersyarat (dua permintaan paralel tidak mungkin sama-sama berhasil).
 * Pemanggil bertanggung jawab atas pembatasan percobaan (`assertTwoFactorNotBlocked` / `recordTwoFactorFailure`).
 */
export async function verifySecondFactor(userId: string, code: string): Promise<SecondFactorResult> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true, twoFactorSecretEnc: true, twoFactorLastStep: true } });
  if (!user?.twoFactorEnabled || !user.twoFactorSecretEnc) return { ok: false };
  if (looksLikeRecoveryCode(code)) {
    const r = await prisma.twoFactorRecoveryCode.updateMany({ where: { userId, codeHash: sha256(normalizeRecoveryCode(code)), usedAt: null }, data: { usedAt: new Date() } });
    return r.count === 1 ? { ok: true, method: "recovery" } : { ok: false };
  }
  const v = verifyTotp(decryptField(user.twoFactorSecretEnc), code, { lastStep: user.twoFactorLastStep });
  if (!v.ok || v.step === undefined) return { ok: false };
  // Klaim langkah secara atomik: hanya satu permintaan yang dapat memajukan langkah terakhir.
  const claimed = await prisma.$executeRaw`UPDATE users SET "twoFactorLastStep" = ${v.step} WHERE id = ${userId}::uuid AND ("twoFactorLastStep" IS NULL OR "twoFactorLastStep" < ${v.step})`;
  return claimed === 1 ? { ok: true, method: "totp" } : { ok: false };
}

/** Periksa password + (bila diminta) faktor kedua untuk tindakan sensitif pada akun sendiri. */
async function reauthenticate(actor: Actor, password: string, code: string | null): Promise<void> {
  await assertTwoFactorNotBlocked(actor.userId);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!(await verifyPassword(password, user.passwordHash))) {
    await recordTwoFactorFailure(actor.userId);
    throw Errors.validation("Password salah.", { password: "Password salah." });
  }
  if (code !== null) {
    const v = await verifySecondFactor(actor.userId, code);
    if (!v.ok) {
      await recordTwoFactorFailure(actor.userId);
      throw Errors.validation("Kode verifikasi salah atau sudah dipakai.", { code: "Kode salah atau sudah dipakai" });
    }
  }
}

export interface TwoFactorStatus { enabled: boolean; enabledAt: string | null; recoveryRemaining: number }

export async function getTwoFactorStatus(actor: Actor): Promise<TwoFactorStatus> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { twoFactorEnabled: true, twoFactorEnabledAt: true } });
  const remaining = u.twoFactorEnabled ? await prisma.twoFactorRecoveryCode.count({ where: { userId: actor.userId, usedAt: null } }) : 0;
  return { enabled: u.twoFactorEnabled, enabledAt: u.twoFactorEnabledAt?.toISOString() ?? null, recoveryRemaining: remaining };
}

const passwordSchema = z.object({ password: z.string().min(1, "Password wajib diisi").max(256) });
const codeSchema = z.object({ code: z.string().trim().min(6, "Masukkan kode 6 digit").max(20) });
const reauthSchema = passwordSchema.merge(codeSchema);

export interface TwoFactorSetup { secret: string; otpauthUri: string; qrSvg: string }

/** Langkah 1: buat rahasia baru (belum aktif). Memerlukan password. Memanggil ulang membuat rahasia baru. */
export async function beginTwoFactorSetup(actor: Actor, raw: unknown): Promise<TwoFactorSetup> {
  const { password } = parseInput(passwordSchema, raw);
  await reauthenticate(actor, password, null);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { twoFactorEnabled: true, email: true } });
  if (user.twoFactorEnabled) throw Errors.conflict("Autentikasi dua langkah sudah aktif.");
  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: actor.userId }, data: { twoFactorSecretEnc: encryptField(secret) } });
  const brand = (await prisma.companySettings.findUnique({ where: { id: 1 }, select: { name: true } }))?.name ?? "Trilogika HRIS";
  const uri = otpauthUri({ issuer: brand, account: user.email, secret });
  const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, width: 200, errorCorrectionLevel: "M" });
  return { secret, otpauthUri: uri, qrSvg };
}

async function newRecoveryCodes(tx: Parameters<Parameters<typeof transaction>[0]>[0], userId: string): Promise<string[]> {
  await tx.twoFactorRecoveryCode.deleteMany({ where: { userId } });
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => generateRecoveryCode());
  await tx.twoFactorRecoveryCode.createMany({ data: codes.map((c) => ({ userId, codeHash: sha256(normalizeRecoveryCode(c)) })) });
  return codes;
}

/** Langkah 2: konfirmasi dengan kode dari aplikasi autentikator → aktif. Mengembalikan kode pemulihan SATU KALI. */
export async function enableTwoFactor(actor: Actor & { sessionId?: string }, raw: unknown): Promise<{ recoveryCodes: string[] }> {
  const { code } = parseInput(codeSchema, raw);
  await assertTwoFactorNotBlocked(actor.userId);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (user.twoFactorEnabled) throw Errors.conflict("Autentikasi dua langkah sudah aktif.");
  if (!user.twoFactorSecretEnc) throw Errors.validation("Mulai pengaturan dari awal (rahasia belum dibuat).");
  const v = verifyTotp(decryptField(user.twoFactorSecretEnc), code);
  if (!v.ok || v.step === undefined) {
    await recordTwoFactorFailure(actor.userId);
    throw Errors.validation("Kode tidak cocok. Pastikan jam ponsel akurat, lalu coba kode berikutnya.", { code: "Kode tidak cocok" });
  }
  const codes = await transaction(async (tx) => {
    const r = await tx.user.updateMany({ where: { id: actor.userId, twoFactorEnabled: false }, data: { twoFactorEnabled: true, twoFactorEnabledAt: new Date(), twoFactorLastStep: v.step } });
    if (r.count === 0) throw Errors.conflict("Autentikasi dua langkah sudah aktif.");
    const c = await newRecoveryCodes(tx, actor.userId);
    await writeAudit(tx, actor, { action: "auth.2fa_enabled", entityType: "User", entityId: actor.userId, summary: "Autentikasi dua langkah diaktifkan" });
    return c;
  });
  await resetBucket(twoFactorBucketKey(actor.userId));
  await revokeAllSessions(actor.userId, actor.sessionId);
  return { recoveryCodes: codes };
}

/** Matikan 2FA sendiri: perlu password + kode. Ditolak bila kebijakan mewajibkannya untuk peran ini. */
export async function disableTwoFactor(actor: Actor & { sessionId?: string }, raw: unknown): Promise<void> {
  const { password, code } = parseInput(reauthSchema, raw);
  const settings = await prisma.companySettings.findUnique({ where: { id: 1 }, select: { twoFactorRequiredForAdmins: true } });
  if (twoFactorRequired(actor.role, !!settings?.twoFactorRequiredForAdmins)) {
    throw Errors.forbidden("Kebijakan perusahaan mewajibkan 2FA untuk Direktur dan HR; tidak dapat dimatikan.");
  }
  await reauthenticate(actor, password, code);
  await transaction(async (tx) => {
    await tx.user.update({ where: { id: actor.userId }, data: { twoFactorEnabled: false, twoFactorSecretEnc: null, twoFactorEnabledAt: null, twoFactorLastStep: null } });
    await tx.twoFactorRecoveryCode.deleteMany({ where: { userId: actor.userId } });
    await writeAudit(tx, actor, { action: "auth.2fa_disabled", entityType: "User", entityId: actor.userId, summary: "Autentikasi dua langkah dimatikan" });
  });
  await resetBucket(twoFactorBucketKey(actor.userId));
  await revokeAllSessions(actor.userId, actor.sessionId);
}

/** Buat ulang kode pemulihan (yang lama hangus). Perlu password + kode. */
export async function regenerateRecoveryCodes(actor: Actor, raw: unknown): Promise<{ recoveryCodes: string[] }> {
  const { password, code } = parseInput(reauthSchema, raw);
  const st = await getTwoFactorStatus(actor);
  if (!st.enabled) throw Errors.validation("Autentikasi dua langkah belum aktif.");
  await reauthenticate(actor, password, code);
  const codes = await transaction(async (tx) => {
    const c = await newRecoveryCodes(tx, actor.userId);
    await writeAudit(tx, actor, { action: "auth.2fa_recovery_regenerated", entityType: "User", entityId: actor.userId, summary: "Kode pemulihan 2FA dibuat ulang" });
    return c;
  });
  await resetBucket(twoFactorBucketKey(actor.userId));
  return { recoveryCodes: codes };
}

/**
 * Super Admin mengatur ulang 2FA akun lain (mis. ponsel hilang & kode pemulihan habis). Tidak dapat untuk akun sendiri.
 * Semua sesi akun itu dicabut; bila 2FA wajib bagi admin, akun itu harus mengaktifkan ulang saat masuk berikutnya.
 */
export async function resetUserTwoFactor(actor: Actor, userId: string): Promise<void> {
  assertCan(actor, "user:reset_2fa");
  if (userId === actor.userId) throw Errors.validation("Gunakan kode pemulihan untuk akun Anda sendiri; reset hanya untuk akun lain.");
  await transaction(async (tx) => {
    const u = await tx.user.findUnique({ where: { id: userId }, select: { email: true, twoFactorEnabled: true } });
    if (!u) throw Errors.notFound("Pengguna");
    if (!u.twoFactorEnabled) throw Errors.conflict("Akun ini tidak memakai autentikasi dua langkah.");
    await tx.user.update({ where: { id: userId }, data: { twoFactorEnabled: false, twoFactorSecretEnc: null, twoFactorEnabledAt: null, twoFactorLastStep: null } });
    await tx.twoFactorRecoveryCode.deleteMany({ where: { userId } });
    await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    await writeAudit(tx, actor, { action: "auth.2fa_reset", entityType: "User", entityId: userId, summary: `2FA akun ${u.email} diatur ulang oleh admin` });
    await notifyUsers(tx, [userId], { type: "auth.2fa_reset", title: "Autentikasi dua langkah Anda diatur ulang", body: "Admin mengatur ulang 2FA akun Anda. Aktifkan kembali di menu Keamanan & Notifikasi.", href: "/akun" });
  });
  await resetBucket(twoFactorBucketKey(userId));
}
