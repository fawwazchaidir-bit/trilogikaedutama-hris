/**
 * Tingkat jabatan (SOP Rev 0.5): Staf → Supervisor → Manajer; Direktur dikenali dari role Super Admin.
 * Disimpan sebagai atribut EKSPLISIT pada karyawan (bukan diturunkan dari pohon atasan: bawahan Manajer Marketing & Relations
 * tidak punya bawahan lagi, sehingga pohon saja akan salah membacanya sebagai Supervisor). Logika MURNI, dapat diuji.
 */
export type JobLevelValue = "STAFF" | "SUPERVISOR" | "MANAGER";
export const JOB_LEVELS: readonly JobLevelValue[] = ["STAFF", "SUPERVISOR", "MANAGER"];
export const JOB_LEVEL_LABEL: Record<JobLevelValue, string> = { STAFF: "Staf", SUPERVISOR: "Supervisor", MANAGER: "Manajer" };
export const JOB_LEVEL_HELP: Record<JobLevelValue, string> = {
  STAFF: "Pelaksana. Layanan mandiri; hak lain mengikuti penugasan.",
  SUPERVISOR: "Memimpin tim kecil. Meninjau pengajuan bawahan langsung (lewat hubungan atasan).",
  MANAGER: "Memimpin divisi/fungsi. Otomatis berhak sebagai Pemantau Training (hanya baca, tanpa kontak peserta). Lingkup domain mengikuti divisi.",
};

/** Peringatan lunak (tidak memblokir) atas hierarki tingkat — petunjuk bagi HR saat mengatur organisasi. */
export function hierarchyHints(args: { level: JobLevelValue; supervisor: { level: JobLevelValue; isDirector: boolean } | null }): string[] {
  const { level, supervisor } = args;
  const out: string[] = [];
  if (level === "MANAGER" && supervisor && !supervisor.isDirector) out.push("Atasan langsung seorang Manajer biasanya Direktur (atau kosong).");
  if (level === "SUPERVISOR" && supervisor && !supervisor.isDirector && supervisor.level !== "MANAGER") out.push("Atasan langsung seorang Supervisor biasanya Manajer atau Direktur.");
  if (level === "STAFF" && supervisor && supervisor.level === "STAFF" && !supervisor.isDirector) out.push("Atasan langsung seorang Staf biasanya Supervisor atau Manajer.");
  return out;
}
