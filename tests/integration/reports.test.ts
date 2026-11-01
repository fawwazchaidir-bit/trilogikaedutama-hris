import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import { toCsv } from "@/server/export";
import { getRecap } from "@/server/services/recap";
import {
  getAttendanceReport, getComplianceReport, getCostReport, getExecutiveSummary, getLeaveOvertimeReport, getWorkforceReport, reportTable, REPORT_KINDS,
} from "@/server/services/reports";
import { approveRun, createRun, issueRun, submitRun } from "@/server/services/payroll";
import { confirmPayrollRules, updateAttendancePolicy, updatePayrollRules, updateStatutoryConfig } from "@/server/services/settings";
import { submitOvertime, reviewOvertime } from "@/server/services/overtime";
import { setBalance } from "@/server/services/leave";
import { defaultStatutoryConfig } from "@/lib/statutory";
import { formatPercent } from "@/lib/analytics";
import { addAttendance, addComponent, resetDb, seedFixtures, type Fixtures } from "../helpers/db";
import { pinNow } from "../helpers/pin-now";

// Tanggal tetap di masa lalu + aturan mundur 365 hari → titik awal waktu dipatok agar tes tidak membusuk (lihat helpers/pin-now.ts).
pinNow();

let fx: Fixtures;
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const [AYU, BUDI] = [0, 1] as const;
let soloDiv: string;

/** Data Januari 2026 yang sama dengan tes penggajian: Ayu 17 hadir (1 terlambat 20 mnt), 1 tidak hadir, 1 izin, 2 sakit, dari 21 hari kerja (libur 1 Jan). */
async function seedJanuary() {
  const id = fx.empIds[AYU];
  await prisma.calendarDay.create({ data: { date: isoToDate("2026-01-01"), kind: "HOLIDAY", name: "Tahun Baru (uji)", createdById: fx.hr.userId } });
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
}

beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
  await updateAttendancePolicy(fx.superAdmin, {
    lateMinutesAfterTolerance: false, locationEnabled: false, locationName: null, locationLat: null, locationLng: null, locationRadiusMeters: 100,
    locationMaxAccuracyMeters: 150, requestBackdateDays: 365, annualLeaveQuota: 12, allowNegativeLeaveBalance: false,
  });
  await seedJanuary();
  // Ayu sendirian di satu divisi agar angka per-divisi sama dengan angka per-karyawan.
  soloDiv = (await prisma.division.create({ data: { name: "Solo" } })).id;
  await prisma.employee.update({ where: { id: fx.empIds[AYU] }, data: { divisionId: soloDiv } });
});

