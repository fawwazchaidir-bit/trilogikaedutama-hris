/** Utilitas murni kecil: kode proyek, bentrok jadwal, template checklist standar. */
import type { ChecklistPhase } from "./types";

// ─────────────────────────── Kode proyek ───────────────────────────

/** "TRN-2026-0001". Nomor urut direset tiap tahun; lebih dari 9999 tetap valid (tidak dipotong). */
export function formatProjectCode(year: number, seq: number): string {
  return `TRN-${year}-${String(seq).padStart(4, "0")}`;
}

// ─────────────────────────── Bentrok jadwal ───────────────────────────

/** Dua rentang waktu beririsan bila saling menembus; bersentuhan di batas (selesai 10.00, mulai 10.00) BUKAN bentrok. */
export function intervalsOverlap(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** Normalisasi label ruangan untuk perbandingan (tanpa membedakan huruf besar/kecil & spasi ganda). */
export function normalizeRoom(room: string | null | undefined): string | null {
  const r = (room ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return r === "" ? null : r;
}

// ─────────────────────────── Template checklist standar ───────────────────────────

export interface TemplateItemSeed { phase: ChecklistPhase; title: string; isRequired: boolean }

/**
 * Daftar standar awal (usulan; dapat diubah Manajer Program). Item "wajib" = syarat penutupan proyek.
 * Dibuat hanya atas tindakan eksplisit (bukan otomatis saat migrasi).
 */
export const DEFAULT_TEMPLATE_NAME = "Standar Pelatihan Trilogika";
export const DEFAULT_TEMPLATE_ITEMS: readonly TemplateItemSeed[] = [
  { phase: "PREPARATION", title: "Data proyek lengkap", isRequired: true },
  { phase: "PREPARATION", title: "Tim proyek ditetapkan", isRequired: true },
  { phase: "PREPARATION", title: "Jadwal disepakati", isRequired: true },
  { phase: "PREPARATION", title: "Narasumber / asesor dikonfirmasi", isRequired: true },
  { phase: "PREPARATION", title: "Materi dan perangkat disiapkan", isRequired: false },
  { phase: "PREPARATION", title: "Informasi peserta diperiksa", isRequired: true },
  { phase: "PREPARATION", title: "Tempat / media daring disiapkan", isRequired: false },
  { phase: "EXECUTION", title: "Kehadiran peserta dicatat sesuai proses yang berlaku", isRequired: true },
  { phase: "EXECUTION", title: "Kegiatan berlangsung sesuai jadwal", isRequired: false },
  { phase: "EXECUTION", title: "Dokumentasi kegiatan tersedia", isRequired: false },
  { phase: "EXECUTION", title: "Evaluasi kegiatan disiapkan", isRequired: false },
  { phase: "CLOSING", title: "Dokumen proyek dilengkapi", isRequired: true },
  { phase: "CLOSING", title: "Laporan kegiatan disusun", isRequired: true },
  { phase: "CLOSING", title: "Hasil evaluasi dikumpulkan", isRequired: false },
  { phase: "CLOSING", title: "Tindak lanjut proyek dicatat", isRequired: false },
];
