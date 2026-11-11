/**
 * Pengelolaan karyawan TIDAK boleh melewati aturan akun: akun admin hanya Super Admin yang mengelola; akun Super Admin dinonaktifkan dua langkah (akun dulu,
 * baru karyawan) dengan jaminan minimal satu Super Admin aktif (service + trigger database); akun tidak boleh diaktifkan untuk karyawan yang sudah berhenti;
 * mengaktifkan kembali karyawan tidak menghidupkan akun admin; login/sesi menolak akun mantan karyawan.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { login } from "@/server/services/auth";
import { isSessionAlive, validateSession } from "@/server/auth/session";
import { updateUser } from "@/server/services/users";
import { deactivateEmployee, reactivateEmployee } from "@/server/services/employees";
import { accountUsable } from "@/lib/account";
import { makeEmployee, makeUser, resetDb, seedFixtures, TEST_PASSWORD, type Fixtures } from "../helpers/db";

const META = { ip: "10.0.0.1", userAgent: "vitest" };
let fx: Fixtures;
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const activeSupers = () => prisma.user.count({ where: { role: "SUPER_ADMIN", isActive: true } });
const acct = (id: string) => prisma.user.findUniqueOrThrow({ where: { id } });
const emp = (id: string) => prisma.employee.findUniqueOrThrow({ where: { id } });
const canLogin = (email: string) => login({ email, password: TEST_PASSWORD }, META).then(() => true, () => false);

/** Direktur = akun Super Admin yang tertaut ke data karyawan. */
async function director(email = "direktur@uji.test") {
  const e = await makeEmployee({ fullName: "Direktur Uji" });
  const a = await makeUser(email, "Direktur Uji", "SUPER_ADMIN", e.id);
  return { e, a };
}

beforeEach(async () => { await resetDb(); fx = await seedFixtures(); });

describe("nonaktifkan karyawan yang tertaut ke akun Super Admin", () => {
  it("HR ditolak (FORBIDDEN); Super Admin lain pun ditolak dengan petunjuk dua langkah; tidak ada yang berubah", async () => {
    const { e, a } = await director();
    expect((await fail(deactivateEmployee(fx.hr, e.id, { reason: "uji" })))?.code).toBe("FORBIDDEN");
    const two = await fail(deactivateEmployee(fx.superAdmin, e.id, {}));
    expect(two?.code).toBe("CONFLICT");
    expect(two?.message).toMatch(/Nonaktifkan akunnya lebih dulu di Akun Pengguna[^]*masih ada Super Admin aktif/);
    expect((await emp(e.id)).isActive).toBe(true);
    expect((await acct(a.userId)).isActive).toBe(true);
    expect(await activeSupers()).toBe(2);
  });

  it("dua langkah: nonaktifkan akun (dijaga Super Admin terakhir) → baru nonaktifkan karyawan oleh HR; akun tetap nonaktif", async () => {
    const { e, a } = await director();
    await updateUser(fx.superAdmin, a.userId, { isActive: false });              // langkah 1 (masih ada Super Admin lain)
    expect((await acct(a.userId)).isActive).toBe(false);
    await deactivateEmployee(fx.hr, e.id, { reason: "Pensiun" });                // langkah 2 — HR boleh: akun sudah mati, tidak ada hak akun yang dipakai
    expect(await emp(e.id)).toMatchObject({ isActive: false });
    expect((await acct(a.userId)).isActive).toBe(false);
    expect(await prisma.auditLog.count({ where: { action: "employee.deactivate", entityId: e.id } })).toBe(1);
  });

  it("Super Admin TERAKHIR tidak bisa dimatikan lewat jalur mana pun: modul akun (service) dan database (trigger)", async () => {
    const { a } = await director();
    await updateUser(fx.superAdmin, a.userId, { isActive: true });                // pastikan aktif
    await prisma.user.update({ where: { id: fx.superAdmin.userId }, data: { isActive: false } }); // masih ada Direktur → boleh
    expect(await activeSupers()).toBe(1);
    // service
    const viaService = await fail(updateUser({ ...fx.superAdmin, userId: fx.superAdmin.userId }, a.userId, { isActive: false }));
    expect(viaService?.code).toBe("VALIDATION");
    expect(viaService?.message).toMatch(/minimal satu Super Admin aktif/);
    // database langsung (skrip/jalur lain): ditolak trigger
    await expect(prisma.user.update({ where: { id: a.userId }, data: { isActive: false } })).rejects.toThrow(/HRIS-GUARD[^]*minimal satu Super Admin aktif/);
    await expect(prisma.user.update({ where: { id: a.userId }, data: { role: "HR_ADMIN" } })).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.user.delete({ where: { id: a.userId } })).rejects.toThrow(/HRIS-GUARD/);
    expect(await activeSupers()).toBe(1);
  });

  it("dua Super Admin dinonaktifkan BERSAMAAN: tepat satu yang berhasil (kunci serialisasi di trigger)", async () => {
    const { a } = await director();
    const res = await Promise.allSettled([
      prisma.user.update({ where: { id: a.userId }, data: { isActive: false } }),
      prisma.user.update({ where: { id: fx.superAdmin.userId }, data: { isActive: false } }),
    ]);
    expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(res.filter((r) => r.status === "rejected")).toHaveLength(1);
    expect(await activeSupers()).toBe(1);
  });
});

