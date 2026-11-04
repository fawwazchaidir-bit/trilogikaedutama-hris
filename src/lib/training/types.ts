/**
 * Tipe & label (Bahasa Indonesia) modul Training & Operations. Nilai string identik dengan enum Prisma
 * (`TrainingLevel`, `TrainingProjectStatus`, dst.) sehingga aman dipakai di sisi klien tanpa mengimpor Prisma.
 */

export type TrainingLevel = "VIEWER" | "ADMIN_PROGRAM" | "MANAGER";
export const TRAINING_LEVELS: readonly TrainingLevel[] = ["VIEWER", "ADMIN_PROGRAM", "MANAGER"];
export const TRAINING_LEVEL_LABEL: Record<TrainingLevel, string> = {
  VIEWER: "Pemantau (hanya lihat)",
  ADMIN_PROGRAM: "Admin Program",
  MANAGER: "Manajer Program",
};
export const TRAINING_LEVEL_HELP: Record<TrainingLevel, string> = {
  VIEWER: "Melihat seluruh proyek, progres, jadwal, dan laporan. Tidak dapat mengubah data. Cocok untuk manajer atau pihak lain yang perlu memantau. (Direktur sudah memiliki akses penuh sebagai Super Admin.)",
  ADMIN_PROGRAM: "Dapat membuat proyek. Mengelola peserta, dokumen, jadwal, dan tugas hanya pada proyek yang ia ikuti, sesuai peran proyeknya.",
  MANAGER: "Mengelola seluruh proyek: tim & PIC, tugas, template checklist, program, penutupan/pembatalan proyek. Jumlah pemegang tidak dibatasi; Direktur yang memberi akses.",
};

export type ActivityKind = "REGULAR" | "CERTIFICATION" | "IN_HOUSE" | "OTHER";
export const ACTIVITY_KINDS: readonly ActivityKind[] = ["REGULAR", "CERTIFICATION", "IN_HOUSE", "OTHER"];
export const ACTIVITY_KIND_LABEL: Record<ActivityKind, string> = {
  REGULAR: "Reguler", CERTIFICATION: "Sertifikasi", IN_HOUSE: "In-house", OTHER: "Lainnya",
};

export type DeliveryMode = "ONSITE" | "ONLINE" | "HYBRID";
export const DELIVERY_MODES: readonly DeliveryMode[] = ["ONSITE", "ONLINE", "HYBRID"];
export const DELIVERY_MODE_LABEL: Record<DeliveryMode, string> = { ONSITE: "Tatap muka", ONLINE: "Daring (online)", HYBRID: "Hibrid" };

export type ProjectStatus = "DRAFT" | "PREPARATION" | "RUNNING" | "COMPLETED" | "CANCELLED";
export const PROJECT_STATUSES: readonly ProjectStatus[] = ["DRAFT", "PREPARATION", "RUNNING", "COMPLETED", "CANCELLED"];
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  DRAFT: "Draf", PREPARATION: "Persiapan", RUNNING: "Berjalan", COMPLETED: "Selesai", CANCELLED: "Dibatalkan",
};
/** Proyek aktif = berstatus Persiapan atau Berjalan. */
export const ACTIVE_PROJECT_STATUSES: readonly ProjectStatus[] = ["PREPARATION", "RUNNING"];
export const isActiveProject = (s: ProjectStatus): boolean => s === "PREPARATION" || s === "RUNNING";
/** Proyek yang sudah ditutup/dibatalkan hanya dapat dibaca (kecuali dibuka kembali oleh Manajer Program). */
export const isFinalProject = (s: ProjectStatus): boolean => s === "COMPLETED" || s === "CANCELLED";

export type ProjectRole = "PROJECT_MANAGER" | "ADMIN_PROGRAM" | "PARTICIPANT_OWNER" | "MATERIAL_OWNER" | "DOCUMENTATION_OWNER" | "STAFF";
export const PROJECT_ROLES: readonly ProjectRole[] = ["PROJECT_MANAGER", "ADMIN_PROGRAM", "PARTICIPANT_OWNER", "MATERIAL_OWNER", "DOCUMENTATION_OWNER", "STAFF"];
export const PROJECT_ROLE_LABEL: Record<ProjectRole, string> = {
  PROJECT_MANAGER: "Project Manager (PIC)",
  ADMIN_PROGRAM: "Admin Program",
  PARTICIPANT_OWNER: "Penanggung Jawab Peserta",
  MATERIAL_OWNER: "Penanggung Jawab Materi",
  DOCUMENTATION_OWNER: "Penanggung Jawab Dokumentasi",
  STAFF: "Staf Pelaksana",
};

export type TaskStatus = "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED";
export const TASK_STATUSES: readonly TaskStatus[] = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  TODO: "Belum dikerjakan", IN_PROGRESS: "Dalam proses", IN_REVIEW: "Menunggu pemeriksaan", DONE: "Selesai", CANCELLED: "Dibatalkan",
};
/** Tugas "terbuka" = belum selesai & belum dibatalkan. */
export const isOpenTask = (s: TaskStatus): boolean => s === "TODO" || s === "IN_PROGRESS" || s === "IN_REVIEW";

