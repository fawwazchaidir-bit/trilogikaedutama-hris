import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { transaction } from "@/server/db";
import { completeLogin, login, startLogin } from "@/server/services/auth";
import { beginTwoFactorSetup, disableTwoFactor, enableTwoFactor, getTwoFactorStatus, regenerateRecoveryCodes, resetUserTwoFactor } from "@/server/services/two-factor";
import { requestPasswordReset, resetPassword, inspectResetToken, RESET_REQUESTED_MESSAGE } from "@/server/services/password-reset";
import { getAccount, sendTestNotification, updateNotificationPrefs } from "@/server/services/account";
import { listNotifications, notifyUsers } from "@/server/services/notifications";
import { retryFailedDeliveries, getDeliveryStats, runDeliveriesNow } from "@/server/services/delivery-admin";
import { backoffSeconds, composeMessage, MAX_ATTEMPTS, processDeliveries } from "@/server/notify/deliveries";
import { buildWhatsappRequest, setTransportsForTest } from "@/server/notify/transports";
import { createSession, validateSession } from "@/server/auth/session";
import { updateSecurityPolicy } from "@/server/services/settings";
import { env } from "@/server/env";
import { generateTotpSecret, totpAt } from "@/lib/totp";
import { decryptField } from "@/server/crypto";
import { resetDb, seedFixtures, TEST_PASSWORD, type Fixtures } from "../helpers/db";

let fx: Fixtures;
const META = { ip: "10.0.0.1", userAgent: "vitest" };
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };

interface Capture { emails: { to: string; subject: string; text: string }[]; wa: { to: string; text: string }[]; failEmail: boolean; failWa: boolean }
let cap: Capture;
const waitFor = async (cond: () => boolean, ms = 1500) => { const t = Date.now(); while (!cond() && Date.now() - t < ms) await new Promise((r) => setTimeout(r, 10)); };

beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
  cap = { emails: [], wa: [], failEmail: false, failWa: false };
  setTransportsForTest({
    email: async (m) => { if (cap.failEmail) throw new Error("SMTP down"); cap.emails.push(m); },
    whatsapp: async (m) => { if (cap.failWa) throw new Error("WA gateway 500"); cap.wa.push(m); },
  });
});
afterEach(() => setTransportsForTest(null));

/** Aktifkan 2FA untuk aktor dan kembalikan rahasia + kode pemulihan. */
async function enable2fa(actor: typeof fx.emp1) {
  const setup = await beginTwoFactorSetup(actor, { password: TEST_PASSWORD });
  const { recoveryCodes } = await enableTwoFactor(actor, { code: totpAt(setup.secret, Date.now()) });
  return { secret: setup.secret, recoveryCodes };
}
/** Kode TOTP untuk langkah SETELAH yang terakhir dipakai (replay-safe) — memajukan 1 langkah (masih dalam toleransi ±1). */
const nextCode = (secret: string, stepsAhead = 1) => totpAt(secret, Date.now() + stepsAhead * 30_000);
/** Simulasikan berlalunya waktu: langkah yang sudah dipakai dianggap lama, sehingga kode langkah sekarang/berikutnya sah lagi. */
const timePasses = (userId: string) => prisma.user.update({ where: { id: userId }, data: { twoFactorLastStep: Math.floor(Date.now() / 30_000) - 5 } });

// ─────────────────────────── 2FA ───────────────────────────

