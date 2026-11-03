import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { getBalance, getLeavePolicy, grantAnnualQuota, reviewLeave, setBalance, setLeavePolicy, submitLeave } from "@/server/services/leave";
import { updateAttendancePolicy } from "@/server/services/settings";
import { listNotifications } from "@/server/services/notifications";
import { isoToDate } from "@/server/json";
import { resetDb, seedFixtures, type Fixtures } from "../helpers/db";
import { pinNow } from "../helpers/pin-now";

pinNow(); // "hari ini" = 1 Nov 2026 (WIB) kapan pun tes dijalankan

let fx: Fixtures;
const policyOf = (over: Record<string, unknown> = {}) => ({
  lateMinutesAfterTolerance: false, locationEnabled: false, locationName: null, locationLat: null, locationLng: null, locationRadiusMeters: 100,
  locationMaxAccuracyMeters: 150, requestBackdateDays: 365, annualLeaveQuota: 12, allowNegativeLeaveBalance: false, ...over,
});
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const [A, B, C] = [0, 1, 2] as const;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
  await updateAttendancePolicy(fx.superAdmin, policyOf());
  // A (emp1): bekerja sejak 2025-01-01 (> 1 tahun) · B (emp2): baru 2 bulan (sejak 2026-09-01) · C (emp3): sejak 2026-01-15
  await prisma.employee.update({ where: { id: fx.empIds[B] }, data: { joinDate: isoToDate("2026-09-01") } });
  await prisma.employee.update({ where: { id: fx.empIds[C] }, data: { joinDate: isoToDate("2026-01-15") } });
});

