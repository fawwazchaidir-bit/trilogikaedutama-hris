/**
 * USULAN level modul berdasarkan jabatan pada bagan organisasi (Struktur Organisasi LPK Trilogika Edutama, SOP Rev. 0.5).
 * Hanya petunjuk bagi Super Admin pada layar Akses Training — TIDAK PERNAH diterapkan otomatis dan tidak mengubah izin.
 * Hak akses melekat pada orang + penugasan; jabatan di HRIS hanyalah teks, jadi pergantian jabatan tidak mengubah akses.
 */
import type { TrainingLevel } from "./types";

export interface LevelSuggestion { level: TrainingLevel | null; reason: string }

const RULES: { test: RegExp; level: TrainingLevel; reason: string }[] = [
  { test: /manajer\s+operasional/i, level: "MANAGER", reason: "Mengendalikan operasional harian dan menjadi penyetuju pada SOP ADK." },
  { test: /supervisor\s+adm\w*.*kurikulum|kurikulum.*supervisor/i, level: "MANAGER", reason: "Memegang jadwal induk, materi, dan instruktur: berperan sebagai Manajer Program sehari-hari (bagan tidak memuat jabatan itu)." },
  { test: /staf\s+adm\w*.*kurikulum/i, level: "ADMIN_PROGRAM", reason: "Mengelola jadwal, materi, dan halaman program; dapat membuat proyek dan mengelola proyek yang ia ikuti." },
  { test: /manajer\s+marketing/i, level: "VIEWER", reason: "Perlu memantau status pelaksanaan (mis. in-house dari B2B) tanpa hak ubah dan tanpa melihat kontak peserta." },
];

export function suggestLevel(position: string | null | undefined): LevelSuggestion {
  const p = (position ?? "").trim();
  if (/direktur/i.test(p)) return { level: null, reason: "Direktur Utama = Super Admin: akses penuh ke seluruh proyek (melihat dan mengubah) dan mengatur akses. Tidak perlu level modul." };
  const hit = RULES.find((r) => r.test.test(p));
  return hit ? { level: hit.level, reason: hit.reason } : { level: null, reason: "Tanpa level modul. Cukup ditambahkan sebagai anggota proyek dengan peran yang sesuai (staf, PJ peserta, PJ materi, PJ dokumentasi)." };
}
