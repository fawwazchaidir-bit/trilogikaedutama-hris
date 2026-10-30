import { describe, expect, it } from "vitest";
import { computeItem, selectComponents, totalsFromLines, type ComponentInput, type PayrollRules } from "@/lib/payroll";
import { emptyTotals, type DayResult } from "@/lib/attendance";

const PERIOD = { start: "2026-10-01", end: "2026-10-31" };

const NO_RULES: PayrollRules = {
  lateMode: "NONE", lateAmount: 0, absenceMode: "NONE", absenceAmount: 0, absenceDivisor: null,
  izinDeductsPay: true, sakitDeductsPay: false, cutiDeductsPay: false,
  overtimeMode: "MANUAL", overtimeRatePerHour: 0, overtimeMinMinutes: 60, overtimeMaxMinutesPerDay: 240,
};

let seq = 0;
function comp(over: Partial<ComponentInput>): ComponentInput {
  return {
    id: `c${++seq}`, kind: "EARNING", category: "BASE_SALARY", name: "Gaji pokok", calc: "FIXED", amount: 0, percentBp: null,
    recurrence: "RECURRING", effectiveFrom: "2026-01-01", effectiveTo: null, description: null, isActive: true, ...over,
  };
}

const totals = (over: Partial<ReturnType<typeof emptyTotals>> = {}) => ({ ...emptyTotals(), scheduledDays: 22, presentDays: 20, onTimeDays: 20, ...over });
const noDays: DayResult[] = [];

const BASE = comp({ amount: 5_000_000 });

describe("selectComponents — periode berlaku", () => {
  it("komponen berulang: irisan rentang; nonaktif diabaikan", () => {
    const all = [
      comp({ name: "a", effectiveFrom: "2026-01-01", effectiveTo: null }),
      comp({ name: "b", effectiveFrom: "2026-11-01" }),                         // mulai setelah periode
      comp({ name: "c", effectiveFrom: "2026-01-01", effectiveTo: "2026-09-30" }), // berakhir sebelum periode
      comp({ name: "d", effectiveFrom: "2026-10-31", effectiveTo: null }),      // mulai di hari terakhir
      comp({ name: "e", effectiveFrom: "2026-01-01", effectiveTo: "2026-10-01" }), // berakhir di hari pertama
      comp({ name: "f", isActive: false }),
    ];
    expect(selectComponents(all, PERIOD).map((c) => c.name)).toEqual(["a", "d", "e"]);
  });
  it("komponen sekali: hanya periode yang memuat tanggalnya", () => {
    const one = comp({ name: "Bonus", recurrence: "ONE_TIME", effectiveFrom: "2026-10-15", effectiveTo: "2026-10-15", category: "INCENTIVE" });
    expect(selectComponents([one], PERIOD)).toHaveLength(1);
    expect(selectComponents([one], { start: "2026-11-01", end: "2026-11-30" })).toHaveLength(0);
    expect(selectComponents([one], { start: "2026-09-01", end: "2026-09-30" })).toHaveLength(0);
  });
});

