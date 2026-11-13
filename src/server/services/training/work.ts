import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, transaction, type Tx } from "../../db";
import { AppError, Errors } from "../../errors";
import { parseInput } from "../../validate";
import type { Actor } from "../../actor";
import { writeAudit, diffFields } from "../../audit";
import { dateToIso, isoToDate } from "../../json";
import { notifyUsers } from "../notifications";
import { projectAbilities } from "@/lib/training/access";
import { allowedTaskTransitions, reviewBlockReason } from "@/lib/training/status";
import { isLiveFollowUp, type ClosureTaskPlan } from "@/lib/training/closure";
import { assigneeUnavailableReason, type AssigneeUnavailable } from "@/lib/training/availability";
import { checklistProgress, isTaskDueSoon, isTaskDueToday, isTaskOverdue, requiredOutstanding, type ChecklistProgress } from "@/lib/training/indicators";
import { DEFAULT_TEMPLATE_ITEMS, DEFAULT_TEMPLATE_NAME } from "@/lib/training/misc";
import {
  CHECKLIST_PHASES, TASK_STATUS_LABEL, isFinalProject, isOpenTask, type ChecklistPhase, type ProjectRole, type TaskPriority, type TaskStatus,
} from "@/lib/training/types";
import {
  applyTemplateSchema, checklistItemCreateSchema, checklistItemUpdateSchema, myTasksSchema, taskCommentSchema, taskCreateSchema,
  taskStatusSchema, taskUpdateSchema, templateSaveSchema, checklistItemDeleteSchema,
} from "@/lib/validation/training";
import {
  assertEditable, assertEditableLocked, getModuleContext, loadProjectAccess, lockProjectShared, requireAbility, requireGlobalCap, requireModule, accessibleProjectWhere, type ProjectAccess,
} from "./access";
import { assertUuid, auditProject, iso, liveTaskWhere, today } from "./shared";

// ═════════════════════════════ Tugas ═════════════════════════════

export interface TaskDto {
  id: string; projectId: string; projectCode: string; projectName: string; title: string; description: string | null;
  assigneeId: string | null; assigneeName: string | null;
  /** Penanggung jawab tidak tersedia (tugas perlu dialihkan): bukan anggota aktif, karyawan berhenti, atau akun nonaktif. */
  assigneeInactive: boolean;
  /** Alasan ketidaktersediaan (satu definisi di `lib/training/availability`); null = tersedia. */
  assigneeUnavailable: AssigneeUnavailable | null;
  dueDate: string | null; priority: TaskPriority; status: TaskStatus; requiresReview: boolean;
  completedAt: string | null; createdByName: string | null; createdAt: string;
  /** Tiga peran pemeriksaan (tugas wajib periksa), disimpan terpisah: pelaksana saat dikirim · pengirim hasil · pemeriksa. */
  executorName: string | null; submittedByName: string | null; submittedAt: string | null; reviewedByName: string | null; reviewedAt: string | null;
  /** Pelaku adalah pelaksana tugas ini (penanggung jawab saat ini atau saat hasil dikirim) — tidak boleh mematikan kewajiban pemeriksaannya sendiri. */
  viewerIsExecutor: boolean;
  overdue: boolean; commentCount: number;
  /** Status tujuan yang boleh dipilih pelaku saat ini (untuk menampilkan tombol; penegakan di server). */
  allowedNext: TaskStatus[];
  /** Pelaku boleh mengubah isi tugas (judul, penanggung jawab, tenggat, dst.). */
  canEdit: boolean;
  /** Tugas tindak lanjut: sengaja dilanjutkan setelah proyek ditutup (diputuskan saat penutupan). */
  isFollowUp: boolean;
  /** Proyek sudah final (Selesai/Dibatalkan) dan tugas ini TERKUNCI (bukan tindak lanjut pada proyek Selesai): tidak ada aksi yang tersedia. */
  locked: boolean;
}

const taskInclude = {
  project: { select: { code: true, name: true, status: true } },
  assignee: { select: { fullName: true, isActive: true, user: { select: { isActive: true } } } },
  _count: { select: { comments: true } },
} satisfies Prisma.TrainingTaskInclude;
type TaskRow = Prisma.TrainingTaskGetPayload<{ include: typeof taskInclude }>;

interface TaskCtx { actor: Actor; subject: { role: Actor["role"]; level: Awaited<ReturnType<typeof getModuleContext>>["subject"]["level"] }; roles: Map<string, ProjectRole>; activeAssignees: Set<string> }

async function buildTaskCtx(actor: Actor, rows: TaskRow[]): Promise<TaskCtx> {
  const mod = await getModuleContext(actor);
  const projectIds = [...new Set(rows.map((r) => r.projectId))];
  const members = projectIds.length
    ? await prisma.trainingProjectMember.findMany({ where: { projectId: { in: projectIds }, endedAt: null }, select: { projectId: true, employeeId: true, role: true } })
    : [];
  const roles = new Map<string, ProjectRole>();
  const activeAssignees = new Set<string>();
  for (const m of members) {
    activeAssignees.add(`${m.projectId}:${m.employeeId}`);
    if (m.employeeId === actor.employeeId) roles.set(m.projectId, m.role);
  }
  return { actor, subject: mod.subject, roles, activeAssignees };
}

