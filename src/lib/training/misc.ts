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

/** Kata-kata pembentuk lokasi (huruf kecil, tanpa tanda baca, tanpa kata ganda, terurut): urutan kata, huruf besar/kecil, dan tanda baca tidak berpengaruh. Kosong → null. */
export function placeTokens(place: string | null | undefined): string[] | null {
  const t = (place ?? "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  return t.length === 0 ? null : [...new Set(t)].sort();
}

/**
 * Hasil membandingkan ruangan dua jadwal yang waktunya beririsan.
 *   SAME  — ruangan DAN lokasi sama: bentrok pasti.
 *   CHECK — nama ruangan sama tetapi lokasi belum cukup jelas untuk memastikan: bentrok perlu DIPERIKSA (bukan dianggap aman).
 *           NO_LOCATION = salah satu/dua-duanya tanpa lokasi; SIMILAR_LOCATION = lokasi berbeda tetapi yang satu memuat semua kata yang lain ("Hotel Aston" ⊂ "Hotel Aston Magelang").
 *   NONE  — bukan ruangan yang sama: ruangan berbeda, salah satu tanpa ruangan (jadwal itu tidak memakai ruangan), atau lokasi jelas berbeda ("Ruang Jasmine" di dua hotel).
 */
export type RoomMatch = { match: "SAME" } | { match: "CHECK"; why: "NO_LOCATION" | "SIMILAR_LOCATION" } | { match: "NONE" };
export function matchRoom(a: { room: string | null | undefined; location: string | null | undefined }, b: { room: string | null | undefined; location: string | null | undefined }): RoomMatch {
  const ra = normalizeRoom(a.room), rb = normalizeRoom(b.room);
  if (ra === null || rb === null || ra !== rb) return { match: "NONE" };
  const la = placeTokens(a.location), lb = placeTokens(b.location);
  if (la === null || lb === null) return { match: "CHECK", why: "NO_LOCATION" };
  if (la.length === lb.length && la.every((t, i) => t === lb[i])) return { match: "SAME" };
  const [small, big] = la.length <= lb.length ? [la, lb] : [lb, la];
  return small.every((t) => big.includes(t)) ? { match: "CHECK", why: "SIMILAR_LOCATION" } : { match: "NONE" };
}

export interface ScheduleConflictLike {
  kind: "ROOM" | "ROOM_CHECK" | "INSTRUCTOR";
  visible: boolean; withProjectCode: string | null; withTitle: string | null;
  /** Hanya untuk ROOM_CHECK. */
  why: "NO_LOCATION" | "SIMILAR_LOCATION" | null;
}
/** Kalimat peringatan bentrok — satu sumber untuk peringatan saat menyimpan dan untuk tampilan jadwal/kalender. Rincian proyek lawan disamarkan bila di luar akses pelaku. */
export function conflictMessage(c: ScheduleConflictLike): string {
  const who = c.visible ? `${c.withProjectCode} · "${c.withTitle}"` : "proyek lain (di luar akses Anda)";
  if (c.kind === "INSTRUCTOR") return `Instruktur / asesor yang sama dijadwalkan di ${who} pada waktu yang beririsan.`;
  if (c.kind === "ROOM") return `Ruangan yang sama (lokasi sama) dipakai ${who} pada waktu yang beririsan.`;
  return c.why === "SIMILAR_LOCATION"
    ? `Bentrok ruangan perlu diperiksa: nama ruangan sama dengan ${who} pada waktu yang beririsan dan lokasinya mirip — pastikan apakah tempatnya sama.`
    : `Bentrok ruangan perlu diperiksa: nama ruangan sama dengan ${who} pada waktu yang beririsan, tetapi lokasinya belum jelas. Isi kolom Lokasi agar pengecekannya pasti.`;
}

// ─────────────────────────── Template checklist standar ───────────────────────────

export interface TemplateItemSeed { phase: ChecklistPhase; title: string; isRequired: boolean }

/**
 * Daftar standar awal (usulan; dapat diubah Koordinator Program). Item "wajib" = syarat penutupan proyek.
 * Dibuat hanya atas tindakan eksplisit (bukan otomatis saat migrasi).
 */
export const DEFAULT_TEMPLATE_NAME = "Standar Pelatihan Trilogika";
export const DEFAULT_TEMPLATE_ITEMS: readonly TemplateItemSeed[] = [
  // Persiapan — SOP/ADK/001, 004, 007, 009. Pemeriksaan jadwal & Berita Acara dicatat sebagai butir checklist (bukan alur persetujuan terpisah).
  { phase: "PREPARATION", title: "Data proyek lengkap", isRequired: true },
  { phase: "PREPARATION", title: "Tim proyek ditetapkan", isRequired: true },
  { phase: "PREPARATION", title: "Arahan program & validasi anggaran (Direktur / Manajer Operasional & Keuangan)", isRequired: true },
  { phase: "PREPARATION", title: "Silabus, RPP, dan bahan ajar tersedia (Supervisor Adm. & Kurikulum)", isRequired: true },
  { phase: "PREPARATION", title: "Narasumber / asesor / instruktur dikonfirmasi (Supervisor Adm. & Kurikulum)", isRequired: true },
  { phase: "PREPARATION", title: "Draf jadwal disusun (Staf Adm. & Kurikulum)", isRequired: true },
  { phase: "PREPARATION", title: "Platform daring / ruangan diverifikasi (Supervisor IT / Supervisor Adm. & Kurikulum)", isRequired: false },
  { phase: "PREPARATION", title: "Jadwal diperiksa bebas bentrok sumber daya (Manajer Operasional & Keuangan)", isRequired: true },
  { phase: "PREPARATION", title: "Berita Acara Persetujuan Jadwal ditandatangani (Direktur)", isRequired: true },
  { phase: "PREPARATION", title: "Jadwal Induk diterbitkan dan diserahkan ke Manajer Marketing & Relations (Supervisor Adm. & Kurikulum)", isRequired: true },
  { phase: "PREPARATION", title: "Halaman program disetujui dan terbit paling lambat H-30 (Supervisor / Staf Adm. & Kurikulum)", isRequired: false },
  { phase: "PREPARATION", title: "Informasi dan berkas peserta diperiksa (Staf Administrasi Umum)", isRequired: true },
  { phase: "EXECUTION", title: "Kehadiran peserta dicatat sesuai proses yang berlaku", isRequired: true },
  { phase: "EXECUTION", title: "Kesiapan kelas diperiksa sesuai checklist moda (Fasilitator Kelas)", isRequired: false },
  { phase: "EXECUTION", title: "Kegiatan berlangsung sesuai jadwal", isRequired: false },
  { phase: "EXECUTION", title: "Dokumentasi kegiatan tersedia", isRequired: false },
  { phase: "EXECUTION", title: "Presensi dan data nilai diserahkan (Instruktur / Fasilitator)", isRequired: true },
  { phase: "CLOSING", title: "Dokumen proyek dilengkapi", isRequired: true },
  { phase: "CLOSING", title: "Daftar kelulusan divalidasi (Supervisor Adm. & Kurikulum)", isRequired: false },
  { phase: "CLOSING", title: "Sertifikat diperiksa dua lapis dan dikirim (Staf Adm. & Supervisor)", isRequired: false },
  { phase: "CLOSING", title: "Laporan kegiatan disusun", isRequired: true },
  { phase: "CLOSING", title: "Hasil evaluasi dikumpulkan", isRequired: false },
  { phase: "CLOSING", title: "Tindak lanjut proyek dicatat", isRequired: false },
];
