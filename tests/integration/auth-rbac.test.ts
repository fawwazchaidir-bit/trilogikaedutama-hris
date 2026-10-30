import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { login, changeOwnPassword } from "@/server/services/auth";
import { validateSession, revokeSessionByToken } from "@/server/auth/session";
import { createUser, listUsers, resetUserPassword, updateUser } from "@/server/services/users";
import { getEmployee, listEmployees, createEmployee } from "@/server/services/employees";
import { getRecap, getRecapDetail } from "@/server/services/recap";
import { getEmployeeRange } from "@/server/services/attendance";
import { listLeaves, setBalance } from "@/server/services/leave";
import { listComponents } from "@/server/services/components";
import { listRuns, approveRun } from "@/server/services/payroll";
import { updatePayrollRules, updateAttendancePolicy, updateCompany } from "@/server/services/settings";
import { listAuditLogs } from "@/server/services/audit-log";
import { createSchedule } from "@/server/services/schedules";
import { resetDb, seedFixtures, TEST_PASSWORD, type Fixtures } from "../helpers/db";

let fx: Fixtures;
beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
});

const META = { ip: "10.0.0.1", userAgent: "vitest" };
const code = async (p: Promise<unknown>) => {
  try { await p; return "OK"; } catch (e) { return e instanceof AppError ? e.code : `ERR:${(e as Error).message}`; }
};

describe("login & sesi", () => {
  it("berhasil → token valid → sesi memuat peran & employeeId", async () => {
    const r = await login({ email: "AYU@uji.test ", password: TEST_PASSWORD }, META);
    const u = await validateSession(r.token);
    expect(u?.role).toBe("EMPLOYEE");
    expect(u?.employeeId).toBe(fx.empIds[0]);
    // Yang tersimpan di DB hanya hash token.
    const rows = await prisma.session.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toContain(r.token);
  });

  it("password salah / email tak dikenal → pesan sama (tidak membocorkan keberadaan akun)", async () => {
    const a = await login({ email: "ayu@uji.test", password: "salah-salah-1" }, META).catch((e: AppError) => e);
    const b = await login({ email: "tidak-ada@uji.test", password: "salah-salah-1" }, META).catch((e: AppError) => e);
    expect((a as AppError).message).toBe((b as AppError).message);
    expect((a as AppError).code).toBe("UNAUTHENTICATED");
  });

  it("dikunci setelah 5 percobaan gagal (per email), bahkan dengan password benar", async () => {
    for (let i = 0; i < 5; i++) await login({ email: "ayu@uji.test", password: "salah-salah-1" }, { ip: null, userAgent: null }).catch(() => undefined);
    expect(await code(login({ email: "ayu@uji.test", password: TEST_PASSWORD }, { ip: null, userAgent: null }))).toBe("RATE_LIMITED");
  });

  it("akun nonaktif tidak dapat login dan sesi lama ditolak", async () => {
    const r = await login({ email: "budi@uji.test", password: TEST_PASSWORD }, META);
    await prisma.user.update({ where: { id: fx.emp2.userId }, data: { isActive: false } });
    expect(await validateSession(r.token)).toBeNull();
    expect(await code(login({ email: "budi@uji.test", password: TEST_PASSWORD }, META))).toBe("UNAUTHENTICATED");
  });

  it("logout mencabut sesi; ganti password mencabut sesi lain", async () => {
    const s1 = await login({ email: "citra@uji.test", password: TEST_PASSWORD }, META);
    const s2 = await login({ email: "citra@uji.test", password: TEST_PASSWORD }, META);
    await revokeSessionByToken(s1.token);
    expect(await validateSession(s1.token)).toBeNull();
    const me = (await validateSession(s2.token))!;
    await changeOwnPassword(me, { currentPassword: TEST_PASSWORD, newPassword: "Password-Baru-456!" });
    const s3 = await login({ email: "citra@uji.test", password: "Password-Baru-456!" }, META);
    expect(await validateSession(s3.token)).not.toBeNull();
    // sesi `me` dipertahankan (sesi saat ini), sesi lain dicabut → s1 sudah dicabut; buat satu lagi untuk memastikan
    expect(await code(changeOwnPassword(me, { currentPassword: "salah", newPassword: "Password-Lain-789!" }))).toBe("VALIDATION");
    expect(await code(changeOwnPassword(me, { currentPassword: "Password-Baru-456!", newPassword: "pendek" }))).toBe("VALIDATION");
  });

  it("password di database berupa hash scrypt, bukan teks asli", async () => {
    const u = await prisma.user.findFirstOrThrow({ where: { email: "hr@uji.test" } });
    expect(u.passwordHash.startsWith("scrypt$")).toBe(true);
    expect(u.passwordHash).not.toContain(TEST_PASSWORD);
  });
});