async function toTaskDtos(rows: TaskRow[], ctx: TaskCtx): Promise<TaskDto[]> {
  const userIds = [...new Set(rows.flatMap((r) => [r.createdById, r.submittedById, r.reviewedById]).filter((x): x is string => !!x))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const uname = new Map(users.map((u) => [u.id, u.name]));
  const execIds = [...new Set(rows.map((r) => r.assigneeAtSubmitId).filter((x): x is string => !!x))];
  const execs = execIds.length ? await prisma.employee.findMany({ where: { id: { in: execIds } }, select: { id: true, fullName: true } }) : [];
  const ename = new Map(execs.map((e) => [e.id, e.fullName]));
  const t = today();
  return rows.map((r) => {
    const abilities = projectAbilities(ctx.subject, ctx.roles.get(r.projectId) ?? null);
    const canManage = abilities.has("manage_tasks");
    // Hak pemilik hanya untuk anggota AKTIF; identitas pelaksana (untuk pemisahan pemeriksa) tidak bergantung pada keanggotaan.
    const isAssignee = !!ctx.actor.employeeId && r.assigneeId === ctx.actor.employeeId && ctx.roles.has(r.projectId);
    const isSubmitter = !!r.submittedById && r.submittedById === ctx.actor.userId;
    const isExecutor = !!ctx.actor.employeeId && (r.assigneeAtSubmitId === ctx.actor.employeeId || r.assigneeId === ctx.actor.employeeId);
    const due = r.dueDate ? dateToIso(r.dueDate) : null;
    const locked = isFinalProject(r.project.status) && !isLiveFollowUp(r.project.status, r.isFollowUp);
    const unavailable = r.assigneeId && r.assignee ? assigneeUnavailableReason({ activeMember: ctx.activeAssignees.has(`${r.projectId}:${r.assigneeId}`), employeeActive: r.assignee.isActive, accountActive: r.assignee.user?.isActive ?? null }) : null;
    return {
      id: r.id, projectId: r.projectId, projectCode: r.project.code, projectName: r.project.name, title: r.title, description: r.description,
      assigneeId: r.assigneeId, assigneeName: r.assignee?.fullName ?? null,
      assigneeInactive: unavailable !== null, assigneeUnavailable: unavailable,
      dueDate: due, priority: r.priority, status: r.status, requiresReview: r.requiresReview, completedAt: iso(r.completedAt),
      createdByName: uname.get(r.createdById) ?? null, createdAt: r.createdAt.toISOString(),
      executorName: r.assigneeAtSubmitId ? ename.get(r.assigneeAtSubmitId) ?? null : null,
      submittedByName: r.submittedById ? uname.get(r.submittedById) ?? null : null, submittedAt: iso(r.submittedAt),
      reviewedByName: r.reviewedById ? uname.get(r.reviewedById) ?? null : null, reviewedAt: iso(r.reviewedAt), viewerIsExecutor: isExecutor,
      overdue: isTaskOverdue({ status: r.status, dueDate: due }, t), commentCount: r._count.comments,
      allowedNext: abilities.has("view") && !locked ? allowedTaskTransitions({ status: r.status, requiresReview: r.requiresReview, isAssignee, canManage, isSubmitter, isExecutor }) : [],
      canEdit: canManage && !locked, isFollowUp: r.isFollowUp, locked,
    };
  });
}

const PRIORITY_RANK: Record<TaskPriority, number> = { URGENT: 0, HIGH: 1, NORMAL: 2, LOW: 3 };
const STATUS_RANK: Record<TaskStatus, number> = { IN_REVIEW: 0, IN_PROGRESS: 1, TODO: 2, DONE: 3, CANCELLED: 4 };
function sortTasks(list: TaskDto[]): TaskDto[] {
  return [...list].sort((a, b) =>
    (isOpenTask(a.status) ? 0 : 1) - (isOpenTask(b.status) ? 0 : 1)
    || (a.dueDate ?? "9999") .localeCompare(b.dueDate ?? "9999")
    || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
    || STATUS_RANK[a.status] - STATUS_RANK[b.status]
    || a.createdAt.localeCompare(b.createdAt));
}

/** Proyek final mengunci semua tugasnya, KECUALI tindak lanjut pada proyek yang Selesai (dibuat saat penutupan; proyek Dibatalkan tidak punya tindak lanjut). */
function assertTaskEditable(project: Pick<ProjectAccess["project"], "status">, task: { isFollowUp: boolean }): void {
  if (isLiveFollowUp(project.status, task.isFollowUp)) return;
  assertEditable(project);
}

/**
 * Versi OTORITATIF (di dalam transaksi, setelah kunci bersama): status proyek dan penanda tindak lanjut tugas dibaca ULANG. Penutupan yang berhasil lebih dulu menandai tindak lanjut
 * dan mengunci tugas lain; di sini keduanya terbaca segar, sehingga tugas yang bukan tindak lanjut ditolak dengan pesan "proyek sudah ditutup" sedangkan tindak lanjut tetap boleh dikerjakan.
 */
async function assertTaskEditableLocked(tx: Tx, projectId: string, taskId: string): Promise<void> {
  await lockProjectShared(tx, projectId);
  const p = await tx.trainingProject.findUnique({ where: { id: projectId }, select: { status: true } });
  if (!p) throw Errors.notFound("Proyek");
  if (!isFinalProject(p.status)) return;
  const t = await tx.trainingTask.findUnique({ where: { id: taskId }, select: { isFollowUp: true } });
  assertTaskEditable(p, { isFollowUp: t?.isFollowUp ?? false });
}

async function loadTask(actor: Actor, taskId: string): Promise<{ task: TaskRow; access: ProjectAccess }> {
  assertUuid(taskId, "Tugas");
  const task = await prisma.trainingTask.findUnique({ where: { id: taskId }, include: taskInclude });
  if (!task) throw Errors.notFound("Tugas");
  // Akses diperiksa terhadap PROYEK milik tugas itu: mengganti ID tugas tidak memberi akses ke proyek lain (404).
  const access = await loadProjectAccess(actor, task.projectId);
  return { task, access };
}

export async function listProjectTasks(actor: Actor, projectId: string): Promise<TaskDto[]> {
  await loadProjectAccess(actor, projectId);
  const rows = await prisma.trainingTask.findMany({ where: { projectId }, include: taskInclude });
  return sortTasks(await toTaskDtos(rows, await buildTaskCtx(actor, rows)));
}

export async function getTask(actor: Actor, taskId: string): Promise<TaskDto> {
  const { task } = await loadTask(actor, taskId);
  return (await toTaskDtos([task], await buildTaskCtx(actor, [task])))[0]!;
}

export async function listMyTasks(actor: Actor, raw: unknown = {}): Promise<TaskDto[]> {
  const mod = await requireModule(actor);
  const f = parseInput(myTasksSchema, raw);
  if (!actor.employeeId) return [];
  const rows = await prisma.trainingTask.findMany({
    // Tugas terbuka hanya yang "hidup" (lihat `liveTaskWhere`); riwayat Selesai/Dibatalkan tetap tampil (terkunci bila proyeknya final).
    where: { AND: [{ OR: [liveTaskWhere, { status: { in: ["DONE", "CANCELLED"] } }] }, { assigneeId: actor.employeeId, ...(f.projectId ? { projectId: f.projectId } : {}), project: { AND: [accessibleProjectWhere(actor, mod), activeMemberOf(actor.employeeId)] } }] },
    include: taskInclude,
  });
  const dtos = await toTaskDtos(rows, await buildTaskCtx(actor, rows));
  const t = today();
  const filter = f.filter ?? "open";
  const pick = dtos.filter((d) => {
    const lite = { status: d.status, dueDate: d.dueDate };
    switch (filter) {
      case "all": return true;
      case "done": return d.status === "DONE";
      case "overdue": return isTaskOverdue(lite, t);
      case "today": return isTaskDueToday(lite, t);
      case "soon": return isTaskDueSoon(lite, t);
      default: return isOpenTask(d.status);
    }
  });
  return sortTasks(pick);
}

/** Jumlah tugas terbuka milik pelaku yang sudah lewat tenggat (lencana menu "Tugas Saya"). Hanya proyek yang masih boleh ia lihat. */
export async function countMyOverdueTasks(actor: Actor): Promise<number> {
  if (!actor.employeeId) return 0;
  const mod = await getModuleContext(actor);
  return prisma.trainingTask.count({
    where: { AND: [liveTaskWhere, { assigneeId: actor.employeeId, status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] }, dueDate: { lt: isoToDate(today()) }, project: { AND: [accessibleProjectWhere(actor, mod), activeMemberOf(actor.employeeId)] } }] },
  });
}