describe("2FA — pengaturan", () => {
  it("setup perlu password; rahasia tersimpan terenkripsi; enable perlu kode benar; kode pemulihan 10 buah diberikan sekali", async () => {
    expect((await fail(beginTwoFactorSetup(fx.emp1, { password: "salah-banget-1" })))?.fieldErrors?.password).toBeTruthy();
    const setup = await beginTwoFactorSetup(fx.emp1, { password: TEST_PASSWORD });
    expect(setup.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(setup.otpauthUri).toContain("otpauth://totp/");
    expect(setup.qrSvg).toContain("<svg");
    const row = await prisma.user.findUniqueOrThrow({ where: { id: fx.emp1.userId } });
    expect(row.twoFactorEnabled).toBe(false);
    expect(row.twoFactorSecretEnc).toMatch(/^v1:/);
    expect(row.twoFactorSecretEnc).not.toContain(setup.secret);
    expect(decryptField(row.twoFactorSecretEnc!)).toBe(setup.secret);

    expect((await fail(enableTwoFactor(fx.emp1, { code: "000000" })))?.fieldErrors?.code).toBeTruthy();
    const r = await enableTwoFactor(fx.emp1, { code: totpAt(setup.secret, Date.now()) });
    expect(r.recoveryCodes).toHaveLength(10);
    expect(new Set(r.recoveryCodes).size).toBe(10);
    expect(await getTwoFactorStatus(fx.emp1)).toMatchObject({ enabled: true, recoveryRemaining: 10 });
    // kode pemulihan hanya hash di database
    const stored = await prisma.twoFactorRecoveryCode.findMany({ where: { userId: fx.emp1.userId } });
    expect(stored).toHaveLength(10);
    expect(stored.every((c) => !r.recoveryCodes.some((x) => c.codeHash.includes(x.replace("-", ""))))).toBe(true);
    // mengaktifkan lagi / setup ulang ditolak
    expect((await fail(beginTwoFactorSetup(fx.emp1, { password: TEST_PASSWORD })))?.code).toBe("CONFLICT");
    expect((await fail(enableTwoFactor(fx.emp1, { code: "123456" })))?.code).toBe("CONFLICT");
  });

  it("memanggil setup dua kali membuat rahasia baru (rahasia lama tidak berlaku)", async () => {
    const a = await beginTwoFactorSetup(fx.emp1, { password: TEST_PASSWORD });
    const b = await beginTwoFactorSetup(fx.emp1, { password: TEST_PASSWORD });
    expect(a.secret).not.toBe(b.secret);
    expect((await fail(enableTwoFactor(fx.emp1, { code: totpAt(a.secret, Date.now()) })))?.code).toBe("VALIDATION");
    expect(await fail(enableTwoFactor(fx.emp1, { code: totpAt(b.secret, Date.now()) }))).toBeNull();
  });

  it("mengaktifkan 2FA mencabut sesi lain (sesi saat ini tetap)", async () => {
    const other = await createSession(fx.emp1.userId, null, null);
    const current = await createSession(fx.emp1.userId, null, null);
    const cur = (await validateSession(current.token))!;
    const setup = await beginTwoFactorSetup(fx.emp1, { password: TEST_PASSWORD });
    await enableTwoFactor({ ...fx.emp1, sessionId: cur.sessionId }, { code: totpAt(setup.secret, Date.now()) });
    expect(await validateSession(other.token)).toBeNull();
    expect(await validateSession(current.token)).not.toBeNull();
  });
});

describe("2FA — login", () => {
  it("password benar tetapi 2FA aktif: TIDAK ada sesi; tantangan sekali pakai; kode benar → sesi", async () => {
    const { secret } = await enable2fa(fx.emp1);
    const sessionsBefore = await prisma.session.count({ where: { userId: fx.emp1.userId } });
    const r = await startLogin({ email: "ayu@uji.test", password: TEST_PASSWORD }, META);
    expect(r.requiresTwoFactor).toBe(true);
    expect(await prisma.session.count({ where: { userId: fx.emp1.userId } })).toBe(sessionsBefore);
    if (!r.requiresTwoFactor) throw new Error("unreachable");
    // tantangan disimpan sebagai hash
    const ch = await prisma.loginChallenge.findFirstOrThrow({ where: { userId: fx.emp1.userId } });
    expect(ch.tokenHash).not.toBe(r.challenge);
    const done = await completeLogin({ challenge: r.challenge, code: nextCode(secret) }, META);
    expect(done.token).toBeTruthy();
    expect(await prisma.loginChallenge.count({ where: { userId: fx.emp1.userId } })).toBe(0);
    // tantangan yang sama tidak dapat dipakai lagi
    expect((await fail(completeLogin({ challenge: r.challenge, code: nextCode(secret, 1) }, META)))?.code).toBe("UNAUTHENTICATED");
  });

  it("login() lama gagal tegas untuk akun 2FA (tidak pernah mengembalikan sesi tanpa kode)", async () => {
    await enable2fa(fx.emp1);
    expect((await fail(login({ email: "ayu@uji.test", password: TEST_PASSWORD }, META)))?.code).toBe("CONFLICT");
    expect(await prisma.session.count({ where: { userId: fx.emp1.userId } })).toBe(0);
  });

  it("password salah pada akun 2FA → pesan sama dengan akun biasa (tidak membocorkan 2FA)", async () => {
    await enable2fa(fx.emp1);
    const a = await fail(startLogin({ email: "ayu@uji.test", password: "salah-banget-1" }, META));
    const b = await fail(startLogin({ email: "budi@uji.test", password: "salah-banget-1" }, META));
    expect(a?.message).toBe(b?.message);
  });

  it("replay: kode TOTP yang sudah dipakai tidak dapat dipakai lagi, juga dari tantangan baru", async () => {
    const { secret } = await enable2fa(fx.emp1);
    const code = nextCode(secret, 1);
    const c1 = await startLogin({ email: "ayu@uji.test", password: TEST_PASSWORD }, META);
    if (!c1.requiresTwoFactor) throw new Error("x");
    await completeLogin({ challenge: c1.challenge, code }, META);
    const c2 = await startLogin({ email: "ayu@uji.test", password: TEST_PASSWORD }, META);
    if (!c2.requiresTwoFactor) throw new Error("x");
    expect((await fail(completeLogin({ challenge: c2.challenge, code }, META)))?.message).toContain("salah atau sudah dipakai");
  });

  it("kode TOTP dari langkah sebelum kode yang terakhir dipakai ditolak (tidak bisa mundur)", async () => {
    const { secret } = await enable2fa(fx.emp1); // langkah sekarang sudah dipakai saat enable
    const c = await startLogin({ email: "ayu@uji.test", password: TEST_PASSWORD }, META);
    if (!c.requiresTwoFactor) throw new Error("x");
    expect((await fail(completeLogin({ challenge: c.challenge, code: totpAt(secret, Date.now() - 30_000) }, META)))?.code).toBe("UNAUTHENTICATED");
  });

  it("kode pemulihan: berhasil sekali, kedua kali ditolak, sisa berkurang; format huruf kecil/tanpa strip diterima", async () => {
    const { recoveryCodes } = await enable2fa(fx.emp1);
    const start = async () => { const r = await startLogin({ email: "ayu@uji.test", password: TEST_PASSWORD }, META); if (!r.requiresTwoFactor) throw new Error("x"); return r.challenge; };
    const code = recoveryCodes[0]!;
    const ok = await completeLogin({ challenge: await start(), code: code.toLowerCase().replace("-", " ") }, META);
    expect(ok.token).toBeTruthy();
    expect((await fail(completeLogin({ challenge: await start(), code }, META)))?.code).toBe("UNAUTHENTICATED");
    expect((await getTwoFactorStatus(fx.emp1)).recoveryRemaining).toBe(9);
  });

  it("kode pemulihan yang sama dipakai serentak → hanya satu yang berhasil", async () => {
    const { recoveryCodes } = await enable2fa(fx.emp1);
    const challenges = await Promise.all(Array.from({ length: 4 }, async () => { const r = await startLogin({ email: "ayu@uji.test", password: TEST_PASSWORD }, { ip: null, userAgent: null }); if (!r.requiresTwoFactor) throw new Error("x"); return r.challenge; }));
    const res = await Promise.allSettled(challenges.map((challenge) => completeLogin({ challenge, code: recoveryCodes[1]! }, META)));
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("brute force: 5 kode salah membatalkan tantangan dan mengunci; setelah terkunci kode benar pun ditolak (RATE_LIMITED)", async () => {
    const { secret } = await enable2fa(fx.emp1);
    const c = await startLogin({ email: "ayu@uji.test", password: TEST_PASSWORD }, META);
    if (!c.requiresTwoFactor) throw new Error("x");
    for (let i = 0; i < 5; i++) await fail(completeLogin({ challenge: c.challenge, code: String(100000 + i) }, META));
    const locked = await fail(completeLogin({ challenge: c.challenge, code: nextCode(secret) }, META));
    expect(locked?.code).toBe("RATE_LIMITED");
    const c2 = await startLogin({ email: "ayu@uji.test", password: TEST_PASSWORD }, { ip: null, userAgent: null }).catch((e: AppError) => e);
    // password-step masih jalan; tetapi verifikasi kode tetap terkunci
    if (!(c2 instanceof Error) && c2.requiresTwoFactor) expect((await fail(completeLogin({ challenge: c2.challenge, code: nextCode(secret, 1) }, META)))?.code).toBe("RATE_LIMITED");
    const audits = await prisma.auditLog.count({ where: { action: "auth.2fa_failed" } });
    expect(audits).toBeGreaterThanOrEqual(5);
  });

  it("tantangan kedaluwarsa / palsu / milik akun nonaktif ditolak", async () => {
    const { secret } = await enable2fa(fx.emp1);
    expect((await fail(completeLogin({ challenge: "x".repeat(43), code: "123456" }, META)))?.code).toBe("UNAUTHENTICATED");
    const c = await startLogin({ email: "ayu@uji.test", password: TEST_PASSWORD }, META);
    if (!c.requiresTwoFactor) throw new Error("x");
    await prisma.loginChallenge.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await fail(completeLogin({ challenge: c.challenge, code: nextCode(secret) }, META)))?.message).toContain("kedaluwarsa");
    const c3 = await startLogin({ email: "ayu@uji.test", password: TEST_PASSWORD }, META);
    if (!c3.requiresTwoFactor) throw new Error("x");
    await prisma.user.update({ where: { id: fx.emp1.userId }, data: { isActive: false } });
    expect((await fail(completeLogin({ challenge: c3.challenge, code: nextCode(secret, 1) }, META)))?.code).toBe("UNAUTHENTICATED");
  });
});

describe("2FA — mematikan, kode pemulihan, reset admin, kebijakan", () => {
  it("mematikan perlu password + kode; kode pemulihan baru membatalkan yang lama", async () => {
    const { secret, recoveryCodes } = await enable2fa(fx.emp1);
    expect((await fail(disableTwoFactor(fx.emp1, { password: "salah-banget-1", code: nextCode(secret) })))?.fieldErrors?.password).toBeTruthy();
    expect((await fail(disableTwoFactor(fx.emp1, { password: TEST_PASSWORD, code: "000000" })))?.fieldErrors?.code).toBeTruthy();
    const fresh = await regenerateRecoveryCodes(fx.emp1, { password: TEST_PASSWORD, code: nextCode(secret, 1) });
    await timePasses(fx.emp1.userId);
    expect(fresh.recoveryCodes).toHaveLength(10);
    const c = await startLogin({ email: "ayu@uji.test", password: TEST_PASSWORD }, META);
    if (!c.requiresTwoFactor) throw new Error("x");
    expect((await fail(completeLogin({ challenge: c.challenge, code: recoveryCodes[2]! }, META)))?.code).toBe("UNAUTHENTICATED"); // kode lama hangus
    await timePasses(fx.emp1.userId);
    await disableTwoFactor(fx.emp1, { password: TEST_PASSWORD, code: nextCode(secret, 1) });
    expect((await getTwoFactorStatus(fx.emp1)).enabled).toBe(false);
    expect(await prisma.twoFactorRecoveryCode.count({ where: { userId: fx.emp1.userId } })).toBe(0);
    expect((await login({ email: "ayu@uji.test", password: TEST_PASSWORD }, META)).token).toBeTruthy();
  });

  it("Super Admin mengatur ulang 2FA akun lain; HR tidak boleh; tidak untuk akun sendiri; sesi korban dicabut", async () => {
    const { secret } = await enable2fa(fx.emp2);
    const s = await createSession(fx.emp2.userId, null, null);
    expect((await fail(resetUserTwoFactor(fx.hr, fx.emp2.userId)))?.code).toBe("FORBIDDEN");
    expect((await fail(resetUserTwoFactor(fx.superAdmin, fx.superAdmin.userId)))?.code).toBe("VALIDATION");
    expect((await fail(resetUserTwoFactor(fx.superAdmin, fx.emp1.userId)))?.code).toBe("CONFLICT"); // emp1 tidak memakai 2FA
    await resetUserTwoFactor(fx.superAdmin, fx.emp2.userId);
    expect(await validateSession(s.token)).toBeNull();
    expect((await getTwoFactorStatus(fx.emp2)).enabled).toBe(false);
    expect((await login({ email: "budi@uji.test", password: TEST_PASSWORD }, META)).token).toBeTruthy();
    expect((await listNotifications(fx.emp2)).items.some((n) => n.type === "auth.2fa_reset")).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "auth.2fa_reset" } })).toBe(1);
    void secret;
  });

  it("kebijakan 'wajib 2FA untuk admin': admin tanpa 2FA ditandai wajib setup, karyawan tidak; tidak bisa dimatikan; dapat dicabut", async () => {
    const sHr = await createSession(fx.hr.userId, null, null);
    const sEmp = await createSession(fx.emp1.userId, null, null);
    expect((await validateSession(sHr.token))!.mustSetupTwoFactor).toBe(false);
    expect((await fail(updateSecurityPolicy(fx.hr, { twoFactorRequiredForAdmins: true })))?.code).toBe("FORBIDDEN");
    await updateSecurityPolicy(fx.superAdmin, { twoFactorRequiredForAdmins: true });
    expect((await validateSession(sHr.token))!.mustSetupTwoFactor).toBe(true);
    expect((await validateSession(sEmp.token))!.mustSetupTwoFactor).toBe(false);
    expect((await getAccount(fx.hr)).twoFactor.required).toBe(true);
    // setelah aktif, tidak lagi wajib setup, tetapi tidak boleh dimatikan
    const { secret } = await enable2fa(fx.hr);
    const sHr2 = await createSession(fx.hr.userId, null, null);
    expect((await validateSession(sHr2.token))!.mustSetupTwoFactor).toBe(false);
    expect((await fail(disableTwoFactor(fx.hr, { password: TEST_PASSWORD, code: nextCode(secret, 1) })))?.code).toBe("FORBIDDEN");
    await updateSecurityPolicy(fx.superAdmin, { twoFactorRequiredForAdmins: false });
    expect(await fail(disableTwoFactor(fx.hr, { password: TEST_PASSWORD, code: nextCode(secret, 1) }))).toBeNull();
  });
});

