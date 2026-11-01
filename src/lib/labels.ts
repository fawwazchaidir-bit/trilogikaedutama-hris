/** Label tampilan (Bahasa Indonesia) untuk enum database. */

export type EmploymentStatus = "PERMANENT" | "CONTRACT" | "INTERN";
export const EMPLOYMENT_LABEL: Record<EmploymentStatus, string> = {
  PERMANENT: "Tetap",
  CONTRACT: "Kontrak",
  INTERN: "Magang",
};

export type LeaveType = "IZIN" | "SAKIT" | "CUTI";
export const LEAVE_TYPE_LABEL: Record<LeaveType, string> = { IZIN: "Izin", SAKIT: "Sakit", CUTI: "Cuti" };

export type RequestStatus = "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = {
  PENDING: "Menunggu",
  APPROVED: "Disetujui",
  REJECTED: "Ditolak",
  CANCELLED: "Dibatalkan",
};

export type PayrollStatus = "DRAFT" | "PENDING_APPROVAL" | "APPROVED" | "ISSUED" | "CANCELLED";
export const PAYROLL_STATUS_LABEL: Record<PayrollStatus, string> = {
  DRAFT: "Draf",
  PENDING_APPROVAL: "Menunggu persetujuan",
  APPROVED: "Disetujui",
  ISSUED: "Diterbitkan",
  CANCELLED: "Dibatalkan",
};

export const SCOPE_LABEL = { ALL: "Seluruh perusahaan", DIVISION: "Per divisi", EMPLOYEE: "Per karyawan" } as const;
export const CALENDAR_KIND_LABEL = { HOLIDAY: "Hari libur", SPECIAL_WORKDAY: "Hari kerja khusus" } as const;
export const LEDGER_KIND_LABEL = { GRANT: "Saldo awal / kuota", ADJUSTMENT: "Penyesuaian", USAGE: "Pemakaian", RESTORE: "Pengembalian" } as const;
export const LATE_MODE_LABEL = { NONE: "Tidak ada potongan", PER_OCCURRENCE: "Nominal per kali terlambat", PER_MINUTE: "Nominal per menit terlambat" } as const;
export const ABSENCE_MODE_LABEL = { NONE: "Tidak ada potongan", FIXED_PER_DAY: "Nominal tetap per hari", SALARY_DIVISOR: "Gaji pokok ÷ pembagi (per hari)" } as const;
export const OVERTIME_MODE_LABEL = {
  MANUAL: "Input manual (tanpa perhitungan otomatis)",
  APPROVED: "Hanya lembur yang disetujui & terbukti di absensi (disarankan)",
  AUTO: "Otomatis dari jam pulang (tanpa persetujuan)",
} as const;
export const OVERTIME_RATE_MODE_LABEL = { FIXED_PER_HOUR: "Nominal tetap per jam", SALARY_DIVISOR: "Gaji pokok ÷ pembagi (mis. 173)" } as const;