describe("laporan kehadiran — angka cocok dengan hitungan manual & rekap", () => {
  it("Ayu Januari 2026: 21 hari kerja, 17 hadir (16 tepat + 1 terlambat), 1 tidak hadir, 1 izin, 2 sakit; rasio & rata-rata jam kerja", async () => {
    const r = await getAttendanceReport(fx.hr, { from: "2026-01-01", to: "2026-01-31", divisionId: soloDiv });
    expect(r.totals).toMatchObject({ scheduledDays: 21, presentDays: 17, onTimeDays: 16, lateCount: 1, lateMinutes: 20, izinDays: 1, sakitDays: 2, absentDays: 1, incompleteCount: 1 });
    expect(r.rates.attendance).toBeCloseTo(17 / 21, 6);
    expect(r.rates.punctuality).toBeCloseTo(16 / 17, 6);
    expect(r.rates.absence).toBeCloseTo(1 / 21, 6);
    expect(r.rates.leave).toBeCloseTo(3 / 21, 6);
    expect(r.avgWorkedMinutes).toBeCloseTo(7655 / 16, 6); // 16 hari lengkap; 9 Jan tanpa check-out tidak dihitung
    // sebaran hari: terlambat Selasa (6 Jan), tidak hadir Kamis (8 Jan)
    const wd = (n: number) => r.byWeekday.find((w) => w.weekday === n)!;
    expect(wd(2).late).toBe(1);
    expect(wd(4).absent).toBe(1);
    // histogram jam datang: 14 tepat/awal ≤10 mnt, 1 awal 10 mnt, 1 terlambat 1–15, 1 terlambat 16–30
    expect(Object.fromEntries(r.arrival.map((b) => [b.label, b.count]))).toMatchObject({
      "10 mnt awal – tepat": 14, "30–10 mnt lebih awal": 1, "Terlambat 1–15 mnt": 1, "Terlambat 16–30 mnt": 1,
    });
    expect(r.arrival.reduce((a, b) => a + b.count, 0)).toBe(17);
    expect(r.topLate.map((p) => [p.name, p.late, p.lateMinutes])).toEqual([["Ayu Lestari", 1, 20]]);
    expect(r.byDivision).toHaveLength(1);
    expect(r.byDivision[0]).toMatchObject({ name: "Solo", employees: 1, scheduled: 21, present: 17, late: 1 });
  });

  it("konsisten dengan rekap bulanan untuk seluruh perusahaan (satu sumber kebenaran)", async () => {
    const rep = await getAttendanceReport(fx.hr, { from: "2026-01-01", to: "2026-01-31" });
    const recap = await getRecap(fx.hr, { view: "bulanan", month: "2026-01", pageSize: 200 });
    for (const k of ["scheduledDays", "presentDays", "onTimeDays", "lateCount", "lateMinutes", "izinDays", "sakitDays", "cutiDays", "absentDays", "incompleteCount", "workedMinutes"] as const) {
      expect(rep.totals[k], k).toBe(recap.summary[k]);
    }
    expect(rep.rows).toHaveLength(recap.summary.employees);
    // Budi & Citra tanpa absensi sama sekali → seluruh hari kerja = tidak hadir
    expect(rep.rows.find((x) => x.name === "Budi Santoso")!.absent).toBe(21);
  });

  it("rentang tanggal tidak valid / terlalu panjang ditolak; karyawan biasa tidak boleh", async () => {
    expect((await fail(getAttendanceReport(fx.hr, { from: "2026-02-01", to: "2026-01-01" })))?.code).toBe("VALIDATION");
    expect((await fail(getAttendanceReport(fx.hr, { from: "2024-01-01", to: "2026-01-31" })))?.message).toContain("400 hari");
    expect((await fail(getAttendanceReport(fx.emp1, {})))?.code).toBe("FORBIDDEN");
    expect((await fail(getExecutiveSummary(fx.emp1, {})))?.code).toBe("FORBIDDEN");
  });

  it("setengah hari terhitung pecahan di laporan", async () => {
    await prisma.leaveRequest.create({ data: { employeeId: fx.empIds[AYU], type: "CUTI", startDate: isoToDate("2026-01-08"), endDate: isoToDate("2026-01-08"), reason: "Cuti pagi", status: "APPROVED", workingDays: 0.5, dayPart: "MORNING", reviewedById: fx.hr.userId, reviewedAt: new Date() } });
    const r = await getAttendanceReport(fx.hr, { from: "2026-01-01", to: "2026-01-31", divisionId: soloDiv });
    expect(r.totals.cutiDays).toBe(0.5);
    expect(r.totals.absentDays).toBe(0.5); // 8 Jan: cuti pagi 0,5 + siang tanpa check-in = tidak hadir 0,5
    expect(r.totals.scheduledDays).toBe(21);
  });
});

