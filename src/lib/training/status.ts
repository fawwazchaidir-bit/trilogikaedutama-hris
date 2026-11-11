/**
 * Aturan alur status — logika MURNI. Service memakai ini; trigger database `training_projects_guard` menegakkan
 * alur proyek yang sama sebagai lapis kedua.
 */
import type { ProjectStatus, TaskStatus } from "./types";

// ─────────────────────────── Proyek ───────────────────────────

/**
 * Perpindahan status proyek yang sah (di luar penutupan/pembatalan/pembukaan kembali, yang punya aturan sendiri):
 *   DRAFT → PREPARATION → RUNNING. Selesai lewat alur penutupan; Dibatalkan lewat alur pembatalan.
 */
export const PROJECT_FORWARD: Partial<Record<ProjectStatus, ProjectStatus>> = { DRAFT: "PREPARATION", PREPARATION: "RUNNING" };

/** Seluruh perpindahan yang diizinkan database (sama dengan trigger). */
export const PROJECT_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  DRAFT: ["PREPARATION", "CANCELLED"],
  PREPARATION: ["RUNNING", "COMPLETED", "CANCELLED"],
  RUNNING: ["COMPLETED", "CANCELLED"],
  COMPLETED: ["RUNNING"],
  CANCELLED: [],
};

export function canProjectTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return PROJECT_TRANSITIONS[from].includes(to);
}

export interface PromotionCheck { ok: boolean; problems: string[] }

/** Syarat memulai persiapan: tanggal lengkap & ada PIC. Pesan ditulis untuk pengguna. */
export function checkReadyForPreparation(p: { startDate: string | null; endDate: string | null; hasPic: boolean }): PromotionCheck {
  const problems: string[] = [];
  if (!p.startDate || !p.endDate) problems.push("Tanggal mulai dan tanggal selesai wajib diisi.");
  if (!p.hasPic) problems.push("Tetapkan Project Manager (PIC) terlebih dulu pada tab Tim.");
  return { ok: problems.length === 0, problems };
}

// ─────────────────────────── Tugas ───────────────────────────

export interface TaskTransitionInput {
  status: TaskStatus;
  requiresReview: boolean;
  /** Pelaku adalah penanggung jawab tugas. */
  isAssignee: boolean;
  /** Pelaku berwenang mengelola tugas proyek (ability manage_tasks). */
  canManage: boolean;
  /** Pelaku adalah AKUN yang mengirim hasil tugas ini ke pemeriksaan (pengirim hasil). */
  isSubmitter?: boolean;
  /** Pelaku adalah PELAKSANA saat hasil dikirim (penanggung jawab ketika dikirim — tetap berlaku walau penanggung jawab kemudian dialihkan/dikosongkan). */
  isExecutor?: boolean;
}

/**
 * Mengapa pelaku TIDAK boleh memeriksa (menyelesaikan) tugas yang menunggu pemeriksaan; null = boleh.
 * Pemeriksa harus berbeda dari pengirim hasil, pelaksana saat dikirim, dan penanggung jawab saat ini.
 */
export function reviewBlockReason(i: Pick<TaskTransitionInput, "isAssignee" | "isSubmitter" | "isExecutor">): "SUBMITTER" | "EXECUTOR" | null {
  if (i.isSubmitter) return "SUBMITTER";
  if (i.isAssignee || i.isExecutor) return "EXECUTOR";
  return null;
}

/**
 * Status tujuan yang boleh dipilih pelaku (tidak termasuk status saat ini).
 *
 *  - Penanggung jawab: Belum dikerjakan ↔ Dalam proses; menyelesaikan langsung (Selesai) bila tugas tidak perlu diperiksa,
 *    atau mengirim ke "Menunggu pemeriksaan" bila perlu. Dari "Menunggu pemeriksaan" ia hanya boleh menarik kembali.
 *  - Pengelola tugas: dapat memindahkan ke mana saja, termasuk Dibatalkan dan membuka kembali yang Selesai/Dibatalkan,
 *    KECUALI memeriksa hasil yang ia kirim sendiri atau tugas yang ia/dulu ia kerjakan (pemeriksa ≠ pengirim hasil, ≠ pelaksana, ≠ penanggung jawab).
 *  - Tugas yang perlu diperiksa hanya dapat menjadi Selesai dari "Menunggu pemeriksaan".
 */
export function allowedTaskTransitions(i: TaskTransitionInput): TaskStatus[] {
  const out = new Set<TaskStatus>();
  const { status, requiresReview } = i;
  const finishTarget: TaskStatus = requiresReview ? "IN_REVIEW" : "DONE";

  if (i.isAssignee) {
    if (status === "TODO") { out.add("IN_PROGRESS"); out.add(finishTarget); }
    if (status === "IN_PROGRESS") { out.add("TODO"); out.add(finishTarget); }
    if (status === "IN_REVIEW") out.add("IN_PROGRESS");
  }
  if (i.canManage) {
    if (status === "TODO") { out.add("IN_PROGRESS"); out.add("CANCELLED"); if (requiresReview) out.add("IN_REVIEW"); else out.add("DONE"); }
    if (status === "IN_PROGRESS") { out.add("TODO"); out.add("CANCELLED"); if (requiresReview) out.add("IN_REVIEW"); else out.add("DONE"); }
    if (status === "IN_REVIEW") { out.add("IN_PROGRESS"); out.add("CANCELLED"); if (reviewBlockReason(i) === null) out.add("DONE"); }
    if (status === "DONE") { out.add("IN_PROGRESS"); }
    if (status === "CANCELLED") { out.add("TODO"); }
  }
  out.delete(status);
  return [...out];
}

export function canTaskTransition(i: TaskTransitionInput, to: TaskStatus): boolean {
  return allowedTaskTransitions(i).includes(to);
}
