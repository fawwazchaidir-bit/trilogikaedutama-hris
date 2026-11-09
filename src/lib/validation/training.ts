/** Skema validasi (Zod) modul Training & Operations — dipakai SERVICE agar aturan sama untuk API, halaman, seed, dan tes. */
import { z } from "zod";
import { hhmm, isoDate, optionalEmail, optionalPhone, optionalText, requiredText, uuid } from "./common";
import { ANCHORS, ITEM_COMPONENTS, TRACKS, indicatorConfigSchema } from "@/lib/training/indicators/config";
import { RECOVERY_KINDS } from "@/lib/training/indicators/escalation";
import {
  ACTIVITY_KINDS, CHECKLIST_PHASES, CONFIRMATIONS, DELIVERY_MODES, DOC_CATEGORIES, EXTERNAL_SYSTEMS, INSTRUCTOR_KINDS,
  PARTICIPANT_STATUSES, PROJECT_ROLES, PROJECT_STATUSES, SCHEDULE_STATUSES, TASK_PRIORITIES, TASK_STATUSES, TRAINING_LEVELS,
} from "@/lib/training/types";

const oneOf = <T extends string>(values: readonly T[], label: string) =>
  z.enum(values as unknown as [T, ...T[]], { error: `${label} tidak valid` });

const optUuid = uuid.nullish().transform((v) => v ?? null);
const optDate = isoDate.nullish().transform((v) => v ?? null);
const bool = z.boolean({ error: "Nilai harus benar/salah" });

// ─────────────────────────── Akses & program ───────────────────────────

/**
 * Skema UBAH sebagian (PATCH). Zod 4 tetap menerapkan `.default()` walau field dibungkus `.partial()`, sehingga PATCH `{ title }` diam-diam
 * mengembalikan prioritas/status/jenis ke nilai bawaan. Skema ubah dibangun dari field TANPA default; semuanya opsional.
 */
type NoDefault<F> = F extends z.ZodDefault<infer I> ? I : F;
function patchOf<T extends z.ZodRawShape>(o: z.ZodObject<T>): z.ZodObject<{ [K in keyof T]: z.ZodOptional<NoDefault<T[K]>> }> {
  const shape: Record<string, z.ZodType> = {};
  for (const [k, f] of Object.entries(o.shape)) shape[k] = ((f instanceof z.ZodDefault ? f.removeDefault() : f) as z.ZodType).optional();
  return z.object(shape) as never;
}

export const accessGrantSchema = z.object({
  userId: uuid,
  level: oneOf(TRAINING_LEVELS, "Level akses"),
  note: optionalText(200, "Catatan"),
});

export const programSchema = z.object({
  name: requiredText(3, 120, "Nama program"),
  kind: oneOf(ACTIVITY_KINDS, "Jenis program").default("REGULAR"),
  description: optionalText(1000, "Deskripsi"),
});
export const programUpdateSchema = patchOf(programSchema).extend({ isActive: bool.optional() });

// ─────────────────────────── Proyek ───────────────────────────

const dateOrder = <T extends { startDate?: string | null; endDate?: string | null }>(v: T, ctx: z.RefinementCtx) => {
  if (v.startDate && v.endDate && v.endDate < v.startDate) {
    ctx.addIssue({ code: "custom", path: ["endDate"], message: "Tanggal selesai tidak boleh sebelum tanggal mulai" });
  }
};

const projectFields = {
  name: requiredText(3, 160, "Nama proyek"),
  programId: optUuid,
  kind: oneOf(ACTIVITY_KINDS, "Jenis kegiatan").default("REGULAR"),
  clientName: optionalText(160, "Klien / mitra"),
  deliveryMode: oneOf(DELIVERY_MODES, "Moda pelaksanaan").default("ONSITE"),
  location: optionalText(200, "Lokasi / media"),
  startDate: optDate,
  endDate: optDate,
  description: optionalText(2000, "Deskripsi"),
  notes: optionalText(2000, "Catatan penting"),
  // Pemantauan: jenis program & data pelaksana indikator.
  track: oneOf(TRACKS, "Jenis program").default("REGULAR"),
  participantsMin: z.number({ error: "Harus berupa angka" }).int("Harus bilangan bulat").min(0).max(100000).nullish().transform((v) => v ?? null),
  participantsMax: z.number({ error: "Harus berupa angka" }).int("Harus bilangan bulat").min(0).max(100000).nullish().transform((v) => v ?? null),
  bnsp: bool.default(false),
  requestDate: optDate,
  registrationCloseDate: optDate,
};