describe("laporan eksekutif", () => {
  it("KPI bulan ini vs bulan lalu; tren 6 bulan; wawasan hanya yang melewati ambang", async () => {
    const s = await getExecutiveSummary(fx.hr, { month: "2026-01" });
    expect(s.trend.map((t) => t.ym)).toEqual(["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01"]);
    // seluruh perusahaan: 3 karyawan × 21 hari = 63 hari kerja, 17 hadir
    expect(s.currentRates.attendance).toBeCloseTo(17 / 63, 6);
    expect(s.kpis.find((k) => k.label === "Tingkat kehadiran")!.value).toBe(formatPercent(17 / 63));
    expect(s.kpis.find((k) => k.label === "Karyawan aktif (akhir bulan)")!.value).toBe("3");
    expect(s.kpis.find((k) => k.label === "Kejadian terlambat")!.value).toBe("1");
    // 1 kejadian terlambat (< 5) → tidak ada wawasan "terlambat berulang"
    expect(s.insights.some((i) => i.text.includes("terlambat ≥ 5"))).toBe(false);
    // 1 absensi belum lengkap → wawasan muncul
    expect(s.insights.some((i) => i.text.includes("belum lengkap"))).toBe(true);
    // divisi hanya 1 orang tidak disorot (tidak informatif); setelah Budi digabung dengan Citra (2 orang, keduanya tanpa absensi) → muncul
    expect(s.insights.some((i) => i.text.includes("tingkat tidak hadir tertinggi"))).toBe(false);
    await prisma.employee.update({ where: { id: fx.empIds[BUDI] }, data: { divisionId: fx.divisionB } });
    const s2 = await getExecutiveSummary(fx.hr, { month: "2026-01" });
    expect(s2.insights.find((i) => i.text.includes("tingkat tidak hadir tertinggi"))!.text).toContain("Pemasaran");
    expect(s2.insights.find((i) => i.text.includes("tingkat tidak hadir tertinggi"))!.text).toContain("100,0%");
  });

  it("tanpa data di bulan tertentu → rasio null ('—'), bukan 0% atau error", async () => {
    const s = await getExecutiveSummary(fx.hr, { month: "2025-02" }); // sebelum karyawan ada? (join 2025-01-01) → ada hari kerja, semua tidak hadir
    expect(s.kpis).toHaveLength(8);
    const s2 = await getExecutiveSummary(fx.hr, { month: "2024-06" }); // sebelum seluruh karyawan bergabung
    expect(s2.currentRates).toEqual({ attendance: null, absence: null, punctuality: null, leave: null });
    expect(s2.kpis.find((k) => k.label === "Tingkat kehadiran")!.value).toBe("—");
  });

  it("lembur disetujui masuk KPI; pengajuan menunggu masuk wawasan", async () => {
    const o = await submitOvertime(fx.emp1, { date: "2026-01-12", startTime: "16:00", minutes: 120, reason: "Penyelesaian laporan" });
    await reviewOvertime(fx.hr, o.id, { decision: "APPROVE", approvedMinutes: 90 });
    await submitOvertime(fx.emp2, { date: "2026-01-13", startTime: "16:00", minutes: 60, reason: "Menunggu persetujuan" });
    const s = await getExecutiveSummary(fx.hr, { month: "2026-01" });
    expect(s.kpis.find((k) => k.label === "Lembur disetujui")!.value).toBe("1 j 30 m");
    expect(s.insights.some((i) => i.text.includes("1 pengajuan lembur menunggu"))).toBe(true);
  });
});

describe("laporan cuti & lembur", () => {
  it("hari izin/sakit per jenis & divisi; lembur per karyawan/divisi; saldo cuti (kewajiban) per tahun", async () => {
    await setBalance(fx.hr, { employeeId: fx.empIds[AYU], year: 2026, targetDays: 12, note: "Saldo awal" });
    await setBalance(fx.hr, { employeeId: fx.empIds[BUDI], year: 2026, targetDays: 7.5, note: "Sisa setengah hari" });
    const o = await submitOvertime(fx.emp1, { date: "2026-01-12", startTime: "16:00", minutes: 120, reason: "Penyelesaian laporan" });
    await reviewOvertime(fx.hr, o.id, { decision: "APPROVE" });
    const r = await getLeaveOvertimeReport(fx.hr, { from: "2026-01-01", to: "2026-01-31" });
    expect(Object.fromEntries(r.leaveByType.map((t) => [t.type, [t.requests, t.days]]))).toEqual({ IZIN: [1, 1], SAKIT: [1, 2], CUTI: [0, 0] });
    expect(r.leaveByDivision).toEqual([{ name: "Solo", izin: 1, sakit: 2, cuti: 0 }]);
    expect(r.overtime.approvedMinutes).toBe(120);
    expect(r.overtime.byEmployee).toEqual([{ employeeId: fx.empIds[AYU], name: "Ayu Lestari", division: "Solo", minutes: 120, days: 1 }]);
    expect(r.overtime.byDivision).toEqual([{ name: "Solo", minutes: 120 }]);
    expect(r.balance).toMatchObject({ year: 2026, totalDays: 19.5, employees: 2 });
    expect(r.balance.highest[0]).toMatchObject({ name: "Ayu Lestari", balance: 12 });
  });
});

