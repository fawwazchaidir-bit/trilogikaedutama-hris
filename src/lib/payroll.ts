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
import { formatDateShort, formatDays, formatDuration } from "./format";
import type { DayResult, RecapTotals } from "./attendance";
import { computeStatutory, type StatutoryConfig, type StatutoryResult, type TaxStatus, type YtdInput } from "./statutory";

export type ComponentKind = "EARNING" | "DEDUCTION";
export type ComponentCategory =
  | "BASE_SALARY" | "POSITION_ALLOWANCE" | "TRANSPORT_ALLOWANCE" | "MEAL_ALLOWANCE" | "INCENTIVE" | "OVERTIME" | "OTHER_EARNING"
  | "LATE_DEDUCTION" | "ABSENCE_DEDUCTION" | "LOAN" | "BPJS" | "TAX" | "OTHER_DEDUCTION";
export type ComponentCalc = "FIXED" | "PER_PRESENT_DAY" | "PERCENT_OF_BASE";
export type ComponentRecurrence = "RECURRING" | "ONE_TIME";
export type LineSource = "COMPONENT" | "RULE_LATE" | "RULE_ABSENCE" | "RULE_OVERTIME" | "RULE_STATUTORY" | "ADJUSTMENT";

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
  /** MANUAL: tidak ada lembur otomatis · AUTO: dari jam pulang (tanpa persetujuan) · APPROVED: hanya yang disetujui lewat pengajuan. */
  overtimeMode: "MANUAL" | "AUTO" | "APPROVED";
  overtimeRatePerHour: number;
  overtimeMinMinutes: number;
  overtimeMaxMinutesPerDay: number;
  // Opsional agar snapshot aturan lama tetap terbaca (nilai bawaan = perilaku lama).
  overtimeRateMode?: "FIXED_PER_HOUR" | "SALARY_DIVISOR";
  overtimeSalaryDivisor?: number;
  /** Pengali jam lembur pertama / berikutnya (basis point; 10000 = 1×). */
  overtimeFirstHourBp?: number;
  overtimeNextHoursBp?: number;
  /** Lembur disetujui dibayar hanya sebesar menit yang terbukti di absensi. */
  overtimeRequireAttendance?: boolean;
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
  /** Pendapatan ini masuk penghasilan bruto PPh 21 (bawaan: ya). */
  taxable?: boolean;
  /** Pendapatan ini masuk dasar upah BPJS (bawaan: gaji pokok & tunjangan jabatan). */
  inBpjsBase?: boolean;
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

export interface OvertimeApproval { date: string; approvedMinutes: number }

export interface StatutoryContext {
  config: StatutoryConfig | null;
  employee: { taxStatus: TaxStatus; hasNpwp: boolean; healthEnrolled: boolean; employmentEnrolled: boolean };
  taxMonth: number;
  finalPeriod: boolean;
  priorMonthsExpected: number;
  ytd: YtdInput | null;
}

