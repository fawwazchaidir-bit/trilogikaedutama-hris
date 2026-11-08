/**
 * Penyelesaian akhir (final settlement) — FUNGSI MURNI. Hanya menghitung yang dapat dihitung dari data tanpa tarif baku:
 *   · gaji prorata bulan terakhir per komponen nominal tetap,
 *   · uang cuti sisa (gaji pokok ÷ pembagi yang DIISI HR × sisa hari),
 *   · total pendapatan / potongan / bersih.
 * Pesangon, UPMK, UPH, THR, dan pajak SENGAJA tidak dihitung di sini: tidak ada tarif atau aturan yang ditanam; HR mengisinya sebagai baris manual
 * sesuai perjanjian/ketentuan dan hasil perhitungan yang sah. Seluruh nominal bilangan bulat Rupiah (BigInt); satu aturan pembulatan: half-up.
 */
import { formatRupiah, roundDivHalfUp } from "./money";

export type SettlementStatusValue = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "PAID" | "CANCELLED";
export type SettlementBasisValue = "WORKING_DAYS" | "CALENDAR_DAYS";
export type SettlementLineKind = "EARNING" | "DEDUCTION";
export type SettlementLineSourceValue = "SYSTEM" | "MANUAL";

export const EARNING_LINE_CATEGORIES = ["PRORATED_SALARY", "LEAVE_PAYOUT", "UNPAID_ALLOWANCE", "SEVERANCE", "SERVICE_AWARD", "ENTITLEMENT", "THR", "OTHER_EARNING"] as const;
export const DEDUCTION_LINE_CATEGORIES = ["TAX", "BPJS", "LOAN", "ASSET", "OTHER_DEDUCTION"] as const;
export const LINE_CATEGORIES = [...EARNING_LINE_CATEGORIES, ...DEDUCTION_LINE_CATEGORIES] as const;
export type SettlementLineCategoryValue = (typeof LINE_CATEGORIES)[number];

export const SETTLEMENT_STATUS_LABEL: Record<SettlementStatusValue, string> = {
  DRAFT: "Draf", PENDING_APPROVAL: "Menunggu persetujuan", APPROVED: "Disetujui", PAID: "Dibayar", CANCELLED: "Dibatalkan",
};
export const BASIS_LABEL: Record<SettlementBasisValue, string> = { WORKING_DAYS: "Hari kerja terjadwal", CALENDAR_DAYS: "Hari kalender" };
export const LINE_CATEGORY_LABEL: Record<SettlementLineCategoryValue, string> = {
  PRORATED_SALARY: "Gaji prorata", LEAVE_PAYOUT: "Uang cuti sisa", UNPAID_ALLOWANCE: "Uang harian belum dibayar", SEVERANCE: "Uang pesangon", SERVICE_AWARD: "Uang penghargaan masa kerja (UPMK)",
  ENTITLEMENT: "Uang penggantian hak (UPH) / hak lain", THR: "THR prorata", OTHER_EARNING: "Pendapatan lainnya",
  TAX: "Pajak (PPh 21)", BPJS: "BPJS", LOAN: "Kasbon / pinjaman", ASSET: "Ganti rugi aset", OTHER_DEDUCTION: "Potongan lainnya",
};
export const kindOfCategory = (c: SettlementLineCategoryValue): SettlementLineKind => ((EARNING_LINE_CATEGORIES as readonly string[]).includes(c) ? "EARNING" : "DEDUCTION");

/** Kategori yang dihitung sistem (bukan manual) — dasar peringatan "tidak dihitung sistem" di layar. */
export const NOT_COMPUTED_BY_SYSTEM = ["Uang pesangon", "UPMK", "UPH / hak lain", "THR prorata", "Pajak (PPh 21)", "BPJS", "Sisa kasbon"] as const;

export interface DraftLine {
  kind: SettlementLineKind; category: SettlementLineCategoryValue; name: string; amount: bigint; formula: string | null; source: SettlementLineSourceValue; note: string | null;
}

const rp = (n: bigint) => formatRupiah(n, "PLAIN");

