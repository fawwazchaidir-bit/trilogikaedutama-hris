import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import { correctAttendance } from "@/server/services/attendance";
import { getRecap, getRecapDetail, recapTable } from "@/server/services/recap";
import { toCsv } from "@/server/export";
import { createComponent, setComponentActive } from "@/server/services/components";
import {
  addAdjustment, approveRun, calculateRun, cancelRun, createRevision, createRun, getItem, getRun, issueRun, listRuns, removeAdjustment, returnRun, submitRun,
} from "@/server/services/payroll";
import { getPayslip, getRunPayslips, listMyPayslips } from "@/server/services/payslips";
import { confirmPayrollRules, updatePayrollRules } from "@/server/services/settings";
import { renderPayslipsPdf } from "@/server/pdf/render";
import { encryptField } from "@/server/crypto";
import { addAttendance, addComponent, resetDb, seedFixtures, type Fixtures } from "../helpers/db";

let fx: Fixtures;
const [E1, E2] = [0, 1] as const;
const PERIOD = { label: "Gaji Januari 2026", periodStart: "2026-01-01", periodEnd: "2026-01-31" };

const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };

/**
 * Januari 2026 untuk Ayu (emp1). Libur 1 Jan (Kamis). Hari kerja Sen–Jum = 21 hari terjadwal.
 *  hadir tepat waktu: 2, 5, 7(08:15 tepat batas), 9(tanpa check-out), 12–16, 20–23, 28–30
 *  terlambat: 6 Jan (20 mnt) ; tidak hadir: 8 Jan ; izin: 19 Jan ; sakit: 26–27 Jan
 */
async function seedJanuary(fx: Fixtures) {
  const id = fx.empIds[E1];
  await addAttendance(id, "2026-01-02", "08:00", "16:00");
  await addAttendance(id, "2026-01-05", "07:55", "16:05");
  await addAttendance(id, "2026-01-06", "08:20", "16:00");
  await addAttendance(id, "2026-01-07", "08:15", "16:00");
  await addAttendance(id, "2026-01-09", "07:50", null);
  for (const d of [12, 13, 14, 15, 16, 20, 21, 22, 23, 28, 29, 30]) await addAttendance(id, `2026-01-${d}`, "08:00", "16:00");
  const approved = (type: "IZIN" | "SAKIT", s: string, e: string, days: number) => prisma.leaveRequest.create({
    data: { employeeId: id, type, startDate: isoToDate(s), endDate: isoToDate(e), reason: "Data uji", status: "APPROVED", workingDays: days, reviewedById: fx.hr.userId, reviewedAt: new Date() },
  });
  await approved("IZIN", "2026-01-19", "2026-01-19", 1);
  await approved("SAKIT", "2026-01-26", "2026-01-27", 2);
  // permohonan yang BELUM disetujui tidak boleh memengaruhi apa pun
  await prisma.leaveRequest.create({ data: { employeeId: id, type: "CUTI", startDate: isoToDate("2026-01-08"), endDate: isoToDate("2026-01-08"), reason: "Menunggu", status: "PENDING", workingDays: 1 } });
}

beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
  await prisma.calendarDay.create({ data: { date: isoToDate("2026-01-01"), kind: "HOLIDAY", name: "Tahun Baru (uji)", createdById: fx.hr.userId } });
  await seedJanuary(fx);
});