export interface ItemComputation {
  baseSalary: number;
  lines: LineDraft[];
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
  warnings: string[];
  /** Hasil BPJS/PPh 21 otomatis (null bila tidak aktif / dilewati). */
  statutory: StatutoryResult | null;
  /** Ringkasan lembur yang dihitung otomatis (menit disetujui, terbukti, dibayar). */
  overtime: { approvedMinutes: number; paidMinutes: number; days: number } | null;
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

/** Hari boleh berpecahan 0,5 (cuti setengah hari): nominal × hari, dibulatkan half-up. */
function mulDays(amount: number, days: number): number {
  return mulDiv(amount, Math.round(days * 2), 2);
}

export function percentLabel(bp: number): string {
  return `${(bp / 100).toString().replace(".", ",")}%`;
}

const multLabel = (bp: number) => `${(bp / 10_000).toString().replace(".", ",")}×`;

const CATEGORY_ORDER = new Map<ComponentCategory, number>([...EARNING_CATEGORIES, ...DEDUCTION_CATEGORIES].map((c, i) => [c, i]));

/**
 * Upah lembur dari menit per hari. Jam pertama tiap hari memakai pengali pertama, sisanya pengali berikutnya.
 * Tarif dasar per jam: nominal tetap, atau gaji pokok ÷ pembagi (mis. 173). Dibulatkan SEKALI di akhir (half-up).
 */
export function overtimePay(perDayMinutes: number[], baseSalary: number, rules: PayrollRules): number {
  const first = BigInt(rules.overtimeFirstHourBp ?? 10_000);
  const next = BigInt(rules.overtimeNextHoursBp ?? 10_000);
  let weighted = 0n;
  for (const m of perDayMinutes) weighted += BigInt(Math.min(m, 60)) * first + BigInt(Math.max(0, m - 60)) * next;
  if ((rules.overtimeRateMode ?? "FIXED_PER_HOUR") === "SALARY_DIVISOR") {
    const div = BigInt(rules.overtimeSalaryDivisor ?? 173);
    return div > 0n ? Number(roundDivHalfUp(BigInt(baseSalary) * weighted, div * 60n * 10_000n)) : 0;
  }
  return Number(roundDivHalfUp(BigInt(rules.overtimeRatePerHour) * weighted, 60n * 10_000n));
}

function overtimeRateUsable(rules: PayrollRules, baseSalary: number): boolean {
  return (rules.overtimeRateMode ?? "FIXED_PER_HOUR") === "SALARY_DIVISOR"
    ? baseSalary > 0 && (rules.overtimeSalaryDivisor ?? 173) > 0
    : rules.overtimeRatePerHour > 0;
}

function overtimeRateText(rules: PayrollRules, baseSalary: number): string {
  const first = rules.overtimeFirstHourBp ?? 10_000, next = rules.overtimeNextHoursBp ?? 10_000;
  const mult = first === 10_000 && next === 10_000 ? "" : `; pengali ${multLabel(first)} jam pertama, ${multLabel(next)} berikutnya (per hari)`;
  if ((rules.overtimeRateMode ?? "FIXED_PER_HOUR") === "SALARY_DIVISOR") {
    const div = rules.overtimeSalaryDivisor ?? 173;
    return `tarif gaji pokok ${rp(baseSalary)} ÷ ${div} = ${rp(mulDiv(baseSalary, 1, div))}/jam${mult}`;
  }
  return `tarif ${rp(rules.overtimeRatePerHour)}/jam${mult}`;
}

export function computeItem(args: {
  components: ComponentInput[];
  rules: PayrollRules;
  totals: RecapTotals;
  days: DayResult[];
  period: { start: string; end: string };
  /** Pengajuan lembur DISETUJUI pada rentang absensi (dipakai bila mode lembur = APPROVED). */
  overtime?: OvertimeApproval[];
  statutory?: StatutoryContext | null;
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
    else if (c.calc === "PER_PRESENT_DAY") baseSalary += mulDays(c.amount, totals.presentDays);
  }
  if (baseComps.length === 0) warnings.push("Tidak ada komponen gaji pokok yang berlaku pada periode ini.");

  const lines: LineDraft[] = [];
  // Dasar BPJS & penghasilan kena pajak dikumpulkan saat baris pendapatan dibuat.
  let bpjsWage = 0;
  let taxable = 0;

  for (const c of applicable) {
    let amount = 0;
    let formula: string;
    switch (c.calc) {
      case "FIXED":
        amount = c.amount;
        formula = c.recurrence === "ONE_TIME" ? "Nominal sekali pada periode ini" : "Nominal tetap per periode";
        break;
      case "PER_PRESENT_DAY":
        amount = mulDays(c.amount, totals.presentDays);
        formula = `${formatDays(totals.presentDays)} hari hadir × ${rp(c.amount)}`;
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
    if (c.kind === "EARNING") {
      if (c.taxable ?? true) taxable += amount;
      if (c.inBpjsBase ?? (c.category === "BASE_SALARY" || c.category === "POSITION_ALLOWANCE")) bpjsWage += amount;
    }
  }

  // 2. Lembur: otomatis dari jam pulang (AUTO) atau hanya yang disetujui & terbukti di absensi (APPROVED)
  let overtimeSummary: ItemComputation["overtime"] = null;
  const approvals = args.overtime ?? [];
  if (rules.overtimeMode === "AUTO" && overtimeRateUsable(rules, baseSalary)) {
    const perDay: number[] = [];
    for (const d of days) {
      if (!d.scheduled || d.afterEndMinutes < rules.overtimeMinMinutes || d.afterEndMinutes <= 0) continue;
      perDay.push(Math.min(d.afterEndMinutes, rules.overtimeMaxMinutesPerDay));
    }
    const minutes = perDay.reduce((a, m) => a + m, 0);
    if (minutes > 0) {
      lines.push({
        kind: "EARNING", category: "OVERTIME", name: "Lembur (otomatis dari absensi)", source: "RULE_OVERTIME",
        amount: overtimePay(perDay, baseSalary, rules),
        formula: `${formatDuration(minutes)}, ${overtimeRateText(rules, baseSalary)} (min. ${rules.overtimeMinMinutes} mnt/hari, maks. ${rules.overtimeMaxMinutesPerDay} mnt/hari)`,
        reason: null, componentId: null,
      });
      overtimeSummary = { approvedMinutes: minutes, paidMinutes: minutes, days: perDay.length };
    }
    warnings.push("Lembur otomatis aktif: periksa jam pulang karyawan dan pastikan lembur memang disetujui.");
  } else if (rules.overtimeMode === "APPROVED") {
    const perDay: number[] = [];
    let approvedTotal = 0;
    if (approvals.length > 0 && !overtimeRateUsable(rules, baseSalary)) {
      warnings.push("Ada lembur disetujui tetapi tarif lembur belum dapat dihitung (isi tarif per jam atau pastikan ada gaji pokok & pembagi di Pengaturan).");
    } else {
      for (const a of [...approvals].sort((x, y) => x.date.localeCompare(y.date))) {
        approvedTotal += a.approvedMinutes;
        const day = days.find((d) => d.date === a.date);
        const evidence = !day ? 0 : day.scheduled ? day.afterEndMinutes : day.workedMinutes;
        const verified = rules.overtimeRequireAttendance === false ? a.approvedMinutes : Math.min(a.approvedMinutes, evidence);
        const capped = Math.min(verified, rules.overtimeMaxMinutesPerDay);
        if (capped < rules.overtimeMinMinutes || capped <= 0) {
          warnings.push(`Lembur ${formatDateShort(a.date)} (disetujui ${formatDuration(a.approvedMinutes)}) tidak dihitung: ${evidence === 0 && rules.overtimeRequireAttendance !== false
            ? (day?.missingCheckout ? "belum ada check-out" : "tidak terbukti di absensi (check-out tidak melewati jam pulang)")
            : `hanya ${formatDuration(capped)} yang terbukti (minimal ${formatDuration(rules.overtimeMinMinutes)}/hari)`}.`);
          continue;
        }
        if (capped < a.approvedMinutes) {
          warnings.push(`Lembur ${formatDateShort(a.date)}: disetujui ${formatDuration(a.approvedMinutes)}, dibayar ${formatDuration(capped)} (${verified < a.approvedMinutes ? "sesuai bukti absensi" : `batas maksimal ${formatDuration(rules.overtimeMaxMinutesPerDay)}/hari`}).`);
        }
        perDay.push(capped);
      }
      const minutes = perDay.reduce((a, m) => a + m, 0);
      if (minutes > 0) {
        const amount = overtimePay(perDay, baseSalary, rules);
        lines.push({
          kind: "EARNING", category: "OVERTIME", name: "Lembur (disetujui)", source: "RULE_OVERTIME", amount,
          formula: `${formatDuration(minutes)} dari ${perDay.length} hari lembur disetujui, ${overtimeRateText(rules, baseSalary)}`,
          reason: null, componentId: null,
        });
        overtimeSummary = { approvedMinutes: approvedTotal, paidMinutes: minutes, days: perDay.length };
      } else if (approvedTotal > 0) {
        overtimeSummary = { approvedMinutes: approvedTotal, paidMinutes: 0, days: 0 };
      }
    }
  } else if (approvals.length > 0) {
    warnings.push(`Ada ${approvals.length} lembur disetujui, tetapi mode lembur "${rules.overtimeMode === "MANUAL" ? "Manual" : "Otomatis"}" tidak menghitungnya dari pengajuan. Ubah ke "Hanya yang disetujui" di Pengaturan atau input manual.`);
  }
  for (const l of lines) if (l.source === "RULE_OVERTIME") taxable += l.amount;

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

  // 4. Potongan ketidakhadiran (+ izin/sakit/cuti bila diatur memengaruhi gaji). Hari boleh berpecahan 0,5.
  if (rules.absenceMode !== "NONE") {
    const parts: string[] = [];
    let days_ = totals.absentDays;
    if (totals.absentDays > 0) parts.push(`${formatDays(totals.absentDays)} tidak hadir`);
    if (rules.izinDeductsPay && totals.izinDays > 0) { days_ += totals.izinDays; parts.push(`${formatDays(totals.izinDays)} izin`); }
    if (rules.sakitDeductsPay && totals.sakitDays > 0) { days_ += totals.sakitDays; parts.push(`${formatDays(totals.sakitDays)} sakit`); }
    if (rules.cutiDeductsPay && totals.cutiDays > 0) { days_ += totals.cutiDays; parts.push(`${formatDays(totals.cutiDays)} cuti`); }
    if (days_ > 0) {
      let amount = 0;
      let formula = "";
      if (rules.absenceMode === "FIXED_PER_DAY") {
        amount = mulDays(rules.absenceAmount, days_);
        formula = `${formatDays(days_)} hari (${parts.join(" + ")}) × ${rp(rules.absenceAmount)}`;
      } else if (rules.absenceDivisor && rules.absenceDivisor > 0) {
        amount = mulDiv(baseSalary, Math.round(days_ * 2), rules.absenceDivisor * 2);
        formula = `${formatDays(days_)} hari (${parts.join(" + ")}) × gaji pokok ${rp(baseSalary)} ÷ ${rules.absenceDivisor}`;
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

  // 5. BPJS & PPh 21 otomatis (aturan manual — komponen potongan berkategori BPJS/Pajak — menang atas otomatis)
  let statutoryResult: StatutoryResult | null = null;
  const sc = args.statutory;
  if (sc?.config && (sc.config.bpjs.enabled || sc.config.pph21.enabled)) {
    // Potongan absensi/keterlambatan mengurangi penghasilan yang benar-benar diterima (dasar PPh), bukan dasar upah BPJS.
    const unpaid = lines.filter((l) => l.kind === "DEDUCTION" && (l.category === "LATE_DEDUCTION" || l.category === "ABSENCE_DEDUCTION")).reduce((a, l) => a + l.amount, 0);
    statutoryResult = computeStatutory({
      config: sc.config, employee: sc.employee, bpjsWage, taxableEarnings: Math.max(0, taxable - unpaid),
      taxMonth: sc.taxMonth, finalPeriod: sc.finalPeriod, ytd: sc.ytd, priorMonthsExpected: sc.priorMonthsExpected,
      skipBpjs: applicable.some((c) => c.kind === "DEDUCTION" && c.category === "BPJS"),
      skipPph21: applicable.some((c) => c.kind === "DEDUCTION" && c.category === "TAX"),
    });
    for (const l of statutoryResult.lines) {
      lines.push({ kind: l.kind, category: l.category, name: l.name, source: "RULE_STATUTORY", amount: l.amount, formula: l.formula, reason: null, componentId: null });
    }
    warnings.push(...statutoryResult.warnings);
  }

  const sum = (kind: ComponentKind) => lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.amount, 0);
  const totalEarnings = sum("EARNING");
  const totalDeductions = sum("DEDUCTION");
  const netPay = totalEarnings - totalDeductions;
  if (netPay < 0) warnings.push(`Potongan (${rp(totalDeductions)}) melebihi pendapatan (${rp(totalEarnings)}); gaji bersih negatif — sesuaikan sebelum diajukan.`);
  if (totals.pendingDays > 0) warnings.push(`${formatDays(totals.pendingDays)} hari kerja terjadwal belum dapat dinilai (belum berlalu / belum absen).`);
  if (totals.incompleteCount > 0) warnings.push(`${totals.incompleteCount} absensi belum lengkap (tanpa check-out); jam kerja tidak terhitung — koreksi bila perlu.`);

  return { baseSalary, lines, totalEarnings, totalDeductions, netPay, warnings, statutory: statutoryResult, overtime: overtimeSummary };
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
