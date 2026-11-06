/**
 * Struktur organisasi kepegawaian: atasan langsung, tanggal berlaku, riwayat, pengganti, dan alur tinjauan cuti/lembur.
 * Bagan uji: Citra (puncak) ← Ayu ← Budi.  Sari (karyawan baru) di bawah Ayu bersama Budi.  Tono berdiri sendiri (tanpa atasan).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import type { Actor } from "@/server/actor";
import { addDays, isoWeekday, todayIso } from "@/lib/time";
import { makeEmployee, makeUser, resetDb, seedFixtures, type Fixtures } from "../helpers/db";
import { changeOrg, createDelegation, cancelDelegation, getOrgProfile, listDelegations, listOrgHistory, teamPendingCount } from "@/server/services/org";
import { updateEmployee } from "@/server/services/employees";
import { cancelLeave, getBalance, listTeamLeaves, reviewLeave, setBalance, submitLeave } from "@/server/services/leave";
import { listTeamOvertime, reviewOvertime, submitOvertime } from "@/server/services/overtime";
import { listNotifications } from "@/server/services/notifications";
import { updateAttendancePolicy } from "@/server/services/settings";
import { pinNow } from "../helpers/pin-now";

pinNow();
let fx: Fixtures;
let ayu: Actor, budi: Actor, citra: Actor, sari: Actor, tono: Actor;
let ids: { ayu: string; budi: string; citra: string; sari: string; tono: string };
const TODAY = () => todayIso("Asia/Jakarta");
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const workday = (plus: number) => { let d = addDays(TODAY(), plus); while (isoWeekday(d) > 5) d = addDays(d, 1); return d; };
const notes = (a: Actor, type: string) => prisma.notification.findMany({ where: { userId: a.userId, type } });
const setSupervisor = (employeeId: string, supervisorId: string | null) => changeOrg(fx.hr, employeeId, { supervisorId, effectiveFrom: TODAY() });

beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
  [citra, ayu, budi] = [fx.emp3, fx.emp1, fx.emp2];
  const s = await makeEmployee({ employeeNo: "TE-004", fullName: "Sari Wulandari", divisionId: fx.divisionA });
  const t = await makeEmployee({ employeeNo: "TE-005", fullName: "Tono Prasetyo", divisionId: fx.divisionA });
  sari = await makeUser("sari@uji.test", "Sari Wulandari", "EMPLOYEE", s.id);
  tono = await makeUser("tono@uji.test", "Tono Prasetyo", "EMPLOYEE", t.id);
  ids = { ayu: fx.empIds[0], budi: fx.empIds[1], citra: fx.empIds[2], sari: s.id, tono: t.id };
  await updateAttendancePolicy(fx.superAdmin, {
    lateMinutesAfterTolerance: false, locationEnabled: false, locationName: null, locationLat: null, locationLng: null, locationRadiusMeters: 100,
    locationMaxAccuracyMeters: 150, requestBackdateDays: 365, annualLeaveQuota: 12, allowNegativeLeaveBalance: false,
  });
  await setSupervisor(ids.ayu, ids.citra);
  await setSupervisor(ids.budi, ids.ayu);
  await setSupervisor(ids.sari, ids.ayu);
});

describe("atasan langsung, tanggal berlaku, dan riwayat", () => {
  it("perubahan jabatan/divisi/status/atasan tercatat dengan tanggal berlaku; baris awal dibuat otomatis; kolom karyawan = keadaan terkini", async () => {
    const eff = addDays(TODAY(), -10);
    const p = await changeOrg(fx.hr, ids.budi, { position: "Supervisor Operasional", divisionId: fx.divisionB, employmentStatus: "CONTRACT", effectiveFrom: eff, note: "Promosi + mutasi" });
    expect(p).toMatchObject({ position: "Supervisor Operasional", divisionName: "Pemasaran", employmentStatus: "CONTRACT", effectiveFrom: eff, sinceJoin: false, supervisor: { id: ids.ayu } });
    const row = await prisma.employee.findUniqueOrThrow({ where: { id: ids.budi } });
    expect(row).toMatchObject({ position: "Supervisor Operasional", divisionId: fx.divisionB, employmentStatus: "CONTRACT", supervisorId: ids.ayu });
    const h = await listOrgHistory(fx.hr, ids.budi);
    // terbaru dulu: perubahan struktural (eff) → baris atasan (hari ini, saat setSupervisor) → baris awal
    expect(h.map((x) => x.changes)).toEqual([["SUPERVISOR"], ["DIVISION", "POSITION", "STATUS"], ["BASELINE"]]);
    const struct = h.find((x) => x.changes.includes("POSITION"))!;
    expect(struct).toMatchObject({ effectiveFrom: eff, position: "Supervisor Operasional", divisionName: "Pemasaran", employmentStatus: "CONTRACT", note: "Promosi + mutasi", supervisorName: "Ayu Lestari" });
    expect(h.some((x) => x.changes.includes("BASELINE") && x.position === "Staf")).toBe(true); // keadaan sebelum perubahan pertama
    expect(await prisma.auditLog.count({ where: { action: "employee.org_change", entityId: ids.budi } })).toBeGreaterThanOrEqual(2);
  });

  it("mengganti atasan saja tidak menggeser tanggal mulai berlaku jabatan; karyawan & atasan baru diberi tahu", async () => {
    const before = (await getOrgProfile(fx.hr, ids.sari)).effectiveFrom;
    await setSupervisor(ids.sari, ids.citra);
    const p = await getOrgProfile(fx.hr, ids.sari);
    expect(p.supervisor?.id).toBe(ids.citra);
    expect(p.effectiveFrom).toBe(before);
    expect((await notes(sari, "org.changed")).length).toBeGreaterThan(0);
    expect((await notes(citra, "org.report_added")).length).toBeGreaterThan(0);
    expect((await getOrgProfile(fx.hr, ids.ayu)).reports.map((r) => r.name)).toEqual(["Budi Santoso"]);
  });

  it("validasi: diri sendiri, rantai melingkar, atasan nonaktif, tanpa perubahan, tanggal masa depan/terlalu awal, karyawan nonaktif", async () => {
    expect((await fail(setSupervisor(ids.tono, ids.tono)))?.fieldErrors?.supervisorId).toBeTruthy();
    expect((await fail(setSupervisor(ids.citra, ids.budi)))?.fieldErrors?.supervisorId).toBeTruthy(); // Budi di bawah Ayu di bawah Citra
    expect((await fail(setSupervisor(ids.ayu, ids.sari)))?.fieldErrors?.supervisorId).toBeTruthy();
    await prisma.employee.update({ where: { id: ids.tono }, data: { isActive: false } });
    expect((await fail(setSupervisor(ids.budi, ids.tono)))?.fieldErrors?.supervisorId).toBeTruthy();
    expect((await fail(setSupervisor(ids.budi, ids.ayu)))?.message).toMatch(/Tidak ada perubahan/);
    expect((await fail(changeOrg(fx.hr, ids.budi, { position: "Kepala Tim", effectiveFrom: addDays(TODAY(), 1) })))?.fieldErrors?.effectiveFrom).toBeTruthy();
    expect((await fail(changeOrg(fx.hr, ids.budi, { position: "Kepala Tim", effectiveFrom: "2000-01-01" })))?.fieldErrors?.effectiveFrom).toBeTruthy();
    expect((await fail(changeOrg(fx.hr, ids.tono, { position: "Kepala Tim", effectiveFrom: TODAY() })))?.code).toBe("CONFLICT"); // nonaktif
  });

  it("izin: hanya HR/Super Admin yang mengubah; karyawan melihat profilnya sendiri tetapi tidak milik orang lain", async () => {
    expect((await fail(changeOrg(budi, ids.sari, { position: "X Y", effectiveFrom: TODAY() })))?.code).toBe("FORBIDDEN");
    expect((await fail(changeOrg(ayu, ids.budi, { supervisorId: null, effectiveFrom: TODAY() })))?.code).toBe("FORBIDDEN"); // atasan pun tidak
    expect((await getOrgProfile(budi, ids.budi)).supervisor?.id).toBe(ids.ayu);
    expect((await fail(getOrgProfile(budi, ids.sari)))?.code).toBe("FORBIDDEN");
    expect((await fail(listOrgHistory(budi, ids.sari)))?.code).toBe("FORBIDDEN");
    expect((await getOrgProfile(fx.hr, ids.sari)).supervisor?.id).toBe(ids.ayu);
  });

  it("penjaga database: riwayat tambah-saja, atasan bukan diri sendiri, rantai melingkar ditolak di tingkat DB", async () => {
    await expect(prisma.$executeRaw`UPDATE employee_org_history SET position = 'x'`).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.$executeRaw`DELETE FROM employee_org_history`).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.employee.update({ where: { id: ids.tono }, data: { supervisorId: ids.tono } })).rejects.toThrow();
    await expect(prisma.employee.update({ where: { id: ids.citra }, data: { supervisorId: ids.budi } })).rejects.toThrow(/melingkar/);
  });

  it("mengubah divisi/jabatan lewat formulir data karyawan juga tercatat di riwayat (berlaku hari ini); tanpa perubahan struktur tidak mencatat apa pun", async () => {
    const e = await prisma.employee.findUniqueOrThrow({ where: { id: ids.tono } });
    const base = { employeeNo: e.employeeNo, fullName: e.fullName, divisionId: e.divisionId, position: e.position, employmentStatus: e.employmentStatus, joinDate: "2025-01-01" };
    await updateEmployee(fx.hr, ids.tono, { ...base, phone: "0812 3456 7890" });
    expect(await prisma.employeeOrgHistory.count({ where: { employeeId: ids.tono, NOT: { changes: { has: "BASELINE" } } } })).toBe(0);
    await updateEmployee(fx.hr, ids.tono, { ...base, position: "Koordinator Lapangan" });
    const h = await listOrgHistory(fx.hr, ids.tono);
    expect(h[0]).toMatchObject({ changes: ["POSITION"], position: "Koordinator Lapangan", effectiveFrom: TODAY() });
    expect(h.some((x) => x.changes.includes("BASELINE") && x.position === "Staf")).toBe(true);
    expect((await getOrgProfile(fx.hr, ids.tono)).effectiveFrom).toBe(TODAY());
  });
});

describe("alur tinjauan cuti: karyawan → atasan → HR memantau/memproses", () => {
  const submit = (who: Actor, over: Record<string, unknown> = {}) => submitLeave(who, { type: "IZIN", startDate: workday(3), endDate: workday(3), reason: "Urusan keluarga", ...over });

  it("pengajuan Sari diberi tahu ke atasannya (bukan ke HR); atasan menyetujui dan kapasitasnya tercatat; HR tetap melihat dan memproses bila perlu", async () => {
    const l = await submit(sari);
    expect((await notes(ayu, "leave.submitted")).map((n) => n.href)).toEqual(["/persetujuan-tim"]);
    expect(await notes(fx.hr, "leave.submitted")).toHaveLength(0);
    expect(await notes(fx.superAdmin, "leave.submitted")).toHaveLength(0);
    expect((await listTeamLeaves(ayu)).items.map((x) => x.id)).toEqual([l.id]);
    expect(await teamPendingCount(ayu)).toBe(1);

    const r = await reviewLeave(ayu, l.id, { decision: "APPROVE", note: "Silakan" });
    expect(r).toMatchObject({ status: "APPROVED", reviewedAs: "SUPERVISOR", reviewedBy: "Ayu Lestari" });
    expect((await notes(sari, "leave.reviewed")).length).toBe(1);
    expect(await teamPendingCount(ayu)).toBe(0);

    // HR memproses bila diperlukan (mis. atasan tidak sempat), kapasitas dicatat HR
    const l2 = await submit(sari, { startDate: workday(5), endDate: workday(5) });
    expect((await reviewLeave(fx.hr, l2.id, { decision: "APPROVE" })).reviewedAs).toBe("HR");
  });

  it("karyawan tanpa atasan: perilaku lama (HR & Super Admin diberi tahu, href lama)", async () => {
    await submit(tono);
    expect((await notes(fx.hr, "leave.submitted"))[0]!.href).toBe("/pengajuan?status=PENDING");
    expect(await notes(fx.superAdmin, "leave.submitted")).toHaveLength(1);
  });

  it("cuti yang disetujui atasan memotong saldo seperti biasa (per tahun)", async () => {
    const y = Number(TODAY().slice(0, 4));
    await setBalance(fx.hr, { employeeId: ids.sari, year: y, targetDays: 10, note: "Saldo uji" });
    const l = await submit(sari, { type: "CUTI" });
    await reviewLeave(ayu, l.id, { decision: "APPROVE" });
    expect((await getBalance(fx.hr, ids.sari, Number(workday(3).slice(0, 4)))).used).toBe(-1);
  });

  it("batas wewenang: rekan, bawahan, dan atasan orang lain mendapat 404; karyawan tanpa peran tinjau apa pun mendapat 403; tidak muncul di daftar tim", async () => {
    const l = await submit(sari);
    expect((await fail(reviewLeave(budi, l.id, { decision: "APPROVE" })))?.code).toBe("FORBIDDEN"); // rekan tanpa bawahan: tidak punya wewenang tinjau apa pun
    expect((await fail(reviewLeave(citra, l.id, { decision: "APPROVE" })))?.code).toBe("NOT_FOUND"); // atasan dari atasan, Ayu hadir → tidak naik
    expect((await fail(reviewLeave(tono, l.id, { decision: "APPROVE" })))?.code).toBe("FORBIDDEN");
    expect((await fail(reviewLeave(sari, l.id, { decision: "APPROVE" })))?.code).toBe("FORBIDDEN"); // diri sendiri
    expect((await fail(listTeamLeaves(tono)))?.code).toBe("FORBIDDEN");
    const other = await submit(tono);
    expect((await listTeamLeaves(ayu)).items.map((x) => x.id)).toEqual([l.id]); // pengajuan Tono (tanpa atasan) bukan urusan Ayu
    expect((await fail(reviewLeave(ayu, other.id, { decision: "APPROVE" })))?.code).toBe("NOT_FOUND");
    expect(await prisma.leaveRequest.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({ status: "PENDING" });
  });

  it("tidak ada yang menyetujui pengajuannya sendiri: HR, atasan, dan Super Admin yang punya atasan ditolak; Super Admin puncak organisasi tetap boleh", async () => {
    const own = await submit(ayu);
    expect((await fail(reviewLeave(ayu, own.id, { decision: "APPROVE" })))?.code).toBe("FORBIDDEN");
    expect((await reviewLeave(citra, own.id, { decision: "APPROVE" })).reviewedAs).toBe("SUPERVISOR"); // atasan Ayu yang memprosesnya
    const hrEmp = await makeEmployee({ employeeNo: "TE-006", fullName: "HR Karyawan" });
    const hrSelf = await makeUser("hr2@uji.test", "HR Karyawan", "HR_ADMIN", hrEmp.id);
    const mine = await submit(hrSelf);
    expect((await fail(reviewLeave(hrSelf, mine.id, { decision: "APPROVE" })))?.message).toMatch(/sendiri/);
    // Super Admin yang juga karyawan
    const bossEmp = await makeEmployee({ employeeNo: "TE-007", fullName: "Direktur" });
    const boss = await makeUser("boss@uji.test", "Direktur", "SUPER_ADMIN", bossEmp.id);
    const top = await submit(boss);
    expect((await reviewLeave(boss, top.id, { decision: "APPROVE" })).reviewedAs).toBe("HR"); // puncak: belum punya atasan (perilaku lama)
    await changeOrg(fx.superAdmin, bossEmp.id, { supervisorId: ids.citra, effectiveFrom: TODAY() });
    const top2 = await submit(boss, { startDate: workday(6), endDate: workday(6) });
    expect((await fail(reviewLeave(boss, top2.id, { decision: "APPROVE" })))?.message).toMatch(/[Aa]tasan langsung/);
  });

  it("atasan sedang cuti tanpa pengganti → pengajuan naik ke atasannya (eskalasi) dan notifikasi ikut ke sana; atasan tetap berwenang", async () => {
    const day = TODAY();
    await prisma.leaveRequest.create({ data: { employeeId: ids.ayu, type: "CUTI", startDate: isoToDate(day), endDate: isoToDate(day), reason: "Cuti", status: "APPROVED", workingDays: 1, reviewedById: fx.hr.userId, reviewedAt: new Date() } });
    const l = await submit(sari);
    expect((await notes(citra, "leave.submitted")).length).toBe(1); // eskalasi
    expect((await notes(ayu, "leave.submitted")).length).toBe(1);   // atasan tetap diberi tahu
    expect((await reviewLeave(citra, l.id, { decision: "APPROVE" })).reviewedAs).toBe("ESCALATION");
  });
});

describe("pengganti peninjau", () => {
  const sub = (who: Actor, d = workday(3)) => submitLeave(who, { type: "IZIN", startDate: d, endDate: d, reason: "Urusan keluarga" });

  it("atasan menunjuk pengganti untuk rentang tanggal: pengganti berwenang hanya pada rentang itu; tidak atas pengajuannya sendiri", async () => {
    const d = await createDelegation(ayu, { delegateId: ids.budi, startDate: TODAY(), endDate: addDays(TODAY(), 5), reason: "Dinas luar" });
    expect(d).toMatchObject({ supervisorName: "Ayu Lestari", delegateName: "Budi Santoso", active: true });
    expect((await notes(budi, "org.delegation")).length).toBe(1);
    const l = await sub(sari);
    expect((await notes(budi, "leave.submitted")).length).toBe(1);
    expect((await listTeamLeaves(budi)).items.map((x) => x.id)).toEqual([l.id]);
    expect((await reviewLeave(budi, l.id, { decision: "APPROVE" })).reviewedAs).toBe("DELEGATE");
    // pengganti tidak boleh memproses pengajuannya sendiri; pengajuan Ayu diproses atasannya (Citra), bukan penggantinya
    const own = await sub(budi, workday(4));
    expect((await fail(reviewLeave(budi, own.id, { decision: "APPROVE" })))?.code).toBe("FORBIDDEN");
    const ayuOwn = await sub(ayu, workday(5));
    expect((await fail(reviewLeave(budi, ayuOwn.id, { decision: "APPROVE" })))?.code).toBe("NOT_FOUND");
  });

  it("pengganti di masa depan belum berlaku; yang dibatalkan tidak berlaku; atasan cuti dengan pengganti tidak mengeskalasi", async () => {
    await createDelegation(ayu, { delegateId: ids.budi, startDate: addDays(TODAY(), 3), endDate: addDays(TODAY(), 6) });
    const l = await sub(sari);
    expect((await fail(reviewLeave(budi, l.id, { decision: "APPROVE" })))?.code).toBe("FORBIDDEN"); // belum berlaku → Budi belum punya wewenang tinjau apa pun
    const act = await createDelegation(ayu, { delegateId: ids.tono, startDate: TODAY(), endDate: TODAY() });
    await prisma.leaveRequest.create({ data: { employeeId: ids.ayu, type: "CUTI", startDate: isoToDate(TODAY()), endDate: isoToDate(TODAY()), reason: "Cuti", status: "APPROVED", workingDays: 1, reviewedById: fx.hr.userId, reviewedAt: new Date() } });
    expect((await fail(reviewLeave(citra, l.id, { decision: "APPROVE" })))?.code).toBe("NOT_FOUND"); // tercakup pengganti → tak ada eskalasi
    expect((await reviewLeave(tono, l.id, { decision: "REJECT", note: "Belum bisa" })).reviewedAs).toBe("DELEGATE");
    await cancelDelegation(ayu, act.id);
    expect((await listDelegations(ayu)).map((x) => x.delegateName)).toEqual(["Budi Santoso"]); // yang dibatalkan hilang dari daftar
    expect((await fail(cancelDelegation(ayu, act.id)))?.code).toBe("CONFLICT");
  });

  it("izin & validasi: orang lain tidak menunjuk untuk atasan lain; HR boleh; pengganti harus aktif berakun; rentang dibatasi; tidak diri sendiri", async () => {
    expect((await fail(createDelegation(budi, { supervisorId: ids.ayu, delegateId: ids.tono, startDate: TODAY(), endDate: TODAY() })))?.code).toBe("FORBIDDEN");
    expect((await createDelegation(fx.hr, { supervisorId: ids.ayu, delegateId: ids.tono, startDate: TODAY(), endDate: TODAY() })).supervisorName).toBe("Ayu Lestari");
    expect((await fail(createDelegation(ayu, { delegateId: ids.ayu, startDate: TODAY(), endDate: TODAY() })))?.fieldErrors?.delegateId).toBeTruthy();
    expect((await fail(createDelegation(ayu, { delegateId: ids.budi, startDate: TODAY(), endDate: addDays(TODAY(), 200) })))?.fieldErrors?.endDate).toBeTruthy();
    expect((await fail(createDelegation(ayu, { delegateId: ids.budi, startDate: addDays(TODAY(), 5), endDate: TODAY() })))?.fieldErrors?.endDate).toBeTruthy();
    const noAccount = await makeEmployee({ employeeNo: "TE-008", fullName: "Tanpa Akun" });
    expect((await fail(createDelegation(ayu, { delegateId: noAccount.id, startDate: TODAY(), endDate: TODAY() })))?.fieldErrors?.delegateId).toBeTruthy();
    expect((await fail(cancelDelegation(budi, (await listDelegations(fx.hr))[0]!.id)))?.code).toBe("NOT_FOUND"); // bukan miliknya
    await expect(prisma.$executeRaw`DELETE FROM supervisor_delegations`).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.$executeRaw`UPDATE supervisor_delegations SET "delegateId" = "supervisorId"`).rejects.toThrow();
  });
});

describe("alur tinjauan lembur", () => {
  it("lembur Sari ditinjau atasannya dengan menit disetujui; kapasitas tercatat; peninjau lain 404; daftar tim hanya miliknya", async () => {
    const o = await submitOvertime(sari, { date: workday(-1), startTime: "16:00", minutes: 120, reason: "Menyelesaikan laporan akhir bulan" });
    expect((await notes(ayu, "overtime.submitted"))[0]!.href).toBe("/persetujuan-tim");
    expect(await notes(fx.hr, "overtime.submitted")).toHaveLength(0);
    expect((await listTeamOvertime(ayu)).items.map((x) => x.id)).toEqual([o.id]);
    expect((await fail(reviewOvertime(budi, o.id, { decision: "APPROVE" })))?.code).toBe("FORBIDDEN"); // rekan tanpa bawahan
    expect((await fail(reviewOvertime(citra, o.id, { decision: "APPROVE" })))?.code).toBe("NOT_FOUND"); // atasan dari atasan: Ayu hadir → tidak naik
    const r = await reviewOvertime(ayu, o.id, { decision: "APPROVE", approvedMinutes: 90 });
    expect(r.overtime).toMatchObject({ status: "APPROVED", approvedMinutes: 90, reviewedAs: "SUPERVISOR" });
    const own = await submitOvertime(ayu, { date: workday(-2), startTime: "16:00", minutes: 60, reason: "Rapat dengan klien malam hari" });
    expect((await fail(reviewOvertime(ayu, own.id, { decision: "APPROVE" })))?.code).toBe("FORBIDDEN");
    expect((await reviewOvertime(citra, own.id, { decision: "APPROVE" })).overtime.reviewedAs).toBe("SUPERVISOR");
  });
});

describe("pembatalan oleh HR tetap seperti semula", () => {
  it("HR membatalkan cuti yang disetujui atasan dengan alasan", async () => {
    const l = await submitLeave(sari, { type: "IZIN", startDate: workday(3), endDate: workday(3), reason: "Urusan keluarga" });
    await reviewLeave(ayu, l.id, { decision: "APPROVE" });
    expect((await cancelLeave(fx.hr, l.id, { reason: "Dibatalkan HR" })).status).toBe("CANCELLED");
    void listNotifications;
  });
});
