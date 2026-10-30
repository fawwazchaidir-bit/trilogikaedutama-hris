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
    "leave:view_all", "leave:review", "leave_balance:manage",
    "recap:view_all", "recap:export",
    "payroll:components", "payroll:view", "payroll:prepare",
    "payslip:download_all",
      "settings:view",
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
  group: "umum" | "saya" | "sdm" | "gaji" | "sistem";
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/dashboard", label: "Dashboard", group: "umum" },
  { href: "/absensi-saya", label: "Absensi Saya", selfService: true, group: "saya" },
  { href: "/pengajuan-saya", label: "Pengajuan Saya", selfService: true, group: "saya" },
  { href: "/slip-saya", label: "Slip Gaji Saya", selfService: true, group: "saya" },
  { href: "/profil", label: "Profil & Jadwal", selfService: true, group: "saya" },
  { href: "/karyawan", label: "Karyawan", anyOf: ["employee:view"], group: "sdm" },
  { href: "/jadwal", label: "Jadwal & Libur", anyOf: ["schedule:manage"], group: "sdm" },
  { href: "/absensi", label: "Absensi", anyOf: ["attendance:view_all"], group: "sdm" },
  { href: "/pengajuan", label: "Pengajuan & Cuti", anyOf: ["leave:view_all"], group: "sdm" },
  { href: "/rekap", label: "Rekap Absensi", anyOf: ["recap:view_all"], group: "sdm" },
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
  umum: "", saya: "Layanan Saya", sdm: "Kepegawaian", gaji: "Penggajian", sistem: "Sistem",
};
