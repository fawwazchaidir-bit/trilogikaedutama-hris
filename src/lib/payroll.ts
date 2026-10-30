/**
 * Mesin perhitungan gaji — FUNGSI MURNI. Input: komponen gaji karyawan, aturan penggajian, rekap absensi periode.
 * Output: rincian baris (pendapatan/potongan) lengkap dengan RUMUS TERTULIS agar dapat diperiksa sebelum disetujui.
 *
 *   Gaji bersih = total pendapatan − total potongan.
 *
 * Prinsip:
 *  - Seluruh nominal bilangan bulat Rupiah; pembagian memakai satu aturan pembulatan (half-up, di akhir).
 *  - TIDAK ada tarif baku (BPJS, pajak, lembur, potongan). Semua berasal dari komponen/aturan yang dikonfigurasi admin.
 *  - Aturan potongan & lembur otomatis default-nya NONAKTIF.
 */
import { formatRupiah, roundDivHalfUp } from "./money";
import { formatDuration } from "./format";
import type { DayResult, RecapTotals } from "./attendance";

export type ComponentKind = "EARNING" | "DEDUCTION";
export type ComponentCategory =
  | "BASE_SALARY" | "POSITION_ALLOWANCE" | "TRANSPORT_ALLOWANCE" | "MEAL_ALLOWANCE" | "INCENTIVE" | "OVERTIME" | "OTHER_EARNING"
  | "LATE_DEDUCTION" | "ABSENCE_DEDUCTION" | "LOAN" | "BPJS" | "TAX" | "OTHER_DEDUCTION";
export type ComponentCalc = "FIXED" | "PER_PRESENT_DAY" | "PERCENT_OF_BASE";
export type ComponentRecurrence = "RECURRING" | "ONE_TIME";
export type LineSource = "COMPONENT" | "RULE_LATE" | "RULE_ABSENCE" | "RULE_OVERTIME" | "ADJUSTMENT";

export const EARNING_CATEGORIES: ComponentCategory[] = [
  "BASE_SALARY", "POSITION_ALLOWANCE", "TRANSPORT_ALLOWANCE", "MEAL_ALLOWANCE", "INCENTIVE", "OVERTIME", "OTHER_EARNING",
];
export const DEDUCTION_CATEGORIES: ComponentCategory[] = ["LATE_DEDUCTION", "ABSENCE_DEDUCTION", "LOAN", "BPJS", "TAX", "OTHER_DEDUCTION"];

export const CATEGORY_LABEL: Record<ComponentCategory, string> = {
  BASE_SALARY: "Gaji pokok",
  POSITION_ALLOWANCE: "Tunjangan jabatan",
  TRANSPORT_ALLOWANCE: "Tunjangan transportasi",
  MEAL_ALLOWANCE: "Tunjangan makan",
  INCENTIVE: "Insentif / bonus",
  OVERTIME: "Lembur",
  OTHER_EARNING: "Pendapatan lainnya",
  LATE_DEDUCTION: "Potongan keterlambatan",
  ABSENCE_DEDUCTION: "Potongan ketidakhadiran",
  LOAN: "Kasbon / pinjaman",
  BPJS: "BPJS",
  TAX: "Pajak",
  OTHER_DEDUCTION: "Potongan lainnya",
};

export const CALC_LABEL: Record<ComponentCalc, string> = {
  FIXED: "Nominal tetap per periode",
  PER_PRESENT_DAY: "Nominal × jumlah hari hadir",
  PERCENT_OF_BASE: "Persen dari gaji pokok",
};

export interface PayrollRules {
  lateMode: "NONE" | "PER_OCCURRENCE" | "PER_MINUTE";
  lateAmount: number;
  absenceMode: "NONE" | "FIXED_PER_DAY" | "SALARY_DIVISOR";
  absenceAmount: number;
  absenceDivisor: number | null;
  izinDeductsPay: boolean;
  sakitDeductsPay: boolean;
  cutiDeductsPay: boolean;
  overtimeMode: "MANUAL" | "AUTO";
  overtimeRatePerHour: number;
  overtimeMinMinutes: number;
  overtimeMaxMinutesPerDay: number;
}

export interface ComponentInput {
  id: string;
  kind: ComponentKind;
  category: ComponentCategory;
  name: string;
  calc: ComponentCalc;
  amount: number;
  percentBp: number | null;
  recurrence: ComponentRecurrence;
  effectiveFrom: string;
  effectiveTo: string | null;
  description: string | null;
  isActive: boolean;
}

