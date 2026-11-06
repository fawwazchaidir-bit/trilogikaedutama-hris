import { describe, expect, it } from "vitest";
import { computeItem, overtimeEvidenceMinutes, overtimePay, type ComponentInput, type PayrollRules } from "@/lib/payroll";
import { zonedInstant } from "@/lib/time";
import { emptyTotals } from "@/lib/attendance";
import { defaultStatutoryConfig, type StatutoryConfig } from "@/lib/statutory";
import { makeDay } from "../helpers/day";

const PERIOD = { start: "2026-10-01", end: "2026-10-31" };
const RULES: PayrollRules = {
  lateMode: "NONE", lateAmount: 0, absenceMode: "NONE", absenceAmount: 0, absenceDivisor: null,
  izinDeductsPay: true, sakitDeductsPay: false, cutiDeductsPay: false,
  overtimeMode: "MANUAL", overtimeRatePerHour: 0, overtimeMinMinutes: 60, overtimeMaxMinutesPerDay: 240,
};
let seq = 0;
const comp = (over: Partial<ComponentInput>): ComponentInput => ({
  id: `c${++seq}`, kind: "EARNING", category: "BASE_SALARY", name: "Gaji pokok", calc: "FIXED", amount: 0, percentBp: null,
  recurrence: "RECURRING", effectiveFrom: "2026-01-01", effectiveTo: null, description: null, isActive: true, ...over,
});
const totals = (over: Partial<ReturnType<typeof emptyTotals>> = {}) => ({ ...emptyTotals(), scheduledDays: 22, presentDays: 20, onTimeDays: 20, ...over });
const BASE = comp({ amount: 5_000_000 });
const line = (r: ReturnType<typeof computeItem>, pred: (l: ReturnType<typeof computeItem>["lines"][number]) => boolean) => r.lines.find(pred);

describe("hari pecahan (cuti setengah hari)", () => {
  it("komponen per hari hadir memakai 19,5 hari → 390.000, rumus tertulis 19,5", () => {
    const r = computeItem({ components: [BASE, comp({ category: "MEAL_ALLOWANCE", name: "Uang makan", calc: "PER_PRESENT_DAY", amount: 20_000 })], rules: RULES, totals: totals({ presentDays: 19.5 }), days: [], period: PERIOD });
    const meal = line(r, (l) => l.category === "MEAL_ALLOWANCE")!;
    expect(meal.amount).toBe(390_000);
    expect(meal.formula).toContain("19,5 hari hadir");
  });
  it("hari ganjil 0,5 × tarif ganjil dibulatkan half-up (0,5 × 25.001 = 12.500,5 → 12.501)", () => {
    const r = computeItem({ components: [BASE, comp({ category: "MEAL_ALLOWANCE", name: "Makan", calc: "PER_PRESENT_DAY", amount: 25_001 })], rules: RULES, totals: totals({ presentDays: 0.5 }), days: [], period: PERIOD });
    expect(line(r, (l) => l.category === "MEAL_ALLOWANCE")!.amount).toBe(12_501);
  });
  it("potongan tidak hadir tetap per hari: 0,5 tidak hadir + 0,5 izin = 1 hari × nominal", () => {
    const r = computeItem({ components: [BASE], rules: { ...RULES, absenceMode: "FIXED_PER_DAY", absenceAmount: 100_000 }, totals: totals({ absentDays: 0.5, izinDays: 0.5 }), days: [], period: PERIOD });
    const l = line(r, (x) => x.category === "ABSENCE_DEDUCTION")!;
    expect(l.amount).toBe(100_000);
    expect(l.formula).toContain("1 hari");
  });
  it("potongan pembagi gaji: 0,5 hari × 5.000.000 ÷ 22 = 113.636 (bukan 227.273)", () => {
    const r = computeItem({ components: [BASE], rules: { ...RULES, absenceMode: "SALARY_DIVISOR", absenceDivisor: 22 }, totals: totals({ absentDays: 0.5 }), days: [], period: PERIOD });
    expect(line(r, (x) => x.category === "ABSENCE_DEDUCTION")!.amount).toBe(113_636);
  });
  it("gaji pokok per hari hadir juga mendukung pecahan", () => {
    const r = computeItem({ components: [comp({ calc: "PER_PRESENT_DAY", amount: 200_000 })], rules: RULES, totals: totals({ presentDays: 10.5 }), days: [], period: PERIOD });
    expect(r.baseSalary).toBe(2_100_000);
  });
});

