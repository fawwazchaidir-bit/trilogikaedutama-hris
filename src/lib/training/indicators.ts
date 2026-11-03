/**
 * Definisi indikator dashboard & laporan — logika MURNI dan satu-satunya tempat rumus ditulis, agar dashboard,
 * daftar proyek, dan laporan SELALU konsisten (dan dapat diuji).
 *
 * Definisi (juga tertulis di docs/TRAINING-OPS.md):
 *  - Proyek aktif        = status Persiapan atau Berjalan.
 *  - Tugas terlambat     = tugas terbuka (belum Selesai/Dibatalkan) dengan tanggal jatuh tempo < hari ini (WIB).
 *  - Progres checklist   = item selesai ÷ seluruh item checklist proyek. Tanpa item → null ("Belum tersedia"), bukan 0%.
 *  - Perlu perhatian     = proyek aktif yang memenuhi minimal satu aturan di `attentionReasons`.
 *
 * SENGAJA TIDAK ADA: persentase "beban tim", "kesiapan kegiatan", dan "ketepatan waktu". Rumusnya belum disepakati
 * dan datanya belum memadai; menampilkannya akan menyesatkan.
 */
import { addDays } from "@/lib/time";
import { isActiveProject, isOpenTask, type ProjectStatus, type TaskStatus } from "./types";

/** Berapa hari menjelang mulai (atau sesudahnya) checklist wajib yang belum lengkap dianggap perlu perhatian. */
export const ATTENTION_WINDOW_DAYS = 7;
/** Tugas "mendekati deadline" = jatuh tempo dalam sekian hari ke depan. */
export const DUE_SOON_DAYS = 3;

export interface TaskLite { status: TaskStatus; dueDate: string | null }

export const isTaskOverdue = (t: TaskLite, today: string): boolean => isOpenTask(t.status) && t.dueDate !== null && t.dueDate < today;
export const isTaskDueToday = (t: TaskLite, today: string): boolean => isOpenTask(t.status) && t.dueDate === today;
export const isTaskDueSoon = (t: TaskLite, today: string, days = DUE_SOON_DAYS): boolean =>
  isOpenTask(t.status) && t.dueDate !== null && t.dueDate >= today && t.dueDate <= addDays(today, days);

export interface ChecklistProgress { done: number; total: number; percent: number | null }

export function checklistProgress(items: readonly { isDone: boolean }[]): ChecklistProgress {
  const total = items.length;
  const done = items.filter((i) => i.isDone).length;
  return { done, total, percent: total === 0 ? null : Math.round((done / total) * 100) };
}

export const requiredOutstanding = <T extends { isRequired: boolean; isDone: boolean }>(items: readonly T[]): T[] => items.filter((i) => i.isRequired && !i.isDone);

export type AttentionCode = "OVERDUE_TASKS" | "REQUIRED_CHECKLIST" | "NO_PIC" | "PAST_END_NOT_CLOSED";
export const ATTENTION_LABEL: Record<AttentionCode, string> = {
  OVERDUE_TASKS: "Ada tugas terlambat",
  REQUIRED_CHECKLIST: "Checklist wajib belum lengkap",
  NO_PIC: "Belum ada Project Manager (PIC)",
  PAST_END_NOT_CLOSED: "Lewat tanggal selesai, belum ditutup",
};

export interface ProjectSignals {
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
  hasPic: boolean;
  overdueTasks: number;
  requiredOutstanding: number;
  today: string;
}

/** Alasan sebuah proyek perlu perhatian. Hanya proyek AKTIF yang dinilai (draf/selesai/batal tidak). */
export function attentionReasons(s: ProjectSignals): AttentionCode[] {
  if (!isActiveProject(s.status)) return [];
  const out: AttentionCode[] = [];
  if (s.overdueTasks > 0) out.push("OVERDUE_TASKS");
  if (s.requiredOutstanding > 0 && s.startDate !== null && s.startDate <= addDays(s.today, ATTENTION_WINDOW_DAYS)) out.push("REQUIRED_CHECKLIST");
  if (!s.hasPic) out.push("NO_PIC");
  if (s.endDate !== null && s.endDate < s.today) out.push("PAST_END_NOT_CLOSED");
  return out;
}

export interface ClosureReadiness {
  /** Dapat ditutup tanpa pengecualian. */
  canCloseClean: boolean;
  requiredOutstanding: number;
  openTasks: number;
}

export function closureReadiness(items: readonly { isRequired: boolean; isDone: boolean }[], tasks: readonly TaskLite[]): ClosureReadiness {
  const outstanding = requiredOutstanding(items).length;
  return { canCloseClean: outstanding === 0, requiredOutstanding: outstanding, openTasks: tasks.filter((t) => isOpenTask(t.status)).length };
}
