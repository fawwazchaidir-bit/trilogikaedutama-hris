import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db";
import { env, isSecureDeployment } from "../env";
import type { Actor } from "../actor";

/**
 * Sesi berbasis cookie opaque. Token acak 256-bit; yang disimpan di DB hanya SHA-256-nya,
 * sehingga kebocoran tabel `sessions` tidak memberi akses. Sesi dapat dicabut kapan saja
 * (logout, nonaktifkan pengguna, ganti password).
 */

export const SESSION_COOKIE_NAME = () => (isSecureDeployment() ? "__Host-hris_session" : "hris_session");

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function cookieOptions(expires: Date) {
  return {
    httpOnly: true,
    secure: isSecureDeployment(),
    sameSite: "lax" as const,
    path: "/",
    expires,
  };
}

export async function createSession(userId: string, ip: string | null, userAgent: string | null) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + env().SESSION_ABSOLUTE_DAYS * 86_400_000);
  await prisma.session.create({
    data: { userId, tokenHash: hashToken(token), expiresAt, ip, userAgent: userAgent?.slice(0, 300) ?? null },
  });
  return { token, expiresAt };
}

/**
 * Kebijakan "2FA wajib untuk admin" dibaca pada tiap permintaan; di-cache singkat agar tidak menambah query tiap request.
 * Perubahan pengaturan menghapus cache proses ini (instance lain mengikuti dalam ≤ 15 detik).
 */
// Disimpan di globalThis: Next membangun grafik modul terpisah untuk halaman (RSC) dan route handler, sehingga variabel
// tingkat-modul biasa TIDAK ikut terhapus saat pengaturan diubah lewat API (kebijakan baru baru berlaku di halaman setelah 15 detik).
const policyStore = globalThis as unknown as { __securityPolicyCache?: { at: number; adminsRequire2fa: boolean } | null };
export function invalidateSecurityPolicyCache(): void { policyStore.__securityPolicyCache = null; }
async function adminsRequireTwoFactor(): Promise<boolean> {
  const hit = policyStore.__securityPolicyCache;
  if (hit && Date.now() - hit.at < 15_000) return hit.adminsRequire2fa;
  const s = await prisma.companySettings.findUnique({ where: { id: 1 }, select: { twoFactorRequiredForAdmins: true } });
  const fresh = { at: Date.now(), adminsRequire2fa: !!s?.twoFactorRequiredForAdmins };
  policyStore.__securityPolicyCache = fresh;
  return fresh.adminsRequire2fa;
}

export interface SessionUser extends Actor {
  sessionId: string;
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
  /** Kebijakan mewajibkan 2FA untuk peran ini tetapi belum diaktifkan → hanya halaman/API pengaturan 2FA yang boleh dipakai. */
  mustSetupTwoFactor: boolean;
  /** Akun demonstrasi (hanya untuk pengujian) → antarmuka menampilkan banner peringatan. */
  isDemo: boolean;
}

/** Validasi token → pengguna. Mengembalikan null bila tidak valid / kedaluwarsa / idle / pengguna nonaktif. */
export async function validateSession(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { employee: { select: { id: true } } } } },
  });
  if (!session || session.revokedAt) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) return null;
  if (now - session.lastSeenAt.getTime() > env().SESSION_IDLE_HOURS * 3_600_000) return null;
  if (!session.user.isActive) return null;

  // Sliding idle window; tulis paling sering 1×/menit agar tidak membebani DB.
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  return {
    sessionId: session.id,
    userId: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    employeeId: session.user.employee?.id ?? null,
    mustChangePassword: session.user.mustChangePassword,
    twoFactorEnabled: session.user.twoFactorEnabled,
    mustSetupTwoFactor: session.user.role !== "EMPLOYEE" && !session.user.twoFactorEnabled && (await adminsRequireTwoFactor()),
    isDemo: session.user.isDemo,
  };
}

/**
 * Apakah sesi ini MASIH berlaku? Hanya-baca: TIDAK menggeser jendela idle (`lastSeenAt`). Dipakai aliran SSE Obrolan agar koneksi yang terbuka
 * tidak memperpanjang sesi tanpa batas; sesi dicabut/kedaluwarsa/idle atau pengguna dinonaktifkan → aliran ditutup.
 */
export async function isSessionAlive(sessionId: string): Promise<boolean> {
  const s = await prisma.session.findUnique({ where: { id: sessionId }, select: { revokedAt: true, expiresAt: true, lastSeenAt: true, user: { select: { isActive: true } } } });
  if (!s || s.revokedAt || !s.user.isActive) return false;
  const now = Date.now();
  return s.expiresAt.getTime() > now && now - s.lastSeenAt.getTime() <= env().SESSION_IDLE_HOURS * 3_600_000;
}

export async function revokeSessionByToken(token: string): Promise<void> {
  await prisma.session.updateMany({
    where: { tokenHash: hashToken(token), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string): Promise<void> {
  await prisma.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: new Date() },
  });
}

/** Housekeeping: hapus sesi kedaluwarsa > 30 hari (dipanggil oportunistik saat login). */
export async function purgeOldSessions(): Promise<void> {
  const cutoff = new Date(Date.now() - 30 * 86_400_000);
  await prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] } });
}
