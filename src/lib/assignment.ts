/** Aturan Surat Tugas & Uang Harian (murni, tanpa database). */
import { diffDays } from "./time";

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"] as const;

/** Kode jenis dokumen pada nomor surat. */
export const LETTER_CODE = { ASSIGNMENT: "ST", RECEIPT: "BPUH" } as const;

/** "2026-11-01", 3, "ST" → "003/ST/XI/2026" (nomor urut per tahun, bulan Romawi, tahun terbit). */
export function formatLetterNumber(seqNo: number, code: string, issueDate: string): string {
  const [y, m] = issueDate.split("-");
  return `${String(seqNo).padStart(3, "0")}/${code}/${ROMAN[Number(m) - 1] ?? m}/${y}`;
}

/** Lama perjalanan (hari kalender, termasuk hari pertama & terakhir). */
export function tripDays(startDate: string, endDate: string): number {
  return diffDays(endDate, startDate) + 1;
}

/**
 * Batas nilai penerimaan uang yang lazimnya memerlukan bea meterai (Rp 10.000) pada dokumen bukti penerimaan: di atas Rp 5.000.000.
 * Hanya penanda di dokumen; ketentuan perpajakan harus diverifikasi sendiri (lihat docs/KEPUTUSAN-BISNIS.md).
 */
export const MATERAI_THRESHOLD = 5_000_000;
export const needsMaterai = (total: number): boolean => total > MATERAI_THRESHOLD;