/** nominal × dikerjakan ÷ total, half-up. Dikerjakan dibatasi [0, total]. */
export function prorate(amount: bigint, worked: number, total: number): bigint {
  if (!Number.isInteger(total) || total <= 0) throw new RangeError("Pembagi prorata harus bilangan bulat positif");
  const w = Math.min(Math.max(Math.round(worked), 0), total);
  return roundDivHalfUp(amount * BigInt(w), BigInt(total));
}

export interface ProrateComponent {
  id: string; name: string; category: string; calc: "FIXED" | "PER_PRESENT_DAY" | "PERCENT_OF_BASE"; amount: bigint;
  recurrence: "RECURRING" | "ONE_TIME"; effectiveFrom: string; effectiveTo: string | null;
}
export interface SuggestOutput { lines: DraftLine[]; warnings: string[] }

/**
 * Gaji prorata bulan terakhir per komponen pendapatan NOMINAL TETAP yang berlaku pada bulan itu.
 * Komponen per-hari-hadir / persen dari gaji pokok TIDAK dihitung otomatis (butuh rekap kehadiran/dasar) → peringatan, HR menambah manual.
 * Komponen yang mulai/berakhir di tengah bulan → peringatan (prorata memakai nominal penuh).
 */
export function suggestProratedLines(args: { month: { start: string; end: string }; worked: number; total: number; basisLabel: string; components: ProrateComponent[] }): SuggestOutput {
  const { month, worked, total, basisLabel } = args;
  const lines: DraftLine[] = [];
  const warnings: string[] = [];
  if (total <= 0) return { lines, warnings: [`Tidak ada ${basisLabel.toLowerCase()} pada bulan terakhir bekerja sehingga gaji prorata tidak dapat dihitung. Periksa jadwal kerja karyawan atau gunakan dasar hari kalender.`] };
  for (const c of args.components) {
    const live = c.recurrence === "RECURRING" && c.effectiveFrom <= month.end && (c.effectiveTo === null || c.effectiveTo >= month.start);
    if (!live) continue;
    if (c.calc !== "FIXED") { warnings.push(`Komponen "${c.name}" bersifat ${c.calc === "PER_PRESENT_DAY" ? "per hari hadir" : "persen dari gaji pokok"} sehingga tidak dihitung otomatis; tambahkan sebagai baris manual bila perlu.`); continue; }
    if (c.amount <= 0n) continue;
    if (c.effectiveFrom > month.start || (c.effectiveTo !== null && c.effectiveTo < month.end)) warnings.push(`Komponen "${c.name}" mulai/berakhir di tengah bulan; prorata memakai nominal penuh — periksa barisnya.`);
    const amount = prorate(c.amount, worked, total);
    if (amount <= 0n) continue;
    lines.push({ kind: "EARNING", category: "PRORATED_SALARY", name: `${c.name} (prorata)`, amount, formula: `${rp(c.amount)} × ${Math.min(Math.max(worked, 0), total)}/${total} ${basisLabel.toLowerCase()}`, source: "SYSTEM", note: null });
  }
  return { lines, warnings };
}

/** Uang cuti sisa = gaji pokok bulanan × sisa hari ÷ pembagi (diisi HR; tidak ada pembagi baku). Hari boleh berpecahan 0,5. */
export function suggestLeavePayout(args: { baseMonthly: bigint; days: number; divisor: number }): DraftLine | null {
  if (!(args.days > 0) || args.baseMonthly <= 0n) return null;
  if (!Number.isInteger(args.divisor) || args.divisor < 1 || args.divisor > 31) throw new RangeError("Pembagi uang cuti harus bilangan bulat 1–31");
  const halves = Math.round(args.days * 2);
  const amount = roundDivHalfUp(args.baseMonthly * BigInt(halves), BigInt(args.divisor) * 2n);
  if (amount <= 0n) return null;
  return { kind: "EARNING", category: "LEAVE_PAYOUT", name: "Uang cuti sisa", amount, formula: `${rp(args.baseMonthly)} × ${args.days} hari ÷ ${args.divisor}`, source: "SYSTEM", note: null };
}

export function totalsOf(lines: { kind: SettlementLineKind; amount: bigint }[]): { earnings: bigint; deductions: bigint; net: bigint } {
  let earnings = 0n, deductions = 0n;
  for (const l of lines) { if (l.kind === "EARNING") earnings += l.amount; else deductions += l.amount; }
  return { earnings, deductions, net: earnings - deductions };
}