// ─────────────────────────── Lupa password ───────────────────────────

const tokenFromEmail = () => {
  const m = cap.emails.at(-1)!.text.match(/reset-password\?token=([\w-]+)/);
  return m![1]!;
};

describe("lupa password mandiri", () => {
  it("email terdaftar: tautan terkirim; email tidak terdaftar: respons identik, tidak ada token/email (anti-enumerasi)", async () => {
    const a = await requestPasswordReset({ email: " AYU@uji.test " }, META);
    const b = await requestPasswordReset({ email: "tidak-ada@uji.test" }, META);
    expect(a.message).toBe(RESET_REQUESTED_MESSAGE);
    expect(b.message).toBe(a.message);
    await waitFor(() => cap.emails.length >= 1);
    expect(cap.emails).toHaveLength(1);
    expect(cap.emails[0]!.to).toBe("ayu@uji.test");
    expect(cap.emails[0]!.text).toContain(`${env().APP_URL}/reset-password?token=`);
    expect(await prisma.passwordResetToken.count()).toBe(1);
    // token mentah tidak disimpan
    const tok = tokenFromEmail();
    const row = await prisma.passwordResetToken.findFirstOrThrow();
    expect(row.tokenHash).not.toBe(tok);
    expect(row.tokenHash).toHaveLength(64);
  });

  it("akun nonaktif tidak mendapat tautan; fitur tanpa email terkonfigurasi memberi pesan jelas", async () => {
    await prisma.user.update({ where: { id: fx.emp1.userId }, data: { isActive: false } });
    await requestPasswordReset({ email: "ayu@uji.test" }, META);
    await new Promise((r) => setTimeout(r, 50));
    expect(cap.emails).toHaveLength(0);
    setTransportsForTest({ whatsapp: async () => undefined });
    expect((await fail(requestPasswordReset({ email: "budi@uji.test" }, META)))?.message).toContain("belum diaktifkan");
  });

  it("dibatasi: permintaan ke-4 untuk email yang sama dalam sejam ditolak; permintaan baru mencabut tautan lama", async () => {
    await requestPasswordReset({ email: "ayu@uji.test" }, META);
    await waitFor(() => cap.emails.length >= 1);
    const first = tokenFromEmail();
    await requestPasswordReset({ email: "ayu@uji.test" }, META);
    await waitFor(() => cap.emails.length >= 2);
    expect((await inspectResetToken(first)).valid).toBe(false); // tautan pertama dicabut
    expect((await inspectResetToken(tokenFromEmail())).valid).toBe(true);
    await requestPasswordReset({ email: "ayu@uji.test" }, META);
    expect((await fail(requestPasswordReset({ email: "ayu@uji.test" }, META)))?.code).toBe("RATE_LIMITED");
    expect(await prisma.passwordResetToken.count({ where: { userId: fx.emp1.userId } })).toBe(1);
  });

  it("mengatur password: sukses sekali pakai; password lama gagal, baru berlaku; semua sesi dicabut; tautan tidak dapat dipakai lagi", async () => {
    const s = await createSession(fx.emp1.userId, null, null);
    await requestPasswordReset({ email: "ayu@uji.test" }, META);
    await waitFor(() => cap.emails.length >= 1);
    const token = tokenFromEmail();
    expect(await inspectResetToken(token)).toEqual({ valid: true, needsTwoFactor: false });
    await resetPassword({ token, newPassword: "Password-Baru-Kuat-77!" }, META);
    expect(await validateSession(s.token)).toBeNull();
    expect((await fail(login({ email: "ayu@uji.test", password: TEST_PASSWORD }, META)))?.code).toBe("UNAUTHENTICATED");
    expect((await login({ email: "ayu@uji.test", password: "Password-Baru-Kuat-77!" }, META)).token).toBeTruthy();
    expect((await fail(resetPassword({ token, newPassword: "Password-Lain-Kuat-88!" }, META)))?.message).toContain("tidak valid");
    expect((await listNotifications(fx.emp1)).items.some((n) => n.type === "auth.password_changed")).toBe(true);
  });

  it("password lemah ditolak dan tautan TETAP berlaku; kedaluwarsa ditolak; token ngawur ditolak", async () => {
    await requestPasswordReset({ email: "ayu@uji.test" }, META);
    await waitFor(() => cap.emails.length >= 1);
    const token = tokenFromEmail();
    expect((await fail(resetPassword({ token, newPassword: "pendek" }, META)))?.fieldErrors?.newPassword).toBeTruthy();
    expect((await fail(resetPassword({ token, newPassword: "ayulestari-password-1" }, META)))?.fieldErrors?.newPassword).toBeTruthy(); // memuat nama
    expect((await inspectResetToken(token)).valid).toBe(true);
    await prisma.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await fail(resetPassword({ token, newPassword: "Password-Baru-Kuat-77!" }, META)))?.message).toContain("kedaluwarsa");
    expect((await fail(resetPassword({ token: "a".repeat(43), newPassword: "Password-Baru-Kuat-77!" }, META)))?.message).toContain("tidak valid");
  });

  it("pemakaian serentak tautan yang sama → hanya satu yang berhasil", async () => {
    await requestPasswordReset({ email: "ayu@uji.test" }, META);
    await waitFor(() => cap.emails.length >= 1);
    const token = tokenFromEmail();
    const r = await Promise.allSettled(["Password-Satu-Kuat-11!", "Password-Dua-Kuat-22!", "Password-Tiga-Kuat-33!"].map((p) => resetPassword({ token, newPassword: p }, META)));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });

  it("akun ber-2FA: wajib kode (TOTP/pemulihan); kode salah ditolak & tautan tetap berlaku; tanpa kode ditolak", async () => {
    const { secret, recoveryCodes } = await enable2fa(fx.emp1);
    await requestPasswordReset({ email: "ayu@uji.test" }, META);
    await waitFor(() => cap.emails.length >= 1);
    const token = tokenFromEmail();
    expect(await inspectResetToken(token)).toEqual({ valid: true, needsTwoFactor: true });
    expect((await fail(resetPassword({ token, newPassword: "Password-Baru-Kuat-77!" }, META)))?.fieldErrors?.code).toBeTruthy();
    expect((await fail(resetPassword({ token, newPassword: "Password-Baru-Kuat-77!", code: "000000" }, META)))?.fieldErrors?.code).toBeTruthy();
    expect((await inspectResetToken(token)).valid).toBe(true);
    await resetPassword({ token, newPassword: "Password-Baru-Kuat-77!", code: nextCode(secret) }, META);
    // 2FA tetap aktif setelah reset password
    expect((await getTwoFactorStatus(fx.emp1)).enabled).toBe(true);
    // kode pemulihan juga diterima untuk reset
    await requestPasswordReset({ email: "ayu@uji.test" }, META);
    await waitFor(() => cap.emails.length >= 2);
    await resetPassword({ token: tokenFromEmail(), newPassword: "Password-Baru-Kuat-88!", code: recoveryCodes[0]! }, META);
    expect((await getTwoFactorStatus(fx.emp1)).recoveryRemaining).toBe(9);
  });

  it("brute force tautan: banyak token salah dari IP/token yang sama → RATE_LIMITED", async () => {
    const bad = "z".repeat(43);
    for (let i = 0; i < 10; i++) await fail(resetPassword({ token: bad, newPassword: "Password-Baru-Kuat-77!" }, META));
    expect((await fail(resetPassword({ token: bad, newPassword: "Password-Baru-Kuat-77!" }, META)))?.code).toBe("RATE_LIMITED");
  });
});