describe("nonaktifkan karyawan yang tertaut ke akun HR Admin", () => {
  it("HR tidak boleh (modul akun pun menolak HR); Super Admin boleh dan akunnya ikut nonaktif + sesi diakhiri", async () => {
    const e = await makeEmployee({ fullName: "HR Dua" });
    const hr2 = await makeUser("hr2@uji.test", "HR Dua", "HR_ADMIN", e.id);
    expect((await fail(updateUser(fx.hr, hr2.userId, { isActive: false })))?.code).toBe("FORBIDDEN");
    expect((await fail(deactivateEmployee(fx.hr, e.id, {})))?.code).toBe("FORBIDDEN");
    expect((await acct(hr2.userId)).isActive).toBe(true);
    const tok = await login({ email: "hr2@uji.test", password: TEST_PASSWORD }, META);
    expect(await validateSession(tok.token)).not.toBeNull();
    await deactivateEmployee(fx.superAdmin, e.id, { reason: "Resign" });
    expect((await acct(hr2.userId)).isActive).toBe(false);
    expect(await validateSession(tok.token)).toBeNull();
  });
});

describe("mengaktifkan kembali karyawan", () => {
  it("akun Karyawan ikut aktif; hasilnya dilaporkan", async () => {
    await deactivateEmployee(fx.hr, fx.empIds[0], { reason: "Resign" });
    expect(await canLogin("ayu@uji.test")).toBe(false);
    expect(await reactivateEmployee(fx.hr, fx.empIds[0])).toEqual({ account: "REACTIVATED" });
    expect(await canLogin("ayu@uji.test")).toBe(true);
  });

  it("akun ADMIN yang dimatikan Super Admin TIDAK ikut hidup lewat nonaktifkan→aktifkan karyawan oleh HR; diaktifkan eksplisit oleh Super Admin", async () => {
    const e = await makeEmployee({ fullName: "HR Dua" });
    const hr2 = await makeUser("hr2@uji.test", "HR Dua", "HR_ADMIN", e.id);
    await updateUser(fx.superAdmin, hr2.userId, { isActive: false });               // Super Admin mematikan akun (mis. alasan keamanan)
    expect((await fail(updateUser(fx.hr, hr2.userId, { isActive: true })))?.code).toBe("FORBIDDEN");
    await deactivateEmployee(fx.hr, e.id, {});                                      // akun sudah mati → HR boleh menonaktifkan data karyawan
    expect(await reactivateEmployee(fx.hr, e.id)).toEqual({ account: "ADMIN_KEPT_INACTIVE" });
    expect((await acct(hr2.userId)).isActive).toBe(false);                          // tetap mati
    expect(await canLogin("hr2@uji.test")).toBe(false);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "employee.reactivate", entityId: e.id } })).summary).toMatch(/akun admin tetap nonaktif/);
    await updateUser(fx.superAdmin, hr2.userId, { isActive: true });                // jalur resmi
    expect(await canLogin("hr2@uji.test")).toBe(true);
  });

  it("akun Super Admin pun tidak ikut hidup; diaktifkan Super Admin lain di Akun Pengguna", async () => {
    const { e, a } = await director();
    await updateUser(fx.superAdmin, a.userId, { isActive: false });
    await deactivateEmployee(fx.hr, e.id, {});
    expect(await reactivateEmployee(fx.hr, e.id)).toEqual({ account: "ADMIN_KEPT_INACTIVE" });
    expect((await acct(a.userId)).isActive).toBe(false);
    await updateUser(fx.superAdmin, a.userId, { isActive: true });
    expect(await canLogin("direktur@uji.test")).toBe(true);
  });
});