export interface LineDraft {
  kind: ComponentKind;
  category: ComponentCategory;
  name: string;
  source: LineSource;
  amount: number;
  formula: string | null;
  reason: string | null;
  componentId: string | null;
}

export interface ItemComputation {
  baseSalary: number;
  lines: LineDraft[];
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
  warnings: string[];
}

const rp = (n: number) => formatRupiah(n, "PLAIN");

/** Komponen yang berlaku untuk periode [start, end]. RECURRING: rentang beririsan. ONE_TIME: tanggalnya jatuh di periode. */
export function selectComponents(all: ComponentInput[], period: { start: string; end: string }): ComponentInput[] {
  return all.filter((c) => {
    if (!c.isActive) return false;
    if (c.recurrence === "ONE_TIME") return c.effectiveFrom >= period.start && c.effectiveFrom <= period.end;
    return c.effectiveFrom <= period.end && (c.effectiveTo === null || c.effectiveTo >= period.start);
  });
}

function mulDiv(a: number, b: number, d: number): number {
  return Number(roundDivHalfUp(BigInt(a) * BigInt(b), BigInt(d)));
}

export function percentLabel(bp: number): string {
  return `${(bp / 100).toString().replace(".", ",")}%`;
}

const CATEGORY_ORDER = new Map<ComponentCategory, number>([...EARNING_CATEGORIES, ...DEDUCTION_CATEGORIES].map((c, i) => [c, i]));