// ─────────────────────────── Notifikasi email / WhatsApp ───────────────────────────

describe("notifikasi di luar aplikasi — outbox", () => {
  it("pengajuan baru → notifikasi dalam aplikasi + email antre ke HR & Super Admin; dikirim oleh pekerja; tanpa WhatsApp bila tidak dipilih", async () => {
    // notifyUsers langsung agar tidak tergantung tanggal sistem / aturan pengajuan
    await prisma.$transaction(async (tx) => { await notifyUsers(tx, [fx.hr.userId, fx.superAdmin.userId], { type: "demo", title: "Pengajuan izin baru", body: "Ayu Lestari · 1 Maret 2027", href: "/pengajuan?status=PENDING" }); });
    const queued = await prisma.notificationDelivery.findMany({ where: { notification: { type: "demo" } } });
    expect(queued.map((d) => d.channel).sort()).toEqual(["EMAIL", "EMAIL"]);
    expect(queued.every((d) => d.status === "PENDING" && d.attempts === 0)).toBe(true);
    const r = await processDeliveries();
    expect(r).toMatchObject({ claimed: 2, sent: 2, failed: 0 });
    expect(cap.emails.map((e) => e.to).sort()).toEqual(["hr@uji.test", "pimpinan@uji.test"]);
    expect(cap.emails[0]!.subject).toBe("[TRILOGIKA EDUTAMA (UJI)] Pengajuan izin baru");
    expect(cap.emails[0]!.text).toContain(`${env().APP_URL}/pengajuan?status=PENDING`);
    expect(cap.wa).toHaveLength(0);
    expect((await listNotifications(fx.hr)).items.some((n) => n.title === "Pengajuan izin baru")).toBe(true);
  });

  it("WhatsApp: nomor dinormalisasi; wajib diisi saat diaktifkan; pesan terkirim ke nomor internasional", async () => {
    expect((await fail(updateNotificationPrefs(fx.emp1, { notifyWhatsapp: true })))?.fieldErrors?.whatsappNumber).toBeTruthy();
    expect((await fail(updateNotificationPrefs(fx.emp1, { whatsappNumber: "12345" })))?.fieldErrors?.whatsappNumber).toBeTruthy();
    const p = await updateNotificationPrefs(fx.emp1, { notifyWhatsapp: true, whatsappNumber: "0812-3456-7890" });
    expect(p).toMatchObject({ whatsapp: true, whatsappNumber: "6281234567890", email: true });
    await prisma.$transaction(async (tx) => { await notifyUsers(tx, [fx.emp1.userId], { type: "demo2", title: "Slip gaji baru tersedia", body: "Gaji Januari · No. SG-1", href: "/slip-saya" }); });
    expect((await prisma.notificationDelivery.findMany({ where: { notification: { type: "demo2" } } })).map((d) => d.channel).sort()).toEqual(["EMAIL", "WHATSAPP"]);
    await processDeliveries();
    expect(cap.wa).toEqual([{ to: "6281234567890", text: expect.stringContaining("Slip gaji baru tersedia") }]);
    // menghapus nomor mematikan WhatsApp
    expect((await fail(updateNotificationPrefs(fx.emp1, { whatsappNumber: null })))?.fieldErrors?.whatsappNumber).toBeTruthy();
    expect(await fail(updateNotificationPrefs(fx.emp1, { notifyWhatsapp: false, whatsappNumber: null }))).toBeNull();
  });

  it("pengguna yang mematikan email tidak diantre; yang dinonaktifkan setelah antre → SKIPPED", async () => {
    await updateNotificationPrefs(fx.emp2, { notifyEmail: false });
    await prisma.$transaction(async (tx) => { await notifyUsers(tx, [fx.emp1.userId, fx.emp2.userId], { type: "demo3", title: "Tes", body: null, href: null }); });
    expect(await prisma.notificationDelivery.count({ where: { userId: fx.emp2.userId } })).toBe(0);
    expect(await prisma.notificationDelivery.count({ where: { userId: fx.emp1.userId } })).toBe(1);
    await prisma.user.update({ where: { id: fx.emp1.userId }, data: { isActive: false } });
    const r = await processDeliveries();
    expect(r.skipped).toBe(1);
    expect(cap.emails).toHaveLength(0);
  });

  it("atomik: transaksi peristiwa yang gagal tidak meninggalkan notifikasi maupun antrean", async () => {
    await transaction(async (tx) => { await notifyUsers(tx, [fx.emp1.userId], { type: "gagal", title: "x", body: null, href: null }); throw new Error("rollback"); }).catch(() => undefined);
    expect(await prisma.notification.count({ where: { type: "gagal" } })).toBe(0);
    expect(await prisma.notificationDelivery.count()).toBe(0);
  });

  it("gagal kirim: dicoba ulang dengan jeda bertahap; setelah 5 kali → FAILED & terlihat di ringkasan; dapat diantrekan ulang", async () => {
    cap.failEmail = true;
    await prisma.$transaction(async (tx) => { await notifyUsers(tx, [fx.emp1.userId], { type: "retry", title: "Tes", body: null, href: null }); });
    const d = () => prisma.notificationDelivery.findFirstOrThrow({ where: { notification: { type: "retry" } } });
    expect(await processDeliveries()).toMatchObject({ claimed: 1, retried: 1, sent: 0 });
    let row = await d();
    expect(row.status).toBe("PENDING");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toContain("SMTP down");
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect((await processDeliveries()).claimed).toBe(0); // belum waktunya
    for (let i = 2; i <= MAX_ATTEMPTS; i++) {
      await prisma.notificationDelivery.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      await processDeliveries();
    }
    row = await d();
    expect(row.status).toBe("FAILED");
    expect(row.attempts).toBe(MAX_ATTEMPTS);
    const stats = await getDeliveryStats(fx.superAdmin);
    expect(stats.counts.failed).toBe(1);
    expect(stats.recentFailures[0]!.to).toBe("ay•••@uji.test"); // alamat disamarkan
    cap.failEmail = false;
    expect(await retryFailedDeliveries(fx.superAdmin)).toEqual({ requeued: 1 });
    expect(await runDeliveriesNow(fx.superAdmin)).toMatchObject({ sent: 1 });
    expect((await d()).status).toBe("SENT");
    // izin
    expect((await fail(getDeliveryStats(fx.hr)))?.code).toBe("FORBIDDEN");
  });

  it("dua pekerja serentak: setiap pesan terkirim TEPAT sekali (SKIP LOCKED)", async () => {
    await prisma.$transaction(async (tx) => { for (let i = 0; i < 12; i++) await notifyUsers(tx, [fx.emp1.userId], { type: "banyak", title: `Pesan ${i}`, body: null, href: null }); });
    const [a, b, c] = await Promise.all([processDeliveries({ limit: 5 }), processDeliveries({ limit: 5 }), processDeliveries({ limit: 5 })]);
    await processDeliveries({ limit: 5 });
    expect(a.sent + b.sent + c.sent).toBeLessThanOrEqual(12);
    expect(cap.emails).toHaveLength(12);
    expect(new Set(cap.emails.map((e) => e.subject)).size).toBe(12);
    expect(await prisma.notificationDelivery.count({ where: { status: "SENT" } })).toBe(12);
  });

  it("saluran tidak dikonfigurasi → tidak ada antrean (notifikasi dalam aplikasi tetap dibuat)", async () => {
    setTransportsForTest(null);
    await prisma.$transaction(async (tx) => { await notifyUsers(tx, [fx.emp1.userId], { type: "polos", title: "Hanya di aplikasi", body: null, href: null }); });
    expect(await prisma.notification.count({ where: { type: "polos" } })).toBe(1);
    expect(await prisma.notificationDelivery.count()).toBe(0);
  });

  it("pesan uji: dikirim langsung, dibatasi 5/jam, kegagalan transport dilaporkan jelas", async () => {
    await sendTestNotification(fx.emp1, { channel: "EMAIL" });
    expect(cap.emails.at(-1)!.subject).toContain("Pesan uji");
    cap.failEmail = true;
    expect((await fail(sendTestNotification(fx.emp1, { channel: "EMAIL" })))?.message).toContain("gagal dikirim");
    expect((await fail(sendTestNotification(fx.emp1, { channel: "WHATSAPP" })))?.fieldErrors?.whatsappNumber).toBeTruthy();
    cap.failEmail = false;
    for (let i = 0; i < 2; i++) await fail(sendTestNotification(fx.emp1, { channel: "EMAIL" }));
    expect((await fail(sendTestNotification(fx.emp1, { channel: "EMAIL" })))?.code).toBe("RATE_LIMITED");
  });

  it("isi pesan ringkas tanpa data sensitif; backoff 1,2,4,8 menit maks 1 jam", () => {
    const m = composeMessage("Trilogika", { title: "Slip gaji baru tersedia", body: "Gaji Januari · No. SG-1", href: "/slip-saya" });
    expect(m.text).toContain("Buka: ");
    expect(m.text).not.toMatch(/Rp/);
    expect([1, 2, 3, 4, 5, 9].map(backoffSeconds)).toEqual([60, 120, 240, 480, 960, 3600]);
  });
});