async function approvedJanuaryRun() {
  await updatePayrollRules(fx.superAdmin, { lateMode: "NONE", lateAmount: 0, absenceMode: "NONE", absenceAmount: 0, absenceDivisor: null, izinDeductsPay: true, sakitDeductsPay: false, cutiDeductsPay: false, overtimeMode: "MANUAL", overtimeRatePerHour: 0, overtimeMinMinutes: 60, overtimeMaxMinutesPerDay: 240 });
  const c = defaultStatutoryConfig(); c.bpjs.enabled = true; c.pph21.enabled = true;
  await updateStatutoryConfig(fx.superAdmin, c);
  await confirmPayrollRules(fx.superAdmin);
  await addComponent(fx.empIds[AYU], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 8_000_000 });
  await addComponent(fx.empIds[BUDI], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 4_000_000 });
  const { id } = await createRun(fx.hr, { label: "Gaji Januari 2026", periodStart: "2026-01-01", periodEnd: "2026-01-31" });
  await submitRun(fx.hr, id);
  await approveRun(fx.superAdmin, id);
  return id;
}

describe("laporan biaya SDM & kepatuhan BPJS/PPh 21", () => {
  it("biaya = pendapatan + BPJS perusahaan; hanya periode disetujui/diterbitkan; per divisi & kategori", async () => {
    // periode DRAF tidak ikut
    await updatePayrollRules(fx.superAdmin, { lateMode: "NONE", lateAmount: 0, absenceMode: "NONE", absenceAmount: 0, absenceDivisor: null, izinDeductsPay: true, sakitDeductsPay: false, cutiDeductsPay: false, overtimeMode: "MANUAL", overtimeRatePerHour: 0, overtimeMinMinutes: 60, overtimeMaxMinutesPerDay: 240 });
    await addComponent(fx.empIds[AYU], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 1_000_000 });
    await createRun(fx.hr, { label: "Draf Januari", periodStart: "2026-01-01", periodEnd: "2026-01-31" });
    expect((await getCostReport(fx.hr, { year: 2026 })).months).toHaveLength(0);
  });

  it("setelah disetujui: total & komposisi sesuai hitungan manual", async () => {
    const id = await approvedJanuaryRun();
    const r = await getCostReport(fx.hr, { year: 2026 });
    expect(r.months).toHaveLength(1);
    // Ayu 8.000.000: BPJS karyawan 80.000+160.000+80.000 = 320.000, PPh 125.448 (TER A 1,5% × 8.363.200). Budi 4.000.000: BPJS 160.000 (Kes 40.000 + JHT 80.000 + JP 40.000), PPh 0 (≤ 5,4 jt... bruto 4.181.600 → 0%).
    // BPJS perusahaan Ayu 819.200; Budi: Kes 160.000 + JHT 148.000 + JP 80.000 + JKK 9.600 + JKM 12.000 = 409.600
    expect(r.totals.earnings).toBe(12_000_000);
    expect(r.totals.employerBpjs).toBe(819_200 + 409_600);
    expect(r.totals.employerCost).toBe(12_000_000 + 819_200 + 409_600);
    expect(r.totals.pph21).toBe(125_448);
    expect(r.totals.deductions).toBe(320_000 + 125_448 + 160_000);
    expect(r.totals.net).toBe(12_000_000 - (320_000 + 125_448 + 160_000));
    expect(r.byDivision.find((d) => d.name === "Solo")).toMatchObject({ employees: 1, earnings: 8_000_000 });
    expect(r.byDivision.find((d) => d.name === "Operasional")).toMatchObject({ employees: 1, earnings: 4_000_000 });
    expect(r.byCategory.find((c) => c.category === "BASE_SALARY")!.amount).toBe(12_000_000);
    expect(r.byCategory.find((c) => c.category === "TAX")!.amount).toBe(125_448);
    await issueRun(fx.hr, id);
    expect((await getCostReport(fx.hr, { year: 2026 })).totals.earnings).toBe(12_000_000); // diterbitkan tetap terhitung
    expect((await fail(getCostReport(fx.emp1, { year: 2026 })))?.code).toBe("FORBIDDEN");
  });

  it("rekap BPJS & PPh 21 per karyawan + temuan (tanpa NPWP, bukan peserta BPJS)", async () => {
    await prisma.employee.update({ where: { id: fx.empIds[BUDI] }, data: { hasNpwp: false } });
    await approvedJanuaryRun();
    const r = await getComplianceReport(fx.hr, { month: "2026-01" });
    expect(r.automatic).toBe(true);
    expect(r.rows.map((x) => x.name)).toEqual(["Ayu Lestari", "Budi Santoso"]);
    const ayu = r.rows[0]!;
    expect(ayu).toMatchObject({ bpjsWage: 8_000_000, kesEmp: 80_000, kesEr: 320_000, jhtEmp: 160_000, jhtEr: 296_000, jpEmp: 80_000, jpEr: 160_000, jkk: 19_200, jkm: 24_000, taxableGross: 8_363_200, pph21: 125_448, pph21Method: "TER A" });
    expect(r.totals.pph21).toBe(125_448);
    expect(r.totals.kesEmp).toBe(80_000 + 40_000);
    expect(r.issues).toEqual([{ text: "Karyawan tanpa NPWP/NIK terdaftar (PPh 21 dikenai tarif lebih tinggi)", count: 1 }]);
  });

  it("bulan tanpa periode disetujui → kosong, bukan galat", async () => {
    const r = await getComplianceReport(fx.hr, { month: "2026-03" });
    expect(r.rows).toEqual([]);
    expect(r.issues).toEqual([]);
  });
});

