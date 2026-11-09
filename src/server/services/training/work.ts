import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, transaction, type Tx } from "../../db";
import { Errors } from "../../errors";
import { parseInput } from "../../validate";
import type { Actor } from "../../actor";
import { writeAudit, diffFields } from "../../audit";
import { dateToIso, isoToDate } from "../../json";
import { notifyUsers } from "../notifications";
import { projectAbilities } from "@/lib/training/access";
import { allowedTaskTransitions } from "@/lib/training/status";
import { checklistProgress, isTaskDueSoon, isTaskDueToday, isTaskOverdue, requiredOutstanding, type ChecklistProgress } from "@/lib/training/indicators";
import { DEFAULT_TEMPLATE_ITEMS, DEFAULT_TEMPLATE_NAME } from "@/lib/training/misc";
import {
  CHECKLIST_PHASES, TASK_STATUS_LABEL, isOpenTask, type ChecklistPhase, type ProjectRole, type TaskPriority, type TaskStatus,
} from "@/lib/training/types";
import {
  applyTemplateSchema, checklistItemCreateSchema, checklistItemUpdateSchema, myTasksSchema, taskCommentSchema, taskCreateSchema,
  taskStatusSchema, taskUpdateSchema, templateSaveSchema,
} from "@/lib/validation/training";
import {
  assertEditable, getModuleContext, loadProjectAccess, requireAbility, requireGlobalCap, requireModule, accessibleProjectWhere, type ProjectAccess,
} from "./access";
import { assertUuid, auditProject, iso, today } from "./shared";

// ═════════════════════════════ Tugas ═════════════════════════════

export interface TaskDto {
  id: string; projectId: string; projectCode: string; projectName: string; title: string; description: string | null;
  assigneeId: string | null; assigneeName: string | null;
  /** Penanggung jawab sudah tidak menjadi anggota aktif proyek (tugas perlu dialihkan). */
  assigneeInactive: boolean;
  dueDate: string | null; priority: TaskPriority; status: TaskStatus; requiresReview: boolean;
  completedAt: string | null; createdByName: string | null; createdAt: string;
  overdue: boolean; commentCount: number;
  /** Status tujuan yang boleh dipilih pelaku saat ini (untuk menampilkan tombol; penegakan di server). */
  allowedNext: TaskStatus[];
  /** Pelaku boleh mengubah isi tugas (judul, penanggung jawab, tenggat, dst.). */
  canEdit: boolean;
}

const taskInclude = {
  project: { select: { code: true, name: true } },
  assignee: { select: { fullName: true } },
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
  const userIds = [...new Set(rows.map((r) => r.createdById))];
  const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }) : [];
  const uname = new Map(users.map((u) => [u.id, u.name]));
  const t = today();
  return rows.map((r) => {
    const abilities = projectAbilities(ctx.subject, ctx.roles.get(r.projectId) ?? null);
    const canManage = abilities.has("manage_tasks");
    const isAssignee = !!ctx.actor.employeeId && r.assigneeId === ctx.actor.employeeId;
    const due = r.dueDate ? dateToIso(r.dueDate) : null;
    return {
      id: r.id, projectId: r.projectId, projectCode: r.project.code, projectName: r.project.name, title: r.title, description: r.description,
      assigneeId: r.assigneeId, assigneeName: r.assignee?.fullName ?? null,
      assigneeInactive: !!r.assigneeId && !ctx.activeAssignees.has(`${r.projectId}:${r.assigneeId}`),
      dueDate: due, priority: r.priority, status: r.status, requiresReview: r.requiresReview, completedAt: iso(r.completedAt),
      createdByName: uname.get(r.createdById) ?? null, createdAt: r.createdAt.toISOString(),
      overdue: isTaskOverdue({ status: r.status, dueDate: due }, t), commentCount: r._count.comments,
      allowedNext: abilities.has("view") ? allowedTaskTransitions({ status: r.status, requiresReview: r.requiresReview, isAssignee, canManage }) : [],
      canEdit: canManage,
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
    where: { assigneeId: actor.employeeId, ...(f.projectId ? { projectId: f.projectId } : {}), project: accessibleProjectWhere(actor, mod) },
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
    where: { assigneeId: actor.employeeId, status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] }, dueDate: { lt: isoToDate(today()) }, project: accessibleProjectWhere(actor, mod) },
  });
}

