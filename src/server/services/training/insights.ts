import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import type { Actor } from "../../actor";
import type { ReportTable } from "../../export";
import { parseInput } from "../../validate";
import { dateToIso, isoToDate } from "../../json";
import { addDays } from "@/lib/time";
import { isOpenTask, PROJECT_STATUSES, type ActivityKind, type DocCategory, type ProjectStatus, PROJECT_STATUS_LABEL, ACTIVITY_KIND_LABEL } from "@/lib/training/types";
import { ATTENTION_LABEL, ATTENTION_WINDOW_DAYS, closureReadiness, type AttentionCode, type ChecklistProgress } from "@/lib/training/indicators";
import { isoDate, uuid } from "@/lib/validation/common";
import type { Paged } from "@/lib/types";
import { accessibleProjectWhere, loadProjectAccess, requireModule } from "./access";
import { listProjects, type ProjectListItemDto } from "./projects";
import { listMyChecklistItems, listMyTasks, type MyChecklistItemDto, type TaskDto } from "./work";
import { listCalendar, type ScheduleDto } from "./operations";
import { today } from "./shared";

// ═════════════════════════════ Dashboard ═════════════════════════════

export type DashboardVariant = "staff" | "admin" | "manager" | "director";

export interface DashboardDto {
  variant: DashboardVariant;
  today: string;
  /** Semua angka dihitung langsung dari data proyek yang boleh dilihat pelaku (lihat definisi di docs/TRAINING-OPS.md). */
  counts: {
    projectsInScope: number; activeProjects: number; completedProjects: number;
    openTasks: number; overdueTasks: number; dueTodayTasks: number; dueSoonTasks: number;
    requiredChecklistProjects: number; openChecklistItems: number; activeWithoutDocuments: number; attentionProjects: number;
  };
  statusDistribution: { status: ProjectStatus; count: number }[];
  /** Jumlah proyek menurut bulan mulai (direktur). */
  byMonth: { month: string; count: number }[];
  projects: ProjectListItemDto[];
  attention: ProjectListItemDto[];
  myTasks: TaskDto[];
  myChecklist: MyChecklistItemDto[];
  /** Ringkasan penugasan tim: JUMLAH tugas terbuka/terlambat per orang — bukan persentase beban. */
  teamLoad: { employeeId: string; name: string; openTasks: number; overdueTasks: number }[];
  upcoming: ScheduleDto[];
  risks: { overdueTasks: number; requiredChecklistNearStart: number; noPic: number; pastEndNotClosed: number; orphanTasks: number };
}

const OPEN: Prisma.TrainingTaskWhereInput["status"] = { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] };

