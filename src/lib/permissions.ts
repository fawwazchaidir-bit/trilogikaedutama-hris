/**
 * Matriks hak akses (RBAC). Satu file, dapat ditinjau & diuji.
 *
 * PENTING: UI memakai ini hanya untuk menyembunyikan tombol/menu. Penegakan sebenarnya ada di SERVICE LAYER
 * (`assertCan`) sehingga berlaku untuk setiap endpoint dan halaman server.
 *
 *   SUPER_ADMIN (Pimpinan) — semua: akun, kebijakan & aturan penggajian, persetujuan/pembatalan penggajian, laporan, audit.
 *   HR_ADMIN               — operasional HR: data karyawan, jadwal & kalender, koreksi absensi, pengajuan, rekap,
 *                            komponen gaji, menghitung & menerbitkan gaji. TIDAK: menyetujui gaji, mengubah aturan
 *                            penggajian/kebijakan, mengelola akun admin, melihat audit log.
 *   EMPLOYEE               — layanan mandiri: absensi, riwayat, pengajuan, profil, slip gaji miliknya sendiri.
 *
 * Layanan mandiri (`self:*`) berlaku untuk SIAPA PUN yang akunnya tertaut ke data karyawan (termasuk admin yang
 * juga karyawan); service selalu memakai `actor.employeeId` dari sesi — tidak pernah ID dari input pengguna.
 */

export type Role = "SUPER_ADMIN" | "HR_ADMIN" | "EMPLOYEE";

export const PERMISSIONS = [
  "dashboard:admin",
  "employee:view",
  "employee:manage",         // tambah/ubah/nonaktifkan karyawan, divisi
  "employee:export",
  "employee:import",
  "user:manage",             // semua akun (Super Admin)
  "user:manage_employee",    // hanya akun berperan Karyawan (HR)
  "schedule:manage",         // jadwal kerja, penugasan, kalender libur
  "attendance:view_all",
  "attendance:correct",
  "leave:view_all",
  "leave:review",
  "leave_balance:manage",
  "leave_policy:manage",     // kebijakan cuti PER KARYAWAN (kuota, tanggal mulai berhak, saldo negatif)
  "overtime:view_all",
  "overtime:review",
  "recap:view_all",
  "recap:export",
  "payroll:components",      // komponen gaji per karyawan
  "payroll:view",
  "payroll:prepare",         // buat periode, hitung, sesuaikan, ajukan, terbitkan
  "payroll:approve",         // setujui / kembalikan (pimpinan)
  "payroll:revoke",          // batalkan periode yang sudah disetujui/terbit (pimpinan)
  "payroll:rules",           // aturan penggajian
  "payslip:download_all",
  "audit:view",
  "settings:view",
  "settings:manage",         // profil lembaga, logo, kebijakan absensi/cuti
  "report:view",             // laporan & analisis lanjutan
  "report:payroll",          // laporan biaya SDM / penggajian / kepatuhan BPJS & PPh 21
  "location:review",         // meninjau penilaian risiko lokasi
  "user:reset_2fa",          // mengatur ulang 2FA akun lain (Super Admin)
  "document:view_all",       // melihat dokumen kepegawaian (kontrak kerja) seluruh karyawan
  "document:manage",         // unggah / arsipkan dokumen kepegawaian
  "document:decide",         // memutuskan kontrak dilanjutkan atau tidak (pimpinan)
  "assignment:view_all",     // melihat Surat Tugas & Bukti Penerimaan Uang Harian
  "assignment:manage",       // menerbitkan / membatalkan surat tugas, menerbitkan bukti penerimaan uang harian
  "assignment:revoke",       // membatalkan bukti penerimaan uang harian yang sudah terbit (pimpinan)
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  SUPER_ADMIN: new Set(PERMISSIONS),
  HR_ADMIN: new Set<Permission>([
    "dashboard:admin",
    "employee:view", "employee:manage", "employee:export", "employee:import",
    "user:manage_employee",
    "schedule:manage",
    "attendance:view_all", "attendance:correct",
    "leave:view_all", "leave:review", "leave_balance:manage", "leave_policy:manage",
    "overtime:view_all", "overtime:review",
    "recap:view_all", "recap:export",
    "payroll:components", "payroll:view", "payroll:prepare",
    "payslip:download_all",
    "settings:view",
    "report:view", "report:payroll",
    "location:review",
    "document:view_all", "document:manage",
    "assignment:view_all", "assignment:manage",
  ]),
  EMPLOYEE: new Set<Permission>([]),
};

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return ROLE_PERMISSIONS[role].has(permission);
}

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: "Super Admin / Pimpinan",
  HR_ADMIN: "Admin / HR",
  EMPLOYEE: "Karyawan",
};

