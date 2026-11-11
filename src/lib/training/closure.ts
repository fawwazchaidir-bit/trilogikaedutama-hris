/**
 * Penutupan proyek — logika MURNI (dapat diuji tanpa database). Rancangan: docs/TRAINING-OPS.md §Penutupan.
 *
 * Tugas terbuka tidak menghalangi penutupan, tetapi TIDAK BOLEH menggantung: setiap tugas terbuka harus diputuskan eksplisit saat menutup —
 *   FOLLOW_UP = dilanjutkan sebagai tindak lanjut (wajib ada penanggung jawab dan tenggat yang belum lewat; tetap dapat dikerjakan setelah proyek Selesai), atau
 *   CANCEL    = dibatalkan (wajib beralasan).
 * "Selesai" sengaja BUKAN pilihan saat menutup: tugas diselesaikan lewat alurnya sendiri (termasuk pemeriksaan bila wajib periksa), agar penutupan tidak
 * menjadi jalan pintas melewati pemisahan pelaksana–pemeriksa.
 */
import { isOpenTask, type TaskStatus } from "./types";

export const CLOSURE_TASK_ACTIONS = ["FOLLOW_UP", "CANCEL"] as const;
export type ClosureTaskAction = (typeof CLOSURE_TASK_ACTIONS)[number];
export const CLOSURE_TASK_ACTION_LABEL: Record<ClosureTaskAction, string> = { FOLLOW_UP: "Jadikan tindak lanjut", CANCEL: "Batalkan" };

export interface ClosureTaskDecision { taskId: string; action: ClosureTaskAction; assigneeId?: string | null; dueDate?: string | null; reason?: string | null }
export interface OpenTaskLite { id: string; title: string; status: TaskStatus; assigneeId: string | null; dueDate: string | null }

export interface ClosureTaskPlan {
  followUp: { taskId: string; title: string; assigneeId: string; dueDate: string; assigneeChanged: boolean; dueChanged: boolean; reason: string | null }[];
  cancel: { taskId: string; title: string; reason: string }[];
}
export interface ClosureTaskCheck {
  plan: ClosureTaskPlan;
  /** Tugas terbuka yang belum diputuskan. */
  undecided: OpenTaskLite[];
  /** ID pada keputusan yang BUKAN tugas terbuka proyek ini (mis. baru diselesaikan orang lain) → daftar berubah, muat ulang. */
  unknown: string[];
  /** Keputusan yang tidak lengkap/tidak sah, per tugas (pesan untuk pengguna). */
  invalid: { taskId: string; title: string; message: string }[];
}

export const MIN_CANCEL_REASON = 5;

/** Cocokkan tugas terbuka dengan keputusan Koordinator Program. `ok` hanya bila semua tugas terbuka punya keputusan yang sah. */
export function checkClosureTasks(tasks: readonly OpenTaskLite[], decisions: readonly ClosureTaskDecision[], today: string): ClosureTaskCheck & { ok: boolean } {
  const open = tasks.filter((t) => isOpenTask(t.status));
  const byId = new Map(open.map((t) => [t.id, t]));
  const plan: ClosureTaskPlan = { followUp: [], cancel: [] };
  const seen = new Set<string>();
  const unknown: string[] = [];
  const invalid: ClosureTaskCheck["invalid"] = [];
  for (const d of decisions) {
    const t = byId.get(d.taskId);
    if (!t) { unknown.push(d.taskId); continue; }
    if (seen.has(d.taskId)) { invalid.push({ taskId: t.id, title: t.title, message: "Keputusan ganda untuk tugas ini." }); continue; }
    seen.add(d.taskId);
    if (d.action === "CANCEL") {
      const reason = (d.reason ?? "").trim();
      if (reason.length < MIN_CANCEL_REASON) invalid.push({ taskId: t.id, title: t.title, message: `Alasan pembatalan wajib diisi (minimal ${MIN_CANCEL_REASON} karakter).` });
      else plan.cancel.push({ taskId: t.id, title: t.title, reason });
      continue;
    }
    const assigneeId = d.assigneeId ?? t.assigneeId;
    const dueDate = d.dueDate ?? t.dueDate;
    if (!assigneeId) { invalid.push({ taskId: t.id, title: t.title, message: "Tindak lanjut wajib punya penanggung jawab." }); continue; }
    if (!dueDate) { invalid.push({ taskId: t.id, title: t.title, message: "Tindak lanjut wajib punya tenggat." }); continue; }
    if (dueDate < today) { invalid.push({ taskId: t.id, title: t.title, message: "Tenggat tindak lanjut sudah lewat: isi tenggat baru (hari ini atau sesudahnya)." }); continue; }
    const assigneeChanged = assigneeId !== t.assigneeId;
    // Sama dengan aturan ubah tugas: mengganti penanggung jawab setelah pekerjaan dimulai wajib beralasan.
    const reason = (d.reason ?? "").trim();
    if (assigneeChanged && t.status !== "TODO" && reason.length < MIN_CANCEL_REASON) { invalid.push({ taskId: t.id, title: t.title, message: "Mengganti penanggung jawab tugas yang sudah dimulai wajib disertai alasan." }); continue; }
    plan.followUp.push({ taskId: t.id, title: t.title, assigneeId, dueDate, assigneeChanged, dueChanged: dueDate !== t.dueDate, reason: reason || null });
  }
  const undecided = open.filter((t) => !seen.has(t.id));
  return { ok: undecided.length === 0 && unknown.length === 0 && invalid.length === 0, plan, undecided, unknown, invalid };
}

export interface RelaxationLite { itemTitle: string; acknowledgedAt: string | null }
/** Pelonggaran checklist wajib yang BELUM diakui Koordinator Program. Penutupan menuntut pengakuan bila ada. */
export const unacknowledgedRelaxations = <T extends { acknowledgedAt: string | null }>(list: readonly T[]): T[] => list.filter((r) => r.acknowledgedAt === null);

/** Tugas pada proyek final tetap "hidup" (terhitung & dapat dikerjakan) hanya bila proyek SELESAI dan tugas itu ditandai tindak lanjut. */
export const isLiveFollowUp = (projectStatus: string, isFollowUp: boolean): boolean => projectStatus === "COMPLETED" && isFollowUp;