export async function getTrainingDashboard(actor: Actor): Promise<DashboardDto> {
  const mod = await requireModule(actor);
  const level = mod.subject.level;
  const variant: DashboardVariant = level === "COORDINATOR" ? "manager" : actor.role === "SUPER_ADMIN" || level === "VIEWER" ? "director" : level === "ADMIN_PROGRAM" ? "admin" : "staff";
  const t = today();
  const td = isoToDate(t);
  const scope = accessibleProjectWhere(actor, mod);
  const inScope: Prisma.TrainingProjectWhereInput = scope;
  const activeScope: Prisma.TrainingProjectWhereInput = { AND: [scope, { status: { in: ["PREPARATION", "RUNNING"] } }] };
  // Dashboard Staf menghitung tugas & checklist MILIKNYA sendiri (bukan seluruh pekerjaan di proyek yang ia ikuti).
  const own = variant === "staff" ? { assigneeId: actor.employeeId ?? "00000000-0000-0000-0000-000000000000" } : {};
  const taskScope = (extra: Prisma.TrainingTaskWhereInput = {}): Prisma.TrainingTaskWhereInput => ({ project: inScope, ...own, ...extra });

  const [byStatus, openTasks, overdue, dueToday, dueSoon, openChecklist, activeNoDocs, projectsPage, attentionPage, myTasks, myChecklist, upcoming] = await Promise.all([
    prisma.trainingProject.groupBy({ by: ["status"], where: inScope, _count: { _all: true } }),
    prisma.trainingTask.count({ where: taskScope({ status: OPEN }) }),
    prisma.trainingTask.count({ where: taskScope({ status: OPEN, dueDate: { lt: td } }) }),
    prisma.trainingTask.count({ where: taskScope({ status: OPEN, dueDate: td }) }),
    prisma.trainingTask.count({ where: taskScope({ status: OPEN, dueDate: { gte: td, lte: isoToDate(addDays(t, 3)) } }) }),
    prisma.trainingProjectChecklistItem.count({ where: { isDone: false, ...(variant === "staff" ? { assigneeId: actor.employeeId ?? "00000000-0000-0000-0000-000000000000" } : {}), project: activeScope } }),
    prisma.trainingProject.count({ where: { AND: [activeScope, { documents: { none: { deletedAt: null } } }] } }),
    listProjects(actor, { active: "1", sort: "start_asc", pageSize: 8 }),
    listProjects(actor, { attention: "1", sort: "start_asc", pageSize: 8 }),
    listMyTasks(actor, { filter: "open" }),
    listMyChecklistItems(actor),
    listCalendar(actor, { from: t, to: addDays(t, 14) }),
  ]);

  const statusMap = new Map(byStatus.map((r) => [r.status, r._count._all]));
  const statusDistribution = PROJECT_STATUSES.map((status) => ({ status, count: statusMap.get(status) ?? 0 }));
  const total = [...statusMap.values()].reduce((a, b) => a + b, 0);

  // Proyek aktif yang mendekati/sudah melewati tanggal mulai dengan checklist wajib belum lengkap, tanpa PIC, atau lewat tanggal selesai.
  const activeRows = await prisma.trainingProject.findMany({
    where: activeScope, select: { id: true, startDate: true, endDate: true, members: { where: { role: "PROJECT_MANAGER", endedAt: null }, select: { id: true } } },
  });
  const activeIds = activeRows.map((p) => p.id);
  const reqOut = activeIds.length
    ? await prisma.trainingProjectChecklistItem.groupBy({ by: ["projectId"], where: { projectId: { in: activeIds }, isRequired: true, isDone: false }, _count: { _all: true } })
    : [];
  const reqSet = new Set(reqOut.map((r) => r.projectId));
  const startLimit = addDays(t, ATTENTION_WINDOW_DAYS);
  const requiredNearStart = activeRows.filter((p) => reqSet.has(p.id) && p.startDate !== null && dateToIso(p.startDate) <= startLimit).length;
  const noPic = activeRows.filter((p) => p.members.length === 0).length;
  const pastEnd = activeRows.filter((p) => p.endDate !== null && dateToIso(p.endDate) < t).length;

  // Tugas terbuka yang penanggung jawabnya sudah tidak anggota aktif proyek (perlu dialihkan).
  const openAssigned = await prisma.trainingTask.findMany({ where: taskScope({ status: OPEN, assigneeId: { not: null } }), select: { projectId: true, assigneeId: true } });
  const activeMembers = openAssigned.length
    ? await prisma.trainingProjectMember.findMany({ where: { projectId: { in: [...new Set(openAssigned.map((x) => x.projectId))] }, endedAt: null }, select: { projectId: true, employeeId: true } })
    : [];
  const am = new Set(activeMembers.map((m) => `${m.projectId}:${m.employeeId}`));
  const orphanTasks = openAssigned.filter((x) => !am.has(`${x.projectId}:${x.assigneeId}`)).length;

  let teamLoad: DashboardDto["teamLoad"] = [];
  if (variant === "manager" || variant === "admin") {
    const [open, late] = await Promise.all([
      prisma.trainingTask.groupBy({ by: ["assigneeId"], where: taskScope({ status: OPEN, assigneeId: { not: null } }), _count: { _all: true } }),
      prisma.trainingTask.groupBy({ by: ["assigneeId"], where: taskScope({ status: OPEN, assigneeId: { not: null }, dueDate: { lt: td } }), _count: { _all: true } }),
    ]);
    const names = await prisma.employee.findMany({ where: { id: { in: open.map((o) => o.assigneeId!) } }, select: { id: true, fullName: true } });
    const nm = new Map(names.map((e) => [e.id, e.fullName]));
    const lm = new Map(late.map((l) => [l.assigneeId, l._count._all]));
    teamLoad = open.map((o) => ({ employeeId: o.assigneeId!, name: nm.get(o.assigneeId!) ?? "—", openTasks: o._count._all, overdueTasks: lm.get(o.assigneeId) ?? 0 }))
      .sort((a, b) => b.overdueTasks - a.overdueTasks || b.openTasks - a.openTasks).slice(0, 10);
  }

  let byMonth: DashboardDto["byMonth"] = [];
  if (variant === "director" || variant === "manager") {
    const from = addDays(t.slice(0, 7) + "-01", -180);
    const rows = await prisma.trainingProject.findMany({ where: { AND: [inScope, { startDate: { gte: isoToDate(from) } }] }, select: { startDate: true } });
    const m = new Map<string, number>();
    for (const r of rows) { const k = dateToIso(r.startDate!).slice(0, 7); m.set(k, (m.get(k) ?? 0) + 1); }
    byMonth = [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, count]) => ({ month, count }));
  }

  return {
    variant, today: t,
    counts: {
      projectsInScope: total, activeProjects: (statusMap.get("PREPARATION") ?? 0) + (statusMap.get("RUNNING") ?? 0), completedProjects: statusMap.get("COMPLETED") ?? 0,
      openTasks, overdueTasks: overdue, dueTodayTasks: dueToday, dueSoonTasks: dueSoon, requiredChecklistProjects: reqSet.size, openChecklistItems: openChecklist,
      activeWithoutDocuments: activeNoDocs, attentionProjects: attentionPage.total,
    },
    statusDistribution, byMonth, projects: projectsPage.items, attention: attentionPage.items,
    myTasks: myTasks.slice(0, 10), myChecklist: myChecklist.slice(0, 10), teamLoad, upcoming: upcoming.slice(0, 8),
    risks: { overdueTasks: overdue, requiredChecklistNearStart: requiredNearStart, noPic, pastEndNotClosed: pastEnd, orphanTasks },
  };
}