/** Peran akun yang boleh dikelola oleh `role` (HR hanya akun Karyawan). */
export function manageableRoles(role: Role): Role[] {
  if (can(role, "user:manage")) return ["SUPER_ADMIN", "HR_ADMIN", "EMPLOYEE"];
  if (can(role, "user:manage_employee")) return ["EMPLOYEE"];
  return [];
}

export interface NavItem {
  href: string;
  label: string;
  /** Salah satu izin cukup. */
  anyOf?: readonly Permission[];
  /** Hanya tampil bila akun tertaut ke data karyawan (layanan mandiri). */
  selfService?: boolean;
  group: "umum" | "saya" | "sdm" | "gaji" | "training" | "sistem";
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", group: "umum" },
  { href: "/absensi-saya", label: "Absensi Saya", selfService: true, group: "saya" },
  { href: "/pengajuan-saya", label: "Pengajuan Saya", selfService: true, group: "saya" },
  { href: "/lembur-saya", label: "Lembur Saya", selfService: true, group: "saya" },
  { href: "/slip-saya", label: "Slip Gaji Saya", selfService: true, group: "saya" },
  { href: "/surat-tugas-saya", label: "Surat Tugas Saya", selfService: true, group: "saya" },
  { href: "/dokumen-saya", label: "Dokumen Saya", selfService: true, group: "saya" },
  { href: "/profil", label: "Profil & Jadwal", selfService: true, group: "saya" },
  { href: "/akun", label: "Keamanan & Notifikasi", group: "saya" },
  { href: "/karyawan", label: "Karyawan", anyOf: ["employee:view"], group: "sdm" },
  { href: "/jadwal", label: "Jadwal & Libur", anyOf: ["schedule:manage"], group: "sdm" },
  { href: "/absensi", label: "Absensi", anyOf: ["attendance:view_all"], group: "sdm" },
  { href: "/pengajuan", label: "Pengajuan & Cuti", anyOf: ["leave:view_all"], group: "sdm" },
  { href: "/lembur", label: "Pengajuan Lembur", anyOf: ["overtime:view_all"], group: "sdm" },
  { href: "/lokasi", label: "Tinjauan Lokasi", anyOf: ["location:review"], group: "sdm" },
  { href: "/surat-tugas", label: "Surat Tugas", anyOf: ["assignment:view_all"], group: "sdm" },
  { href: "/dokumen", label: "Dokumen", anyOf: ["document:view_all"], group: "sdm" },
  { href: "/rekap", label: "Rekap Absensi", anyOf: ["recap:view_all"], group: "sdm" },
  { href: "/laporan", label: "Laporan & Analisis", anyOf: ["report:view"], group: "sdm" },
  { href: "/penggajian", label: "Penggajian", anyOf: ["payroll:view"], group: "gaji" },
  { href: "/audit-log", label: "Audit Log", anyOf: ["audit:view"], group: "sistem" },
  { href: "/pengaturan", label: "Pengaturan", anyOf: ["settings:view"], group: "sistem" },
  { href: "/pengguna", label: "Akun Pengguna", anyOf: ["user:manage", "user:manage_employee"], group: "sistem" },
];

export function visibleNav(role: Role | null | undefined, hasEmployee: boolean): NavItem[] {
  return NAV_ITEMS.filter((i) => {
    if (i.selfService) return hasEmployee;
    if (!i.anyOf) return true;
    return i.anyOf.some((p) => can(role, p));
  });
}

export const NAV_GROUP_LABEL: Record<NavItem["group"], string> = {
  umum: "", saya: "Layanan Saya", sdm: "Kepegawaian", gaji: "Penggajian", training: "Training & Operations", sistem: "Sistem",
};
