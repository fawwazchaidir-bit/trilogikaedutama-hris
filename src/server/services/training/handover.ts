import "server-only";
import { prisma, type Tx } from "../../db";
import { trainingEnabled } from "../../env";
import { Errors } from "../../errors";
import { actorCan, type Actor } from "../../actor";
import { dateToIso } from "../../json";
import { assigneeUnavailableReason } from "@/lib/training/availability";
import type { ProjectRole, ProjectStatus } from "@/lib/training/types";
import { accessibleProjectWhere, getModuleContext } from "./access";
import { notifyUsers } from "../notifications";

/**
 * SERAH TERIMA saat karyawan berhenti: semua yang MASIH ia pegang di Training (tugas terbuka, checklist belum selesai, milestone & item kesiapan belum
 * selesai, keanggotaan proyek, penugasan instruktur) dikumpulkan per proyek. Hanya MEMBACA & MEMBERI TAHU — tidak ada yang dialihkan atau diakhiri otomatis
 * (itu keputusan PIC/Koordinator); penanda "perlu dialihkan" dihitung dari status karyawan/akun (lib/training/availability), sehingga hilang sendiri bila ia
 * diaktifkan kembali.
 */
const LIVE_PROJECT: ProjectStatus[] = ["DRAFT", "PREPARATION", "RUNNING"];
const OPEN_TASK = ["TODO", "IN_PROGRESS", "IN_REVIEW"] as const;

export interface HandoverDetail {
  tasks: { id: string; title: string; status: string; dueDate: string | null }[];
  checklist: { id: string; title: string; phase: string }[];
  milestones: { id: string; code: string; name: string }[];
  readiness: { id: string; name: string }[];
}
export interface HandoverProject {
  projectId: string; code: string; name: string; status: ProjectStatus; role: ProjectRole | null; isPic: boolean;
  counts: { tasks: number; checklist: number; milestones: number; readiness: number; instructors: number };
  /** Rincian (judul) hanya bila pelaku berhak melihat proyek itu (mis. PIC/Koordinator/Direktur); HR tanpa akses Training hanya melihat jumlah. */
  detail: HandoverDetail | null;
}
export interface HandoverDto { employeeId: string; employeeName: string; employeeActive: boolean; total: number; projects: HandoverProject[] }

type Db = Tx | typeof prisma;
interface RawProject extends Omit<HandoverProject, "detail"> { detail: HandoverDetail }