describe("mengaktifkan akun untuk karyawan yang sudah berhenti", () => {
  it("modul akun menolak (VALIDATION) selama data karyawan nonaktif; setelah karyawan diaktifkan, akun boleh diaktifkan", async () => {
    await deactivateEmployee(fx.hr, fx.empIds[0], { reason: "Resign" });
    const r = await fail(updateUser(fx.hr, fx.emp1.userId, { isActive: true }));
    expect(r?.code).toBe("VALIDATION");
    expect(r?.message).toMatch(/Ayu Lestari sudah nonaktif[^]*Aktifkan kembali data karyawannya lebih dulu/);
    expect((await acct(fx.emp1.userId)).isActive).toBe(false);
    expect(await canLogin("ayu@uji.test")).toBe(false);
    // setelah data karyawan aktif lagi, akun Karyawan ikut aktif (jalur resmi)
    await reactivateEmployee(fx.hr, fx.empIds[0]);
    expect(await canLogin("ayu@uji.test")).toBe(true);
  });

  it("berlaku juga untuk akun admin yang tertaut ke karyawan nonaktif", async () => {
    const e = await makeEmployee({ fullName: "HR Dua" });
    const hr2 = await makeUser("hr2@uji.test", "HR Dua", "HR_ADMIN", e.id);
    await deactivateEmployee(fx.superAdmin, e.id, {});
    expect((await fail(updateUser(fx.superAdmin, hr2.userId, { isActive: true })))?.code).toBe("VALIDATION");
  });
});

describe("lapis kedua: login & sesi menolak akun mantan karyawan (data tidak konsisten)", () => {
  it("akun Karyawan aktif + karyawan nonaktif: tidak bisa masuk; sesi yang berjalan mati", async () => {
    const tok = await login({ email: "ayu@uji.test", password: TEST_PASSWORD }, META);
    const su = await validateSession(tok.token);
    expect(su).not.toBeNull();
    await prisma.employee.update({ where: { id: fx.empIds[0] }, data: { isActive: false, endDate: new Date("2026-11-01") } }); // keadaan tak konsisten (akun masih aktif)
    expect((await acct(fx.emp1.userId)).isActive).toBe(true);
    expect(await validateSession(tok.token)).toBeNull();
    expect(await isSessionAlive(su!.sessionId)).toBe(false);
    expect(await canLogin("ayu@uji.test")).toBe(false);
  });

  it("Super Admin dikecualikan (agar data tak konsisten tidak mengunci pimpinan); akun tanpa karyawan tidak terpengaruh", async () => {
    const { e } = await director();
    await prisma.employee.update({ where: { id: e.id }, data: { isActive: false } });
    expect(await canLogin("direktur@uji.test")).toBe(true);
    expect(await canLogin("hr@uji.test")).toBe(true);   // HR tanpa data karyawan
    expect(accountUsable({ isActive: true, role: "EMPLOYEE", employee: { isActive: false } })).toBe(false);
    expect(accountUsable({ isActive: true, role: "SUPER_ADMIN", employee: { isActive: false } })).toBe(true);
    expect(accountUsable({ isActive: false, role: "SUPER_ADMIN", employee: null })).toBe(false);
    expect(accountUsable({ isActive: true, role: "HR_ADMIN", employee: null })).toBe(true);
  });
});
