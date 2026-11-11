/**
 * Apakah akun masih boleh dipakai masuk? Akun harus aktif; untuk akun yang tertaut ke data karyawan, karyawannya juga harus masih aktif
 * (akun mantan karyawan tidak boleh hidup lagi karena salah kelola). SUPER ADMIN DIKECUALIKAN dari syarat kedua: ia dikendalikan lewat dua langkah
 * eksplisit (nonaktifkan akun dulu, baru karyawan) dengan jaminan minimal satu Super Admin aktif — agar data yang tidak konsisten tidak mengunci pimpinan.
 */
export function accountUsable(u: { isActive: boolean; role: string; employee?: { isActive: boolean } | null }): boolean {
  if (!u.isActive) return false;
  if (u.role === "SUPER_ADMIN") return true;
  return !u.employee || u.employee.isActive;
}