// ═════════════════════════════ Pratinjau penutupan ═════════════════════════════

export interface ClosurePreviewDto {
  project: { code: string; name: string; status: ProjectStatus; startDate: string | null; endDate: string | null };
  tasks: { total: number; done: number; open: number; overdue: number; cancelled: number };
  checklist: ChecklistProgress;
  requiredOutstanding: { id: string; title: string }[];
  documents: { category: DocCategory; count: number }[];
  /** Dokumen yang DIANJURKAN ada sebelum ditutup (informasi; tidak memblokir penutupan). */
  missingRecommendedDocuments: DocCategory[];
  canCloseClean: boolean;
}

const RECOMMENDED_DOCS: DocCategory[] = ["ATTENDANCE", "FINAL_REPORT"];

export async function getClosurePreview(actor: Actor, projectId: string): Promise<ClosurePreviewDto> {
  const access = await loadProjectAccess(actor, projectId);
  const p = await prisma.trainingProject.findUniqueOrThrow({ where: { id: projectId } });
  const [tasks, items, docs] = await Promise.all([
    prisma.trainingTask.findMany({ where: { projectId }, select: { status: true, dueDate: true } }),
    prisma.trainingProjectChecklistItem.findMany({ where: { projectId }, orderBy: [{ phase: "asc" }, { sortOrder: "asc" }], select: { id: true, title: true, isRequired: true, isDone: true } }),
    prisma.trainingProjectDocument.groupBy({ by: ["category"], where: { projectId, deletedAt: null }, _count: { _all: true } }),
  ]);
  const t = today();
  const lite = tasks.map((x) => ({ status: x.status, dueDate: x.dueDate ? dateToIso(x.dueDate) : null }));
  const ready = closureReadiness(items, lite);
  const have = new Set(docs.map((d) => d.category));
  // Kategori sensitif disembunyikan dari yang tidak berwenang (jumlah tetap tidak diperlihatkan).
  const showSensitive = access.abilities.has("manage_participants");
  return {
    project: { code: p.code, name: p.name, status: p.status, startDate: p.startDate ? dateToIso(p.startDate) : null, endDate: p.endDate ? dateToIso(p.endDate) : null },
    tasks: {
      total: tasks.length, done: tasks.filter((x) => x.status === "DONE").length, open: tasks.filter((x) => isOpenTask(x.status)).length,
      overdue: lite.filter((x) => isOpenTask(x.status) && x.dueDate !== null && x.dueDate < t).length, cancelled: tasks.filter((x) => x.status === "CANCELLED").length,
    },
    checklist: { done: items.filter((i) => i.isDone).length, total: items.length, percent: items.length === 0 ? null : Math.round((items.filter((i) => i.isDone).length / items.length) * 100) },
    requiredOutstanding: items.filter((i) => i.isRequired && !i.isDone).map((i) => ({ id: i.id, title: i.title })),
    documents: docs.filter((d) => showSensitive || d.category !== "PARTICIPANT_DOC").map((d) => ({ category: d.category, count: d._count._all })),
    missingRecommendedDocuments: RECOMMENDED_DOCS.filter((c) => !have.has(c)),
    canCloseClean: ready.canCloseClean,
  };
}

