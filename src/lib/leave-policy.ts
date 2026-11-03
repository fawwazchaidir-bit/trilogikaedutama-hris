/**
 * Kebijakan cuti PER KARYAWAN (murni, tanpa database — mudah diuji).
 *
 * Tiap karyawan punya kebijakan efektif: kuota tahunan, tanggal mulai berhak, dan boleh/tidaknya saldo negatif.
 * Nilai kosong (null) pada data karyawan = ikut kebijakan bawaan lembaga (Pengaturan):
 *   - tanggal mulai berhak = tanggal mulai bekerja + masa kerja minimum (bulan)
 *   - kuota                = kuota tahunan bawaan
 *   - saldo negatif        = pengaturan bawaan
 * Nilai terisi = kebijakan KHUSUS karyawan itu (wajib beralasan; lihat service).
 *
 * Aturan kuota per tahun kalender: karyawan yang sudah berhak pada akhir tahun Y mendapat kuota penuh tahun Y, tetapi cuti baru
 * boleh DIPAKAI mulai tanggal berhaknya. Karyawan yang belum berhak sampai akhir tahun Y tidak mendapat kuota tahun Y.
 * (Pro-rata tahun pertama adalah keputusan bisnis — dapat diatur lewat penyesuaian saldo; lihat docs/KEPUTUSAN-BISNIS.md.)
 */
import { addMonths } from "./time";

export interface LeaveDefaults {
  annualQuota: number;
  allowNegative: boolean;
  /** Masa kerja minimum (bulan) sebelum berhak cuti. */
  minTenureMonths: number;
}

export interface LeaveOverrides {
  quotaDays: number | null;
  eligibleFrom: string | null;
  allowNegative: boolean | null;
  note: string | null;
}

export type PolicySource = "DEFAULT" | "CUSTOM";

export interface EffectiveLeavePolicy {
  quotaDays: number;
  /** Tanggal (YYYY-MM-DD) mulai berhak mengambil cuti tahunan. */
  eligibleFrom: string;
  allowNegative: boolean;
  source: { quota: PolicySource; eligibleFrom: PolicySource; allowNegative: PolicySource };
  /** Ada setidaknya satu nilai khusus. */
  custom: boolean;
  note: string | null;
}

export function effectiveLeavePolicy(joinDate: string, o: LeaveOverrides, d: LeaveDefaults): EffectiveLeavePolicy {
  const src = (v: unknown): PolicySource => (v === null || v === undefined ? "DEFAULT" : "CUSTOM");
  const source = { quota: src(o.quotaDays), eligibleFrom: src(o.eligibleFrom), allowNegative: src(o.allowNegative) };
  return {
    quotaDays: o.quotaDays ?? d.annualQuota,
    eligibleFrom: o.eligibleFrom ?? addMonths(joinDate, d.minTenureMonths),
    allowNegative: o.allowNegative ?? d.allowNegative,
    source,
    custom: source.quota === "CUSTOM" || source.eligibleFrom === "CUSTOM" || source.allowNegative === "CUSTOM",
    note: o.note,
  };
}

/** Sudah berhak cuti pada tanggal itu? */
export function isEntitledOn(p: Pick<EffectiveLeavePolicy, "eligibleFrom">, date: string): boolean {
  return date >= p.eligibleFrom;
}

/** Kuota yang diberikan untuk tahun kalender `year` (0 bila belum berhak sampai akhir tahun itu). */
export function quotaForYear(p: Pick<EffectiveLeavePolicy, "eligibleFrom" | "quotaDays">, year: number): number {
  return p.eligibleFrom <= `${year}-12-31` ? p.quotaDays : 0;
}

/** Ringkas untuk pesan ke pengguna. */
export function describeEligibility(p: Pick<EffectiveLeavePolicy, "eligibleFrom">, today: string): string {
  return p.eligibleFrom <= today ? "Sudah berhak cuti tahunan" : "Belum berhak cuti tahunan";
}