export type TaskPriority = "LOW" | "NORMAL" | "HIGH" | "URGENT";
export const TASK_PRIORITIES: readonly TaskPriority[] = ["LOW", "NORMAL", "HIGH", "URGENT"];
export const TASK_PRIORITY_LABEL: Record<TaskPriority, string> = { LOW: "Rendah", NORMAL: "Normal", HIGH: "Tinggi", URGENT: "Mendesak" };

export type ChecklistPhase = "PREPARATION" | "EXECUTION" | "CLOSING";
export const CHECKLIST_PHASES: readonly ChecklistPhase[] = ["PREPARATION", "EXECUTION", "CLOSING"];
export const CHECKLIST_PHASE_LABEL: Record<ChecklistPhase, string> = { PREPARATION: "Persiapan", EXECUTION: "Pelaksanaan", CLOSING: "Penutupan" };

export type ScheduleStatus = "PLANNED" | "CONFIRMED" | "DONE" | "CANCELLED";
export const SCHEDULE_STATUSES: readonly ScheduleStatus[] = ["PLANNED", "CONFIRMED", "DONE", "CANCELLED"];
export const SCHEDULE_STATUS_LABEL: Record<ScheduleStatus, string> = { PLANNED: "Direncanakan", CONFIRMED: "Dikonfirmasi", DONE: "Selesai", CANCELLED: "Dibatalkan" };

export type ParticipantStatus = "REGISTERED" | "INCOMPLETE_DOCS" | "READY" | "ATTENDING" | "COMPLETED" | "CANCELLED";
export const PARTICIPANT_STATUSES: readonly ParticipantStatus[] = ["REGISTERED", "INCOMPLETE_DOCS", "READY", "ATTENDING", "COMPLETED", "CANCELLED"];
export const PARTICIPANT_STATUS_LABEL: Record<ParticipantStatus, string> = {
  REGISTERED: "Terdaftar", INCOMPLETE_DOCS: "Berkas belum lengkap", READY: "Siap mengikuti kegiatan",
  ATTENDING: "Mengikuti kegiatan", COMPLETED: "Selesai", CANCELLED: "Dibatalkan",
};

export type InstructorKind = "INSTRUCTOR" | "ASSESSOR" | "SPEAKER" | "FACILITATOR";
export const INSTRUCTOR_KINDS: readonly InstructorKind[] = ["INSTRUCTOR", "ASSESSOR", "SPEAKER", "FACILITATOR"];
export const INSTRUCTOR_KIND_LABEL: Record<InstructorKind, string> = { INSTRUCTOR: "Instruktur", ASSESSOR: "Asesor", SPEAKER: "Narasumber", FACILITATOR: "Fasilitator" };

export type Confirmation = "PENDING" | "CONFIRMED" | "DECLINED";
export const CONFIRMATIONS: readonly Confirmation[] = ["PENDING", "CONFIRMED", "DECLINED"];
export const CONFIRMATION_LABEL: Record<Confirmation, string> = { PENDING: "Menunggu konfirmasi", CONFIRMED: "Terkonfirmasi", DECLINED: "Menolak" };

export type DocCategory = "PROPOSAL" | "INVITATION" | "MATERIAL" | "ATTENDANCE" | "PARTICIPANT_DOC" | "DOCUMENTATION" | "FINAL_REPORT" | "OTHER";
export const DOC_CATEGORIES: readonly DocCategory[] = ["PROPOSAL", "INVITATION", "MATERIAL", "ATTENDANCE", "PARTICIPANT_DOC", "DOCUMENTATION", "FINAL_REPORT", "OTHER"];
export const DOC_CATEGORY_LABEL: Record<DocCategory, string> = {
  PROPOSAL: "Proposal", INVITATION: "Surat undangan", MATERIAL: "Materi pelatihan", ATTENDANCE: "Daftar hadir",
  PARTICIPANT_DOC: "Dokumen peserta", DOCUMENTATION: "Dokumentasi kegiatan", FINAL_REPORT: "Laporan akhir", OTHER: "Lainnya",
};
/** Dokumen peserta dapat memuat data pribadi: hanya yang berwenang mengelola peserta yang boleh melihatnya. */
export const SENSITIVE_DOC_CATEGORIES: readonly DocCategory[] = ["PARTICIPANT_DOC"];

export type ExternalSystem = "WEBSITE" | "HALOAI" | "FINANCE";
export const EXTERNAL_SYSTEMS: readonly ExternalSystem[] = ["WEBSITE", "HALOAI", "FINANCE"];
export const EXTERNAL_SYSTEM_LABEL: Record<ExternalSystem, string> = { WEBSITE: "Website (registrasi)", HALOAI: "HaloAI (CRM)", FINANCE: "Sistem Keuangan" };