describe("rekap absensi — angka dapat ditelusuri", () => {
  it("rekap bulanan Ayu sesuai hitungan manual", async () => {
    const r = await getRecap(fx.hr, { view: "bulanan", month: "2026-01", employeeId: fx.empIds[E1] });
    const t = r.page.items[0]!.totals;
    expect(t.scheduledDays).toBe(21);
    expect(t.presentDays).toBe(17);
    expect(t.onTimeDays).toBe(16);
    expect(t.lateCount).toBe(1);
    expect(t.lateMinutes).toBe(20);
    expect(t.izinDays).toBe(1);
    expect(t.sakitDays).toBe(2);
    expect(t.cutiDays).toBe(0); // pengajuan menunggu tidak dihitung
    expect(t.absentDays).toBe(1);
    expect(t.pendingDays).toBe(0);
    expect(t.incompleteCount).toBe(1);
    expect(t.workedMinutes).toBe(7655);
    expect(t.presentDays + t.izinDays + t.sakitDays + t.cutiDays + t.absentDays + t.pendingDays).toBe(t.scheduledDays);
  });

  it("detail harian menjelaskan setiap status", async () => {
    const d = await getRecapDetail(fx.hr, fx.empIds[E1], { view: "bulanan", month: "2026-01" });
    const byDate = Object.fromEntries(d.days.map((x) => [x.date, x]));
    expect(byDate["2026-01-01"]!.status).toBe("LIBUR");
    expect(byDate["2026-01-01"]!.explain).toBe("Tahun Baru (uji)");
    expect(byDate["2026-01-03"]!.explain).toBe("Libur mingguan");
    expect(byDate["2026-01-06"]!.explain).toContain("terlambat 20 m");
    expect(byDate["2026-01-07"]!.status).toBe("HADIR");
    expect(byDate["2026-01-08"]!.status).toBe("TIDAK_HADIR");
    expect(byDate["2026-01-09"]!.incomplete).toBe(true);
    expect(byDate["2026-01-19"]!.status).toBe("IZIN");
    expect(byDate["2026-01-26"]!.status).toBe("SAKIT");
  });

  it("mingguan, harian, filter status & divisi, dan ringkasan seluruh karyawan", async () => {
    const wk = await getRecap(fx.hr, { view: "mingguan", date: "2026-01-07" }); // 5–11 Jan
    expect(wk.from).toBe("2026-01-05");
    expect(wk.to).toBe("2026-01-11");
    const ayu = wk.page.items.find((i) => i.employeeNo === "TE-001")!;
    expect(ayu.totals).toMatchObject({ scheduledDays: 5, presentDays: 4, lateCount: 1, absentDays: 1, incompleteCount: 1 });

    const day = await getRecap(fx.hr, { view: "harian", date: "2026-01-06" });
    expect(day.page.items.find((i) => i.employeeNo === "TE-001")!.days![0]!.status).toBe("TERLAMBAT");
    expect(day.page.items.find((i) => i.employeeNo === "TE-002")!.days![0]!.status).toBe("TIDAK_HADIR");

    const lateOnly = await getRecap(fx.hr, { view: "bulanan", month: "2026-01", status: "TERLAMBAT" });
    expect(lateOnly.page.items.map((i) => i.employeeNo)).toEqual(["TE-001"]);
    const noCheckout = await getRecap(fx.hr, { view: "bulanan", month: "2026-01", status: "BELUM_CHECKOUT" });
    expect(noCheckout.page.items.map((i) => i.employeeNo)).toEqual(["TE-001"]);
    const divB = await getRecap(fx.hr, { view: "bulanan", month: "2026-01", divisionId: fx.divisionB });
    expect(divB.page.items.map((i) => i.employeeNo)).toEqual(["TE-003"]);
    const search = await getRecap(fx.hr, { view: "bulanan", month: "2026-01", q: "budi" });
    expect(search.page.items.map((i) => i.employeeNo)).toEqual(["TE-002"]);
    expect(wk.summary.employees).toBe(3);
  });

  it("ekspor: kolom lengkap, total, dan sel berawalan = dinetralkan (anti CSV injection)", async () => {
    await prisma.employee.update({ where: { id: fx.empIds[E2] }, data: { fullName: "=HYPERLINK(\"http://x\")" } });
    const table = await recapTable(fx.hr, { view: "bulanan", month: "2026-01" });
    expect(table.columns.map((c) => c.label)).toEqual(expect.arrayContaining(["Hari Kerja", "Hadir", "Menit Terlambat", "Belum Lengkap", "Jam Kerja"]));
    expect(table.totals).not.toBeNull();
    const csv = toCsv(table);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toMatch(/,=HYPERLINK/);
    const ayu = table.rows.find((r) => r.no === "TE-001")!;
    expect(ayu).toMatchObject({ scheduled: 21, present: 17, lateMin: 20, hours: "127,58" });
  });

  it("mengubah jadwal (Ramadan) mengubah penilaian terlambat pada rentangnya", async () => {
    // Jadwal baru masuk 07:30 hanya untuk 5–9 Jan → 07:55 menjadi terlambat 25 mnt.
    const s = await prisma.workSchedule.create({ data: { name: "Pagi", workDays: [1, 2, 3, 4, 5], startTime: "07:30", endTime: "15:30", lateToleranceMinutes: 10, absentCutoffTime: "11:00" } });
    await prisma.scheduleAssignment.create({ data: { scheduleId: s.id, scope: "ALL", startDate: isoToDate("2026-01-05"), endDate: isoToDate("2026-01-09"), createdById: fx.hr.userId } });
    const d = await getRecapDetail(fx.hr, fx.empIds[E1], { view: "kustom", from: "2026-01-05", to: "2026-01-09" });
    expect(d.days[0]!.status).toBe("TERLAMBAT");
    expect(d.days[0]!.lateMinutes).toBe(25);
    expect(d.days[0]!.scheduleName).toBe("Pagi");
  });
});