/** Kumpulkan semua pegangan karyawan per proyek yang belum ditutup/dibatalkan (tanpa memeriksa hak lihat pelaku). */
async function collect(db: Db, employeeId: string): Promise<{ name: string; active: boolean; projects: RawProject[] }> {
  const emp = await db.employee.findUnique({ where: { id: employeeId }, select: { fullName: true, isActive: true } });
  if (!emp) throw Errors.notFound("Karyawan");
  const inLive = { project: { status: { in: LIVE_PROJECT } } };
  const [members, tasks, items, milestones, readiness, instructor] = await Promise.all([
    db.trainingProjectMember.findMany({ where: { employeeId, endedAt: null, ...inLive }, select: { projectId: true, role: true } }),
    db.trainingTask.findMany({ where: { assigneeId: employeeId, status: { in: [...OPEN_TASK] }, ...inLive }, select: { id: true, projectId: true, title: true, status: true, dueDate: true }, orderBy: { dueDate: "asc" } }),
    db.trainingProjectChecklistItem.findMany({ where: { assigneeId: employeeId, isDone: false, ...inLive }, select: { id: true, projectId: true, title: true, phase: true }, orderBy: [{ phase: "asc" }, { sortOrder: "asc" }] }),
    db.trainingMilestone.findMany({ where: { assigneeId: employeeId, doneAt: null, notApplicable: false, ...inLive }, select: { id: true, projectId: true, code: true, name: true }, orderBy: { sortOrder: "asc" } }),
    db.trainingReadinessItem.findMany({ where: { assigneeId: employeeId, status: "OPEN", ...inLive }, select: { id: true, projectId: true, name: true }, orderBy: { sortOrder: "asc" } }),
    db.trainingInstructor.findUnique({ where: { employeeId }, select: { id: true } }),
  ]);
  const instr = instructor ? await db.trainingProjectInstructor.findMany({ where: { instructorId: instructor.id, ...inLive }, select: { projectId: true } }) : [];
  const ids = [...new Set([...members, ...tasks, ...items, ...milestones, ...readiness, ...instr].map((x) => x.projectId))];
  const projects = ids.length ? await db.trainingProject.findMany({ where: { id: { in: ids } }, select: { id: true, code: true, name: true, status: true }, orderBy: { code: "asc" } }) : [];
  const out: RawProject[] = projects.map((p) => {
    const role = members.find((m) => m.projectId === p.id)?.role ?? null;
    const detail: HandoverDetail = {
      tasks: tasks.filter((x) => x.projectId === p.id).map((x) => ({ id: x.id, title: x.title, status: x.status, dueDate: x.dueDate ? dateToIso(x.dueDate) : null })),
      checklist: items.filter((x) => x.projectId === p.id).map((x) => ({ id: x.id, title: x.title, phase: x.phase })),
      milestones: milestones.filter((x) => x.projectId === p.id).map((x) => ({ id: x.id, code: x.code, name: x.name })),
      readiness: readiness.filter((x) => x.projectId === p.id).map((x) => ({ id: x.id, name: x.name })),
    };
    return {
      projectId: p.id, code: p.code, name: p.name, status: p.status as ProjectStatus, role, isPic: role === "PROJECT_MANAGER",
      counts: { tasks: detail.tasks.length, checklist: detail.checklist.length, milestones: detail.milestones.length, readiness: detail.readiness.length, instructors: instr.filter((x) => x.projectId === p.id).length },
      detail,
    };
  });
  return { name: emp.fullName, active: emp.isActive, projects: out };
}
const totalOf = (p: { counts: HandoverProject["counts"] }) => p.counts.tasks + p.counts.checklist + p.counts.milestones + p.counts.readiness + p.counts.instructors;

/** Ubah hasil mentah menjadi DTO sesuai hak lihat pelaku: rincian hanya untuk proyek yang boleh ia buka. */
async function toDto(actor: Actor, employeeId: string, raw: Awaited<ReturnType<typeof collect>>): Promise<HandoverDto> {
  let visible = new Set<string>();
  if (raw.projects.length) {
    const mod = await getModuleContext(actor);
    if (mod.canSee) {
      const rows = await prisma.trainingProject.findMany({ where: { AND: [accessibleProjectWhere(actor, mod), { id: { in: raw.projects.map((p) => p.projectId) } }] }, select: { id: true } });
      visible = new Set(rows.map((r) => r.id));
    }
  }
  const projects = raw.projects.map((p): HandoverProject => ({ ...p, detail: visible.has(p.projectId) ? p.detail : null }));
  return { employeeId, employeeName: raw.name, employeeActive: raw.active, total: projects.reduce((n, p) => n + totalOf(p), 0), projects };
}

/** Daftar serah terima untuk ditampilkan (HR di proses berhenti; Koordinator/PIC/Direktur di Training). */
export async function getEmployeeHandover(actor: Actor, employeeId: string): Promise<HandoverDto> {
  if (!trainingEnabled()) return { employeeId, employeeName: "", employeeActive: true, total: 0, projects: [] };
  if (!actorCan(actor, "employee:manage")) {
    const mod = await getModuleContext(actor);
    if (!mod.caps.hasModule) throw Errors.forbidden();
  }
  return toDto(actor, employeeId, await collect(prisma, employeeId));
}