/** Filter proyek: pelaku masih ANGGOTA AKTIF proyek itu ("Tugas Saya", lencana, dan checklist saya hanya memuat proyek tempat ia masih anggota). */
const activeMemberOf = (employeeId: string): Prisma.TrainingProjectWhereInput => ({ members: { some: { employeeId, endedAt: null } } });

/**
 * Hak "pemilik" (penanggung jawab) atas tugas/checklist HANYA berlaku bila pelaku masih anggota aktif proyek: nama di kolom penanggung jawab saja tidak cukup
 * (anggota yang sudah dikeluarkan tetapi masih Pemantau/Manajer tetap boleh MELIHAT proyek, bukan mengubah tugas lamanya). Dibaca ulang di dalam transaksi dengan
 * kunci baris bersama (FOR SHARE): mengakhiri keanggotaan yang berbarengan menunggu transaksi ini selesai, sehingga tidak ada celah balapan.
 */
async function assertStillActiveMember(tx: Tx, projectId: string, employeeId: string): Promise<void> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "training_project_members" WHERE "projectId" = ${projectId}::uuid AND "employeeId" = ${employeeId}::uuid AND "endedAt" IS NULL FOR SHARE`;
  if (rows.length === 0) throw Errors.forbidden(NOT_MEMBER_MESSAGE);
}
const NOT_MEMBER_MESSAGE = "Anda sudah tidak menjadi anggota aktif proyek ini, sehingga tidak dapat mengubah tugas atau checklist yang tercatat atas nama Anda. Minta PIC mengalihkannya atau menambahkan Anda kembali ke tim.";

/** Penanggung jawab tugas harus anggota AKTIF proyek itu — tugas tidak dapat diberikan ke orang di luar tim. */
async function assertAssigneeInTeam(tx: Tx | typeof prisma, projectId: string, employeeId: string | null | undefined): Promise<void> {
  if (!employeeId) return;
  // Karyawan yang sudah berhenti tidak boleh diberi tugas/checklist BARU (pekerjaan lama miliknya ditandai "alihkan", bukan ditambah).
  const e = await tx.employee.findUnique({ where: { id: employeeId }, select: { isActive: true } });
  if (!e?.isActive) throw Errors.validation("Karyawan ini sudah nonaktif (berhenti). Pilih penanggung jawab lain.", { assigneeId: "Karyawan nonaktif" });
  const m = await tx.trainingProjectMember.count({ where: { projectId, employeeId, endedAt: null } });
  if (m === 0) throw Errors.validation("Penanggung jawab harus anggota aktif proyek. Tambahkan dulu pada tab Tim.", { assigneeId: "Bukan anggota proyek" });
}

async function notifyEmployee(tx: Tx, actor: Actor, employeeId: string | null, n: { type: string; title: string; body: string; href: string }): Promise<void> {
  if (!employeeId) return;
  const e = await tx.employee.findUnique({ where: { id: employeeId }, select: { userId: true } });
  if (e?.userId && e.userId !== actor.userId) await notifyUsers(tx, [e.userId], n);
}

export async function createTask(actor: Actor, projectId: string, raw: unknown): Promise<{ id: string }> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "manage_tasks");
  assertEditable(access.project);
  const input = parseInput(taskCreateSchema, raw);
  return transaction(async (tx) => {
    await assertEditableLocked(tx, projectId);                       // kunci bersama + status proyek SEGAR (tidak bisa menyelinap ke proyek yang sedang/ sudah ditutup)
    await assertAssigneeInTeam(tx, projectId, input.assigneeId);
    const t = await tx.trainingTask.create({
      data: { projectId, title: input.title, description: input.description, assigneeId: input.assigneeId, dueDate: input.dueDate ? isoToDate(input.dueDate) : null, priority: input.priority, requiresReview: input.requiresReview, createdById: actor.userId },
    });
    await auditProject(tx, actor, projectId, { action: "training.task.create", summary: `Tugas "${t.title}" dibuat di ${access.project.code}`, after: { taskId: t.id, assigneeId: t.assigneeId, dueDate: input.dueDate, priority: t.priority } });
    await notifyEmployee(tx, actor, input.assigneeId, { type: "training.task.assigned", title: "Tugas baru untuk Anda", body: `${access.project.code} · ${t.title}${input.dueDate ? ` · tenggat ${input.dueDate}` : ""}`, href: "/training/tugas-saya" });
    return { id: t.id };
  });
}

export async function updateTask(actor: Actor, taskId: string, raw: unknown): Promise<void> {
  const { task, access } = await loadTask(actor, taskId);
  requireAbility(access, "manage_tasks");
  assertTaskEditable(access.project, task);
  const input = parseInput(taskUpdateSchema, raw);
  const reason = input.reason?.trim() || null;
  await transaction(async (tx) => {
    await assertTaskEditableLocked(tx, task.projectId, taskId);
    // Penanggung jawab divalidasi hanya bila DIGANTI: menyunting hal lain pada tugas yang masih atas nama karyawan yang sudah berhenti tidak boleh terkunci.
    if ("assigneeId" in input && (input.assigneeId ?? null) !== task.assigneeId) await assertAssigneeInTeam(tx, task.projectId, input.assigneeId);
    const data: Prisma.TrainingTaskUncheckedUpdateInput = {};
    for (const k of ["title", "description", "assigneeId", "priority", "requiresReview"] as const) if (k in input) (data as Record<string, unknown>)[k] = input[k];
    if ("dueDate" in input) data.dueDate = input.dueDate ? isoToDate(input.dueDate) : null;

    // Pemisahan pelaksana–pemeriksa: perubahan yang menyentuh syarat pemeriksaan harus transparan dan tidak boleh dilakukan pelaksananya sendiri.
    const assigneeChanged = "assigneeId" in input && (input.assigneeId ?? null) !== task.assigneeId;
    const reviewChanged = input.requiresReview !== undefined && input.requiresReview !== task.requiresReview;
    const turningOff = reviewChanged && input.requiresReview === false;
    const isExecutor = !!actor.employeeId && (task.assigneeId === actor.employeeId || task.assigneeAtSubmitId === actor.employeeId);
    if (turningOff && isExecutor) throw Errors.forbidden("Pelaksana tidak dapat mematikan kewajiban pemeriksaan tugasnya sendiri. Minta pengelola proyek lain (mis. Koordinator Program atau Direktur) yang mengubahnya.");
    const started = task.status === "IN_PROGRESS" || task.status === "IN_REVIEW" || task.status === "DONE";
    if (started && (assigneeChanged || reviewChanged) && !reason) {
      throw Errors.validation("Mengubah penanggung jawab atau kewajiban pemeriksaan setelah pekerjaan dimulai wajib disertai alasan.", { reason: "Alasan wajib diisi" });
    }
    // Mengubah "perlu diperiksa" saat tugas sedang menunggu pemeriksaan akan membuat statusnya tidak konsisten.
    if (input.requiresReview === false && task.status === "IN_REVIEW") throw Errors.conflict("Tugas sedang menunggu pemeriksaan. Putuskan hasil pemeriksaan dulu sebelum mematikan syarat pemeriksaan.");

    const before = { title: task.title, description: task.description, assigneeId: task.assigneeId, priority: task.priority, requiresReview: task.requiresReview, dueDate: task.dueDate ? dateToIso(task.dueDate) : null };
    const after = { ...before, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v instanceof Date ? dateToIso(v) : v])) };
    const d = diffFields(before, after);
    if (d.changed.length === 0) return;
    await tx.trainingTask.update({ where: { id: taskId }, data });
    await auditProject(tx, actor, task.projectId, {
      action: "training.task.update", summary: `Tugas "${task.title}" diubah (${d.changed.join(", ")})${started && (assigneeChanged || reviewChanged) ? " setelah pekerjaan dimulai" : ""}`,
      before: { taskId, ...d.before }, after: { taskId, ...d.after }, ...(reason ? { reason } : {}),
    });
    if (assigneeChanged || reviewChanged) {
      // Terlihat oleh tim: catatan pada tugas (append-only) memuat apa yang berubah, siapa pelakunya (penulis), dan alasannya.
      const ids = [task.assigneeId, (input.assigneeId ?? null)].filter((x): x is string => !!x);
      const emps = ids.length ? await tx.employee.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
      const nm = (id: string | null) => (id ? emps.find((e) => e.id === id)?.fullName ?? "—" : "(kosong)");
      const parts = [
        assigneeChanged && `penanggung jawab ${nm(task.assigneeId)} → ${nm(input.assigneeId ?? null)}`,
        reviewChanged && `kewajiban pemeriksaan ${task.requiresReview ? "aktif" : "tidak aktif"} → ${input.requiresReview ? "aktif" : "tidak aktif"}`,
      ].filter(Boolean).join("; ");
      await tx.trainingTaskComment.create({ data: { taskId, authorId: actor.userId, body: `[Perubahan syarat tugas] ${parts}${reason ? ` — alasan: ${reason}` : ""}` } });
    }
    if (d.changed.includes("assigneeId")) {
      await notifyEmployee(tx, actor, input.assigneeId ?? null, { type: "training.task.assigned", title: "Tugas dialihkan kepada Anda", body: `${access.project.code} · ${task.title}`, href: "/training/tugas-saya" });
    }
  });
}

/**
 * Ubah status tugas. Penanggung jawab: sesuai alur pada `allowedTaskTransitions`; pengelola tugas: lebih luas, tetapi tidak
 * dapat memeriksa hasil tugasnya sendiri. Status "Selesai" pada tugas TIDAK memengaruhi surat tugas, uang harian,
 * dokumen, pembayaran, atau status proyek.
 */
export async function changeTaskStatus(actor: Actor, taskId: string, raw: unknown): Promise<TaskDto> {
  const { task, access } = await loadTask(actor, taskId);
  assertTaskEditable(access.project, task);
  const input = parseInput(taskStatusSchema, raw);
  const named = !!actor.employeeId && task.assigneeId === actor.employeeId;
  const isAssignee = named && access.memberRole !== null;       // pemilik SAH: tercatat sebagai penanggung jawab DAN masih anggota aktif proyek
  const canManage = access.abilities.has("manage_tasks");
  if (!isAssignee && !canManage) {
    if (named) throw Errors.forbidden(NOT_MEMBER_MESSAGE);
    throw Errors.forbidden("Hanya penanggung jawab tugas atau pengelola proyek yang dapat mengubah status tugas.");
  }
  // Tiga identitas pemeriksaan: pengirim hasil (akun), pelaksana (karyawan; saat dikirim atau penanggung jawab saat ini) — pemeriksa harus berbeda dari keduanya.
  const isSubmitter = !!task.submittedById && task.submittedById === actor.userId;
  const isExecutor = !!actor.employeeId && (task.assigneeAtSubmitId === actor.employeeId || named);
  const allowed = allowedTaskTransitions({ status: task.status, requiresReview: task.requiresReview, isAssignee, canManage, isSubmitter, isExecutor });
  if (!allowed.includes(input.status)) {
    if (task.status === "IN_REVIEW" && input.status === "DONE") {
      const why = reviewBlockReason({ isAssignee, isSubmitter, isExecutor });
      if (why === "SUBMITTER") throw Errors.forbidden("Anda yang mengirim hasil ini ke pemeriksaan, sehingga tidak dapat memeriksanya sendiri. Minta pengelola proyek lain (mis. Koordinator Program atau Direktur) memeriksanya.");
      if (why === "EXECUTOR") throw Errors.forbidden("Anda tidak dapat memeriksa hasil tugas Anda sendiri. Minta Project Manager atau Koordinator Program memeriksanya.");
    }
    if (task.requiresReview && input.status === "DONE" && task.status !== "IN_REVIEW") throw Errors.conflict("Tugas ini perlu diperiksa: kirim dulu ke \"Menunggu pemeriksaan\".");
    throw Errors.conflict(`Status tugas tidak dapat diubah dari "${TASK_STATUS_LABEL[task.status]}" ke "${TASK_STATUS_LABEL[input.status]}".`);
  }
  await transaction(async (tx) => {
    await assertTaskEditableLocked(tx, task.projectId, taskId);
    if (isAssignee && !canManage) await assertStillActiveMember(tx, task.projectId, actor.employeeId!);   // hak lahir dari keanggotaan: baca ulang bersama kunci
    const done = input.status === "DONE";
    const now = new Date();
    const data: Prisma.TrainingTaskUncheckedUpdateManyInput = { status: input.status, completedAt: done ? now : null, completedById: done ? actor.userId : null };
    if (input.status === "IN_REVIEW") {
      // Hasil dikirim: catat pengirim, waktu, dan pelaksana SAAT ITU (salinan — tidak ikut berubah bila penanggung jawab dialihkan/dikosongkan).
      Object.assign(data, { submittedById: actor.userId, submittedAt: now, assigneeAtSubmitId: task.assigneeId, reviewedById: null, reviewedAt: null });
    } else if (done && task.status === "IN_REVIEW") {
      Object.assign(data, { reviewedById: actor.userId, reviewedAt: now });          // pengirim & pelaksana tetap tercatat
    } else {
      // Siklus pemeriksaan berakhir (ditarik/dikembalikan/dibuka kembali/langsung selesai tanpa periksa): kosongkan; riwayat ada di audit.
      Object.assign(data, { submittedById: null, submittedAt: null, assigneeAtSubmitId: null, reviewedById: null, reviewedAt: null });
    }
    const r = await tx.trainingTask.updateMany({ where: { id: taskId, status: task.status }, data });
    if (r.count === 0) throw Errors.conflict("Status tugas baru saja diubah pengguna lain. Muat ulang halaman.");
    await auditProject(tx, actor, task.projectId, {
      action: "training.task.status", summary: `Tugas "${task.title}": ${TASK_STATUS_LABEL[task.status]} → ${TASK_STATUS_LABEL[input.status]}`,
      before: { taskId, status: task.status }, after: { taskId, status: input.status }, reason: input.note,
    });
    if (input.note) await tx.trainingTaskComment.create({ data: { taskId, authorId: actor.userId, body: `[${TASK_STATUS_LABEL[input.status]}] ${input.note}` } });
    if (input.status === "IN_REVIEW") {
      const pic = await tx.trainingProjectMember.findFirst({ where: { projectId: task.projectId, role: "PROJECT_MANAGER", endedAt: null }, select: { employeeId: true } });
      await notifyEmployee(tx, actor, pic?.employeeId ?? null, { type: "training.task.review", title: "Tugas menunggu pemeriksaan", body: `${access.project.code} · ${task.title}`, href: `/training/proyek/${task.projectId}?tab=tugas` });
    }
  });
  return getTask(actor, taskId);
}

export interface TaskCommentDto { id: string; authorName: string; body: string; createdAt: string }

export async function listComments(actor: Actor, taskId: string): Promise<TaskCommentDto[]> {
  await loadTask(actor, taskId);
  const rows = await prisma.trainingTaskComment.findMany({ where: { taskId }, orderBy: { createdAt: "asc" } });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.authorId))] } }, select: { id: true, name: true } });
  const n = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ id: r.id, authorName: n.get(r.authorId) ?? "—", body: r.body, createdAt: r.createdAt.toISOString() }));
}

/** Semua anggota proyek boleh berkomentar pada tugas proyeknya (catatan tidak dapat diubah/dihapus). */
export async function addComment(actor: Actor, taskId: string, raw: unknown): Promise<void> {
  const { task, access } = await loadTask(actor, taskId);
  assertTaskEditable(access.project, task);
  // Komentar adalah perubahan data: hanya ANGGOTA proyek (atau pengelola tugas) — Pemantau/Super Admin hanya melihat.
  if (!access.memberRole && !access.abilities.has("manage_tasks")) throw Errors.forbidden("Hanya anggota proyek yang dapat berkomentar pada tugas.");
  const { body } = parseInput(taskCommentSchema, raw);
  await transaction(async (tx) => {
    await assertTaskEditableLocked(tx, task.projectId, taskId);
    await tx.trainingTaskComment.create({ data: { taskId, authorId: actor.userId, body } });
    await notifyEmployee(tx, actor, task.assigneeId && task.assigneeId !== actor.employeeId ? task.assigneeId : null, { type: "training.task.comment", title: "Komentar baru pada tugas Anda", body: `${task.title}: ${body.slice(0, 120)}`, href: "/training/tugas-saya" });
  });
}

// ═════════════════════════════ Checklist proyek ═════════════════════════════

export interface ChecklistItemDto {
  id: string; projectId: string; phase: ChecklistPhase; title: string; isRequired: boolean; sortOrder: number;
  assigneeId: string | null; assigneeName: string | null; isDone: boolean; doneAt: string | null; doneByName: string | null; note: string | null; sourceTemplateName: string | null;
  /** Pelaku boleh mengubah tanda selesai (penanggung jawab item atau pengelola checklist). */
  canToggle: boolean;
  /** Penanggung jawab tidak tersedia (berhenti / akun nonaktif / bukan anggota aktif) → perlu dialihkan; null = tersedia. */
  assigneeUnavailable: AssigneeUnavailable | null;
}
export interface ChecklistDto {
  items: ChecklistItemDto[]; progress: ChecklistProgress; requiredOutstanding: number; canManage: boolean;
  /** Boleh menjadikan item WAJIB tidak wajib / menghapusnya (beralasan). Setelah proyek Berjalan hanya Koordinator Program/Direktur. */
  canRelax: boolean;
}

export async function listChecklist(actor: Actor, projectId: string): Promise<ChecklistDto> {
  const access = await loadProjectAccess(actor, projectId);
  const rows = await prisma.trainingProjectChecklistItem.findMany({
    where: { projectId }, orderBy: [{ phase: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }], include: { assignee: { select: { fullName: true, isActive: true, user: { select: { isActive: true } } } } },
  });
  const activeIds = new Set((await prisma.trainingProjectMember.findMany({ where: { projectId, endedAt: null }, select: { employeeId: true } })).map((m) => m.employeeId));
  const doers = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.doneById).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const dn = new Map(doers.map((u) => [u.id, u.name]));
  const canManage = access.abilities.has("manage_checklist");
  const items = rows.map((r): ChecklistItemDto => ({
    id: r.id, projectId: r.projectId, phase: r.phase, title: r.title, isRequired: r.isRequired, sortOrder: r.sortOrder, assigneeId: r.assigneeId, assigneeName: r.assignee?.fullName ?? null,
    isDone: r.isDone, doneAt: iso(r.doneAt), doneByName: r.doneById ? dn.get(r.doneById) ?? null : null, note: r.note, sourceTemplateName: r.sourceTemplateName,
    canToggle: canManage || (!!actor.employeeId && r.assigneeId === actor.employeeId && access.memberRole !== null),
    assigneeUnavailable: r.assigneeId && r.assignee ? assigneeUnavailableReason({ activeMember: activeIds.has(r.assigneeId), employeeActive: r.assignee.isActive, accountActive: r.assignee.user?.isActive ?? null }) : null,
  }));
  const canRelax = canManage && (access.project.status !== "RUNNING" || access.abilities.has("close"));
  return { items, progress: checklistProgress(items), requiredOutstanding: requiredOutstanding(items).length, canManage, canRelax };
}

async function loadItem(actor: Actor, itemId: string) {
  assertUuid(itemId, "Item checklist");
  const item = await prisma.trainingProjectChecklistItem.findUnique({ where: { id: itemId } });
  if (!item) throw Errors.notFound("Item checklist");
  const access = await loadProjectAccess(actor, item.projectId);
  return { item, access };
}

export async function applyChecklistTemplate(actor: Actor, projectId: string, raw: unknown): Promise<{ added: number }> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "manage_checklist");
  assertEditable(access.project);
  const { templateId } = parseInput(applyTemplateSchema, raw);
  return transaction(async (tx) => {
    await assertEditableLocked(tx, projectId);
    const tpl = await tx.trainingChecklistTemplate.findUnique({ where: { id: templateId }, include: { items: { orderBy: [{ phase: "asc" }, { sortOrder: "asc" }] } } });
    if (!tpl || !tpl.isActive) throw Errors.validation("Template tidak ditemukan atau nonaktif.", { templateId: "Template tidak valid" });
    if ((await tx.trainingProjectChecklistItem.count({ where: { projectId, sourceTemplateName: tpl.name } })) > 0) throw Errors.conflict(`Template "${tpl.name}" sudah diterapkan pada proyek ini.`);
    const max = await tx.trainingProjectChecklistItem.aggregate({ where: { projectId }, _max: { sortOrder: true } });
    const base = (max._max.sortOrder ?? -1) + 1;
    // Item DISALIN menjadi milik proyek: perubahan template di masa depan tidak mengubah checklist proyek ini.
    await tx.trainingProjectChecklistItem.createMany({ data: tpl.items.map((it, i) => ({ projectId, phase: it.phase, title: it.title, isRequired: it.isRequired, sortOrder: base + i, sourceTemplateName: tpl.name, createdById: actor.userId })) });
    await auditProject(tx, actor, projectId, { action: "training.checklist.apply", summary: `Template checklist "${tpl.name}" diterapkan (${tpl.items.length} item)`, after: { template: tpl.name, items: tpl.items.length } });
    return { added: tpl.items.length };
  });
}

export async function addChecklistItem(actor: Actor, projectId: string, raw: unknown): Promise<{ id: string }> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "manage_checklist");
  assertEditable(access.project);
  const input = parseInput(checklistItemCreateSchema, raw);
  return transaction(async (tx) => {
    await assertEditableLocked(tx, projectId);                       // item (terutama yang WAJIB) tidak boleh menyelinap ke proyek yang sedang/sudah ditutup
    await assertAssigneeInTeam(tx, projectId, input.assigneeId);
    const max = await tx.trainingProjectChecklistItem.aggregate({ where: { projectId, phase: input.phase }, _max: { sortOrder: true } });
    const it = await tx.trainingProjectChecklistItem.create({ data: { projectId, phase: input.phase, title: input.title, isRequired: input.isRequired, assigneeId: input.assigneeId, note: input.note, sortOrder: (max._max.sortOrder ?? -1) + 1, createdById: actor.userId } });
    await auditProject(tx, actor, projectId, { action: "training.checklist.add", summary: `Item checklist "${it.title}" ditambahkan${it.isRequired ? " (wajib)" : ""}`, after: { itemId: it.id, phase: it.phase, isRequired: it.isRequired } });
    return { id: it.id };
  });
}

export async function updateChecklistItem(actor: Actor, itemId: string, raw: unknown): Promise<void> {
  const { item, access } = await loadItem(actor, itemId);
  assertEditable(access.project);
  const input = parseInput(checklistItemUpdateSchema, raw);
  const canManage = access.abilities.has("manage_checklist");
  const named = !!actor.employeeId && item.assigneeId === actor.employeeId;
  const isOwner = named && access.memberRole !== null;           // pemilik SAH: penanggung jawab DAN masih anggota aktif proyek
  const structural = ["phase", "title", "isRequired", "assigneeId", "note"].some((k) => k in input);
  if (structural && !canManage) throw Errors.forbidden("Hanya pengelola checklist yang dapat mengubah isi item.");
  if ("isDone" in input && !canManage && !isOwner) throw Errors.forbidden(named ? NOT_MEMBER_MESSAGE : "Hanya penanggung jawab item atau pengelola checklist yang dapat menandai selesai.");
  // Melonggarkan item WAJIB (jadi tidak wajib) harus beralasan, tercatat sebagai pelonggaran, dan harus diakui saat menutup proyek.
  const demoting = input.isRequired === false && item.isRequired;
  const promoting = input.isRequired === true && !item.isRequired;
  const relaxReason = demoting ? assertMayRelax(access, input.reason) : null;
  await transaction(async (tx) => {
    await assertEditableLocked(tx, item.projectId);
    if ("isDone" in input && !canManage && isOwner) await assertStillActiveMember(tx, item.projectId, actor.employeeId!);
    if ("assigneeId" in input && (input.assigneeId ?? null) !== item.assigneeId) await assertAssigneeInTeam(tx, item.projectId, input.assigneeId);
    const data: Prisma.TrainingProjectChecklistItemUncheckedUpdateInput = {};
    for (const k of ["phase", "title", "isRequired", "assigneeId", "note"] as const) if (k in input) (data as Record<string, unknown>)[k] = input[k];
    if (input.isDone !== undefined && input.isDone !== item.isDone) {
      data.isDone = input.isDone; data.doneAt = input.isDone ? new Date() : null; data.doneById = input.isDone ? actor.userId : null;
    }
    if (Object.keys(data).length === 0) return;
    await tx.trainingProjectChecklistItem.update({ where: { id: itemId }, data });
    const toggled = data.isDone !== undefined;
    if (demoting) {
      const snap = { itemTitle: (data.title as string | undefined) ?? item.title, phase: (data.phase as ChecklistPhase | undefined) ?? item.phase };
      await tx.trainingChecklistRelaxation.upsert({
        where: { itemId },
        create: { projectId: item.projectId, itemId, kind: "DEMOTED", reason: relaxReason!, actorId: actor.userId, ...snap },
        update: { kind: "DEMOTED", reason: relaxReason!, actorId: actor.userId, createdAt: new Date(), acknowledgedAt: null, acknowledgedById: null, ...snap },
      });
    }
    if (promoting) await tx.trainingChecklistRelaxation.deleteMany({ where: { itemId } });   // wajib lagi: tidak ada lagi yang dilonggarkan
    await auditProject(tx, actor, item.projectId, {
      action: toggled ? "training.checklist.toggle" : "training.checklist.update",
      summary: toggled ? `Checklist "${item.title}" ${input.isDone ? "ditandai selesai" : "dibuka kembali"}${item.isRequired ? " (wajib)" : ""}`
        : demoting ? `Item checklist WAJIB "${item.title}" dijadikan TIDAK WAJIB (pelonggaran)` : promoting ? `Item checklist "${item.title}" dijadikan wajib` : `Item checklist "${item.title}" diubah`,
      before: { itemId, isDone: item.isDone, isRequired: item.isRequired }, after: { itemId, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])) },
      ...(relaxReason ? { reason: relaxReason } : {}),
    });
  });
}

export async function deleteChecklistItem(actor: Actor, itemId: string, raw: unknown = {}): Promise<void> {
  const { item, access } = await loadItem(actor, itemId);
  requireAbility(access, "manage_checklist");
  assertEditable(access.project);
  const { reason } = parseInput(checklistItemDeleteSchema, raw ?? {});
  if (item.isDone) throw Errors.conflict("Item yang sudah selesai tidak dapat dihapus. Buka kembali tanda selesainya dulu bila memang keliru.");
  const relaxReason = item.isRequired ? assertMayRelax(access, reason) : null;
  await transaction(async (tx) => {
    await assertEditableLocked(tx, item.projectId);
    await tx.trainingProjectChecklistItem.delete({ where: { id: itemId } });
    if (item.isRequired) {
      await tx.trainingChecklistRelaxation.upsert({
        where: { itemId },
        create: { projectId: item.projectId, itemId, itemTitle: item.title, phase: item.phase, kind: "DELETED", reason: relaxReason!, actorId: actor.userId },
        update: { kind: "DELETED", reason: relaxReason!, actorId: actor.userId, createdAt: new Date(), acknowledgedAt: null, acknowledgedById: null },
      });
    } else {
      await tx.trainingChecklistRelaxation.updateMany({ where: { itemId }, data: { kind: "DELETED" } });   // sebelumnya sudah dilonggarkan (tidak wajib), kini dihapus
    }
    await auditProject(tx, actor, item.projectId, {
      action: "training.checklist.delete", summary: `Item checklist "${item.title}" dihapus${item.isRequired ? " (WAJIB — pelonggaran)" : ""}`,
      before: { itemId, phase: item.phase, isRequired: item.isRequired }, ...(relaxReason ? { reason: relaxReason } : {}),
    });
  });
}

const MIN_RELAX_REASON = 5;
/**
 * Melonggarkan item checklist WAJIB (dijadikan tidak wajib atau dihapus): alasan wajib. Setelah proyek BERJALAN, hanya pemegang hak menutup proyek
 * (Koordinator Program / Direktur) yang boleh — itulah persetujuannya; PIC dan Admin Program meminta mereka. Sebelum itu (Draf/Persiapan) cukup beralasan.
 * Pelonggaran dicatat (`TrainingChecklistRelaxation`), tampil di ringkasan penutupan, dan harus diakui saat menutup.
 */
function assertMayRelax(access: ProjectAccess, reason: string | null | undefined): string {
  if (access.project.status === "RUNNING" && !access.abilities.has("close")) {
    throw Errors.forbidden("Setelah proyek berjalan, checklist wajib hanya dapat dijadikan tidak wajib atau dihapus oleh Koordinator Program atau Direktur (dengan alasan). Mintalah mereka mengubahnya.");
  }
  const r = (reason ?? "").trim();
  if (r.length < MIN_RELAX_REASON) throw Errors.validation("Menjadikan checklist wajib tidak wajib atau menghapusnya harus disertai alasan.", { reason: `Alasan wajib diisi (minimal ${MIN_RELAX_REASON} karakter)` });
  return r;
}

// ═════════════════════════════ Penutupan proyek: keputusan per tugas terbuka ═════════════════════════════

/** Penanggung jawab tindak lanjut harus karyawan aktif & anggota aktif proyek (pesan menyebut tugasnya). */
export async function assertFollowUpAssignees(tx: Tx, projectId: string, plan: ClosureTaskPlan): Promise<void> {
  for (const f of plan.followUp) {
    try { await assertAssigneeInTeam(tx, projectId, f.assigneeId); }
    catch (e) { if (e instanceof AppError) throw Errors.validation(`Tindak lanjut "${f.title}": ${e.message}`, { taskDecisions: "Penanggung jawab tidak valid" }); throw e; }
  }
}

/** Terapkan keputusan penutupan pada tugas terbuka (dipanggil `closeProject` DI DALAM transaksinya). Setiap tugas dicatat di komentar tugas & diberitahukan ke penanggung jawabnya. */
export async function settleOpenTasksForClosure(tx: Tx, actor: Actor, project: { id: string; code: string }, plan: ClosureTaskPlan): Promise<void> {
  for (const f of plan.followUp) {
    const t = await tx.trainingTask.findUniqueOrThrow({ where: { id: f.taskId }, select: { assigneeId: true, dueDate: true } });
    await tx.trainingTask.update({ where: { id: f.taskId }, data: { isFollowUp: true, assigneeId: f.assigneeId, dueDate: isoToDate(f.dueDate) } });
    const parts = [f.assigneeChanged && "penanggung jawab diganti", f.dueChanged && `tenggat ${t.dueDate ? dateToIso(t.dueDate) : "—"} → ${f.dueDate}`].filter(Boolean).join("; ");
    await tx.trainingTaskComment.create({ data: { taskId: f.taskId, authorId: actor.userId, body: `[Tindak lanjut] Proyek ${project.code} ditutup; tugas ini dilanjutkan sebagai tindak lanjut, tenggat ${f.dueDate}.${parts ? ` (${parts})` : ""}${f.reason ? ` Alasan: ${f.reason}` : ""}` } });
    await notifyEmployee(tx, actor, f.assigneeId, { type: "training.task.followup", title: "Tugas tindak lanjut untuk Anda", body: `${project.code} · ${f.title} · tenggat ${f.dueDate}`, href: "/training/tugas-saya" });
  }
  for (const c of plan.cancel) {
    const t = await tx.trainingTask.findUniqueOrThrow({ where: { id: c.taskId }, select: { assigneeId: true } });
    const r = await tx.trainingTask.updateMany({
      where: { id: c.taskId, status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] } },
      data: { status: "CANCELLED", completedAt: null, completedById: null, submittedById: null, submittedAt: null, assigneeAtSubmitId: null, reviewedById: null, reviewedAt: null },
    });
    if (r.count === 0) throw Errors.conflict("Status tugas baru saja diubah pengguna lain. Muat ulang halaman.");
    await tx.trainingTaskComment.create({ data: { taskId: c.taskId, authorId: actor.userId, body: `[Dibatalkan saat penutupan proyek ${project.code}] ${c.reason}` } });
    await notifyEmployee(tx, actor, t.assigneeId, { type: "training.task.cancelled", title: "Tugas dibatalkan saat penutupan proyek", body: `${project.code} · ${c.title}`, href: `/training/proyek/${project.id}?tab=tugas` });
  }
}

export interface MyChecklistItemDto { id: string; projectId: string; projectCode: string; projectName: string; phase: ChecklistPhase; title: string; isRequired: boolean }

/** Item checklist yang menjadi tanggung jawab pelaku (belum selesai) pada proyek aktif yang masih boleh ia lihat. */
export async function listMyChecklistItems(actor: Actor): Promise<MyChecklistItemDto[]> {
  const mod = await requireModule(actor);
  if (!actor.employeeId) return [];
  const rows = await prisma.trainingProjectChecklistItem.findMany({
    where: { assigneeId: actor.employeeId, isDone: false, project: { AND: [accessibleProjectWhere(actor, mod), activeMemberOf(actor.employeeId), { status: { in: ["PREPARATION", "RUNNING"] } }] } },
    orderBy: [{ project: { startDate: "asc" } }, { phase: "asc" }, { sortOrder: "asc" }], include: { project: { select: { code: true, name: true } } },
  });
  return rows.map((r) => ({ id: r.id, projectId: r.projectId, projectCode: r.project.code, projectName: r.project.name, phase: r.phase, title: r.title, isRequired: r.isRequired }));
}

// ═════════════════════════════ Template checklist (Koordinator Program) ═════════════════════════════

export interface TemplateDto {
  id: string; name: string; description: string | null; isActive: boolean;
  items: { id: string; phase: ChecklistPhase; title: string; isRequired: boolean }[];
}

export async function listTemplates(actor: Actor, opts: { includeInactive?: boolean } = {}): Promise<TemplateDto[]> {
  await requireGlobalCap(actor, "createProject");
  const rows = await prisma.trainingChecklistTemplate.findMany({
    where: opts.includeInactive ? {} : { isActive: true }, orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: { items: { orderBy: [{ phase: "asc" }, { sortOrder: "asc" }] } },
  });
  const phaseRank = (p: ChecklistPhase) => CHECKLIST_PHASES.indexOf(p);
  return rows.map((t) => ({
    id: t.id, name: t.name, description: t.description, isActive: t.isActive,
    items: [...t.items].sort((a, b) => phaseRank(a.phase) - phaseRank(b.phase) || a.sortOrder - b.sortOrder).map((i) => ({ id: i.id, phase: i.phase, title: i.title, isRequired: i.isRequired })),
  }));
}

/** Buat (id = null) atau simpan template. Menyimpan MENGGANTI daftar itemnya; checklist proyek yang sudah ada tidak terpengaruh. */
export async function saveTemplate(actor: Actor, id: string | null, raw: unknown): Promise<{ id: string }> {
  await requireGlobalCap(actor, "managePrograms");
  if (id) assertUuid(id, "Template");
  const input = parseInput(templateSaveSchema, raw);
  return transaction(async (tx) => {
    try {
      let tplId = id;
      if (tplId) {
        const cur = await tx.trainingChecklistTemplate.findUnique({ where: { id: tplId } });
        if (!cur) throw Errors.notFound("Template");
        await tx.trainingChecklistTemplate.update({ where: { id: tplId }, data: { name: input.name, description: input.description, ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) } });
        await tx.trainingChecklistTemplateItem.deleteMany({ where: { templateId: tplId } });
      } else {
        tplId = (await tx.trainingChecklistTemplate.create({ data: { name: input.name, description: input.description, isActive: input.isActive ?? true, createdById: actor.userId } })).id;
      }
      await tx.trainingChecklistTemplateItem.createMany({ data: input.items.map((it, i) => ({ templateId: tplId!, phase: it.phase, title: it.title, isRequired: it.isRequired, sortOrder: i })) });
      await writeAudit(tx, actor, { action: id ? "training.template.update" : "training.template.create", entityType: "TrainingChecklistTemplate", entityId: tplId, summary: `Template checklist "${input.name}" ${id ? "diperbarui" : "dibuat"} (${input.items.length} item)`, after: { items: input.items.length, required: input.items.filter((i) => i.isRequired).length } });
      return { id: tplId };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw Errors.conflict("Sudah ada template dengan nama yang sama.");
      throw e;
    }
  });
}

/** Membuat template standar HANYA atas tindakan eksplisit Koordinator Program (bukan otomatis saat migrasi). Idempoten. */
export async function ensureDefaultTemplate(actor: Actor): Promise<{ id: string; created: boolean }> {
  await requireGlobalCap(actor, "managePrograms");
  const existing = await prisma.trainingChecklistTemplate.findFirst({ where: { name: { equals: DEFAULT_TEMPLATE_NAME, mode: "insensitive" } }, select: { id: true } });
  if (existing) return { id: existing.id, created: false };
  const r = await saveTemplate(actor, null, { name: DEFAULT_TEMPLATE_NAME, description: "Daftar standar persiapan, pelaksanaan, dan penutupan pelatihan (usulan; dapat diubah).", items: DEFAULT_TEMPLATE_ITEMS });
  return { id: r.id, created: true };
}