describe("penggajian — alur lengkap", () => {
  async function setup() {
    // Aturan: potongan terlambat per menit, ketidakhadiran nominal tetap per hari (izin ikut, sakit tidak).
    await updatePayrollRules(fx.superAdmin, {
      lateMode: "PER_MINUTE", lateAmount: 1000, absenceMode: "FIXED_PER_DAY", absenceAmount: 100_000, absenceDivisor: null,
      izinDeductsPay: true, sakitDeductsPay: false, cutiDeductsPay: false, overtimeMode: "MANUAL", overtimeRatePerHour: 0, overtimeMinMinutes: 60, overtimeMaxMinutesPerDay: 240,
    });
    const ayu = fx.empIds[E1], budi = fx.empIds[E2];
    await addComponent(ayu, fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 5_000_000 });
    await addComponent(ayu, fx.hr.userId, { category: "TRANSPORT_ALLOWANCE", name: "Transport harian", calc: "PER_PRESENT_DAY", amount: 20_000 });
    await addComponent(ayu, fx.hr.userId, { category: "BPJS", name: "BPJS (input admin)", calc: "PERCENT_OF_BASE", percentBp: 100 });
    await addComponent(ayu, fx.hr.userId, { category: "INCENTIVE", name: "Bonus Januari", amount: 250_000, recurrence: "ONE_TIME", from: "2026-01-20" });
    await addComponent(ayu, fx.hr.userId, { category: "INCENTIVE", name: "Bonus Februari", amount: 999_999, recurrence: "ONE_TIME", from: "2026-02-10" });
    await addComponent(budi, fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 4_000_000 });
    // Citra: tanpa komponen sama sekali
  }
  it("menghitung sesuai rumus; rincian + sumber absensi dapat diperiksa; karyawan tanpa komponen dilewati", async () => {
    await setup();
    const { id, skipped } = await createRun(fx.hr, PERIOD);
    expect(skipped.map((s) => s.employeeNo)).toEqual(["TE-003"]);

    const run = await getRun(fx.hr, id);
    expect(run.run.status).toBe("DRAFT");
    expect(run.items).toHaveLength(2);
    const ayu = run.items.find((i) => i.employeeNo === "TE-001")!;
    // 5.000.000 + transport 17×20.000 (=340.000) + bonus 250.000 − BPJS 1% (50.000) − terlambat 20×1.000 − (1 tidak hadir + 1 izin)×100.000
    expect(ayu.totalEarnings).toBe(5_000_000 + 340_000 + 250_000);
    expect(ayu.totalDeductions).toBe(50_000 + 20_000 + 200_000);
    expect(ayu.netPay).toBe(5_320_000); // 5.590.000 − 270.000
    const budi = run.items.find((i) => i.employeeNo === "TE-002")!;
    // Budi tidak punya absensi sama sekali: 21 hari tidak hadir × 100.000
    expect(budi.totalDeductions).toBe(2_100_000);
    expect(budi.netPay).toBe(4_000_000 - 2_100_000);
    expect(run.run.totalNet).toBe(ayu.netPay + budi.netPay);

    const detail = await getItem(fx.hr, ayu.id);
    const names = detail.lines.map((l) => l.name);
    expect(names).toContain("Bonus Januari");
    expect(names).not.toContain("Bonus Februari"); // komponen sekali periode lain tidak ikut
    expect(detail.lines.find((l) => l.name === "Transport harian")!.formula).toBe("17 hari hadir × Rp 20.000");
    expect(detail.lines.find((l) => l.source === "RULE_LATE")!.formula).toBe("20 menit terlambat × Rp 1.000");
    expect(detail.lines.find((l) => l.source === "RULE_ABSENCE")!.formula).toBe("2 hari (1 tidak hadir + 1 izin) × Rp 100.000");
    expect(detail.attendance.totals).toMatchObject({ scheduledDays: 21, presentDays: 17, lateMinutes: 20, absentDays: 1 });
    expect(detail.days).toHaveLength(31);
    expect(detail.item.warnings.some((w) => w.includes("belum lengkap"))).toBe(true);
    expect(detail.item.stale).toBe(false);
    expect(run.rulesSnapshot?.lateMode).toBe("PER_MINUTE");
  });

  it("penyesuaian wajib beralasan, bertahan saat hitung ulang, dan bisa dihapus", async () => {
    await setup();
    const { id } = await createRun(fx.hr, PERIOD);
    const item = (await getRun(fx.hr, id)).items.find((i) => i.employeeNo === "TE-002")!;
    expect((await fail(addAdjustment(fx.hr, item.id, { kind: "EARNING", name: "Tunjangan khusus", amount: 100_000, reason: "" })))?.code).toBe("VALIDATION");
    await addAdjustment(fx.hr, item.id, { kind: "EARNING", name: "Tunjangan khusus", amount: 150_000, reason: "Persetujuan pimpinan 5/1" });
    let again = (await getRun(fx.hr, id)).items.find((i) => i.employeeNo === "TE-002")!;
    expect(again.netPay).toBe(1_900_000 + 150_000);
    await calculateRun(fx.hr, id);
    again = (await getRun(fx.hr, id)).items.find((i) => i.employeeNo === "TE-002")!;
    expect(again.netPay).toBe(1_900_000 + 150_000);
    const d = await getItem(fx.hr, again.id);
    const adj = d.lines.find((l) => l.source === "ADJUSTMENT")!;
    expect(adj.reason).toBe("Persetujuan pimpinan 5/1");
    await removeAdjustment(fx.hr, adj.id);
    expect((await getRun(fx.hr, id)).items.find((i) => i.employeeNo === "TE-002")!.netPay).toBe(1_900_000);
    expect((await fail(removeAdjustment(fx.hr, d.lines.find((l) => l.source === "COMPONENT" || l.source === "RULE_ABSENCE")!.id)))?.code).toBe("VALIDATION");
  });

  it("alur status: ajukan → (HR tak bisa setujui) → aturan harus dikonfirmasi → setujui → terbitkan", async () => {
    await setup();
    const { id } = await createRun(fx.hr, PERIOD);
    await submitRun(fx.hr, id);
    expect((await getRun(fx.hr, id)).run.status).toBe("PENDING_APPROVAL");
    // item terkunci di luar Draf (aplikasi & trigger database)
    const item = (await getRun(fx.hr, id)).items[0]!;
    expect((await fail(addAdjustment(fx.hr, item.id, { kind: "EARNING", name: "Terlambat", amount: 1000, reason: "Tidak boleh" })))?.code).toBe("CONFLICT");
    await expect(prisma.$executeRawUnsafe(`UPDATE payroll_items SET "netPay" = 1, "totalEarnings" = 1`)).rejects.toThrow(/hanya dapat diubah saat berstatus Draf/);
    expect((await fail(calculateRun(fx.hr, id)))?.code).toBe("CONFLICT");

    expect((await fail(approveRun(fx.hr, id)))?.code).toBe("FORBIDDEN");
    const needConfirm = await fail(approveRun(fx.superAdmin, id));
    expect(needConfirm?.message).toMatch(/belum dikonfirmasi/);
    await confirmPayrollRules(fx.superAdmin);
    await approveRun(fx.superAdmin, id, { note: "OK" });
    const approved = await getRun(fx.hr, id);
    expect(approved.run.status).toBe("APPROVED");
    expect(approved.run.approvedBy).toBe("Pimpinan Uji");

    // mengubah aturan mencabut konfirmasi (alur berikutnya wajib verifikasi ulang)
    await updatePayrollRules(fx.superAdmin, { ...(approved.rules as object), lateAmount: 2000 });
    expect((await getRun(fx.hr, id)).rulesConfirmedAt).toBeNull();
    expect((await getRun(fx.hr, id)).rulesSnapshot?.lateAmount).toBe(1000); // hasil lama tidak berubah

    const { slips } = await issueRun(fx.hr, id, { issueDate: "2026-02-01" });
    expect(slips).toBe(2);
    const issued = await getRun(fx.hr, id);
    expect(issued.run.status).toBe("ISSUED");
    expect(issued.run.issueDate).toBe("2026-02-01");
    const numbers = issued.items.map((i) => i.payslipNumber);
    expect(new Set(numbers).size).toBe(2);
    expect(numbers[0]).toMatch(/^SG-202601-R01-00\d$/);

    // siapa pun tidak dapat menerbitkan dua kali / menyetujui lagi
    expect((await fail(issueRun(fx.hr, id)))?.code).toBe("CONFLICT");
    expect((await fail(submitRun(fx.hr, id)))?.code).toBe("CONFLICT");
  });

  it("dikembalikan ke Draf oleh pimpinan wajib dengan catatan; dapat dihitung ulang", async () => {
    await setup();
    const { id } = await createRun(fx.hr, PERIOD);
    await submitRun(fx.hr, id);
    expect((await fail(returnRun(fx.superAdmin, id, { note: "" })))?.code).toBe("VALIDATION");
    await returnRun(fx.superAdmin, id, { note: "Periksa bonus Ayu" });
    const r = await getRun(fx.hr, id);
    expect(r.run.status).toBe("DRAFT");
    expect(r.run.returnedNote).toBe("Periksa bonus Ayu");
    await calculateRun(fx.hr, id);
  });

  it("slip terbit dikunci: database menolak ubah/hapus, dan koreksi absensi sesudahnya TIDAK mengubah slip", async () => {
    await setup();
    const { id } = await createRun(fx.hr, PERIOD);
    await submitRun(fx.hr, id);
    await confirmPayrollRules(fx.superAdmin);
    await approveRun(fx.superAdmin, id);
    await issueRun(fx.hr, id);

    const ayuItem = (await getRun(fx.hr, id)).items.find((i) => i.employeeNo === "TE-001")!;
    const slipBefore = await getPayslip(fx.hr, ayuItem.payslipId!);
    expect(slipBefore.snapshot.netPay).toBe(ayuItem.netPay);

    // Admin mengoreksi absensi 8 Jan (tidak hadir → hadir) setelah terbit.
    const res = await correctAttendance(fx.hr, { employeeId: fx.empIds[E1], date: "2026-01-08", action: "set", checkIn: "08:00", checkOut: "16:00", reason: "Ada bukti kehadiran" });
    expect(res.payrollNotices[0]).toMatch(/sudah diterbitkan: slip TIDAK berubah/);

    const slipAfter = await getPayslip(fx.hr, ayuItem.payslipId!);
    expect(slipAfter.snapshot).toEqual(slipBefore.snapshot);
    expect(slipAfter.snapshot.netPay).toBe(ayuItem.netPay);
    // tetapi periode ditandai: ada perubahan data sumber sejak dihitung
    const after = await getRun(fx.hr, id);
    expect(after.staleCount).toBe(1);
    expect(after.items.find((i) => i.employeeNo === "TE-001")!.stale).toBe(true);

    // trigger database
    await expect(prisma.$executeRawUnsafe(`UPDATE payslips SET "netPay" = 1`)).rejects.toThrow(/tidak dapat diubah/);
    await expect(prisma.$executeRawUnsafe(`UPDATE payslips SET snapshot = '{}'::jsonb`)).rejects.toThrow(/tidak dapat diubah/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM payslips`)).rejects.toThrow(/tidak boleh dihapus/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM payroll_item_lines`)).rejects.toThrow(/hanya dapat diubah saat berstatus Draf/);
    await expect(prisma.$executeRawUnsafe(`UPDATE payroll_runs SET "periodStart" = '2025-01-01'`)).rejects.toThrow(/terkunci/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM payroll_runs`)).rejects.toThrow(/tidak boleh dihapus/);
    await expect(prisma.$executeRawUnsafe(`UPDATE payroll_runs SET status = 'DRAFT'`)).rejects.toThrow(/tidak diizinkan/);
  });

  it("data berubah sebelum persetujuan → ajukan/setujui diblokir sampai dihitung ulang", async () => {
    await setup();
    const { id } = await createRun(fx.hr, PERIOD);
    await correctAttendance(fx.hr, { employeeId: fx.empIds[E1], date: "2026-01-08", action: "set", checkIn: "08:00", checkOut: "16:00", reason: "Ada bukti kehadiran" });
    expect((await fail(submitRun(fx.hr, id)))?.message).toMatch(/berubah sejak penghitungan/);
    await calculateRun(fx.hr, id);
    await submitRun(fx.hr, id);
    // koreksi lagi saat menunggu persetujuan → persetujuan diblokir
    await correctAttendance(fx.hr, { employeeId: fx.empIds[E1], date: "2026-01-09", action: "set", checkIn: "08:00", checkOut: "16:00", reason: "Melengkapi check-out" });
    await confirmPayrollRules(fx.superAdmin);
    expect((await fail(approveRun(fx.superAdmin, id)))?.message).toMatch(/berubah sejak penghitungan/);
  });

  it("gaji bersih negatif tidak dapat diajukan; periode yang belum berakhir tidak dapat diajukan", async () => {
    await setup();
    await addComponent(fx.empIds[E2], fx.hr.userId, { category: "LOAN", name: "Kasbon besar", amount: 9_000_000 });
    const { id } = await createRun(fx.hr, PERIOD);
    expect((await fail(submitRun(fx.hr, id)))?.message).toMatch(/negatif/);

    const future = await createRun(fx.hr, { label: "Gaji masa depan", periodStart: "2099-01-01", periodEnd: "2099-01-31" });
    expect((await fail(submitRun(fx.hr, future.id)))?.code).toBe("VALIDATION");
  });

  it("periode tidak boleh beririsan; pembatalan membuka kembali rentangnya", async () => {
    await setup();
    const a = await createRun(fx.hr, PERIOD);
    expect((await fail(createRun(fx.hr, { label: "Tumpang tindih", periodStart: "2026-01-15", periodEnd: "2026-02-14" })))?.code).toBe("CONFLICT");
    await cancelRun(fx.hr, a.id, { reason: "Salah rentang" });
    expect(await fail(createRun(fx.hr, { label: "Tumpang tindih", periodStart: "2026-01-15", periodEnd: "2026-02-14" }))).toBeNull();
    expect((await fail(cancelRun(fx.hr, a.id, { reason: "Sekali lagi" })))?.code).toBe("CONFLICT");
    expect((await listRuns(fx.hr)).map((r) => r.label)).toEqual(["Tumpang tindih"]);
    expect((await listRuns(fx.hr, { includeCancelled: true }))).toHaveLength(2);
  });

  it("periode absensi (cut-off) boleh berbeda dari periode gaji", async () => {
    await setup();
    const { id } = await createRun(fx.hr, { ...PERIOD, attendanceStart: "2026-01-05", attendanceEnd: "2026-01-09" });
    const r = await getRun(fx.hr, id);
    const ayu = await getItem(fx.hr, r.items.find((i) => i.employeeNo === "TE-001")!.id);
    expect(ayu.attendance.totals).toMatchObject({ scheduledDays: 5, presentDays: 4, absentDays: 1 });
    expect(ayu.attendance.from).toBe("2026-01-05");
  });

  it("pembatalan penerbitan: hanya pimpinan; slip jadi VOID & hilang dari karyawan; revisi menjaga jejak", async () => {
    await setup();
    const { id } = await createRun(fx.hr, PERIOD);
    await submitRun(fx.hr, id);
    await confirmPayrollRules(fx.superAdmin);
    await approveRun(fx.superAdmin, id);
    await issueRun(fx.hr, id);
    expect((await listMyPayslips(fx.emp1))).toHaveLength(1);
    const oldNumber = (await listMyPayslips(fx.emp1))[0]!.number;

    expect((await fail(cancelRun(fx.hr, id, { reason: "Salah hitung bonus" })))?.code).toBe("FORBIDDEN");
    expect((await fail(cancelRun(fx.superAdmin, id, { reason: "" })))?.code).toBe("VALIDATION");
    await cancelRun(fx.superAdmin, id, { reason: "Salah hitung bonus" });
    expect((await getRun(fx.hr, id)).run.status).toBe("CANCELLED");
    expect(await listMyPayslips(fx.emp1)).toHaveLength(0);
    const voided = await prisma.payslip.findMany({ where: { runId: id } });
    expect(voided.every((s) => s.status === "VOIDED" && s.voidReason === "Salah hitung bonus")).toBe(true);
    // slip tidak dapat dibuka karyawan setelah dibatalkan; admin masih bisa (untuk arsip)
    expect((await fail(getPayslip(fx.emp1, voided.find((v) => v.employeeId === fx.empIds[E1])!.id)))?.code).toBe("NOT_FOUND");
    expect((await getPayslip(fx.hr, voided[0]!.id)).dto.status).toBe("VOIDED");

    // revisi: draf baru dari periode yang dibatalkan
    expect((await fail(createRevision(fx.hr, id + "x")))?.code).toBeTruthy();
    const rev = await createRevision(fx.hr, id, {});
    const revRun = await getRun(fx.hr, rev.id);
    expect(revRun.run.status).toBe("DRAFT");
    expect(revRun.run.revisionOfId).toBe(id);
    expect(revRun.items).toHaveLength(2);
    await submitRun(fx.hr, rev.id);
    await confirmPayrollRules(fx.superAdmin);
    await approveRun(fx.superAdmin, rev.id);
    await issueRun(fx.hr, rev.id);
    const mine = await listMyPayslips(fx.emp1);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.number).not.toBe(oldNumber);
    const snap = (await getPayslip(fx.emp1, mine[0]!.id)).snapshot;
    expect(snap.revisionNote).toContain(oldNumber);
    // revisi hanya dari periode yang dibatalkan
    expect((await fail(createRevision(fx.hr, rev.id, {})))?.code).toBe("CONFLICT");
  });

  it("karyawan hanya melihat slip miliknya; slip karyawan lain 'tidak ditemukan'; unduh massal hanya admin", async () => {
    await setup();
    const { id } = await createRun(fx.hr, PERIOD);
    await submitRun(fx.hr, id);
    await confirmPayrollRules(fx.superAdmin);
    await approveRun(fx.superAdmin, id);
    // belum terbit → karyawan belum melihat apa pun
    expect(await listMyPayslips(fx.emp1)).toHaveLength(0);
    await issueRun(fx.hr, id);
    const mine1 = await listMyPayslips(fx.emp1);
    const mine2 = await listMyPayslips(fx.emp2);
    expect(mine1).toHaveLength(1);
    expect(mine2).toHaveLength(1);
    expect(await listMyPayslips(fx.emp3)).toHaveLength(0); // tanpa komponen → tanpa slip
    expect((await fail(getPayslip(fx.emp1, mine2[0]!.id)))?.code).toBe("NOT_FOUND");
    expect((await fail(getPayslip(fx.emp3, mine1[0]!.id)))?.code).toBe("NOT_FOUND");
    expect((await getPayslip(fx.emp1, mine1[0]!.id)).snapshot.employee.name).toBe("Ayu Lestari");
    expect((await fail(getRunPayslips(fx.emp1, id)))?.code).toBe("FORBIDDEN");
    expect((await getRunPayslips(fx.hr, id))).toHaveLength(2);
    expect((await fail(getRun(fx.emp1, id)))?.code).toBe("FORBIDDEN");
  });

  it("komponen: gaji pokok tidak boleh ganda pada periode beririsan; komponen nonaktif tidak dihitung", async () => {
    await setup();
    const dup = await fail(createComponent(fx.hr, {
      employeeId: fx.empIds[E1], category: "BASE_SALARY", name: "Gaji pokok baru", calc: "FIXED", amount: 6_000_000, recurrence: "RECURRING", effectiveFrom: "2026-06-01",
    }));
    expect(dup?.fieldErrors?.effectiveFrom).toMatch(/Beririsan/);
    const comp = await prisma.salaryComponent.findFirstOrThrow({ where: { employeeId: fx.empIds[E1], name: "Transport harian" } });
    await setComponentActive(fx.hr, comp.id, false);
    const { id } = await createRun(fx.hr, PERIOD);
    const item = (await getRun(fx.hr, id)).items.find((i) => i.employeeNo === "TE-001")!;
    expect((await getItem(fx.hr, item.id)).lines.map((l) => l.name)).not.toContain("Transport harian");
    expect(await prisma.auditLog.count({ where: { action: "component.deactivate" } })).toBe(1);
  });
});

describe("slip PDF", () => {
  it("PDF valid dari snapshot: memuat identitas, rincian, total, ringkasan kehadiran; rekening hanya 4 digit terakhir", async () => {
    await prisma.employee.update({ where: { id: fx.empIds[E1] }, data: { bankName: "Bank Uji", bankAccountEnc: encryptField("1234567890123"), bankAccountLast4: "0123", bankAccountHolder: "Ayu Lestari" } });
    await updatePayrollRules(fx.superAdmin, {
      lateMode: "NONE", lateAmount: 0, absenceMode: "NONE", absenceAmount: 0, absenceDivisor: null, izinDeductsPay: true, sakitDeductsPay: false, cutiDeductsPay: false,
      overtimeMode: "MANUAL", overtimeRatePerHour: 0, overtimeMinMinutes: 60, overtimeMaxMinutesPerDay: 240,
    });
    await addComponent(fx.empIds[E1], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 7_500_000 });
    await addComponent(fx.empIds[E1], fx.hr.userId, { category: "MEAL_ALLOWANCE", name: "Uang makan", calc: "PER_PRESENT_DAY", amount: 30_000 });
    const { id } = await createRun(fx.hr, PERIOD);
    const item = (await getRun(fx.hr, id)).items[0]!;
    await addAdjustment(fx.hr, item.id, { kind: "DEDUCTION", name: "Koreksi kasbon", amount: 100_000, reason: "Sesuai surat pernyataan" });
    await submitRun(fx.hr, id);
    await confirmPayrollRules(fx.superAdmin);
    await approveRun(fx.superAdmin, id);
    await issueRun(fx.hr, id, { issueDate: "2026-02-02" });

    const slips = await getRunPayslips(fx.hr, id);
    const pdf = await renderPayslipsPdf(slips.map((s) => ({ snapshot: s.snapshot, voided: s.voided })));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    const dir = mkdtempSync(join(tmpdir(), "slip-"));
    const file = join(dir, "slip.pdf");
    writeFileSync(file, pdf);
    const text = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
    expect(text).toContain("SLIP GAJI");
    expect(text).toContain("TRILOGIKA EDUTAMA (UJI)");
    expect(text).toContain("Ayu Lestari");
    expect(text).toContain("TE-001");
    expect(text).toContain("Gaji pokok");
    expect(text).toContain("Rp 7.500.000");
    expect(text).toContain("Rp 510.000"); // 17 × 30.000
    expect(text).toContain("Koreksi kasbon");
    expect(text).toContain("Total Pendapatan");
    expect(text).toContain("Total Potongan");
    expect(text).toContain("GAJI BERSIH DITERIMA");
    expect(text).toContain("Rp 7.910.000"); // 7.500.000 + 510.000 − 100.000
    expect(text).toContain("Terbilang: Tujuh Juta Sembilan Ratus Sepuluh Ribu Rupiah");
    expect(text).toContain("RINGKASAN KEHADIRAN");
    expect(text).toContain("2 Februari 2026");
    expect(text).toContain("0123"); // 4 digit terakhir
    expect(text).not.toContain("1234567890123"); // nomor lengkap tidak pernah tampil
    expect(text).not.toContain("DIBATALKAN");
    // Dua slip → dua halaman
    const pages = execFileSync("pdfinfo", [file], { encoding: "utf8" }).match(/Pages:\s+(\d+)/)?.[1];
    expect(Number(pages)).toBe(slips.length);
  });

  it("slip yang dibatalkan tetap dapat dirender untuk arsip admin (watermark diuji di tes unit PDF)", async () => {
    await updatePayrollRules(fx.superAdmin, {
      lateMode: "NONE", lateAmount: 0, absenceMode: "NONE", absenceAmount: 0, absenceDivisor: null, izinDeductsPay: true, sakitDeductsPay: false, cutiDeductsPay: false,
      overtimeMode: "MANUAL", overtimeRatePerHour: 0, overtimeMinMinutes: 60, overtimeMaxMinutesPerDay: 240,
    });
    await addComponent(fx.empIds[E1], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 3_000_000 });
    const { id } = await createRun(fx.hr, PERIOD);
    await submitRun(fx.hr, id);
    await confirmPayrollRules(fx.superAdmin);
    await approveRun(fx.superAdmin, id);
    await issueRun(fx.hr, id);
    await cancelRun(fx.superAdmin, id, { reason: "Salah periode" });
    expect((await fail(getRunPayslips(fx.hr, id)))?.code).toBe("NOT_FOUND"); // default: hanya slip aktif
    const slips = await getRunPayslips(fx.hr, id, { includeVoided: true });
    expect(slips.every((s) => s.voided)).toBe(true);
    const pdf = await renderPayslipsPdf(slips.map((s) => ({ snapshot: s.snapshot, voided: s.voided })));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
