/**
 * Ketersediaan penanggung jawab (tugas, checklist, milestone, item kesiapan, anggota tim) — SATU definisi dipakai penanda di layar, pengingat, dasbor risiko,
 * dan hak "pemilik". Penanggung jawab TIDAK TERSEDIA bila:
 *   · karyawannya sudah nonaktif (berhenti)                        → "EMPLOYEE_INACTIVE"
 *   · akun loginnya nonaktif (karyawan masih aktif)                → "ACCOUNT_INACTIVE"
 *   · bukan lagi anggota aktif proyek (khusus tugas & checklist)   → "NOT_MEMBER"
 * Urutan prioritas pesan: berhenti > akun nonaktif > di luar tim. Karyawan tanpa akun login TIDAK dianggap tidak tersedia (tidak ada akun yang bisa nonaktif).
 */
export type AssigneeUnavailable = "EMPLOYEE_INACTIVE" | "ACCOUNT_INACTIVE" | "NOT_MEMBER";

export function assigneeUnavailableReason(a: { activeMember: boolean; employeeActive: boolean; accountActive: boolean | null }): AssigneeUnavailable | null {
  if (!a.employeeActive) return "EMPLOYEE_INACTIVE";
  if (a.accountActive === false) return "ACCOUNT_INACTIVE";
  if (!a.activeMember) return "NOT_MEMBER";
  return null;
}

/** Label singkat penanda di layar (menempel pada nama penanggung jawab). */
export const UNAVAILABLE_LABEL: Record<AssigneeUnavailable, string> = {
  EMPLOYEE_INACTIVE: "sudah berhenti — alihkan",
  ACCOUNT_INACTIVE: "akun nonaktif — alihkan",
  NOT_MEMBER: "sudah tidak di tim — alihkan",
};
