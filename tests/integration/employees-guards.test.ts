import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { login } from "@/server/services/auth";
import { validateSession } from "@/server/auth/session";
import {
  createDivision, createEmployee, deactivateEmployee, employeesTable, getEmployee, listEmployees, reactivateEmployee, revealBankAccount, updateEmployee, updateDivision,
} from "@/server/services/employees";
import { createAssignment, createSchedule, updateSchedule, addCalendarDay } from "@/server/services/schedules";
import { toCsv } from "@/server/export";
import { resetDb, seedFixtures, TEST_PASSWORD, type Fixtures } from "../helpers/db";

let fx: Fixtures;
beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
});

const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const base = {
  employeeNo: "TE-050", fullName: "Dimas Prakoso", position: "Marketing", employmentStatus: "CONTRACT", joinDate: "2026-02-02",
  phone: "0812-3456-7890", email: "dimas@uji.test", address: "Jl. Uji No. 5", bankName: "Bank Uji", bankAccountNo: "1234567890123", bankAccountHolder: "Dimas Prakoso",
};

describe("data karyawan", () => {
  it("membuat karyawan: nomor rekening dienkripsi, hanya 4 digit terakhir yang ditampilkan", async () => {
    const e = await createEmployee(fx.hr, { ...base, divisionId: fx.divisionB });
    expect(e.bankAccountMasked).toContain("0123");
    expect(JSON.stringify(e)).not.toContain("1234567890123");
    const raw = await prisma.employee.findUniqueOrThrow({ where: { id: e.id } });
    expect(raw.bankAccountEnc).toMatch(/^v1:/);
    expect(raw.bankAccountEnc).not.toContain("1234567890123");
    expect(raw.bankAccountLast4).toBe("0123");
    // karyawan sendiri melihat datanya (tanpa nomor lengkap); orang lain tidak
    const audit = await prisma.auditLog.findFirst({ where: { action: "employee.create" } });
    expect(JSON.stringify(audit?.after)).not.toContain("1234567890123");
  });

  it("nomor lengkap hanya lewat 'tampilkan' oleh admin dan SELALU diaudit", async () => {
    const e = await createEmployee(fx.hr, base);
    expect((await fail(revealBankAccount(fx.emp1, e.id)))?.code).toBe("FORBIDDEN");
    const r = await revealBankAccount(fx.hr, e.id);
    expect(r.accountNo).toBe("1234567890123");
    expect(await prisma.auditLog.count({ where: { action: "employee.reveal_bank" } })).toBe(1);
  });

  it("update tanpa mengirim nomor rekening tidak mengubahnya; null menghapusnya", async () => {
    const e = await createEmployee(fx.hr, base);
    const { bankAccountNo: _omit, ...withoutAccount } = base;
    void _omit;
    await updateEmployee(fx.hr, e.id, { ...withoutAccount, position: "Senior Marketing" });
    expect((await revealBankAccount(fx.hr, e.id)).accountNo).toBe("1234567890123");
    await updateEmployee(fx.hr, e.id, { ...withoutAccount, position: "Senior Marketing", bankAccountNo: null });
    expect((await revealBankAccount(fx.hr, e.id)).accountNo).toBeNull();
    expect((await getEmployee(fx.hr, e.id)).position).toBe("Senior Marketing");
  });

  it("nomor induk unik tanpa membedakan huruf besar/kecil (aplikasi dan database)", async () => {
    await createEmployee(fx.hr, base);
    expect((await fail(createEmployee(fx.hr, { ...base, employeeNo: "te-050", fullName: "Orang Lain" })))?.fieldErrors?.employeeNo).toBeTruthy();
    await expect(prisma.employee.create({ data: { employeeNo: "TE-050".toLowerCase(), fullName: "X", position: "X", employmentStatus: "INTERN", joinDate: new Date("2026-01-01T00:00:00Z") } })).rejects.toThrow();
    const other = await createEmployee(fx.hr, { ...base, employeeNo: "TE-051", fullName: "Orang Lain" });
    expect((await fail(updateEmployee(fx.hr, other.id, { ...base, employeeNo: "TE-050", fullName: "Orang Lain" })))?.code).toBe("VALIDATION");
  });

  it("validasi: wajib diisi, format email/telepon/rekening/tanggal", async () => {
    const e = await fail(createEmployee(fx.hr, { ...base, fullName: "", email: "bukan-email", phone: "abc", bankAccountNo: "12", joinDate: "2026-02-30", employeeNo: "bad nomor!" }));
    expect(e?.code).toBe("VALIDATION");
    expect(Object.keys(e!.fieldErrors!).sort()).toEqual(["bankAccountNo", "email", "employeeNo", "fullName", "joinDate", "phone"]);
  });

  it("pencarian & filter: nama/nomor/jabatan, divisi, status kepegawaian, aktif/nonaktif", async () => {
    await createEmployee(fx.hr, { ...base, divisionId: fx.divisionB });
    const all = await listEmployees(fx.hr, {});
    expect(all.total).toBe(4);
    expect((await listEmployees(fx.hr, { q: "dimas" })).items.map((i) => i.employeeNo)).toEqual(["TE-050"]);
    expect((await listEmployees(fx.hr, { q: "te-00" })).total).toBe(3);
    expect((await listEmployees(fx.hr, { divisionId: fx.divisionB })).total).toBe(2);
    expect((await listEmployees(fx.hr, { employmentStatus: "CONTRACT" })).total).toBe(1);
    expect((await listEmployees(fx.hr, { pageSize: 2, page: 2 })).items).toHaveLength(2);
  });

  it("nonaktifkan: isi tanggal berhenti, matikan akun & sesi; data tetap ada; aktifkan kembali", async () => {
    const s = await login({ email: "budi@uji.test", password: TEST_PASSWORD }, { ip: null, userAgent: null });
    await deactivateEmployee(fx.hr, fx.empIds[1], { endDate: "2026-03-31", reason: "Mengundurkan diri" });
    const e = await getEmployee(fx.hr, fx.empIds[1]);
    expect(e.isActive).toBe(false);
    expect(e.endDate).toBe("2026-03-31");
    expect(await validateSession(s.token)).toBeNull();
    expect((await fail(login({ email: "budi@uji.test", password: TEST_PASSWORD }, { ip: null, userAgent: null })))?.code).toBe("UNAUTHENTICATED");
    expect((await listEmployees(fx.hr, {})).total).toBe(2); // default: hanya aktif
    expect((await listEmployees(fx.hr, { active: "inactive" })).total).toBe(1);
    expect((await fail(deactivateEmployee(fx.hr, fx.empIds[1], {})))?.code).toBe("CONFLICT");
    await reactivateEmployee(fx.hr, fx.empIds[1]);
    expect((await getEmployee(fx.hr, fx.empIds[1])).endDate).toBeNull();
    expect((await login({ email: "budi@uji.test", password: TEST_PASSWORD }, { ip: null, userAgent: null })).token).toBeTruthy();
  });

  it("tanggal berhenti sebelum tanggal mulai ditolak", async () => {
    expect((await fail(deactivateEmployee(fx.hr, fx.empIds[0], { endDate: "2024-01-01" })))?.code).toBe("VALIDATION");
  });

  it("ekspor: nomor rekening dimasker, tercatat di audit, dan sel berbahaya dinetralkan", async () => {
    await createEmployee(fx.hr, { ...base, fullName: "+SUM(1+1)" });
    const t = await employeesTable(fx.hr, {});
    const csv = toCsv(t);
    expect(csv).toContain("•••• •••• 0123");
    expect(csv).not.toContain("1234567890123");
    expect(csv).toContain("'+SUM(1+1)");
    expect(await prisma.auditLog.count({ where: { action: "employee.export" } })).toBe(1);
    expect((await fail(employeesTable(fx.emp1, {})))?.code).toBe("FORBIDDEN");
  });

  it("divisi: nama unik tanpa membedakan huruf", async () => {
    expect((await fail(createDivision(fx.hr, { name: "operasional" })))?.fieldErrors?.name).toBeTruthy();
    const d = await createDivision(fx.hr, { name: "Keuangan" });
    expect((await fail(updateDivision(fx.hr, d.id, { name: "PEMASARAN" })))?.code).toBe("VALIDATION");
  });
});