describe("lembur — tarif & pengali", () => {
  it("tarif tetap per jam, pengali bawaan 1×", () => {
    expect(overtimePay([120], 0, { ...RULES, overtimeRatePerHour: 20_000 })).toBe(40_000);
  });
  it("pengali 1,5× jam pertama & 2× berikutnya per hari: 150 mnt = 60×1,5 + 90×2 = 270 mnt-setara", () => {
    const rules = { ...RULES, overtimeRatePerHour: 20_000, overtimeFirstHourBp: 15_000, overtimeNextHoursBp: 20_000 };
    expect(overtimePay([150], 0, rules)).toBe(90_000);
    // pengali berlaku PER HARI: dua hari × 60 mnt = 2 × 1,5 jam-setara
    expect(overtimePay([60, 60], 0, rules)).toBe(60_000);
  });
  it("tarif dari gaji pokok ÷ 173: 17.300.000 ÷ 173 = 100.000/jam", () => {
    expect(overtimePay([120], 17_300_000, { ...RULES, overtimeRateMode: "SALARY_DIVISOR", overtimeSalaryDivisor: 173 })).toBe(200_000);
  });
  it("pembulatan hanya sekali di akhir (bukan per hari)", () => {
    // 5.000.000 ÷ 173 = 28.901,73/jam; 2 hari × 61 mnt: gabungan lebih akurat daripada pembulatan per hari
    const rules = { ...RULES, overtimeRateMode: "SALARY_DIVISOR" as const, overtimeSalaryDivisor: 173 };
    const combined = overtimePay([61, 61], 5_000_000, rules);
    expect(combined).toBe(Math.round((5_000_000 * 122) / (173 * 60)));
  });
});