/** Penerima pemberitahuan untuk satu proyek: PIC (bila tersedia dan bukan yang berhenti); selain itu Koordinator Program + Direktur. */
async function recipientsFor(db: Db, projectId: string, leavingEmployeeId: string): Promise<string[]> {
  const pic = await db.trainingProjectMember.findFirst({
    where: { projectId, role: "PROJECT_MANAGER", endedAt: null, employeeId: { not: leavingEmployeeId } },
    select: { employee: { select: { isActive: true, user: { select: { id: true, isActive: true } } } } },
  });
  const picUser = pic?.employee.isActive && pic.employee.user?.isActive ? pic.employee.user.id : null;
  if (picUser) return [picUser];
  const [coords, supers] = await Promise.all([
    db.trainingAccess.findMany({ where: { level: "COORDINATOR", user: { isActive: true } }, select: { userId: true } }),
    db.user.findMany({ where: { role: "SUPER_ADMIN", isActive: true }, select: { id: true } }),
  ]);
  return [...coords.map((c) => c.userId), ...supers.map((s) => s.id)];
}

/**
 * Beri tahu PIC (atau Koordinator Program & Direktur bila PIC-nya yang berhenti / tak ada PIC aktif) — SATU pemberitahuan per proyek yang masih memegang pekerjaan
 * karyawan itu. Idempoten: kunci `handover:<karyawan>:<proyek>` di `training_reminder_log`, jadi menonaktifkan ulang (atau mengaktifkan lalu menonaktifkan lagi)
 * tidak mengirim ulang. Dipanggil di transaksi penonaktifan karyawan. Mengembalikan jumlah proyek yang diberi tahu.
 */
export async function notifyHandover(tx: Tx, employeeId: string): Promise<number> {
  if (!trainingEnabled()) return 0;
  const raw = await collect(tx, employeeId);
  const due = raw.projects.filter((p) => totalOf(p) > 0 || p.isPic);
  if (due.length === 0) return 0;
  const fresh = await tx.trainingReminderLog.createManyAndReturn({
    data: due.map((p) => ({ dedupeKey: `handover:${employeeId}:${p.projectId}`, kind: "handover", projectId: p.projectId })), skipDuplicates: true, select: { dedupeKey: true },
  });
  const keys = new Set(fresh.map((f) => f.dedupeKey));
  let sent = 0;
  for (const p of due) {
    if (!keys.has(`handover:${employeeId}:${p.projectId}`)) continue;
    const recipients = await recipientsFor(tx, p.projectId, employeeId);
    if (recipients.length === 0) continue;
    const parts = [p.counts.tasks && `${p.counts.tasks} tugas`, p.counts.checklist && `${p.counts.checklist} item checklist`, p.counts.milestones && `${p.counts.milestones} milestone`, p.counts.readiness && `${p.counts.readiness} item kesiapan`, p.counts.instructors && `${p.counts.instructors} penugasan instruktur`].filter(Boolean).join(", ");
    await notifyUsers(tx, recipients, {
      type: "training.handover.needed", title: p.isPic ? "PIC proyek berhenti — tetapkan PIC baru" : "Karyawan berhenti — alihkan pekerjaannya",
      body: `${raw.name} berhenti${p.isPic ? " (PIC)" : ""} · ${p.code} ${p.name}${parts ? ` · perlu dialihkan: ${parts}` : ""}`, href: `/training/proyek/${p.projectId}?tab=${p.isPic ? "tim" : "tugas"}`,
    });
    sent++;
  }
  return sent;
}

/** Ringkasan serah terima untuk hasil `deactivateEmployee` (rincian disesuaikan hak lihat pelaku). */
export async function handoverFor(actor: Actor, employeeId: string): Promise<HandoverDto> {
  if (!trainingEnabled()) return { employeeId, employeeName: "", employeeActive: false, total: 0, projects: [] };
  return toDto(actor, employeeId, await collect(prisma, employeeId));
}

export { assigneeUnavailableReason };