describe("jadwal, penugasan, kalender", () => {
  const sch = { name: "Ramadan", workDays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "15:00", lateToleranceMinutes: 10, absentCutoffTime: "11:00" };

  it("validasi jam & toleransi; nama unik; hanya satu jadwal default", async () => {
    expect((await fail(createSchedule(fx.hr, { ...sch, endTime: "07:00" })))?.fieldErrors?.endTime).toBeTruthy();
    expect((await fail(createSchedule(fx.hr, { ...sch, absentCutoffTime: "07:00" })))?.fieldErrors?.absentCutoffTime).toBeTruthy();
    expect((await fail(createSchedule(fx.hr, { ...sch, startTime: "8:00" })))?.fieldErrors?.startTime).toBeTruthy();
    expect((await fail(createSchedule(fx.hr, { ...sch, workDays: [] })))?.code).toBe("VALIDATION");
    expect((await fail(createSchedule(fx.hr, { ...sch, name: "reguler" })))?.fieldErrors?.name).toBeTruthy();
    const s = await createSchedule(fx.hr, { ...sch, isDefault: true });
    expect(s.isDefault).toBe(true);
    expect(await prisma.workSchedule.count({ where: { isDefault: true } })).toBe(1);
    await expect(prisma.workSchedule.update({ where: { id: fx.scheduleId }, data: { isDefault: true } })).rejects.toThrow();
    expect((await fail(updateSchedule(fx.hr, s.id, { ...sch, isDefault: false })))?.code).toBe("VALIDATION");
  });

  it("penugasan: tanggal pada target yang sama tidak boleh bertabrakan; target berbeda boleh", async () => {
    const s = await createSchedule(fx.hr, sch);
    const a = { scheduleId: s.id, scope: "DIVISION", divisionId: fx.divisionA, startDate: "2027-02-01", endDate: "2027-03-01" };
    await createAssignment(fx.hr, a);
    expect((await fail(createAssignment(fx.hr, { ...a, startDate: "2027-02-20", endDate: "2027-04-01" })))?.code).toBe("CONFLICT");
    await createAssignment(fx.hr, { ...a, divisionId: fx.divisionB });
    await createAssignment(fx.hr, { ...a, startDate: "2027-03-02", endDate: null });
    expect((await fail(createAssignment(fx.hr, { scheduleId: s.id, scope: "EMPLOYEE", startDate: "2027-02-01" })))?.fieldErrors?.employeeId).toBeTruthy();
  });

  it("jadwal yang sedang dipakai penugasan aktif tidak bisa dinonaktifkan", async () => {
    const s = await createSchedule(fx.hr, sch);
    await createAssignment(fx.hr, { scheduleId: s.id, scope: "ALL", startDate: "2099-01-01" });
    expect((await fail(updateSchedule(fx.hr, s.id, { ...sch, isActive: false })))?.code).toBe("CONFLICT");
  });

  it("kalender: satu entri per tanggal", async () => {
    await addCalendarDay(fx.hr, { date: "2026-08-17", kind: "HOLIDAY", name: "Hari Kemerdekaan" });
    expect((await fail(addCalendarDay(fx.hr, { date: "2026-08-17", kind: "SPECIAL_WORKDAY", name: "Ganda" })))?.fieldErrors?.date).toBeTruthy();
    expect((await fail(addCalendarDay(fx.emp1, { date: "2026-08-18", kind: "HOLIDAY", name: "Tidak sah" })))?.code).toBe("FORBIDDEN");
  });
});

