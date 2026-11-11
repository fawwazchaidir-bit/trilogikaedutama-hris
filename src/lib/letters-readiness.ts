/**
 * Kesiapan Persuratan — tipe & penyusun laporan (murni). Pemeriksaan yang membaca database/PDF ada di `server/services/letters/readiness.ts`;
 * hasilnya dipakai tiga tempat: perintah `npm run check:config` (sebelum deployment), log saat aplikasi mulai, dan bagian "Kesiapan sistem" di Pengaturan Persuratan.
 */
export type ReadinessSeverity = "OK" | "WARN" | "ERROR";

export interface ReadinessCheck {
  key: string;
  severity: ReadinessSeverity;
  /** Judul singkat yang diperiksa. */
  title: string;
  /** Apa yang ditemukan (kalimat jelas, tanpa kode). */
  detail: string;
  /** Cara memperbaiki; kosong bila OK. */
  fix: string | null;
}
export interface ReadinessReport {
  checks: ReadinessCheck[];
  /** Tidak ada ERROR (WARN diperbolehkan). */
  ok: boolean;
  errors: number; warnings: number;
  /** Surat tugas baru dapat dibuat sekarang (modul menyala dan tidak ada ERROR). */
  canCreateAssignments: boolean;
}

export const SEVERITY_LABEL: Record<ReadinessSeverity, string> = { OK: "Siap", WARN: "Perlu perhatian", ERROR: "Menghalangi" };

export function buildReport(checks: ReadinessCheck[]): ReadinessReport {
  const errors = checks.filter((c) => c.severity === "ERROR").length;
  const warnings = checks.filter((c) => c.severity === "WARN").length;
  const flag = checks.find((c) => c.key === "flag");
  return { checks, ok: errors === 0, errors, warnings, canCreateAssignments: errors === 0 && flag?.severity === "OK" };
}

/** Kode keluar perintah `check:config`: 1 bila ada ERROR; dengan `strict` peringatan juga dianggap gagal (untuk jalur deployment yang ketat). */
export function exitCodeFor(report: ReadinessReport, strict: boolean): 0 | 1 {
  return report.errors > 0 || (strict && report.warnings > 0) ? 1 : 0;
}

/** Teks untuk terminal/log. */
export function formatReport(report: ReadinessReport): string {
  const mark: Record<ReadinessSeverity, string> = { OK: "[ OK ]", WARN: "[WARN]", ERROR: "[GAGAL]" };
  const lines = report.checks.map((c) => `${mark[c.severity]} ${c.title}: ${c.detail}${c.fix ? `\n        → ${c.fix}` : ""}`);
  lines.push("", report.ok ? `Siap${report.warnings ? ` dengan ${report.warnings} peringatan` : ""}.` : `${report.errors} masalah menghalangi${report.warnings ? `, ${report.warnings} peringatan` : ""}.`);
  return lines.join("\n");
}
