/**
 * Checklist karyawan masuk & berhenti: dimulai otomatis, sinyal dari data sistem, butir dicatat siapa/kapan, penyelesaian terkunci,
 * dan penjaga database. Sinyal tidak pernah mencentang sendiri.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import { addDays, todayIso } from "@/lib/time";
import { ONBOARDING_TEMPLATE, OFFBOARDING_TEMPLATE } from "@/lib/employee-checklist";
import { addComponent, makeUser, resetDb } from "../helpers/db";
import { addTeam, mkProject, seedTraining, type TrainingFixtures } from "../helpers/training";
import { createEmployee, deactivateEmployee, getEmployee, updateEmployee } from "@/server/services/employees";
import { changeOrg } from "@/server/services/org";
import { createDocument } from "@/server/services/documents";
import { createTask } from "@/server/services/training/work";
import {
  addChecklistItem, cancelChecklist, completeChecklist, listChecklistOverview, listEmployeeChecklists, openChecklistCount, setChecklistItem, startChecklist,
} from "@/server/services/employee-checklists";

let fx: TrainingFixtures;
const TODAY = () => todayIso("Asia/Jakarta");
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const pdf = () => ({ name: "kontrak.pdf", bytes: new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n") });
const hire = (over: Record<string, unknown> = {}) => createEmployee(fx.hr, {
  employeeNo: "TE-100", fullName: "Hazwan Baru", position: "Staf Program", employmentStatus: "CONTRACT", joinDate: TODAY(), ...over,
});
const open = async (employeeId: string, kind: "ONBOARDING" | "OFFBOARDING") => (await listEmployeeChecklists(fx.hr, employeeId)).find((c) => c.kind === kind && c.status === "OPEN")!;
const item = (c: Awaited<ReturnType<typeof open>>, key: string) => c.items.find((i) => i.key === key)!;

beforeEach(async () => {
  await resetDb();
  fx = await seedTraining();
});

describe("memulai checklist", () => {
  it("karyawan baru langsung mendapat checklist masuk sesuai daftar HR; data lama tidak dibanjiri checklist", async () => {
    const e = await hire();
    const c = await open(e.id, "ONBOARDING");
    expect(c.items.map((i) => i.title)).toEqual(ONBOARDING_TEMPLATE.map((t) => t.title));
    expect(c.items.every((i) => i.required && i.status === "TODO")).toBe(true);
    expect(c).toMatchObject({ kind: "ONBOARDING", status: "OPEN", startedBy: "HR Uji", progress: { total: 9, done: 0, requiredLeft: 9 } });
    expect(c.targetDate! >= addDays(TODAY(), 7)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "checklist.start", entityId: c.id } })).toBe(1);

    const old = await hire({ employeeNo: "TE-101", fullName: "Karyawan Lama", joinDate: "2024-02-01" });
    expect(await listEmployeeChecklists(fx.hr, old.id)).toEqual([]);
  });

  it("mulai manual: tidak ganda untuk jenis yang sama; checklist masuk tidak untuk karyawan nonaktif; target tidak di masa lalu; hanya HR", async () => {
    const e = await hire();
    expect((await fail(startChecklist(fx.hr, e.id, { kind: "ONBOARDING" })))?.code).toBe("CONFLICT"); // sudah berjalan otomatis
    expect((await startChecklist(fx.hr, e.id, { kind: "OFFBOARDING", targetDate: addDays(TODAY(), 10), note: "Pindah kota" })).items.map((i) => i.title)).toEqual(OFFBOARDING_TEMPLATE.map((t) => t.title));
    expect((await fail(startChecklist(fx.hr, e.id, { kind: "OFFBOARDING" })))?.code).toBe("CONFLICT");
    expect((await fail(startChecklist(fx.hr, fx.empIds[0], { kind: "ONBOARDING", targetDate: addDays(TODAY(), -1) })))?.fieldErrors?.targetDate).toBeTruthy();
    expect((await fail(startChecklist(fx.emp1, e.id, { kind: "ONBOARDING" })))?.code).toBe("FORBIDDEN");
    expect((await fail(listEmployeeChecklists(fx.emp1, e.id)))?.code).toBe("FORBIDDEN"); // checklist adalah urusan HR
    await prisma.employee.update({ where: { id: fx.empIds[1] }, data: { isActive: false } });
    expect((await fail(startChecklist(fx.hr, fx.empIds[1], { kind: "ONBOARDING" })))?.code).toBe("CONFLICT");
  });
});

describe("sinyal otomatis (petunjuk, tidak mencentang sendiri)", () => {
  it("masuk: tiap sinyal berubah WARN → OK seiring data dilengkapi, tetapi butir tetap Belum sampai HR menyelesaikannya", async () => {
    const e = await hire();
    let c = await open(e.id, "ONBOARDING");
    for (const k of ["basic_data", "emergency_contact", "contract_docs", "placement", "salary_components", "portal_account"]) expect(item(c, k).signal?.state, k).toBe("WARN");
    expect(item(c, "schedule").signal?.state).toBe("INFO");

    await updateEmployee(fx.hr, e.id, {
      employeeNo: "TE-100", fullName: "Hazwan Baru", position: "Staf Program", employmentStatus: "CONTRACT", joinDate: TODAY(), divisionId: fx.divisionA,
      phone: "0812 3456 7890", address: "Jl. Mawar 1, Sleman", bankName: "BCA", bankAccountNo: "1234567890",
      emergencyContactName: "Siti Aminah", emergencyContactRelation: "Istri", emergencyContactPhone: "0813 1111 2222",
    });
    await changeOrg(fx.hr, e.id, { supervisorId: fx.empIds[0], effectiveFrom: TODAY() });
    await addComponent(e.id, fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 4_000_000 });
    await createDocument(fx.hr, { employeeId: e.id, kind: "CONTRACT", title: "PKWT I", startDate: TODAY(), endDate: addDays(TODAY(), 365) }, pdf());
    await makeUser("hazwan@uji.test", "Hazwan Baru", "EMPLOYEE", e.id);

    c = await open(e.id, "ONBOARDING");
    for (const k of ["basic_data", "emergency_contact", "contract_docs", "placement", "salary_components", "portal_account"]) expect(item(c, k).signal?.state, k).toBe("OK");
    expect(item(c, "emergency_contact").signal?.text).toContain("Siti Aminah (Istri)");
    expect(item(c, "system_access").signal?.text).toContain("Peran akun: EMPLOYEE");
    expect(c.items.every((i) => i.status === "TODO")).toBe(true); // sinyal ≠ keputusan
    expect((await getEmployee(fx.hr, e.id)).emergencyContactPhone).toBe("0813 1111 2222");
  });

  it("berhenti: menonaktifkan karyawan memulai checklist berhenti otomatis, menonaktifkan akun, dan sinyal serah terima menghitung yang tersisa", async () => {
    const budi = fx.empIds[1];
    const pid = await mkProject(fx.mgr, {});
    await addTeam(fx.mgr, pid, [[budi, "STAFF"]]);
    await createTask(fx.mgr, pid, { title: "Menyusun materi", assigneeId: budi, dueDate: addDays(TODAY(), 5) });
    await changeOrg(fx.hr, fx.empIds[2], { supervisorId: budi, effectiveFrom: TODAY() });

    let c = await startChecklist(fx.hr, budi, { kind: "OFFBOARDING" }); // dimulai manual selagi masih aktif
    expect(item(c, "end_date_docs").signal?.state).toBe("INFO");
    expect(item(c, "account_decision").signal?.state).toBe("INFO");
    expect(item(c, "handover").signal).toMatchObject({ state: "WARN" });
    expect(item(c, "handover").signal!.text).toMatch(/1 tugas Training aktif.*1 keanggotaan proyek aktif.*1 bawahan langsung/);

    await deactivateEmployee(fx.hr, budi, { endDate: TODAY(), reason: "Mengundurkan diri" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fx.emp2.userId } })).isActive).toBe(false); // perilaku lama tetap: akun nonaktif
    expect(await prisma.employeeChecklist.count({ where: { employeeId: budi, kind: "OFFBOARDING" } })).toBe(1); // tidak ganda
    c = await open(budi, "OFFBOARDING");
    expect(item(c, "account_decision").signal).toMatchObject({ state: "OK" });
    expect(item(c, "end_date_docs").signal).toMatchObject({ state: "WARN" }); // belum ada dokumen penyelesaian
    expect(item(c, "obligations").signal!.text).toContain("sisa cuti");
  });

  it("berhenti tanpa checklist: deactivate membuatkannya otomatis dengan catatan", async () => {
    await deactivateEmployee(fx.hr, fx.empIds[2], {});
    const c = (await listEmployeeChecklists(fx.hr, fx.empIds[2]))[0]!;
    expect(c).toMatchObject({ kind: "OFFBOARDING", status: "OPEN", note: "Dimulai otomatis saat karyawan dinonaktifkan" });
    expect((await openChecklistCount())).toBe(1);
  });
});

describe("mencentang butir & menyelesaikan proses", () => {
  it("Selesai mencatat siapa & kapan; 'Tidak berlaku' wajib beralasan; bisa dibuka lagi; hanya HR", async () => {
    const e = await hire();
    const c = await open(e.id, "ONBOARDING");
    const oc = item(c, "orientation");
    await setChecklistItem(fx.hr, oc.id, { status: "DONE", note: "Orientasi 3 hari dengan tim program" });
    let it = item(await open(e.id, "ONBOARDING"), "orientation");
    expect(it).toMatchObject({ status: "DONE", note: "Orientasi 3 hari dengan tim program", doneBy: "HR Uji" });
    expect(it.doneAt).not.toBeNull();
    expect((await fail(setChecklistItem(fx.hr, item(c, "schedule").id, { status: "NOT_APPLICABLE" })))?.fieldErrors?.note).toBeTruthy();
    await setChecklistItem(fx.hr, item(c, "schedule").id, { status: "NOT_APPLICABLE", note: "Memakai jadwal bawaan" });
    await setChecklistItem(fx.hr, oc.id, { status: "TODO" });
    it = item(await open(e.id, "ONBOARDING"), "orientation");
    expect(it).toMatchObject({ status: "TODO", doneBy: null, doneAt: null });
    expect((await fail(setChecklistItem(fx.emp1, oc.id, { status: "DONE" })))?.code).toBe("FORBIDDEN");
    expect((await fail(setChecklistItem(fx.hr, "00000000-0000-4000-8000-000000000000", { status: "DONE" })))?.code).toBe("NOT_FOUND");
    expect(await prisma.auditLog.count({ where: { action: "checklist.item" } })).toBe(3); // DONE, TIDAK BERLAKU, BUKA LAGI — yang ditolak tidak tercatat
  });

  it("selesai hanya bila semua butir wajib beres; sesudahnya terkunci (aplikasi & database); proses baru boleh dimulai lagi", async () => {
    const e = await hire();
    const c = await open(e.id, "ONBOARDING");
    const err = await fail(completeChecklist(fx.hr, c.id));
    expect(err?.code).toBe("VALIDATION");
    expect(err?.message).toMatch(/9 butir wajib.*Data dasar dilengkapi/);
    await addChecklistItem(fx.hr, c.id, { title: "Serahkan seragam kerja", hint: "Ukuran M", required: false });
    for (const i of c.items) await setChecklistItem(fx.hr, i.id, i.key === "schedule" ? { status: "NOT_APPLICABLE", note: "Jadwal bawaan" } : { status: "DONE" });
    const full = await open(e.id, "ONBOARDING");
    expect(full.items.at(-1)).toMatchObject({ title: "Serahkan seragam kerja", required: false, status: "TODO", group: "Tambahan HR" }); // tidak wajib → tidak menghalangi
    await completeChecklist(fx.hr, c.id, { note: "Semua beres" });
    const done = (await listEmployeeChecklists(fx.hr, e.id))[0]!;
    expect(done).toMatchObject({ status: "COMPLETED", completedBy: "HR Uji", note: "Semua beres" });

    expect((await fail(setChecklistItem(fx.hr, c.items[0]!.id, { status: "TODO" })))?.code).toBe("CONFLICT");
    expect((await fail(completeChecklist(fx.hr, c.id)))?.code).toBe("CONFLICT");
    expect((await fail(addChecklistItem(fx.hr, c.id, { title: "Terlambat ditambah" })))?.code).toBe("CONFLICT");
    await expect(prisma.$executeRaw`UPDATE employee_checklist_items SET status = 'TODO', "doneAt" = NULL, "doneById" = NULL WHERE "checklistId" = ${c.id}::uuid`).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.$executeRaw`DELETE FROM employee_checklist_items`).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.$executeRaw`DELETE FROM employee_checklists`).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.$executeRaw`UPDATE employee_checklists SET status = 'OPEN', "completedAt" = NULL, "completedById" = NULL`).rejects.toThrow(/HRIS-GUARD/);
    expect((await startChecklist(fx.hr, e.id, { kind: "ONBOARDING" })).status).toBe("OPEN"); // misalnya karyawan kembali bekerja
  });

  it("batal wajib beralasan, terkunci, dan database menolak dua proses terbuka sejenis", async () => {
    const e = await hire();
    const c = await open(e.id, "ONBOARDING");
    expect((await fail(cancelChecklist(fx.hr, c.id, { reason: "" })))?.fieldErrors?.reason).toBeTruthy();
    await expect(prisma.employeeChecklist.create({ data: { employeeId: e.id, kind: "ONBOARDING", startedById: fx.hr.userId } })).rejects.toThrow(); // indeks unik parsial
    await cancelChecklist(fx.hr, c.id, { reason: "Dimulai keliru, karyawan batal bergabung" });
    expect((await listEmployeeChecklists(fx.hr, e.id))[0]).toMatchObject({ status: "CANCELLED", cancelReason: "Dimulai keliru, karyawan batal bergabung" });
    expect((await fail(cancelChecklist(fx.hr, c.id, { reason: "Sekali lagi" })))?.code).toBe("CONFLICT");
  });
});

describe("ringkasan proses", () => {
  it("proses terbuka diurutkan terlambat dulu, lencana menghitung yang terbuka, yang ditutup masuk 'baru ditutup'", async () => {
    const a = await hire({ employeeNo: "TE-200", fullName: "Anggun Baru" });
    const b = await hire({ employeeNo: "TE-201", fullName: "Bayu Baru" });
    await prisma.employeeChecklist.updateMany({ where: { employeeId: b.id }, data: { targetDate: isoToDate(addDays(TODAY(), -3)) } });
    const o = await listChecklistOverview(fx.hr);
    expect(o.open.map((r) => r.employeeName)).toEqual(["Bayu Baru", "Anggun Baru"]);
    expect(o.open[0]).toMatchObject({ overdue: true, kind: "ONBOARDING", progress: { total: 9, requiredLeft: 9 } });
    expect(await openChecklistCount()).toBe(2);
    await cancelChecklist(fx.hr, (await open(a.id, "ONBOARDING")).id, { reason: "Batal bergabung" });
    expect(await openChecklistCount()).toBe(1);
    expect((await listChecklistOverview(fx.hr)).recent.map((r) => r.status)).toEqual(["CANCELLED"]);
    expect((await fail(listChecklistOverview(fx.emp1)))?.code).toBe("FORBIDDEN");
  });
});
