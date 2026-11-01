/**
 * Uji beban ringan (opt-in: `PERF=1 npx vitest run --project integration tests/integration/performance-smoke.test.ts`).
 * 300 karyawan × satu bulan absensi: halaman/ laporan/ penggajian utama harus selesai dalam batas wajar dan tidak tumbuh kuadratik.
 * Dilewati pada `npm test` biasa agar suite tetap cepat; jalankan sebelum rilis atau setelah mengubah query.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { getAdminDashboard } from "@/server/services/dashboard";
import { getRecap } from "@/server/services/recap";
import { calculateRun, createRun, getRun } from "@/server/services/payroll";
import { getAttendanceReport, getComplianceReport, getCostReport, getExecutiveSummary, getLeaveOvertimeReport, getWorkforceReport, reportTable } from "@/server/services/reports";
import { listEmployees } from "@/server/services/employees";
import { confirmPayrollRules, updatePayrollRules } from "@/server/services/settings";
import { isoToDate } from "@/server/json";
import { addDays, isoWeekday, monthRange, todayIso } from "@/lib/time";
import { resetDb, seedFixtures, type Fixtures } from "../helpers/db";

const N = Number(process.env.PERF_EMPLOYEES ?? 300);
let fx: Fixtures;
const today = todayIso("Asia/Jakarta");
const month = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
const { from, to } = monthRange(month);
const timings: [string, number][] = [];
async function timed<T>(label: string, fn: () => Promise<T>, maxMs: number): Promise<T> {
  const t = performance.now();
  const r = await fn();
  const ms = Math.round(performance.now() - t);
  timings.push([label, ms]);
  expect(ms, `${label} ${ms} ms > ${maxMs} ms`).toBeLessThan(maxMs);
  return r;
}

describe.skipIf(!process.env.PERF)(`beban ringan — ${N} karyawan × 1 bulan`, () => {
  beforeAll(async () => {
    await resetDb();
    fx = await seedFixtures();
    const div = await prisma.division.findFirstOrThrow();
    await prisma.employee.createMany({
      data: Array.from({ length: N }, (_, i) => ({
        employeeNo: `P-${String(i).padStart(4, "0")}`, fullName: `Karyawan Beban ${i}`, position: "Staf", employmentStatus: "PERMANENT" as const,
        joinDate: isoToDate("2025-01-01"), divisionId: div.id,
      })),
    });
    const emps = await prisma.employee.findMany({ where: { employeeNo: { startsWith: "P-" } }, select: { id: true } });
    await prisma.salaryComponent.createMany({
      data: emps.map((e) => ({ employeeId: e.id, kind: "EARNING" as const, category: "BASE_SALARY" as const, name: "Gaji pokok", calc: "FIXED" as const, amount: BigInt(5_000_000), recurrence: "RECURRING" as const, effectiveFrom: isoToDate("2025-01-01"), createdById: fx.hr.userId })),
    });
    const days: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) if (isoWeekday(d) <= 5) days.push(d);
    const at = (d: string, hms: string) => new Date(`${d}T${hms}+07:00`);
    const rows = emps.flatMap((e, i) => days.map((d, k) => {
      if ((i + k) % 17 === 0) return null; // tidak hadir
      const late = (i * 7 + k) % 5 === 0;
      return { employeeId: e.id, date: isoToDate(d), checkInAt: at(d, late ? "08:25:00" : "07:56:00"), checkOutAt: (i + k) % 29 === 0 ? null : at(d, "16:03:00"), source: "SELF" };
    }).filter((x): x is NonNullable<typeof x> => x !== null));
    await prisma.attendance.createMany({ data: rows });
    await updatePayrollRules(fx.superAdmin, { lateMode: "PER_MINUTE", lateAmount: 1000, absenceMode: "FIXED_PER_DAY", absenceAmount: 100_000, absenceDivisor: null, izinDeductsPay: true, sakitDeductsPay: false, cutiDeductsPay: false, overtimeMode: "MANUAL", overtimeRatePerHour: 20_000, overtimeMinMinutes: 60, overtimeMaxMinutesPerDay: 240 });
    await confirmPayrollRules(fx.superAdmin);
  }, 300_000);

  it("halaman & laporan utama selesai dalam batas wajar (data 300 karyawan × sebulan)", async () => {
    await timed("daftar karyawan (halaman 1)", () => listEmployees(fx.hr, { pageSize: 50 }), 1500);
    const recap = await timed("rekap bulanan semua karyawan", () => getRecap(fx.hr, { view: "kustom", from, to, pageSize: 50 }), 4000);
    expect(recap.summary.employees).toBe(N + 3);
    await timed("rekap harian (hari terakhir)", () => getRecap(fx.hr, { view: "harian", date: to, pageSize: 50 }), 3000);
    await timed("dasbor admin", () => getAdminDashboard(fx.hr), 4000);
    await timed("laporan kehadiran", () => getAttendanceReport(fx.hr, { from, to }), 5000);
    await timed("laporan cuti & lembur", () => getLeaveOvertimeReport(fx.hr, { from, to }), 4000);
    await timed("ringkasan eksekutif (tren 6 bulan)", () => getExecutiveSummary(fx.superAdmin, { month }), 8000);
    await timed("laporan karyawan", () => getWorkforceReport(fx.hr, { year: Number(month.slice(0, 4)) }), 3000);
    await timed("ekspor rekap (tabel)", () => reportTable(fx.hr, "kehadiran", { from, to }), 6000);
  }, 120_000);

  it("penggajian: membuat & menghitung periode untuk semua karyawan; laporan biaya/kepatuhan setelahnya", async () => {
    const { id } = await timed("buat periode gaji (hitung semua)", () => createRun(fx.hr, { label: `Gaji ${month}`, periodStart: from, periodEnd: to }), 20_000);
    const run = await timed("buka periode gaji", () => getRun(fx.hr, id), 5000);
    expect(run.items).toHaveLength(N); // 3 karyawan fixture tanpa komponen gaji dilewati
    await timed("hitung ulang periode", () => calculateRun(fx.hr, id), 20_000);
    await timed("laporan biaya SDM", () => getCostReport(fx.superAdmin, { year: Number(month.slice(0, 4)) }), 5000);
    await timed("laporan kepatuhan BPJS/PPh 21", () => getComplianceReport(fx.superAdmin, { month }), 5000);
    console.log("\n[beban] " + timings.map(([l, ms]) => `${l}: ${ms} ms`).join(" | "));
  }, 180_000);
});