export const projectCreateSchema = z.object({
  ...projectFields,
  /** Template checklist yang diterapkan saat proyek dibuat (opsional). */
  checklistTemplateId: optUuid,
  /** Karyawan yang menjadi Project Manager (PIC). Hanya Koordinator Program yang boleh menetapkan. */
  picEmployeeId: optUuid,
}).superRefine(dateOrder);

export const projectUpdateSchema = patchOf(z.object(projectFields)).superRefine(dateOrder);

export const projectStatusSchema = z.object({ to: oneOf(["PREPARATION", "RUNNING"] as const, "Status tujuan") });

export const projectCloseSchema = z.object({
  summary: requiredText(5, 2000, "Catatan hasil pelaksanaan"),
  followUp: optionalText(2000, "Permasalahan & tindak lanjut"),
  /** Wajib bila masih ada checklist wajib yang belum selesai. */
  overrideReason: optionalText(500, "Alasan pengecualian"),
});
export const projectReasonSchema = z.object({ reason: requiredText(5, 500, "Alasan") });

export const projectListSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: oneOf(PROJECT_STATUSES, "Status").optional(),
  kind: oneOf(ACTIVITY_KINDS, "Jenis").optional(),
  programId: uuid.optional(),
  picId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  attention: z.enum(["1"]).optional(),
  /** "1" = hanya proyek aktif (Persiapan atau Berjalan). */
  active: z.enum(["1"]).optional(),
  sort: z.enum(["start_desc", "start_asc", "code_desc", "name_asc"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

// ─────────────────────────── Tim ───────────────────────────

export const memberAddSchema = z.object({
  employeeId: uuid,
  role: oneOf(PROJECT_ROLES, "Peran proyek"),
  note: optionalText(200, "Catatan"),
});
export const memberUpdateSchema = z.object({ role: oneOf(PROJECT_ROLES, "Peran proyek").optional(), note: optionalText(200, "Catatan").optional() });

// ─────────────────────────── Tugas ───────────────────────────

export const taskCreateSchema = z.object({
  title: requiredText(3, 200, "Judul tugas"),
  description: optionalText(2000, "Deskripsi"),
  assigneeId: optUuid,
  dueDate: optDate,
  priority: oneOf(TASK_PRIORITIES, "Prioritas").default("NORMAL"),
  requiresReview: bool.default(false),
});
export const taskUpdateSchema = patchOf(taskCreateSchema);
export const taskStatusSchema = z.object({ status: oneOf(TASK_STATUSES, "Status tugas"), note: optionalText(500, "Catatan") });
export const taskCommentSchema = z.object({ body: requiredText(1, 2000, "Komentar") });
export const myTasksSchema = z.object({
  filter: z.enum(["open", "overdue", "today", "soon", "done", "all"]).optional(),
  projectId: uuid.optional(),
});

// ─────────────────────────── Checklist ───────────────────────────

export const templateSaveSchema = z.object({
  name: requiredText(3, 120, "Nama template"),
  description: optionalText(500, "Deskripsi"),
  isActive: bool.optional(),
  items: z.array(z.object({
    phase: oneOf(CHECKLIST_PHASES, "Tahap"),
    title: requiredText(2, 200, "Judul item"),
    isRequired: bool.default(false),
  })).min(1, "Template minimal memiliki satu item").max(80, "Maksimal 80 item per template"),
});
export const applyTemplateSchema = z.object({ templateId: uuid });

export const checklistItemCreateSchema = z.object({
  phase: oneOf(CHECKLIST_PHASES, "Tahap"),
  title: requiredText(2, 200, "Judul item"),
  isRequired: bool.default(false),
  assigneeId: optUuid,
  note: optionalText(300, "Catatan"),
});
export const checklistItemUpdateSchema = z.object({
  phase: oneOf(CHECKLIST_PHASES, "Tahap").optional(),
  title: requiredText(2, 200, "Judul item").optional(),
  isRequired: bool.optional(),
  assigneeId: optUuid.optional(),
  note: optionalText(300, "Catatan").optional(),
  isDone: bool.optional(),
});

// ─────────────────────────── Jadwal, peserta, instruktur ───────────────────────────

export const scheduleSchema = z.object({
  title: requiredText(3, 160, "Nama kegiatan"),
  date: isoDate,
  startTime: hhmm,
  endTime: hhmm,
  location: optionalText(200, "Lokasi / media"),
  room: optionalText(80, "Ruangan"),
  inchargeId: optUuid,
  projectInstructorId: optUuid,
  status: oneOf(SCHEDULE_STATUSES, "Status jadwal").default("PLANNED"),
  note: optionalText(500, "Catatan"),
}).superRefine((v, ctx) => {
  if (v.endTime <= v.startTime) ctx.addIssue({ code: "custom", path: ["endTime"], message: "Jam selesai harus setelah jam mulai (di hari yang sama)" });
});
export const scheduleUpdateSchema = z.object({
  title: requiredText(3, 160, "Nama kegiatan").optional(),
  date: isoDate.optional(),
  startTime: hhmm.optional(),
  endTime: hhmm.optional(),
  location: optionalText(200, "Lokasi / media").optional(),
  room: optionalText(80, "Ruangan").optional(),
  inchargeId: optUuid.optional(),
  projectInstructorId: optUuid.optional(),
  status: oneOf(SCHEDULE_STATUSES, "Status jadwal").optional(),
  note: optionalText(500, "Catatan").optional(),
});
export const calendarQuerySchema = z.object({ from: isoDate, to: isoDate, projectId: uuid.optional() });

export const participantSchema = z.object({
  fullName: requiredText(2, 150, "Nama peserta"),
  organization: optionalText(150, "Instansi / perusahaan"),
  phone: optionalPhone,
  email: optionalEmail,
  status: oneOf(PARTICIPANT_STATUSES, "Status peserta").default("REGISTERED"),
  note: optionalText(500, "Catatan"),
  /** Terkonfirmasi (pembayaran diverifikasi / nama diterima dari klien) — dicatat manual, dihitung pada indikator Kesiapan. */
  confirmed: bool.optional(),
});
export const participantUpdateSchema = patchOf(participantSchema);
export const participantListSchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: oneOf(PARTICIPANT_STATUSES, "Status").optional(),
  projectId: uuid.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export const instructorSchema = z.object({
  name: requiredText(2, 150, "Nama"),
  kind: oneOf(INSTRUCTOR_KINDS, "Jenis peran").default("INSTRUCTOR"),
  employeeId: optUuid,
  organization: optionalText(150, "Instansi"),
  expertise: optionalText(200, "Bidang keahlian"),
  phone: optionalPhone,
  email: optionalEmail,
});
export const instructorUpdateSchema = patchOf(instructorSchema).extend({ isActive: bool.optional() });
export const instructorAssignSchema = z.object({
  instructorId: uuid,
  kind: oneOf(INSTRUCTOR_KINDS, "Jenis peran"),
  confirmation: oneOf(CONFIRMATIONS, "Status konfirmasi").default("PENDING"),
  note: optionalText(300, "Catatan"),
});
export const instructorAssignUpdateSchema = z.object({
  kind: oneOf(INSTRUCTOR_KINDS, "Jenis peran").optional(),
  confirmation: oneOf(CONFIRMATIONS, "Status konfirmasi").optional(),
  note: optionalText(300, "Catatan").optional(),
});

// ─────────────────────────── Dokumen & referensi ───────────────────────────

export const documentMetaSchema = z.object({
  category: oneOf(DOC_CATEGORIES, "Kategori dokumen"),
  title: requiredText(2, 160, "Judul dokumen"),
  note: optionalText(300, "Catatan"),
});
export const assignmentLinkSchema = z.object({ letterId: uuid });
export const externalRefSchema = z.object({
  system: oneOf(EXTERNAL_SYSTEMS, "Sistem"),
  externalId: requiredText(1, 100, "ID / nomor referensi"),
  label: optionalText(120, "Keterangan"),
});

// ─────────────────────────── Indikator pemantauan ───────────────────────────

export const indicatorConfigSaveSchema = z.object({ config: indicatorConfigSchema, note: optionalText(300, "Catatan perubahan") });

const offsetInput = {
  anchor: oneOf(ANCHORS, "Acuan tenggat"),
  days: z.number({ error: "Harus berupa angka" }).int().min(-730).max(730).default(0),
  work: bool.default(false),
  ref: z.string().trim().max(20).nullish().transform((v) => v || null),
  manualDate: optDate,
};

export const milestoneCompleteSchema = z.object({ doneAt: optDate, evidence: optionalText(500, "Bukti") });
export const milestoneAddSchema = z.object({
  code: requiredText(1, 20, "Kode"), name: requiredText(3, 200, "Nama milestone"), ...offsetInput,
  weight: z.number({ error: "Harus berupa angka" }).int().min(0).max(1000), critical: bool.default(false), assigneeId: optUuid, reference: optionalText(80, "Rujukan"),
});
export const milestoneUpdateSchema = z.object({
  name: requiredText(3, 200, "Nama milestone").optional(), weight: z.number().int().min(0).max(1000).optional(), critical: bool.optional(),
  assigneeId: optUuid.optional(), manualDate: optDate.optional(), notApplicable: bool.optional(), reference: optionalText(80, "Rujukan").optional(),
});
export const readinessStatusSchema = z.object({ status: z.enum(["OPEN", "DONE", "NOT_APPLICABLE"], { error: "Status tidak valid" }) });
export const readinessAddSchema = z.object({
  component: z.enum(ITEM_COMPONENTS, { error: "Komponen tidak valid" }), name: requiredText(3, 200, "Nama item"), ...offsetInput,
  critical: bool.default(false), assigneeId: optUuid,
});
export const workloadSchema = z.object({
  employeeId: uuid, name: requiredText(3, 200, "Nama tugas"),
  hours: z.number({ error: "Jam harus berupa angka" }).min(0, "Tidak boleh negatif").max(2000), startDate: isoDate, endDate: isoDate,
}).superRefine((v, ctx) => { if (v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "Tanggal selesai tidak boleh sebelum tanggal mulai" }); });
export const workloadUpdateSchema = z.object({
  name: requiredText(3, 200, "Nama tugas").optional(), hours: z.number().min(0).max(2000).optional(), startDate: isoDate.optional(), endDate: isoDate.optional(),
  status: z.enum(["OPEN", "DONE", "CANCELLED"]).optional(),
});
export const staffCapacitySchema = z.object({
  hoursPerDay: z.number({ error: "Harus berupa angka" }).gt(0).max(24).nullish().transform((v) => v ?? null),
  workDays: z.array(z.number().int().min(1).max(7)).min(1, "Pilih minimal satu hari kerja").max(7), note: optionalText(200, "Catatan"),
});
export const heatmapQuerySchema = z.object({ weeks: z.coerce.number().int().min(1).max(12).optional() });
export const densityQuerySchema = z.object({ from: isoDate.optional(), days: z.coerce.number().int().min(1).max(92).optional() });

export const recoveryNoteSchema = z.object({
  kind: z.enum(RECOVERY_KINDS, { error: "Jenis catatan tidak valid" }),
  body: requiredText(5, 1000, "Catatan pemulihan"),
  /** Tanggal selesai baru yang dijanjikan (informasi). */
  newDate: optDate,
});