describe("permintaan WhatsApp per penyedia", () => {
  const base = { ...env() };
  const e = (over: Record<string, unknown>) => ({ ...base, ...over }) as ReturnType<typeof env>;
  it("fonnte: form-urlencoded dengan token di header Authorization", () => {
    const r = buildWhatsappRequest({ to: "6281234567890", text: "Halo" }, e({ WHATSAPP_PROVIDER: "fonnte", WHATSAPP_TOKEN: "tok", WHATSAPP_API_URL: undefined }));
    expect(r.url).toBe("https://api.fonnte.com/send");
    expect(r.headers.Authorization).toBe("tok");
    expect(new URLSearchParams(r.body).get("target")).toBe("6281234567890");
  });
  it("cloud_api: teks biasa, atau template dengan SATU parameter tanpa baris baru", () => {
    const text = buildWhatsappRequest({ to: "6281", text: "A\nB" }, e({ WHATSAPP_PROVIDER: "cloud_api", WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_TEMPLATE_NAME: undefined, WHATSAPP_API_URL: undefined }));
    expect(text.url).toBe("https://graph.facebook.com/v21.0/123/messages");
    expect(JSON.parse(text.body)).toMatchObject({ type: "text", text: { body: "A\nB" } });
    const tpl = buildWhatsappRequest({ to: "6281", text: "A\nB" }, e({ WHATSAPP_PROVIDER: "cloud_api", WHATSAPP_TOKEN: "t", WHATSAPP_PHONE_NUMBER_ID: "123", WHATSAPP_TEMPLATE_NAME: "notif_hris", WHATSAPP_TEMPLATE_LANG: "id", WHATSAPP_API_URL: undefined }));
    const j = JSON.parse(tpl.body);
    expect(j.type).toBe("template");
    expect(j.template.components[0].parameters[0].text).toBe("A · B");
  });
  it("webhook: JSON ke URL sendiri dengan token opsional", () => {
    const r = buildWhatsappRequest({ to: "6281", text: "x" }, e({ WHATSAPP_PROVIDER: "webhook", WHATSAPP_API_URL: "https://n8n.example/hook", WHATSAPP_TOKEN: undefined }));
    expect(r.url).toBe("https://n8n.example/hook");
    expect(r.headers.Authorization).toBeUndefined();
    expect(JSON.parse(r.body)).toMatchObject({ to: "6281", text: "x" });
  });
});

describe("rahasia & rate limit pembantu", () => {
  it("rahasia TOTP acak tidak pernah sama antar akun", async () => {
    const a = (await beginTwoFactorSetup(fx.emp1, { password: TEST_PASSWORD })).secret;
    const b = (await beginTwoFactorSetup(fx.emp2, { password: TEST_PASSWORD })).secret;
    expect(a).not.toBe(b);
    expect(generateTotpSecret()).not.toBe(a);
  });
});