describe("lembur — mode APPROVED (hanya yang disetujui & terbukti)", () => {
  const rules: PayrollRules = { ...RULES, overtimeMode: "APPROVED", overtimeRatePerHour: 20_000, overtimeMinMinutes: 60, overtimeMaxMinutesPerDay: 240 };
  const TZ = "Asia/Jakarta";
  const T = (date: string, hhmm: string) => zonedInstant(date, hhmm, TZ).toISOString();
  /** Hari kerja 08:00–16:00 dengan check-in/out nyata (default masuk 08:00). `out: null` = belum check-out. */
  const day = (date: string, out: string | null, inAt = "08:00", extra: Partial<ReturnType<typeof makeDay>> = {}) => makeDay({
    date, shiftStartAt: T(date, "08:00"), shiftEndAt: T(date, "16:00"), checkInAt: T(date, inAt), checkOutAt: out ? T(date, out) : null, missingCheckout: !out, ...extra,
  });
  const ot = (date: string, approvedMinutes: number, startTime = "16:00") => ({ date, startTime, approvedMinutes });
  const paid = (r: ReturnType<typeof computeItem>) => line(r, (l) => l.source === "RULE_OVERTIME")?.amount;

  it("dibayar = min(disetujui, terbukti di absensi); di bawah ambang tidak dibayar + peringatan", () => {
    const r = computeItem({
      components: [BASE], rules, totals: totals(), days: [day("2026-10-05", "18:10"), day("2026-10-06", "16:45")], period: PERIOD,
      overtime: [ot("2026-10-05", 120), ot("2026-10-06", 90)],
    });
    expect(paid(r)).toBe(40_000); // hanya 2 jam hari pertama
    expect(line(r, (l) => l.source === "RULE_OVERTIME")!.name).toBe("Lembur (disetujui)");
    expect(r.warnings.some((w) => w.includes("06/10/2026") && w.includes("tidak dihitung"))).toBe(true);
    expect(r.overtime).toEqual({ approvedMinutes: 210, paidMinutes: 120, days: 1 });
  });
  it("terbukti lebih sedikit dari yang disetujui → dibayar sesuai bukti (+ peringatan)", () => {
    const r = computeItem({ components: [BASE], rules, totals: totals(), days: [day("2026-10-05", "17:30")], period: PERIOD, overtime: [ot("2026-10-05", 180)] });
    expect(paid(r)).toBe(30_000);
    expect(r.warnings.some((w) => w.includes("sesuai bukti absensi"))).toBe(true);
  });
  it("check-out SEBELUM jam lembur yang disetujui dimulai → tidak dibayar (pulang 16.00, check-out 17.00, lembur 18.00–19.00)", () => {
    const r = computeItem({ components: [BASE], rules: { ...rules, overtimeMinMinutes: 15 }, totals: totals(), days: [day("2026-10-05", "17:00")], period: PERIOD, overtime: [ot("2026-10-05", 60, "18:00")] });
    expect(paid(r)).toBeUndefined();
    expect(r.overtime).toEqual({ approvedMinutes: 60, paidMinutes: 0, days: 0 });
    expect(r.warnings.join(" ")).toContain("tidak terbukti di absensi");
    expect(r.warnings.join(" ")).toContain("18:00–19:00");
  });
  it("check-out di tengah jendela lembur → hanya irisan yang dibayar (18.00–20.00 disetujui, check-out 19.00 → 60 menit)", () => {
    const r = computeItem({ components: [BASE], rules, totals: totals(), days: [day("2026-10-05", "19:00")], period: PERIOD, overtime: [ot("2026-10-05", 120, "18:00")] });
    expect(paid(r)).toBe(20_000);
  });
  it("jendela yang dimulai sebelum jam pulang: waktu sebelum jam pulang bukan lembur (15.00–17.00, check-out 17.00 → 60 menit)", () => {
    const r = computeItem({ components: [BASE], rules, totals: totals(), days: [day("2026-10-05", "17:00")], period: PERIOD, overtime: [ot("2026-10-05", 120, "15:00")] });
    expect(paid(r)).toBe(20_000);
  });
  it("check-in baru setelah jam kerja berakhir: bukti tidak melebihi waktu hadir (check-in 17.30, check-out 19.00, lembur 17.00–19.00 → 90 menit)", () => {
    const r = computeItem({ components: [BASE], rules, totals: totals(), days: [day("2026-10-05", "19:00", "17:30")], period: PERIOD, overtime: [ot("2026-10-05", 120, "17:00")] });
    expect(paid(r)).toBe(30_000);
  });
  it("lembur disetujui tetapi tanpa check-out → tidak dibayar dengan alasan jelas", () => {
    const r = computeItem({ components: [BASE], rules, totals: totals(), days: [day("2026-10-05", null)], period: PERIOD, overtime: [ot("2026-10-05", 120)] });
    expect(paid(r)).toBeUndefined();
    expect(r.warnings.some((w) => w.includes("belum ada check-out"))).toBe(true);
  });
  it("batas maksimal per hari berlaku walau disetujui lebih", () => {
    const r = computeItem({ components: [BASE], rules: { ...rules, overtimeMaxMinutesPerDay: 120 }, totals: totals(), days: [day("2026-10-05", "22:40")], period: PERIOD, overtime: [ot("2026-10-05", 300)] });
    expect(paid(r)).toBe(40_000);
  });
  it("verifikasi absensi dimatikan → dibayar sesuai yang disetujui (jam mulai tidak dinilai)", () => {
    const r = computeItem({ components: [BASE], rules: { ...rules, overtimeRequireAttendance: false }, totals: totals(), days: [day("2026-10-05", "17:00")], period: PERIOD, overtime: [ot("2026-10-05", 120, "18:00")] });
    expect(paid(r)).toBe(40_000);
  });
  it("hari non-kerja (libur): bukti = irisan jendela lembur dengan kehadiran (09.00–13.00 disetujui, hadir 09.00–14.00 → 240)", () => {
    const hol = makeDay({ date: "2026-10-10", scheduled: false, status: "HADIR", checkInAt: T("2026-10-10", "09:00"), checkOutAt: T("2026-10-10", "14:00"), workedMinutes: 300 });
    const r = computeItem({ components: [BASE], rules, totals: totals(), days: [hol], period: PERIOD, overtime: [ot("2026-10-10", 240, "09:00")] });
    expect(paid(r)).toBe(80_000);
  });
  it("hari libur: jendela lembur di luar jam hadir tidak terbukti", () => {
    const hol = makeDay({ date: "2026-10-10", scheduled: false, status: "HADIR", checkInAt: T("2026-10-10", "09:00"), checkOutAt: T("2026-10-10", "11:00"), workedMinutes: 120 });
    const r = computeItem({ components: [BASE], rules, totals: totals(), days: [hol], period: PERIOD, overtime: [ot("2026-10-10", 120, "13:00")] });
    expect(paid(r)).toBeUndefined();
  });
  it("tanpa pengajuan disetujui → tidak ada baris lembur walau ada menit setelah jam pulang (tidak seperti AUTO)", () => {
    const r = computeItem({ components: [BASE], rules, totals: totals(), days: [day("2026-10-05", "21:00")], period: PERIOD, overtime: [] });
    expect(paid(r)).toBeUndefined();
  });
  it("mode MANUAL dengan pengajuan disetujui → tidak dihitung, tetapi ada peringatan", () => {
    const r = computeItem({ components: [BASE], rules: { ...RULES, overtimeRatePerHour: 20_000 }, totals: totals(), days: [day("2026-10-05", "18:00")], period: PERIOD, overtime: [ot("2026-10-05", 120)] });
    expect(paid(r)).toBeUndefined();
    expect(r.warnings.some((w) => w.includes("lembur disetujui"))).toBe(true);
  });
  it("tarif belum diisi → peringatan, tidak ada baris", () => {
    const r = computeItem({ components: [BASE], rules: { ...rules, overtimeRatePerHour: 0 }, totals: totals(), days: [day("2026-10-05", "18:00")], period: PERIOD, overtime: [ot("2026-10-05", 120)] });
    expect(paid(r)).toBeUndefined();
    expect(r.warnings.some((w) => w.includes("tarif lembur"))).toBe(true);
  });
  it("lembur masuk ke penghasilan kena pajak", () => {
    const cfg = defaultStatutoryConfig(); cfg.pph21.enabled = true; cfg.pph21.employerInsuranceInGross = false;
    const r = computeItem({
      components: [comp({ amount: 5_000_000 })], rules, totals: totals(), days: [day("2026-10-05", "22:00")], period: PERIOD, overtime: [ot("2026-10-05", 240)],
      statutory: { config: cfg, employee: { taxStatus: "TK0", hasNpwp: true, healthEnrolled: false, employmentEnrolled: false }, taxMonth: 10, finalPeriod: false, priorMonthsExpected: 0, ytd: null },
    });
    expect(r.statutory!.pph21!.gross).toBe(5_000_000 + 80_000);
  });
});