describe("kebijakan cuti per karyawan", () => {
  it("bawaan: karyawan >1 tahun berhak 12 hari, karyawan baru 2 bulan belum berhak", async () => {
    const a = await getLeavePolicy(fx.hr, fx.empIds[A]);
    const b = await getLeavePolicy(fx.hr, fx.empIds[B]);
    expect(a).toMatchObject({ entitledNow: true, quotaThisYear: 12, policy: { eligibleFrom: "2026-01-01", quotaDays: 12, custom: false } });
    expect(b).toMatchObject({ entitledNow: false, quotaThisYear: 0, policy: { eligibleFrom: "2027-09-01", custom: false } });
  });

  it("kuota tahunan diberikan per kebijakan masing-masing; yang belum berhak dilewati dan dilaporkan", async () => {
    const r = await grantAnnualQuota(fx.hr, { year: 2026 });
    expect(r).toMatchObject({ granted: 1, notEntitled: 2, notEntitledNames: ["Budi Santoso", "Citra Dewi"] }); // hanya A yang berhak sampai akhir 2026
    expect((await getBalance(fx.hr, fx.empIds[A], 2026)).balance).toBe(12);
    expect((await getBalance(fx.hr, fx.empIds[B], 2026)).balance).toBe(0);
    expect((await getBalance(fx.hr, fx.empIds[C], 2026)).balance).toBe(0); // C berhak 2027-01-15 → belum berhak sampai akhir 2026
    // Idempoten
    expect(await grantAnnualQuota(fx.hr, { year: 2026 })).toMatchObject({ granted: 0, skipped: 1, notEntitled: 2 });
    // Tahun 2027: A dan C berhak (C sejak 2027-01-15), B berhak sejak 2027-09-01 → kuota 2027 penuh
    expect(await grantAnnualQuota(fx.hr, { year: 2027 })).toMatchObject({ granted: 3, notEntitled: 0 });
  });

  it("karyawan yang belum berhak: cuti ditolak dengan alasan jelas; izin & sakit tetap boleh", async () => {
    await setBalance(fx.hr, { employeeId: fx.empIds[B], year: 2027, targetDays: 12, note: "Saldo awal uji" });
    const e = await fail(submitLeave(fx.emp2, { type: "CUTI", startDate: "2027-03-01", endDate: "2027-03-02", reason: "Liburan keluarga" }));
    expect(e?.code).toBe("VALIDATION");
    expect(e?.message).toMatch(/belum berhak cuti tahunan/);
    expect(e?.message).toMatch(/1 September 2027/);
    expect(e?.message).toMatch(/masa kerja minimum 12 bulan/);
    expect(await fail(submitLeave(fx.emp2, { type: "IZIN", startDate: "2027-03-01", endDate: "2027-03-01", reason: "Urusan keluarga" }))).toBeNull();
    expect(await fail(submitLeave(fx.emp2, { type: "SAKIT", startDate: "2027-03-02", endDate: "2027-03-02", reason: "Demam tinggi" }))).toBeNull();
    // Karyawan A (berhak) dengan saldo yang sama boleh cuti
    await setBalance(fx.hr, { employeeId: fx.empIds[A], year: 2027, targetDays: 12, note: "Saldo awal uji" });
    expect(await fail(submitLeave(fx.emp1, { type: "CUTI", startDate: "2027-03-01", endDate: "2027-03-02", reason: "Liburan keluarga" }))).toBeNull();
  });

  it("kebijakan khusus: HR memberi hak lebih awal + kuota berbeda (beralasan), tercatat di audit, karyawan diberi tahu", async () => {
    const dto = await setLeavePolicy(fx.hr, fx.empIds[B], { quotaDays: 6, eligibleFrom: "2026-09-01", allowNegative: null, note: "Sesuai perjanjian kerja, cuti berlaku sejak awal" });
    expect(dto.policy).toMatchObject({ quotaDays: 6, eligibleFrom: "2026-09-01", allowNegative: false, custom: true, source: { quota: "CUSTOM", eligibleFrom: "CUSTOM", allowNegative: "DEFAULT" } });
    expect(dto.entitledNow).toBe(true);
    expect(dto.quotaThisYear).toBe(6);
    expect(await grantAnnualQuota(fx.hr, { year: 2026, employeeId: fx.empIds[B] })).toMatchObject({ granted: 1 });
    expect((await getBalance(fx.hr, fx.empIds[B], 2026)).balance).toBe(6);
    // B kini boleh cuti (tanggal setelah berhak)
    expect(await fail(submitLeave(fx.emp2, { type: "CUTI", startDate: "2026-11-02", endDate: "2026-11-03", reason: "Keperluan keluarga" }))).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { action: "leave_policy.set", entityId: fx.empIds[B] } });
    expect(audit?.reason).toMatch(/perjanjian kerja/);
    expect(audit?.before).toMatchObject({ eligibleFrom: "2027-09-01", quotaDays: 12, custom: false });
    expect(audit?.after).toMatchObject({ eligibleFrom: "2026-09-01", quotaDays: 6, custom: true });
    expect((await listNotifications(fx.emp2)).items.some((n) => n.type === "leave.policy")).toBe(true);
  });

  it("kebijakan khusus wajib beralasan; semua null = kembali ke bawaan; tanpa perubahan ditolak", async () => {
    expect((await fail(setLeavePolicy(fx.hr, fx.empIds[A], { quotaDays: 14, eligibleFrom: null, allowNegative: null, note: "" })))?.fieldErrors?.note).toBeTruthy();
    expect((await fail(setLeavePolicy(fx.hr, fx.empIds[A], { quotaDays: 400, eligibleFrom: null, allowNegative: null, note: "Terlalu besar sekali" })))?.fieldErrors?.quotaDays).toBeTruthy();
    expect((await fail(setLeavePolicy(fx.hr, fx.empIds[A], { quotaDays: null, eligibleFrom: null, allowNegative: null, note: null })))?.message).toMatch(/sudah sama/);
    await setLeavePolicy(fx.hr, fx.empIds[A], { quotaDays: 14, eligibleFrom: null, allowNegative: null, note: "Jabatan manajer, kuota 14 hari" });
    expect((await getLeavePolicy(fx.hr, fx.empIds[A])).policy).toMatchObject({ quotaDays: 14, custom: true, note: "Jabatan manajer, kuota 14 hari" });
    const back = await setLeavePolicy(fx.hr, fx.empIds[A], { quotaDays: null, eligibleFrom: null, allowNegative: null, note: null });
    expect(back.policy).toMatchObject({ quotaDays: 12, custom: false, note: null });
    const row = await prisma.employee.findUniqueOrThrow({ where: { id: fx.empIds[A] } });
    expect([row.leaveQuotaDays, row.leaveEligibleFrom, row.leaveAllowNegative, row.leavePolicyNote]).toEqual([null, null, null, null]);
    // Database sendiri menolak kebijakan khusus tanpa catatan
    await expect(prisma.employee.update({ where: { id: fx.empIds[A] }, data: { leaveQuotaDays: 9 } })).rejects.toThrow(/employees_leave_policy_note/);
  });

  it("hak akses: karyawan tidak dapat mengubah; hanya melihat miliknya; HR tidak dapat mengubah kebijakan cutinya sendiri", async () => {
    const body = { quotaDays: 20, eligibleFrom: null, allowNegative: null, note: "Minta tambahan" };
    expect((await fail(setLeavePolicy(fx.emp1, fx.empIds[A], body)))?.code).toBe("FORBIDDEN");
    expect((await fail(getLeavePolicy(fx.emp1, fx.empIds[B])))?.code).toBe("FORBIDDEN");
    expect((await getLeavePolicy(fx.emp1, fx.empIds[A])).employeeId).toBe(fx.empIds[A]);
    const hrWhoIsEmployee = { ...fx.hr, employeeId: fx.empIds[C] };
    expect((await fail(setLeavePolicy(hrWhoIsEmployee, fx.empIds[C], body)))?.message).toMatch(/sendiri/);
    expect(await fail(setLeavePolicy({ ...fx.superAdmin, employeeId: fx.empIds[C] }, fx.empIds[C], body))).toBeNull(); // Super Admin boleh
  });

  it("saldo negatif per karyawan: hanya yang dikecualikan boleh minus", async () => {
    await setBalance(fx.hr, { employeeId: fx.empIds[A], year: 2027, targetDays: 1, note: "Saldo kecil" });
    await setBalance(fx.hr, { employeeId: fx.empIds[C], year: 2027, targetDays: 1, note: "Saldo kecil" });
    await setLeavePolicy(fx.hr, fx.empIds[C], { quotaDays: null, eligibleFrom: "2026-01-15", allowNegative: true, note: "Boleh kasbon cuti oleh pimpinan" });
    const ea = await fail(submitLeave(fx.emp1, { type: "CUTI", startDate: "2027-03-01", endDate: "2027-03-05", reason: "Cuti panjang" }));
    expect(ea?.message).toMatch(/Saldo cuti 2027 tidak cukup/);
    const rc = await submitLeave(fx.emp3, { type: "CUTI", startDate: "2027-03-01", endDate: "2027-03-05", reason: "Cuti panjang" });
    await reviewLeave(fx.hr, rc.id, { decision: "APPROVE" });
    expect((await getBalance(fx.hr, fx.empIds[C], 2027)).balance).toBe(-4); // saldo 1 − 5 hari kerja
  });

  it("persetujuan memeriksa ulang hak cuti bila kebijakan berubah setelah pengajuan", async () => {
    await setBalance(fx.hr, { employeeId: fx.empIds[A], year: 2027, targetDays: 12, note: "Saldo awal uji" });
    const r = await submitLeave(fx.emp1, { type: "CUTI", startDate: "2027-03-01", endDate: "2027-03-02", reason: "Liburan keluarga" });
    await setLeavePolicy(fx.superAdmin, fx.empIds[A], { quotaDays: null, eligibleFrom: "2028-01-01", allowNegative: null, note: "Evaluasi kinerja, hak cuti ditunda" });
    const e = await fail(reviewLeave(fx.hr, r.id, { decision: "APPROVE" }));
    expect(e?.message).toMatch(/belum berhak cuti tahunan/);
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("PENDING");
    // Menolak tetap bisa
    await reviewLeave(fx.hr, r.id, { decision: "REJECT", note: "Hak cuti belum berlaku" });
  });

  it("masa kerja minimum bawaan dapat diubah Super Admin dan langsung berlaku untuk yang tidak dikhususkan", async () => {
    expect((await getLeavePolicy(fx.hr, fx.empIds[B])).entitledNow).toBe(false);
    await updateAttendancePolicy(fx.superAdmin, policyOf({ leaveMinTenureMonths: 0 }));
    const b = await getLeavePolicy(fx.hr, fx.empIds[B]);
    expect(b).toMatchObject({ entitledNow: true, policy: { eligibleFrom: "2026-09-01" }, defaults: { minTenureMonths: 0 } });
    await updateAttendancePolicy(fx.superAdmin, policyOf({ leaveMinTenureMonths: 6 }));
    expect((await getLeavePolicy(fx.hr, fx.empIds[B])).policy.eligibleFrom).toBe("2027-03-01");
    expect((await fail(updateAttendancePolicy(fx.superAdmin, policyOf({ leaveMinTenureMonths: 500 }))))?.fieldErrors?.leaveMinTenureMonths).toBeTruthy();
  });
});
