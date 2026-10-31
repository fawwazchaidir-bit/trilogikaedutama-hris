import "server-only";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { prisma, transaction } from "../db";
import { env } from "../env";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import { writeAudit } from "../audit";
import type { RequestMeta } from "../request-context";
import { hashPassword, validatePasswordStrength } from "../auth/password";
import { blockedSeconds, hashKey, recordFailure } from "../auth/rate-limit";
import { hashToken, revokeAllSessions } from "../auth/session";
import { emailAvailable, sendEmail } from "../notify/transports";
import { normalizeEmail } from "./auth";
import { assertTwoFactorNotBlocked, recordTwoFactorFailure, verifySecondFactor } from "./two-factor";
import { notifyUsers } from "./notifications";

/** Pesan seragam: tidak membocorkan apakah email terdaftar. */
export const RESET_REQUESTED_MESSAGE = "Jika email terdaftar, tautan pengaturan ulang password telah dikirim. Periksa kotak masuk (dan folder spam). Tautan berlaku singkat dan hanya sekali pakai.";

const requestSchema = z.object({ email: z.string().trim().min(1, "Email wajib diisi").max(200) });

/** Permintaan reset dibatasi: per email 3 / jam, per IP 10 / jam — dihitung untuk SETIAP permintaan (bukan hanya yang gagal). */
const REQ_EMAIL = { max: 3, windowMs: 3_600_000, blockMs: 3_600_000 };
const REQ_IP = { max: 10, windowMs: 3_600_000, blockMs: 3_600_000 };

export function resetConfigured(): boolean {
  return emailAvailable();
}

export async function requestPasswordReset(raw: unknown, meta: RequestMeta): Promise<{ message: string }> {
  const input = parseInput(requestSchema, raw);
  if (!resetConfigured()) {
    throw Errors.validation("Fitur lupa password mandiri belum diaktifkan (email belum dikonfigurasi). Hubungi Admin/HR untuk mengatur ulang password Anda.");
  }
  const email = normalizeEmail(input.email);
  const emailKey = `reset:email:${hashKey(email)}`;
  const ipKey = meta.ip ? `reset:ip:${hashKey(meta.ip)}` : null;
  const waits = await Promise.all([blockedSeconds(emailKey), ipKey ? blockedSeconds(ipKey) : Promise.resolve(0)]);
  const wait = Math.max(...waits);
  if (wait > 0) throw Errors.rateLimited(`Terlalu banyak permintaan. Coba lagi dalam ${Math.ceil(wait / 60)} menit.`, { retryAfterSeconds: wait });
  await Promise.all([recordFailure(emailKey, REQ_EMAIL), ipKey ? recordFailure(ipKey, REQ_IP) : null]);

  const user = await prisma.user.findUnique({ where: { email } });
  if (user?.isActive) {
    const token = randomBytes(32).toString("base64url");
    const minutes = env().PASSWORD_RESET_MINUTES;
    await transaction(async (tx) => {
      // Hanya satu tautan aktif: yang lama dicabut.
      await tx.passwordResetToken.deleteMany({ where: { userId: user.id, usedAt: null } });
      await tx.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + minutes * 60_000), requestIp: meta.ip } });
      await writeAudit(tx, null, { action: "auth.password_reset_requested", entityType: "User", entityId: user.id, summary: "Permintaan reset password mandiri", after: { ip: meta.ip } });
    });
    const brand = (await prisma.companySettings.findUnique({ where: { id: 1 }, select: { name: true } }))?.name ?? "Trilogika Edutama";
    const link = `${env().APP_URL.replace(/\/$/, "")}/reset-password?token=${token}`;
    // Tidak di-await: waktu respons sama untuk email terdaftar maupun tidak (anti user-enumeration). Token tidak pernah masuk outbox.
    void sendEmail({
      to: user.email, subject: `[${brand}] Atur ulang password`,
      text: `Halo ${user.name},\n\nKami menerima permintaan mengatur ulang password akun HRIS Anda.\n\nBuka tautan berikut (berlaku ${minutes} menit, hanya sekali pakai):\n${link}\n\nJika bukan Anda yang meminta, abaikan email ini — password Anda tidak berubah.\n\n— ${brand} HRIS`,
    }).catch((e) => {
      console.error("[password-reset] gagal mengirim email:", e instanceof Error ? e.message : e);
      void writeAudit(prisma, null, { action: "auth.password_reset_email_failed", entityType: "User", entityId: user.id, summary: "Email reset password gagal terkirim" }).catch(() => undefined);
    });
  }
  return { message: RESET_REQUESTED_MESSAGE };
}