describe("overtimeEvidenceMinutes", () => {
  const TZ = "Asia/Jakarta";
  const T = (date: string, hhmm: string) => zonedInstant(date, hhmm, TZ).toISOString();
  const night = (out: string | null, outDate = "2026-10-06") => makeDay({
    date: "2026-10-05", endsNextDay: true, shiftStartAt: T("2026-10-05", "22:00"), shiftEndAt: T("2026-10-06", "06:00"),
    checkInAt: T("2026-10-05", "21:55"), checkOutAt: out ? T(outDate, out) : null,
  });
  it("tanpa check-in atau check-out → 0", () => {
    expect(overtimeEvidenceMinutes(makeDay({ date: "2026-10-05" }), { date: "2026-10-05", startTime: "16:00", approvedMinutes: 60 })).toBe(0);
    expect(overtimeEvidenceMinutes(undefined, { date: "2026-10-05", startTime: "16:00", approvedMinutes: 60 })).toBe(0);
  });
  it("shift malam: jam mulai 06.00 berarti dini hari keesokan harinya (shift 22.00–06.00, check-out 07.30 → 90 menit)", () => {
    expect(overtimeEvidenceMinutes(night("07:30"), { date: "2026-10-05", startTime: "06:00", approvedMinutes: 120 })).toBe(90);
  });
  it("shift malam: check-out sebelum jam pulang → 0", () => {
    expect(overtimeEvidenceMinutes(night("05:50"), { date: "2026-10-05", startTime: "06:00", approvedMinutes: 60 })).toBe(0);
  });
  it("shift malam: jam mulai setelah jam masuk (23.00) tetap pada tanggal shift, hanya bagian setelah jam pulang yang dihitung", () => {
    // jendela 23.00–03.00 seluruhnya sebelum jam pulang 06.00 → bukan lembur
    expect(overtimeEvidenceMinutes(night("07:00"), { date: "2026-10-05", startTime: "23:00", approvedMinutes: 240 })).toBe(0);
  });
});