// ═════════════════════════════ Riwayat aktivitas ═════════════════════════════

export interface ActivityDto { id: string; at: string; actorName: string | null; action: string; summary: string | null; reason: string | null }

/** Riwayat proyek dari audit log. Sengaja tanpa IP, user-agent, email, dan isi before/after (bisa memuat detail internal). */
export async function listProjectActivity(actor: Actor, projectId: string, page = 1, pageSize = 30): Promise<Paged<ActivityDto>> {
  await loadProjectAccess(actor, projectId);
  const where: Prisma.AuditLogWhereInput = { entityType: "TrainingProject", entityId: projectId };
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { id: "desc" }, skip: (Math.max(page, 1) - 1) * pageSize, take: pageSize, select: { id: true, createdAt: true, action: true, summary: true, reason: true, actor: { select: { name: true } } } }),
  ]);
  return {
    items: rows.map((r) => ({ id: r.id.toString(), at: r.createdAt.toISOString(), actorName: r.actor?.name ?? null, action: r.action, summary: r.summary, reason: r.reason })),
    total, page, pageSize, pageCount: Math.max(Math.ceil(total / pageSize), 1),
  };
}

// ═════════════════════════════ Laporan proyek ═════════════════════════════

const reportQuerySchema = z.object({ from: isoDate.optional(), to: isoDate.optional(), status: z.enum(PROJECT_STATUSES as unknown as [ProjectStatus, ...ProjectStatus[]]).optional(), programId: uuid.optional() });

export interface ReportRowDto {
  id: string; code: string; name: string; programName: string | null; kind: ActivityKind; status: ProjectStatus;
  startDate: string | null; endDate: string | null; picName: string | null;
  tasksTotal: number; tasksDone: number; tasksOverdue: number; checklist: ChecklistProgress; participants: number; documents: number; attention: AttentionCode[]; closureSummary: string | null;
}