/** Penanggung jawab tugas harus anggota AKTIF proyek itu — tugas tidak dapat diberikan ke orang di luar tim. */
async function assertAssigneeInTeam(tx: Tx | typeof prisma, projectId: string, employeeId: string | null | undefined): Promise<void> {
  if (!employeeId) return;
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
  assertEditable(access.project);
  const input = parseInput(taskUpdateSchema, raw);
  await transaction(async (tx) => {
    if ("assigneeId" in input) await assertAssigneeInTeam(tx, task.projectId, input.assigneeId);
    const data: Prisma.TrainingTaskUncheckedUpdateInput = {};
    for (const k of ["title", "description", "assigneeId", "priority", "requiresReview"] as const) if (k in input) (data as Record<string, unknown>)[k] = input[k];
    if ("dueDate" in input) data.dueDate = input.dueDate ? isoToDate(input.dueDate) : null;
    // Mengubah "perlu diperiksa" saat tugas sedang menunggu pemeriksaan akan membuat statusnya tidak konsisten.
    if (input.requiresReview === false && task.status === "IN_REVIEW") throw Errors.conflict("Tugas sedang menunggu pemeriksaan. Putuskan hasil pemeriksaan dulu sebelum mematikan syarat pemeriksaan.");
    const before = { title: task.title, description: task.description, assigneeId: task.assigneeId, priority: task.priority, requiresReview: task.requiresReview, dueDate: task.dueDate ? dateToIso(task.dueDate) : null };
    const after = { ...before, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v instanceof Date ? dateToIso(v) : v])) };
    const d = diffFields(before, after);
    if (d.changed.length === 0) return;
    await tx.trainingTask.update({ where: { id: taskId }, data });
    await auditProject(tx, actor, task.projectId, { action: "training.task.update", summary: `Tugas "${task.title}" diubah (${d.changed.join(", ")})`, before: { taskId, ...d.before }, after: { taskId, ...d.after } });
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
  assertEditable(access.project);
  const input = parseInput(taskStatusSchema, raw);
  const isAssignee = !!actor.employeeId && task.assigneeId === actor.employeeId;
  const canManage = access.abilities.has("manage_tasks");
  if (!isAssignee && !canManage) throw Errors.forbidden("Hanya penanggung jawab tugas atau pengelola proyek yang dapat mengubah status tugas.");
  const allowed = allowedTaskTransitions({ status: task.status, requiresReview: task.requiresReview, isAssignee, canManage });
  if (!allowed.includes(input.status)) {
    if (task.status === "IN_REVIEW" && input.status === "DONE" && isAssignee) throw Errors.forbidden("Anda tidak dapat memeriksa hasil tugas Anda sendiri. Minta Project Manager atau Koordinator Program memeriksanya.");
    if (task.requiresReview && input.status === "DONE" && task.status !== "IN_REVIEW") throw Errors.conflict("Tugas ini perlu diperiksa: kirim dulu ke \"Menunggu pemeriksaan\".");
    throw Errors.conflict(`Status tugas tidak dapat diubah dari "${TASK_STATUS_LABEL[task.status]}" ke "${TASK_STATUS_LABEL[input.status]}".`);
  }
  await transaction(async (tx) => {
    const done = input.status === "DONE";
    const r = await tx.trainingTask.updateMany({
      where: { id: taskId, status: task.status },
      data: { status: input.status, completedAt: done ? new Date() : null, completedById: done ? actor.userId : null },
    });
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
  assertEditable(access.project);
  // Komentar adalah perubahan data: hanya ANGGOTA proyek (atau pengelola tugas) — Pemantau/Super Admin hanya melihat.
  if (!access.memberRole && !access.abilities.has("manage_tasks")) throw Errors.forbidden("Hanya anggota proyek yang dapat berkomentar pada tugas.");
  const { body } = parseInput(taskCommentSchema, raw);
  await transaction(async (tx) => {
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
}
export interface ChecklistDto { items: ChecklistItemDto[]; progress: ChecklistProgress; requiredOutstanding: number; canManage: boolean }

export async function listChecklist(actor: Actor, projectId: string): Promise<ChecklistDto> {
  const access = await loadProjectAccess(actor, projectId);
  const rows = await prisma.trainingProjectChecklistItem.findMany({
    where: { projectId }, orderBy: [{ phase: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }], include: { assignee: { select: { fullName: true } } },
  });
  const doers = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.doneById).filter((x): x is string => !!x))] } }, select: { id: true, name: true } });
  const dn = new Map(doers.map((u) => [u.id, u.name]));
  const canManage = access.abilities.has("manage_checklist");
  const items = rows.map((r): ChecklistItemDto => ({
    id: r.id, projectId: r.projectId, phase: r.phase, title: r.title, isRequired: r.isRequired, sortOrder: r.sortOrder, assigneeId: r.assigneeId, assigneeName: r.assignee?.fullName ?? null,
    isDone: r.isDone, doneAt: iso(r.doneAt), doneByName: r.doneById ? dn.get(r.doneById) ?? null : null, note: r.note, sourceTemplateName: r.sourceTemplateName,
    canToggle: canManage || (!!actor.employeeId && r.assigneeId === actor.employeeId),
  }));
  return { items, progress: checklistProgress(items), requiredOutstanding: requiredOutstanding(items).length, canManage };
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
  const isOwner = !!actor.employeeId && item.assigneeId === actor.employeeId;
  const structural = ["phase", "title", "isRequired", "assigneeId", "note"].some((k) => k in input);
  if (structural && !canManage) throw Errors.forbidden("Hanya pengelola checklist yang dapat mengubah isi item.");
  if ("isDone" in input && !canManage && !isOwner) throw Errors.forbidden("Hanya penanggung jawab item atau pengelola checklist yang dapat menandai selesai.");
  await transaction(async (tx) => {
    if ("assigneeId" in input) await assertAssigneeInTeam(tx, item.projectId, input.assigneeId);
    const data: Prisma.TrainingProjectChecklistItemUncheckedUpdateInput = {};
    for (const k of ["phase", "title", "isRequired", "assigneeId", "note"] as const) if (k in input) (data as Record<string, unknown>)[k] = input[k];
    if (input.isDone !== undefined && input.isDone !== item.isDone) {
      data.isDone = input.isDone; data.doneAt = input.isDone ? new Date() : null; data.doneById = input.isDone ? actor.userId : null;
    }
    if (Object.keys(data).length === 0) return;
    await tx.trainingProjectChecklistItem.update({ where: { id: itemId }, data });
    const toggled = data.isDone !== undefined;
    await auditProject(tx, actor, item.projectId, {
      action: toggled ? "training.checklist.toggle" : "training.checklist.update",
      summary: toggled ? `Checklist "${item.title}" ${input.isDone ? "ditandai selesai" : "dibuka kembali"}${item.isRequired ? " (wajib)" : ""}` : `Item checklist "${item.title}" diubah`,
      before: { itemId, isDone: item.isDone, isRequired: item.isRequired }, after: { itemId, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])) },
    });
  });
}