describe("guard database (defense in depth)", () => {
  it("menolak data tidak konsisten walau lewat SQL langsung", async () => {
    await expect(prisma.$executeRawUnsafe(`UPDATE work_schedules SET "endTime" = '06:00'`)).rejects.toThrow(/work_schedules_times/);
    await expect(prisma.$executeRawUnsafe(`UPDATE work_schedules SET "workDays" = '{8}'`)).rejects.toThrow(/work_schedules_days/);
    await expect(prisma.$executeRawUnsafe(`UPDATE employees SET "endDate" = '2000-01-01'`)).rejects.toThrow(/employees_dates/);
    await expect(prisma.$executeRawUnsafe(`UPDATE company_settings SET "locationEnabled" = true`)).rejects.toThrow(/company_settings_values/);
  });

  it("satu absensi per karyawan per hari — keunikan ditegakkan database", async () => {
    const mk = () => prisma.attendance.create({ data: { employeeId: fx.empIds[0], date: new Date("2026-01-05T00:00:00Z"), checkInAt: new Date("2026-01-05T01:00:00Z") } });
    await mk();
    await expect(mk()).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE attendances SET "checkOutAt" = "checkInAt" - interval '1 minute'`)).rejects.toThrow(/attendances_out_after_in/);
  });

  it("pengajuan yang sudah diputuskan beku di level database; hapus dilarang", async () => {
    const l = await prisma.leaveRequest.create({
      data: { employeeId: fx.empIds[0], type: "IZIN", startDate: new Date("2026-01-05T00:00:00Z"), endDate: new Date("2026-01-05T00:00:00Z"), reason: "Uji", status: "APPROVED", workingDays: 1, reviewedById: fx.hr.userId, reviewedAt: new Date() },
    });
    await expect(prisma.$executeRawUnsafe(`UPDATE leave_requests SET reason = 'diubah' WHERE id = '${l.id}'`)).rejects.toThrow(/tidak dapat diubah/);
    await expect(prisma.$executeRawUnsafe(`UPDATE leave_requests SET status = 'REJECTED' WHERE id = '${l.id}'`)).rejects.toThrow(/tidak diizinkan/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM leave_requests`)).rejects.toThrow(/tidak boleh dihapus/);
  });

  it("komponen gaji: nominal negatif, persen tanpa nilai, kategori tidak cocok ditolak", async () => {
    const ins = (cols: string, vals: string) => prisma.$executeRawUnsafe(
      `INSERT INTO salary_components (id, "employeeId", "createdById", "updatedAt", "effectiveFrom", ${cols}) VALUES (gen_random_uuid(), '${fx.empIds[0]}', '${fx.hr.userId}', now(), '2026-01-01', ${vals})`);
    await expect(ins(`kind, category, name, calc, amount`, `'EARNING','BASE_SALARY','x','FIXED',-1`)).rejects.toThrow(/salary_components_amount/);
    await expect(ins(`kind, category, name, calc, amount`, `'EARNING','BASE_SALARY','x','PERCENT_OF_BASE',0`)).rejects.toThrow(/salary_components_percent/);
    await expect(ins(`kind, category, name, calc, amount`, `'EARNING','BPJS','x','FIXED',1`)).rejects.toThrow(/salary_components_kind_category/);
  });
});
