/**
 * Kebijakan wajib 2FA — SATU sumber aturan "peran mana yang diwajibkan".
 *
 * Diwajibkan (bila kebijakan perusahaan menyala): Super Admin (Direktur) dan HR (Admin/HR).
 * TIDAK diwajibkan: Karyawan — termasuk Manajer, Supervisor, Staf, dan Magang (tingkat jabatan hanyalah atribut karyawan, bukan peran akun). Fitur 2FA tetap tersedia bagi
 * semua akun: yang tidak diwajibkan boleh mengaktifkan dan mematikannya sendiri kapan saja.
 *
 * Daftar peran ditulis eksplisit (bukan "semua selain Karyawan") agar peran baru di masa depan TIDAK otomatis menjadi wajib tanpa keputusan sadar.
 */
export const TWO_FACTOR_REQUIRED_ROLES = ["SUPER_ADMIN", "HR_ADMIN"] as const;

export const isTwoFactorRequiredRole = (role: string): boolean => (TWO_FACTOR_REQUIRED_ROLES as readonly string[]).includes(role);

/** Apakah akun berperan `role` WAJIB ber-2FA saat kebijakan perusahaan (`policyOn`) menyala. */
export const twoFactorRequired = (role: string, policyOn: boolean): boolean => policyOn && isTwoFactorRequiredRole(role);

export const TWO_FACTOR_REQUIRED_LABEL = "Direktur (Super Admin) dan HR";