export function computeItem(args: {
  components: ComponentInput[];
  rules: PayrollRules;
  totals: RecapTotals;
  days: DayResult[];
  period: { start: string; end: string };
}): ItemComputation {
  const { rules, totals, days } = args;
  const warnings: string[] = [];
  const applicable = selectComponents(args.components, args.period)
    .sort((a, b) => (CATEGORY_ORDER.get(a.category)! - CATEGORY_ORDER.get(b.category)!) || a.name.localeCompare(b.name, "id"));

  // 1. Gaji pokok (dasar rumus lain)
  const baseComps = applicable.filter((c) => c.category === "BASE_SALARY" && c.kind === "EARNING");
  let baseSalary = 0;
  for (const c of baseComps) {
    if (c.calc === "FIXED") baseSalary += c.amount;
    else if (c.calc === "PER_PRESENT_DAY") baseSalary += c.amount * totals.presentDays;
  }
  if (baseComps.length === 0) warnings.push("Tidak ada komponen gaji pokok yang berlaku pada periode ini.");

  const lines: LineDraft[] = [];

  for (const c of applicable) {
    let amount = 0;
    let formula: string;
    switch (c.calc) {
      case "FIXED":
        amount = c.amount;
        formula = c.recurrence === "ONE_TIME" ? "Nominal sekali pada periode ini" : "Nominal tetap per periode";
        break;
      case "PER_PRESENT_DAY":
        amount = c.amount * totals.presentDays;
        formula = `${totals.presentDays} hari hadir × ${rp(c.amount)}`;
        break;
      case "PERCENT_OF_BASE": {
        const bp = c.percentBp ?? 0;
        amount = mulDiv(baseSalary, bp, 10_000);
        formula = `${percentLabel(bp)} × gaji pokok ${rp(baseSalary)}`;
        if (baseSalary === 0) warnings.push(`Komponen "${c.name}" berbasis persen gaji pokok, tetapi gaji pokok bernilai 0.`);
        break;
      }
    }
    lines.push({
      kind: c.kind, category: c.category, name: c.name, source: "COMPONENT", amount, formula,
      reason: c.description, componentId: c.id,
    });
  }

  // 2. Lembur otomatis (opsional; default MANUAL)
  if (rules.overtimeMode === "AUTO" && rules.overtimeRatePerHour > 0) {
    let minutes = 0;
    for (const d of days) {
      if (!d.scheduled || d.afterEndMinutes < rules.overtimeMinMinutes || d.afterEndMinutes <= 0) continue;
      minutes += Math.min(d.afterEndMinutes, rules.overtimeMaxMinutesPerDay);
    }
    if (minutes > 0) {
      lines.push({
        kind: "EARNING", category: "OVERTIME", name: "Lembur (otomatis dari absensi)", source: "RULE_OVERTIME",
        amount: mulDiv(rules.overtimeRatePerHour, minutes, 60),
        formula: `${formatDuration(minutes)} × ${rp(rules.overtimeRatePerHour)}/jam (min. ${rules.overtimeMinMinutes} mnt/hari, maks. ${rules.overtimeMaxMinutesPerDay} mnt/hari)`,
        reason: null, componentId: null,
      });
    }
    warnings.push("Lembur otomatis aktif: periksa jam pulang karyawan dan pastikan lembur memang disetujui.");
  }

  // 3. Potongan keterlambatan
  if (rules.lateMode !== "NONE" && rules.lateAmount > 0 && totals.lateCount > 0) {
    const perMinute = rules.lateMode === "PER_MINUTE";
    const qty = perMinute ? totals.lateMinutes : totals.lateCount;
    lines.push({
      kind: "DEDUCTION", category: "LATE_DEDUCTION", name: "Potongan keterlambatan", source: "RULE_LATE",
      amount: qty * rules.lateAmount,
      formula: perMinute
        ? `${totals.lateMinutes} menit terlambat × ${rp(rules.lateAmount)}`
        : `${totals.lateCount} kali terlambat × ${rp(rules.lateAmount)}`,
      reason: null, componentId: null,
    });
  }

  // 4. Potongan ketidakhadiran (+ izin/sakit/cuti bila diatur memengaruhi gaji)
  if (rules.absenceMode !== "NONE") {
    const parts: string[] = [];
    let days_ = totals.absentDays;
    if (totals.absentDays > 0) parts.push(`${totals.absentDays} tidak hadir`);
    if (rules.izinDeductsPay && totals.izinDays > 0) { days_ += totals.izinDays; parts.push(`${totals.izinDays} izin`); }
    if (rules.sakitDeductsPay && totals.sakitDays > 0) { days_ += totals.sakitDays; parts.push(`${totals.sakitDays} sakit`); }
    if (rules.cutiDeductsPay && totals.cutiDays > 0) { days_ += totals.cutiDays; parts.push(`${totals.cutiDays} cuti`); }
    if (days_ > 0) {
      let amount = 0;
      let formula = "";
      if (rules.absenceMode === "FIXED_PER_DAY") {
        amount = days_ * rules.absenceAmount;
        formula = `${days_} hari (${parts.join(" + ")}) × ${rp(rules.absenceAmount)}`;
      } else if (rules.absenceDivisor && rules.absenceDivisor > 0) {
        amount = mulDiv(baseSalary, days_, rules.absenceDivisor);
        formula = `${days_} hari (${parts.join(" + ")}) × gaji pokok ${rp(baseSalary)} ÷ ${rules.absenceDivisor}`;
      } else {
        warnings.push("Potongan ketidakhadiran berbasis pembagi gaji pokok aktif, tetapi pembagi belum diisi di Pengaturan.");
      }
      if (amount > 0 || formula) {
        lines.push({
          kind: "DEDUCTION", category: "ABSENCE_DEDUCTION", name: "Potongan ketidakhadiran", source: "RULE_ABSENCE",
          amount, formula, reason: null, componentId: null,
        });
      }
    }
  }

  const sum = (kind: ComponentKind) => lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.amount, 0);
  const totalEarnings = sum("EARNING");
  const totalDeductions = sum("DEDUCTION");
  const netPay = totalEarnings - totalDeductions;
  if (netPay < 0) warnings.push(`Potongan (${rp(totalDeductions)}) melebihi pendapatan (${rp(totalEarnings)}); gaji bersih negatif — sesuaikan sebelum diajukan.`);
  if (totals.pendingDays > 0) warnings.push(`${totals.pendingDays} hari kerja terjadwal belum dapat dinilai (belum berlalu / belum absen).`);
  if (totals.incompleteCount > 0) warnings.push(`${totals.incompleteCount} absensi belum lengkap (tanpa check-out); jam kerja tidak terhitung — koreksi bila perlu.`);

  return { baseSalary, lines, totalEarnings, totalDeductions, netPay, warnings };
}

/** Hitung ulang total dari kumpulan baris (dipakai setelah penyesuaian manual). */
export function totalsFromLines(lines: { kind: ComponentKind; amount: number }[]) {
  const totalEarnings = lines.filter((l) => l.kind === "EARNING").reduce((s, l) => s + l.amount, 0);
  const totalDeductions = lines.filter((l) => l.kind === "DEDUCTION").reduce((s, l) => s + l.amount, 0);
  return { totalEarnings, totalDeductions, netPay: totalEarnings - totalDeductions };
}

/** Topeng nomor rekening: hanya 4 digit terakhir yang terlihat. */
export function maskAccount(last4: string | null): string | null {
  return last4 ? `•••• •••• ${last4}` : null;
}