async function findValidToken(token: string) {
  if (token.length < 20 || token.length > 200) return null;
  const row = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now() || !row.user.isActive) return null;
  return row;
}

/** Periksa tautan (untuk menampilkan formulir yang tepat): sah/tidak, dan apakah akun memakai 2FA. */
export async function inspectResetToken(token: string): Promise<{ valid: boolean; needsTwoFactor: boolean }> {
  const row = await findValidToken(token);
  return { valid: !!row, needsTwoFactor: !!row?.user.twoFactorEnabled };
}

const resetSchema = z.object({
  token: z.string().min(20).max(200),
  newPassword: z.string().min(1, "Password baru wajib diisi").max(128),
  code: z.string().trim().max(20).optional(),
});

const INVALID = "Tautan tidak valid atau sudah kedaluwarsa. Minta tautan baru.";

/**
 * Atur password dengan tautan sekali pakai. Akun ber-2FA WAJIB menyertakan kode (TOTP/pemulihan) — kalau tidak, siapa pun yang
 * menguasai email dapat melewati 2FA. Sukses mencabut SEMUA sesi dan semua tautan reset lain milik akun itu.
 */
export async function resetPassword(raw: unknown, meta: RequestMeta): Promise<void> {
  const input = parseInput(resetSchema, raw);
  const ipKey = meta.ip ? `reset-use:ip:${hashKey(meta.ip)}` : null;
  const tokenKey = `reset-use:token:${hashKey(input.token)}`;
  const cfg = { max: 10, windowMs: 3_600_000, blockMs: 3_600_000 };
  const waits = await Promise.all([blockedSeconds(tokenKey), ipKey ? blockedSeconds(ipKey) : Promise.resolve(0)]);
  if (Math.max(...waits) > 0) throw Errors.rateLimited("Terlalu banyak percobaan. Coba lagi nanti.", { retryAfterSeconds: Math.max(...waits) });

  const row = await findValidToken(input.token);
  if (!row) {
    await Promise.all([recordFailure(tokenKey, cfg), ipKey ? recordFailure(ipKey, { ...cfg, max: 30 }) : null]);
    throw Errors.validation(INVALID);
  }
  const user = row.user;
  if (user.twoFactorEnabled) {
    await assertTwoFactorNotBlocked(user.id);
    if (!input.code) throw Errors.validation("Akun ini memakai autentikasi dua langkah: masukkan kode dari aplikasi autentikator (atau kode pemulihan).", { code: "Kode wajib diisi" });
    const v = await verifySecondFactor(user.id, input.code);
    if (!v.ok) {
      await Promise.all([recordTwoFactorFailure(user.id), recordFailure(tokenKey, cfg)]);
      throw Errors.validation("Kode verifikasi salah atau sudah dipakai.", { code: "Kode salah atau sudah dipakai" });
    }
  }
  const weak = validatePasswordStrength(input.newPassword, { email: user.email, name: user.name });
  if (weak) throw Errors.validation(weak, { newPassword: weak });
  const passwordHash = await hashPassword(input.newPassword);
  await transaction(async (tx) => {
    // Klaim token secara atomik: hanya satu permintaan paralel yang menang.
    const claimed = await tx.passwordResetToken.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (claimed.count === 0) throw Errors.validation(INVALID);
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } });
    await tx.passwordResetToken.deleteMany({ where: { userId: user.id, id: { not: row.id } } });
    await writeAudit(tx, { userId: user.id, email: user.email, name: user.name, role: user.role, employeeId: null, ...meta }, {
      action: "auth.password_reset", entityType: "User", entityId: user.id, summary: "Password diatur ulang lewat tautan email",
    });
    await notifyUsers(tx, [user.id], { type: "auth.password_changed", title: "Password akun Anda diubah", body: "Password diubah lewat tautan lupa password. Jika bukan Anda, segera hubungi Admin/HR." });
  });
  await revokeAllSessions(user.id);
}