export async function deleteChecklistItem(actor: Actor, itemId: string): Promise<void> {
  const { item, access } = await loadItem(actor, itemId);
  requireAbility(access, "manage_checklist");
  assertEditable(access.project);
  if (item.isDone) throw Errors.conflict("Item yang sudah selesai tidak dapat dihapus. Buka kembali tanda selesainya dulu bila memang keliru.");
  await transaction(async (tx) => {
    await tx.trainingProjectChecklistItem.delete({ where: { id: itemId } });
    await auditProject(tx, actor, item.projectId, { action: "training.checklist.delete", summary: `Item checklist "${item.title}" dihapus${item.isRequired ? " (wajib)" : ""}`, before: { itemId, phase: item.phase, isRequired: item.isRequired } });
  });
}

export interface MyChecklistItemDto { id: string; projectId: string; projectCode: string; projectName: string; phase: ChecklistPhase; title: string; isRequired: boolean }

/** Item checklist yang menjadi tanggung jawab pelaku (belum selesai) pada proyek aktif yang masih boleh ia lihat. */
export async function listMyChecklistItems(actor: Actor): Promise<MyChecklistItemDto[]> {
  const mod = await requireModule(actor);
  if (!actor.employeeId) return [];
  const rows = await prisma.trainingProjectChecklistItem.findMany({
    where: { assigneeId: actor.employeeId, isDone: false, project: { AND: [accessibleProjectWhere(actor, mod), { status: { in: ["PREPARATION", "RUNNING"] } }] } },
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