describe("laporan karyawan (headcount & turnover)", () => {
  it("masuk/keluar per bulan, headcount akhir bulan, turnover, masa kerja", async () => {
    await prisma.employee.update({ where: { id: fx.empIds[BUDI] }, data: { isActive: false, endDate: isoToDate("2026-02-15") } });
    await prisma.employee.create({ data: { employeeNo: "TE-099", fullName: "Baru Masuk", position: "Staf", employmentStatus: "CONTRACT", joinDate: isoToDate("2026-03-10") } });
    const r = await getWorkforceReport(fx.hr, { year: 2026 });
    const m = (ym: string) => r.movement.find((x) => x.ym === ym)!;
    expect(m("2026-01")).toMatchObject({ joiners: 0, leavers: 0, headcountEnd: 3 });
    expect(m("2026-02")).toMatchObject({ leavers: 1, headcountEnd: 2 });
    expect(m("2026-03")).toMatchObject({ joiners: 1, headcountEnd: 3 });
    expect(r.headcount).toBe(3); // Ayu, Citra, Baru Masuk (Budi sudah berhenti)
    expect(r.byStatus.find((s) => s.status === "CONTRACT")!.count).toBe(1);
    // turnover = 1 ÷ rata-rata(headcount awal tahun 3, sekarang 3)
    expect(r.turnover).toBeCloseTo(1 / 3, 6);
    expect(r.tenure.reduce((a, t) => a + t.count, 0)).toBe(3);
    expect(r.tenure.find((t) => t.label === "< 1 tahun")!.count).toBe(1);
  });

  it("tahun tanpa karyawan → turnover null", async () => {
    const r = await getWorkforceReport(fx.hr, { year: 2024 });
    expect(r.headcount).toBe(0);
    expect(r.turnover).toBeNull();
  });
});

describe("ekspor laporan", () => {
  it("setiap jenis laporan menghasilkan tabel konsisten dan CSV valid; dicatat di audit; karyawan biasa ditolak", async () => {
    await approvedJanuaryRun();
    for (const kind of REPORT_KINDS) {
      const t = await reportTable(fx.hr, kind, { month: "2026-01", year: 2026, from: "2026-01-01", to: "2026-01-31" });
      expect(t.columns.length).toBeGreaterThan(2);
      expect(t.rows.every((row) => t.columns.every((c) => c.key in row))).toBe(true);
      const csv = toCsv(t);
      expect(csv.split("\r\n").length).toBeGreaterThan(5);
      expect(csv.startsWith("﻿")).toBe(true);
    }
    expect(await prisma.auditLog.count({ where: { action: "report.export" } })).toBe(REPORT_KINDS.length);
    expect((await fail(reportTable(fx.emp1, "kehadiran", {})))?.code).toBe("FORBIDDEN");
    // total kolom hari kerja pada ekspor kehadiran = jumlah baris
    const t = await reportTable(fx.hr, "kehadiran", { from: "2026-01-01", to: "2026-01-31" });
    expect(t.totals!.scheduled).toBe(63);
    expect(t.totals!.present).toBe(17);
  });
});
