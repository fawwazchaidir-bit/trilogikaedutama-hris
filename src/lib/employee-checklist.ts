/**
 * Template checklist siklus karyawan — cukup daftar centang untuk tim kecil, agar proses masuk dan berhenti tidak bergantung pada ingatan satu orang.
 * Butir bawaan di bawah disalin ke tiap checklist saat dimulai; HR dapat menandai "Tidak berlaku" (dengan alasan) atau menambah butir sendiri
 * pada checklist itu. Template tidak diubah lewat aplikasi (sengaja sederhana).
 */
export type ChecklistKind = "ONBOARDING" | "OFFBOARDING";
export type ChecklistItemStatus = "TODO" | "DONE" | "NOT_APPLICABLE";

export interface TemplateItem { key: string; group: string; title: string; hint: string; /** Tenggat bawaan = tanggal mulai + hari ini (dapat diubah HR pada template). */ dueDays: number }

export const KIND_LABEL: Record<ChecklistKind, string> = { ONBOARDING: "Karyawan masuk", OFFBOARDING: "Karyawan berhenti" };
export const ITEM_STATUS_LABEL: Record<ChecklistItemStatus, string> = { TODO: "Belum", DONE: "Selesai", NOT_APPLICABLE: "Tidak berlaku" };

export const ONBOARDING_TEMPLATE: readonly TemplateItem[] = [
  { key: "basic_data", group: "Data & dokumen", title: "Data dasar dilengkapi", hint: "Telepon, alamat, dan rekening gaji pada data karyawan.", dueDays: 7 },
  { key: "emergency_contact", group: "Data & dokumen", title: "Kontak darurat dilengkapi", hint: "Nama, hubungan, dan nomor telepon yang bisa dihubungi.", dueDays: 7 },
  { key: "contract_docs", group: "Data & dokumen", title: "Kontrak dan dokumen yang diperlukan dicatat", hint: "Unggah kontrak/PKWT di menu Dokumen beserta tanggal mulai dan berakhir.", dueDays: 7 },
  { key: "placement", group: "Penempatan", title: "Atasan langsung dan divisi ditetapkan", hint: "Kartu Organisasi & atasan langsung pada detail karyawan.", dueDays: 3 },
  { key: "schedule", group: "Penempatan", title: "Jadwal kerja ditetapkan", hint: "Memakai jadwal bawaan perusahaan, atau penugasan jadwal khusus di Jadwal & Libur.", dueDays: 3 },
  { key: "salary_components", group: "Penempatan", title: "Komponen gaji ditetapkan", hint: "Minimal gaji pokok pada komponen gaji karyawan.", dueDays: 7 },
  { key: "portal_account", group: "Akses", title: "Akun portal dibuat", hint: "Akun Pengguna → tautkan ke data karyawan ini.", dueDays: 3 },
  { key: "system_access", group: "Akses", title: "Hak akses sistem diberikan sesuai tugas", hint: "Peran akun, level modul Training, dan keanggotaan proyek bila perlu.", dueDays: 7 },
  { key: "orientation", group: "Orientasi", title: "Orientasi dan pelatihan awal dicatat", hint: "Catat apa yang sudah diikuti dan tanggalnya pada catatan butir ini.", dueDays: 30 },
];

export const OFFBOARDING_TEMPLATE: readonly TemplateItem[] = [
  { key: "end_date_docs", group: "Administrasi", title: "Tanggal berhenti dan dokumen penyelesaian dicatat", hint: "Tanggal berhenti diisi saat karyawan dinonaktifkan; unggah surat/dokumen penyelesaian di menu Dokumen.", dueDays: 7 },
  { key: "handover", group: "Serah terima", title: "Tugas dan proyek yang masih aktif dialihkan", hint: "Tugas Training, keanggotaan proyek, bawahan langsung, dan jabatan pada Rumus Indikator.", dueDays: 7 },
  { key: "account_decision", group: "Akses", title: "Akun dan sesi dinonaktifkan sesuai keputusan HR", hint: "Menonaktifkan karyawan langsung menonaktifkan akun dan mengakhiri sesinya — lakukan pada saat yang HR putuskan.", dueDays: 7 },
  { key: "assets", group: "Aset", title: "Pengembalian aset diperiksa", hint: "Aset yang dicatat di menu Aset sudah dikembalikan (laptop, kunci, kartu akses, seragam); aset yang belum tercatat dicatat lebih dulu.", dueDays: 7 },
  { key: "obligations", group: "Hak & kewajiban", title: "Hak dan kewajiban yang masih perlu diselesaikan dicatat", hint: "Sisa cuti, uang harian/penggantian, kasbon, dan gaji terakhir.", dueDays: 14 },
];

export const templateOf = (kind: ChecklistKind): readonly TemplateItem[] => (kind === "ONBOARDING" ? ONBOARDING_TEMPLATE : OFFBOARDING_TEMPLATE);

/** Sinyal otomatis: petunjuk dari data sistem untuk sebuah butir. Tidak pernah mencentang sendiri — keputusan "selesai" tetap manusia. */
export type SignalState = "OK" | "WARN" | "INFO";
export interface Signal { state: SignalState; text: string }