export async function projectReportRows(actor: Actor, raw: unknown = {}): Promise<ReportRowDto[]> {
  await requireModule(actor);
  const f = parseInput(reportQuerySchema, raw);
  // listProjects menerapkan lingkup akses & seluruh filter (status, program, rentang tanggal) di satu tempat.
  const list = await listProjects(actor, { ...f, sort: "start_asc", pageSize: 100 });
  const ids = list.items.map((i) => i.id);
  const [tasks, parts, docs, closed] = await Promise.all([
    prisma.trainingTask.groupBy({ by: ["projectId", "status"], where: { projectId: { in: ids } }, _count: { _all: true } }),
    prisma.trainingParticipant.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, status: { not: "CANCELLED" } }, _count: { _all: true } }),
    prisma.trainingProjectDocument.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, deletedAt: null, category: { not: "PARTICIPANT_DOC" } }, _count: { _all: true } }),
    prisma.trainingProject.findMany({ where: { id: { in: ids } }, select: { id: true, closureSummary: true } }),
  ]);
  const tasksBy = new Map<string, { total: number; done: number }>();
  for (const r of tasks) {
    const a = tasksBy.get(r.projectId) ?? { total: 0, done: 0 };
    if (r.status !== "CANCELLED") a.total += r._count._all;
    if (r.status === "DONE") a.done += r._count._all;
    tasksBy.set(r.projectId, a);
  }
  const pm = new Map(parts.map((r) => [r.projectId, r._count._all]));
  const dm = new Map(docs.map((r) => [r.projectId, r._count._all]));
  const cm = new Map(closed.map((r) => [r.id, r.closureSummary]));
  return list.items.map((p) => ({
    id: p.id, code: p.code, name: p.name, programName: p.programName, kind: p.kind, status: p.status, startDate: p.startDate, endDate: p.endDate, picName: p.picName,
    tasksTotal: tasksBy.get(p.id)?.total ?? 0, tasksDone: tasksBy.get(p.id)?.done ?? 0, tasksOverdue: p.overdueTasks, checklist: p.checklist,
    participants: pm.get(p.id) ?? 0, documents: dm.get(p.id) ?? 0, attention: p.attention, closureSummary: cm.get(p.id) ?? null,
  }));
}

/** Tabel laporan untuk diunduh (CSV/Excel/PDF) lewat `tableResponse` — sel teks dinetralkan dari injeksi rumus oleh lapisan ekspor. */
export async function projectReportTable(actor: Actor, raw: unknown = {}): Promise<ReportTable> {
  const rows = await projectReportRows(actor, raw);
  const f = parseInput(reportQuerySchema, raw);
  return {
    type: "TrainingProjects", title: "Laporan Proyek Training & Operations", description: "Ringkasan operasional proyek pelatihan dalam lingkup akses Anda.",
    disclaimer: "Progres checklist = item selesai ÷ seluruh item (\"Belum tersedia\" bila belum ada item). Tugas terlambat = tugas terbuka dengan tenggat sebelum hari ini (WIB). Status Selesai tidak berarti invoice dibayar, sertifikat terbit, peserta kompeten, atau surat tugas disetujui.",
    periodLabel: f.from || f.to ? `${f.from ?? "…"} s.d. ${f.to ?? "…"}` : "Semua periode", generatedAt: new Date().toISOString(),
    columns: [
      { key: "code", label: "Kode", type: "text", width: 16 }, { key: "name", label: "Proyek", type: "text", width: 36 }, { key: "program", label: "Program", type: "text", width: 26 },
      { key: "kind", label: "Jenis", type: "text", width: 14 }, { key: "status", label: "Status", type: "text", width: 14 }, { key: "start", label: "Mulai", type: "date", width: 12 }, { key: "end", label: "Selesai", type: "date", width: 12 },
      { key: "pic", label: "PIC", type: "text", width: 22 }, { key: "tasks", label: "Tugas selesai/total", type: "text", width: 18 }, { key: "overdue", label: "Tugas terlambat", type: "number", width: 14 },
      { key: "checklist", label: "Checklist", type: "text", width: 16 }, { key: "participants", label: "Peserta", type: "number", width: 10 }, { key: "documents", label: "Dokumen", type: "number", width: 10 },
      { key: "attention", label: "Perlu perhatian", type: "text", width: 34 },
    ],
    rows: rows.map((r) => ({
      code: r.code, name: r.name, program: r.programName ?? "", kind: ACTIVITY_KIND_LABEL[r.kind], status: PROJECT_STATUS_LABEL[r.status], start: r.startDate, end: r.endDate, pic: r.picName ?? "",
      tasks: `${r.tasksDone}/${r.tasksTotal}`, overdue: r.tasksOverdue, checklist: r.checklist.percent === null ? "Belum tersedia" : `${r.checklist.done}/${r.checklist.total} (${r.checklist.percent}%)`,
      participants: r.participants, documents: r.documents, attention: r.attention.map((a) => ATTENTION_LABEL[a]).join("; "),
    })),
    totals: null,
  };
}