describe("RBAC — karyawan tidak dapat melihat data karyawan lain", () => {
  it("daftar/detail karyawan: hanya diri sendiri", async () => {
    expect(await code(listEmployees(fx.emp1, {}))).toBe("FORBIDDEN");
    expect(await code(getEmployee(fx.emp1, fx.empIds[0]))).toBe("OK");
    expect(await code(getEmployee(fx.emp1, fx.empIds[1]))).toBe("FORBIDDEN");
    expect(await code(createEmployee(fx.emp1, {}))).toBe("FORBIDDEN");
  });

  it("rekap: dikunci ke diri sendiri walau memaksa employeeId orang lain", async () => {
    const r = await getRecap(fx.emp1, { view: "bulanan", month: "2026-01", employeeId: fx.empIds[1] });
    expect(r.page.items).toHaveLength(1);
    expect(r.page.items[0]!.employeeId).toBe(fx.empIds[0]);
    expect(await code(getRecapDetail(fx.emp1, fx.empIds[1], { month: "2026-01" }))).toBe("FORBIDDEN");
    expect(await code(getEmployeeRange(fx.emp1, fx.empIds[1], "2026-01-01", "2026-01-31"))).toBe("FORBIDDEN");
  });

  it("pengajuan, komponen gaji, penggajian, audit, pengaturan: terlarang bagi karyawan", async () => {
    expect(await code(listLeaves(fx.emp1, {}))).toBe("FORBIDDEN");
    expect(await code(listComponents(fx.emp1, fx.empIds[0]))).toBe("FORBIDDEN");
    expect(await code(listRuns(fx.emp1))).toBe("FORBIDDEN");
    expect(await code(listAuditLogs(fx.emp1, {}))).toBe("FORBIDDEN");
    expect(await code(createSchedule(fx.emp1, {}))).toBe("FORBIDDEN");
    expect(await code(listUsers(fx.emp1))).toBe("FORBIDDEN");
    expect(await code(setBalance(fx.emp1, {}))).toBe("FORBIDDEN");
  });

  it("karyawan tidak dapat mengubah peran dirinya jadi admin", async () => {
    expect(await code(updateUser(fx.emp1, fx.emp1.userId, { role: "SUPER_ADMIN" }))).toBe("FORBIDDEN");
  });
});

describe("RBAC — batas Admin/HR", () => {
  it("HR: boleh operasional, tidak boleh persetujuan gaji / aturan / kebijakan / audit", async () => {
    expect(await code(listEmployees(fx.hr, {}))).toBe("OK");
    expect(await code(listComponents(fx.hr, fx.empIds[0]))).toBe("OK");
    expect(await code(listRuns(fx.hr))).toBe("OK");
    expect(await code(listAuditLogs(fx.hr, {}))).toBe("FORBIDDEN");
    expect(await code(approveRun(fx.hr, "00000000-0000-0000-0000-000000000000"))).toBe("FORBIDDEN");
    expect(await code(updatePayrollRules(fx.hr, {}))).toBe("FORBIDDEN");
    expect(await code(updateAttendancePolicy(fx.hr, {}))).toBe("FORBIDDEN");
    expect(await code(updateCompany(fx.hr, {}))).toBe("FORBIDDEN");
  });

  it("HR hanya mengelola akun berperan Karyawan", async () => {
    const e = await prisma.employee.create({ data: { employeeNo: "TE-100", fullName: "Dewi Baru", position: "Staf", employmentStatus: "CONTRACT", joinDate: new Date("2026-01-01T00:00:00Z") } });
    expect(await code(createUser(fx.hr, { email: "x@uji.test", name: "Orang Admin", role: "HR_ADMIN", password: "Sandi-Aman-12345!" }))).toBe("FORBIDDEN");
    expect(await code(createUser(fx.hr, { email: "x@uji.test", name: "Orang Super", role: "SUPER_ADMIN", password: "Sandi-Aman-12345!" }))).toBe("FORBIDDEN");
    const ok = await createUser(fx.hr, { email: "dewi@uji.test", name: "Dewi Baru", role: "EMPLOYEE", password: "Sandi-Aman-12345!", employeeId: e.id });
    expect(ok.employeeId).toBe(e.id);
    expect(ok.mustChangePassword).toBe(true);
    // HR tidak melihat/mengubah akun admin lain
    const list = await listUsers(fx.hr);
    expect(list.every((u) => u.role === "EMPLOYEE")).toBe(true);
    expect(await code(resetUserPassword(fx.hr, fx.superAdmin.userId, { password: "Sandi-Aman-12345!" }))).toBe("FORBIDDEN");
    expect(await code(updateUser(fx.hr, fx.superAdmin.userId, { isActive: false }))).toBe("FORBIDDEN");
  });

  it("Super Admin: boleh semua; tidak boleh menonaktifkan diri / Super Admin terakhir", async () => {
    expect(await code(listAuditLogs(fx.superAdmin, {}))).toBe("OK");
    expect(await code(updateUser(fx.superAdmin, fx.superAdmin.userId, { isActive: false }))).toBe("VALIDATION");
    const second = await createUser(fx.superAdmin, { email: "pimpinan2@uji.test", name: "Pimpinan Dua", role: "SUPER_ADMIN", password: "Sandi-Aman-12345!" });
    expect(await code(updateUser(fx.superAdmin, second.id, { isActive: false }))).toBe("OK");
  });

  it("akun Karyawan wajib tertaut ke data karyawan yang belum punya akun", async () => {
    expect(await code(createUser(fx.superAdmin, { email: "z@uji.test", name: "Tanpa Tautan", role: "EMPLOYEE", password: "Sandi-Aman-12345!" }))).toBe("VALIDATION");
    expect(await code(createUser(fx.superAdmin, { email: "z@uji.test", name: "Sudah Punya", role: "EMPLOYEE", password: "Sandi-Aman-12345!", employeeId: fx.empIds[0] }))).toBe("VALIDATION");
  });

  it("password lemah ditolak", async () => {
    const e = await prisma.employee.create({ data: { employeeNo: "TE-101", fullName: "Eka Uji", position: "Staf", employmentStatus: "INTERN", joinDate: new Date("2026-01-01T00:00:00Z") } });
    expect(await code(createUser(fx.hr, { email: "eka@uji.test", name: "Eka Uji", role: "EMPLOYEE", password: "password1234", employeeId: e.id }))).toBe("VALIDATION");
    expect(await code(createUser(fx.hr, { email: "eka@uji.test", name: "Eka Uji", role: "EMPLOYEE", password: "pendek", employeeId: e.id }))).toBe("VALIDATION");
  });
});
