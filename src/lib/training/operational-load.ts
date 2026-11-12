/**
 * Penanda tugas operasional pada peta beban tim — logika MURNI.
 *
 * Beban JAM STANDAR (estimasi dari template + penyesuaian, minggu ini) dan jumlah TUGAS operasional (seluruh tugas terbuka saat ini) SENGAJA tidak dijumlahkan:
 * satu pekerjaan (mis. "Susun modul") bisa sudah terwakili jam standar, sehingga menambahkannya lagi menciptakan hitung ganda baru. Keduanya ditampilkan
 * berdampingan dengan periode yang tertulis jelas, dan satu penanda sederhana membantu PIC/atasan memeriksa.
 *
 * Definisi (satu tempat, dipakai peta beban & dasbor):
 *  - Tugas TERBUKA     = belum Selesai/Dibatalkan, TERMASUK yang menunggu pemeriksaan.
 *  - TERLAMBAT         = bagian dari terbuka: tenggat < hari ini (WIB).
 *  - MENUNGGU PEMERIKSAAN = bagian dari terbuka, ditampilkan terpisah agar tidak dianggap masih menunggu pekerjaan pelaksana.
 *  - Hanya tugas "hidup" (lihat `liveTaskWhere`): tindak lanjut pada proyek Selesai dihitung; tugas terkunci pada proyek Selesai/Dibatalkan tidak.
 */
import { isTaskOverdue } from "./indicators";
import { isOpenTask, type TaskStatus } from "./types";
import type { LoadBand } from "./indicators/engine";

export interface OperationalCounts { open: number; overdue: number; inReview: number }
export interface OperationalThresholds { openMin: number; overdueMin: number }
export interface OperationalMarker { needsCheck: boolean; reason: string | null }

/** Hitung dari daftar tugas satu orang (hanya yang terbuka yang dihitung). */
export function countOperational(tasks: readonly { status: TaskStatus; dueDate: string | null }[], today: string): OperationalCounts {
  const open = tasks.filter((t) => isOpenTask(t.status));
  return { open: open.length, overdue: open.filter((t) => isTaskOverdue(t, today)).length, inReview: open.filter((t) => t.status === "IN_REVIEW").length };
}

/**
 * "Perlu dicek": beban jam standar minggu ini masih "Ada ruang" tetapi ada banyak tugas terbuka atau ada yang terlambat. Hanya meminta pemeriksaan;
 * tidak memengaruhi status program, eskalasi, maupun penilaian staf.
 */
export function operationalMarker(band: LoadBand, c: OperationalCounts, th: OperationalThresholds): OperationalMarker {
  if (band !== "ROOMY") return { needsCheck: false, reason: null };
  const reasons: string[] = [];
  if (c.open >= th.openMin) reasons.push(`${c.open} tugas terbuka (batas ${th.openMin})`);
  if (c.overdue >= th.overdueMin) reasons.push(`${c.overdue} tugas terlambat (batas ${th.overdueMin})`);
  return reasons.length ? { needsCheck: true, reason: `Beban jam standar minggu ini masih longgar, tetapi ada ${reasons.join(" dan ")}.` } : { needsCheck: false, reason: null };
}