describe("computeItem — pendapatan & potongan dasar", () => {
  it("gaji bersih = total pendapatan − total potongan", () => {
    const r = computeItem({
      components: [
        BASE,
        comp({ category: "POSITION_ALLOWANCE", name: "Tunjangan jabatan", amount: 500_000 }),
        comp({ category: "MEAL_ALLOWANCE", name: "Uang makan", calc: "PER_PRESENT_DAY", amount: 25_000 }),
        comp({ kind: "DEDUCTION", category: "LOAN", name: "Kasbon", amount: 300_000 }),
        comp({ kind: "DEDUCTION", category: "BPJS", name: "BPJS (input admin)", calc: "PERCENT_OF_BASE", percentBp: 100, amount: 0 }),
      ],
      rules: NO_RULES, totals: totals(), days: noDays, period: PERIOD,
    });
    expect(r.baseSalary).toBe(5_000_000);
    expect(r.totalEarnings).toBe(5_000_000 + 500_000 + 20 * 25_000);
    expect(r.totalDeductions).toBe(300_000 + 50_000);
    expect(r.netPay).toBe(r.totalEarnings - r.totalDeductions);
    expect(r.netPay).toBe(5_650_000);
    const meal = r.lines.find((l) => l.name === "Uang makan")!;
    expect(meal.amount).toBe(500_000);
    expect(meal.formula).toBe("20 hari hadir × Rp 25.000");
    expect(r.lines.find((l) => l.name.startsWith("BPJS"))!.formula).toContain("1% × gaji pokok Rp 5.000.000");
  });

  it("urutan baris: pendapatan lebih dulu (gaji pokok pertama), lalu potongan", () => {
    const r = computeItem({
      components: [
        comp({ kind: "DEDUCTION", category: "LOAN", name: "Kasbon", amount: 1 }),
        comp({ category: "INCENTIVE", name: "Bonus", amount: 1 }),
        BASE,
      ],
      rules: NO_RULES, totals: totals(), days: noDays, period: PERIOD,
    });
    expect(r.lines.map((l) => l.name)).toEqual(["Gaji pokok", "Bonus", "Kasbon"]);
  });

  it("persen dibulatkan half-up sekali: 1,5% × 3.333.333 = 49.999,995 → 50.000", () => {
    const r = computeItem({
      components: [comp({ amount: 3_333_333 }), comp({ kind: "DEDUCTION", category: "TAX", name: "Pajak", calc: "PERCENT_OF_BASE", percentBp: 150, amount: 0 })],
      rules: NO_RULES, totals: totals(), days: noDays, period: PERIOD,
    });
    expect(r.lines.find((l) => l.name === "Pajak")!.amount).toBe(50_000);
  });

  it("tanpa gaji pokok → peringatan; persen dari 0 → peringatan", () => {
    const r = computeItem({
      components: [comp({ kind: "DEDUCTION", category: "BPJS", name: "BPJS", calc: "PERCENT_OF_BASE", percentBp: 100, amount: 0 })],
      rules: NO_RULES, totals: totals(), days: noDays, period: PERIOD,
    });
    expect(r.warnings.some((w) => w.includes("gaji pokok yang berlaku"))).toBe(true);
    expect(r.warnings.some((w) => w.includes("bernilai 0"))).toBe(true);
  });

  it("potongan > pendapatan → gaji bersih negatif disertai peringatan", () => {
    const r = computeItem({
      components: [comp({ amount: 100_000 }), comp({ kind: "DEDUCTION", category: "LOAN", name: "Kasbon", amount: 250_000 })],
      rules: NO_RULES, totals: totals(), days: noDays, period: PERIOD,
    });
    expect(r.netPay).toBe(-150_000);
    expect(r.warnings.some((w) => w.includes("negatif"))).toBe(true);
  });
});

describe("computeItem — aturan potongan (opsional, default nonaktif)", () => {
  it("default: tidak ada potongan keterlambatan/ketidakhadiran walau ada data", () => {
    const r = computeItem({ components: [BASE], rules: NO_RULES, totals: totals({ lateCount: 3, lateMinutes: 50, absentDays: 2 }), days: noDays, period: PERIOD });
    expect(r.lines).toHaveLength(1);
    expect(r.netPay).toBe(5_000_000);
  });

  it("keterlambatan per kali & per menit", () => {
    const t = totals({ lateCount: 3, lateMinutes: 50 });
    const perOcc = computeItem({ components: [BASE], rules: { ...NO_RULES, lateMode: "PER_OCCURRENCE", lateAmount: 10_000 }, totals: t, days: noDays, period: PERIOD });
    expect(perOcc.lines.find((l) => l.category === "LATE_DEDUCTION")).toMatchObject({ amount: 30_000, formula: "3 kali terlambat × Rp 10.000" });
    const perMin = computeItem({ components: [BASE], rules: { ...NO_RULES, lateMode: "PER_MINUTE", lateAmount: 1_000 }, totals: t, days: noDays, period: PERIOD });
    expect(perMin.lines.find((l) => l.category === "LATE_DEDUCTION")).toMatchObject({ amount: 50_000 });
  });

  it("ketidakhadiran: nominal tetap per hari; izin ikut dipotong, sakit/cuti tidak (sesuai pengaturan)", () => {
    const t = totals({ absentDays: 2, izinDays: 1, sakitDays: 3, cutiDays: 2 });
    const r = computeItem({ components: [BASE], rules: { ...NO_RULES, absenceMode: "FIXED_PER_DAY", absenceAmount: 100_000 }, totals: t, days: noDays, period: PERIOD });
    const l = r.lines.find((x) => x.category === "ABSENCE_DEDUCTION")!;
    expect(l.amount).toBe(300_000); // 2 tidak hadir + 1 izin
    expect(l.formula).toBe("3 hari (2 tidak hadir + 1 izin) × Rp 100.000");
    const all = computeItem({ components: [BASE], rules: { ...NO_RULES, absenceMode: "FIXED_PER_DAY", absenceAmount: 100_000, sakitDeductsPay: true, cutiDeductsPay: true, izinDeductsPay: false }, totals: t, days: noDays, period: PERIOD });
    expect(all.lines.find((x) => x.category === "ABSENCE_DEDUCTION")!.amount).toBe((2 + 3 + 2) * 100_000);
  });

  it("ketidakhadiran: gaji pokok ÷ pembagi, dibulatkan sekali di akhir", () => {
    const r = computeItem({
      components: [BASE], rules: { ...NO_RULES, absenceMode: "SALARY_DIVISOR", absenceDivisor: 22 },
      totals: totals({ absentDays: 2 }), days: noDays, period: PERIOD,
    });
    expect(r.lines.find((x) => x.category === "ABSENCE_DEDUCTION")!.amount).toBe(454_545); // 5.000.000 × 2 ÷ 22 = 454.545,45
  });

  it("pembagi belum diisi → tidak ada potongan, ada peringatan", () => {
    const r = computeItem({ components: [BASE], rules: { ...NO_RULES, absenceMode: "SALARY_DIVISOR", absenceDivisor: null }, totals: totals({ absentDays: 2 }), days: noDays, period: PERIOD });
    expect(r.lines.some((x) => x.category === "ABSENCE_DEDUCTION")).toBe(false);
    expect(r.warnings.some((w) => w.includes("pembagi"))).toBe(true);
  });
});

