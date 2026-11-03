import type { RecapTotals } from "./attendance";
import type { ComponentCategory } from "./payroll";
import type { EmploymentStatus } from "./labels";

export interface PayslipLine {
  name: string;
  category: ComponentCategory;
  amount: number;
  /** Penjelasan perhitungan (mis. "20 hari hadir × Rp 25.000"). */
  formula: string | null;
  /** Alasan/keterangan (wajib untuk penyesuaian manual). */
  note: string | null;
  manual: boolean;
}

/**
 * Isi slip gaji yang DIBEKUKAN saat diterbitkan (tabel `payslips.snapshot`). PDF dan tampilan layar selalu
 * dirender dari snapshot ini — bukan dari data karyawan/absensi/komponen saat ini — sehingga slip terbit tidak berubah diam-diam.
 */
export interface PayslipSnapshot {
  version: 1;
  number: string;
  company: {
    name: string; legalName: string | null; tagline: string | null; address: string | null;
    phone: string | null; email: string | null; website: string | null; logoFileId: string | null;
  };
  employee: {
    id: string; employeeNo: string; name: string; position: string; division: string | null;
    employmentStatus: EmploymentStatus; bankName: string | null; bankAccountMasked: string | null;
  };
  period: { start: string; end: string; label: string };
  attendanceBasis: { start: string; end: string };
  issueDate: string;
  earnings: PayslipLine[];
  deductions: PayslipLine[];
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
  /** Ringkasan kehadiran — hanya bila diaktifkan di pengaturan saat terbit. */
  attendance: RecapTotals | null;
  /** Beban perusahaan (BPJS porsi pemberi kerja) — informasi, TIDAK mengurangi gaji bersih. */
  employerContributions?: { name: string; amount: number }[];
  /** Lembur yang DIBAYAR pada periode ini (menit, sesuai bukti absensi); null = tidak ada/tidak dihitung otomatis. */
  overtimePaidMinutes?: number | null;
  /** Penanda tangan slip saat terbit (diatur Super Admin). Slip lama tanpa bidang ini tidak menampilkan blok tanda tangan. */
  signer?: { name: string; title: string | null; place: string | null; signatureFileId: string | null } | null;
  note: string | null;
  footerNote: string | null;
  /** Jejak revisi: nomor slip pada periode yang dibatalkan dan digantikan oleh slip ini. */
  revisionNote: string | null;
}