describe("computeItem — BPJS & PPh 21 otomatis", () => {
  const cfg = (over: (c: StatutoryConfig) => void = () => undefined): StatutoryConfig => {
    const c = defaultStatutoryConfig(); c.bpjs.enabled = true; c.pph21.enabled = true; over(c); return c;
  };
  const sctx = (config: StatutoryConfig | null, over: Partial<NonNullable<Parameters<typeof computeItem>[0]["statutory"]>> = {}) => ({
    config, employee: { taxStatus: "TK0" as const, hasNpwp: true, healthEnrolled: true, employmentEnrolled: true }, taxMonth: 10, finalPeriod: false, priorMonthsExpected: 0, ytd: null, ...over,
  });
  const allowance = comp({ category: "TRANSPORT_ALLOWANCE", name: "Transport", amount: 500_000 });

  it("gaji pokok 5 juta + transport 500 rb: BPJS dari gaji pokok saja; PPh dari bruto + premi perusahaan; gaji bersih benar", () => {
    const r = computeItem({ components: [BASE, allowance], rules: RULES, totals: totals(), days: [], period: PERIOD, statutory: sctx(cfg()) });
    expect(line(r, (l) => l.name.startsWith("BPJS Kesehatan"))!.amount).toBe(50_000);
    expect(line(r, (l) => l.name.startsWith("BPJS JHT"))!.amount).toBe(100_000);
    expect(line(r, (l) => l.name.startsWith("BPJS JP"))!.amount).toBe(50_000);
    // bruto = 5.500.000 + premi (200.000 + 12.000 + 15.000) = 5.727.000 → kategori A 0,5% = 28.635
    const tax = line(r, (l) => l.category === "TAX")!;
    expect(tax.amount).toBe(28_635);
    expect(tax.source).toBe("RULE_STATUTORY");
    expect(r.totalEarnings).toBe(5_500_000);
    expect(r.totalDeductions).toBe(200_000 + 28_635);
    expect(r.netPay).toBe(5_500_000 - 228_635);
    expect(r.statutory!.bpjs!.employerTotal).toBe(512_000);
  });
  it("konfigurasi null (nonaktif) → tidak ada baris statutori", () => {
    const r = computeItem({ components: [BASE], rules: RULES, totals: totals(), days: [], period: PERIOD, statutory: sctx(null) });
    expect(r.lines.some((l) => l.source === "RULE_STATUTORY")).toBe(false);
    expect(r.statutory).toBeNull();
  });
  it("komponen BPJS manual menang: BPJS otomatis dilewati, PPh tetap otomatis (tanpa premi perusahaan di bruto)", () => {
    const manual = comp({ kind: "DEDUCTION", category: "BPJS", name: "BPJS manual", calc: "PERCENT_OF_BASE", percentBp: 100 });
    const r = computeItem({ components: [BASE, manual], rules: RULES, totals: totals(), days: [], period: PERIOD, statutory: sctx(cfg()) });
    expect(r.lines.filter((l) => l.category === "BPJS")).toHaveLength(1);
    expect(r.lines.find((l) => l.category === "BPJS")!.source).toBe("COMPONENT");
    expect(r.statutory!.bpjs).toBeNull();
    expect(r.warnings.some((w) => w.includes("BPJS manual"))).toBe(true);
    expect(r.statutory!.pph21!.gross).toBe(5_000_000);
  });
  it("komponen Pajak manual menang atas PPh otomatis", () => {
    const manual = comp({ kind: "DEDUCTION", category: "TAX", name: "PPh manual", amount: 75_000 });
    const r = computeItem({ components: [BASE, manual], rules: RULES, totals: totals(), days: [], period: PERIOD, statutory: sctx(cfg()) });
    expect(r.lines.filter((l) => l.category === "TAX")).toHaveLength(1);
    expect(r.lines.find((l) => l.category === "TAX")!.amount).toBe(75_000);
    expect(r.statutory!.pph21).toBeNull();
  });
  it("potongan keterlambatan/absensi mengurangi dasar PPh tetapi TIDAK dasar upah BPJS", () => {
    const c = cfg((x) => { x.bpjs.enabled = false; });
    const r = computeItem({
      components: [comp({ amount: 10_000_000 })], rules: { ...RULES, lateMode: "PER_OCCURRENCE", lateAmount: 100_000 }, totals: totals({ lateCount: 1, lateMinutes: 20 }), days: [], period: PERIOD, statutory: sctx(c),
    });
    expect(r.statutory!.pph21!.gross).toBe(9_900_000);
    expect(r.statutory!.pph21!.amount).toBe(198_000); // A: ≤ 10.050.000 → 2%
    const c2 = cfg((x) => { x.pph21.enabled = false; });
    const r2 = computeItem({
      components: [comp({ amount: 10_000_000 })], rules: { ...RULES, lateMode: "PER_OCCURRENCE", lateAmount: 100_000 }, totals: totals({ lateCount: 1, lateMinutes: 20 }), days: [], period: PERIOD, statutory: sctx(c2),
    });
    expect(r2.statutory!.bpjs!.wage).toBe(10_000_000);
  });
  it("komponen bertanda taxable=false & inBpjsBase eksplisit dihormati", () => {
    const nonTax = comp({ category: "OTHER_EARNING", name: "Tunjangan non-pajak", amount: 1_000_000, taxable: false });
    const fixedAllowance = comp({ category: "TRANSPORT_ALLOWANCE", name: "Tunjangan tetap", amount: 500_000, inBpjsBase: true });
    const r = computeItem({ components: [BASE, nonTax, fixedAllowance], rules: RULES, totals: totals(), days: [], period: PERIOD, statutory: sctx(cfg((c) => { c.pph21.employerInsuranceInGross = false; })) });
    expect(r.statutory!.bpjs!.wage).toBe(5_500_000);
    expect(r.statutory!.pph21!.gross).toBe(5_500_000); // 5.000.000 + 500.000 (tanpa 1.000.000 non-pajak)
  });
  it("masa pajak terakhir memakai YTD", () => {
    const c = cfg((x) => { x.bpjs.enabled = false; });
    const r = computeItem({
      components: [comp({ amount: 10_000_000 })], rules: RULES, totals: totals(), days: [], period: { start: "2026-12-01", end: "2026-12-31" },
      statutory: sctx(c, { taxMonth: 12, finalPeriod: true, priorMonthsExpected: 11, ytd: { months: 11, gross: 110_000_000, withheld: 2_200_000, jhtJpEmployee: 0 } }),
    });
    expect(r.lines.find((l) => l.category === "TAX")!.amount).toBe(800_000);
  });
  it("gaji bersih negatif tetap diperingatkan setelah baris statutori", () => {
    const r = computeItem({ components: [comp({ amount: 100_000 })], rules: { ...RULES, lateMode: "PER_OCCURRENCE", lateAmount: 500_000 }, totals: totals({ lateCount: 1 }), days: [], period: PERIOD, statutory: sctx(cfg()) });
    expect(r.netPay).toBeLessThan(0);
    expect(r.warnings.some((w) => w.includes("negatif"))).toBe(true);
  });
});