describe("computeItem — lembur", () => {
  const dayWith = (afterEndMinutes: number, scheduled = true): DayResult => ({
    date: "2026-10-05", status: "HADIR", scheduled, offReason: null, scheduleName: null, scheduleStart: "08:00", scheduleEnd: "16:00",
    checkInAt: null, checkOutAt: null, checkInTime: null, checkOutTime: null, late: false, lateMinutes: 0, workedMinutes: 0,
    missingCheckout: false, incomplete: false, afterEndMinutes, leaveType: null, leaveRequestId: null, explain: "",
  });

  it("MANUAL (default): tidak ada lembur otomatis", () => {
    const r = computeItem({ components: [BASE], rules: { ...NO_RULES, overtimeRatePerHour: 20_000 }, totals: totals(), days: [dayWith(120)], period: PERIOD });
    expect(r.lines.some((l) => l.source === "RULE_OVERTIME")).toBe(false);
  });

  it("AUTO: ambang minimal, batas per hari, tarif per jam", () => {
    const rules: PayrollRules = { ...NO_RULES, overtimeMode: "AUTO", overtimeRatePerHour: 20_000, overtimeMinMinutes: 60, overtimeMaxMinutesPerDay: 180 };
    const days = [dayWith(30), dayWith(90), dayWith(300), dayWith(120, false)]; // 30 < ambang; 90 ok; 300 → cap 180; hari non-kerja diabaikan
    const r = computeItem({ components: [BASE], rules, totals: totals(), days, period: PERIOD });
    const ot = r.lines.find((l) => l.source === "RULE_OVERTIME")!;
    expect(ot.amount).toBe(Math.round(((90 + 180) / 60) * 20_000)); // 4,5 jam × 20.000 = 90.000
    expect(ot.amount).toBe(90_000);
    expect(r.warnings.some((w) => w.includes("Lembur otomatis"))).toBe(true);
  });
});

describe("computeItem — peringatan data absensi", () => {
  it("memperingatkan hari belum dinilai dan absensi belum lengkap", () => {
    const r = computeItem({ components: [BASE], rules: NO_RULES, totals: totals({ pendingDays: 3, incompleteCount: 2 }), days: noDays, period: PERIOD });
    expect(r.warnings.some((w) => w.startsWith("3 hari kerja terjadwal belum"))).toBe(true);
    expect(r.warnings.some((w) => w.startsWith("2 absensi belum lengkap"))).toBe(true);
  });
});

describe("totalsFromLines", () => {
  it("menjumlahkan per jenis", () => {
    expect(totalsFromLines([
      { kind: "EARNING", amount: 100 }, { kind: "EARNING", amount: 50 }, { kind: "DEDUCTION", amount: 30 },
    ])).toEqual({ totalEarnings: 150, totalDeductions: 30, netPay: 120 });
  });
});
