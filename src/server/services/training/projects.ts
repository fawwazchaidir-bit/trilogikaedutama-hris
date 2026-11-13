import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, transaction, type Tx } from "../../db";
import { Errors } from "../../errors";
import { parseInput } from "../../validate";
import type { Actor } from "../../actor";
import { writeAudit, diffFields } from "../../audit";
import { dateToIso, isoToDate } from "../../json";
import { notifyUsers } from "../notifications";
import {
  PROJECT_ROLE_LABEL, PROJECT_STATUS_LABEL,
  type ActivityKind, type DeliveryMode, type ProjectRole, type ProjectStatus,
} from "@/lib/training/types";
import { INTERN_FORBIDDEN_PROJECT_ROLES, type ProjectAbility } from "@/lib/training/access";
import { assigneeUnavailableReason } from "@/lib/training/availability";
import { assertNotIntern } from "../function-guard";
import { PROJECT_FORWARD, checkReadyForPreparation } from "@/lib/training/status";
import { checkClosureTasks, unacknowledgedRelaxations } from "@/lib/training/closure";
import { attentionReasons, checklistProgress, closureReadiness, type AttentionCode, type ChecklistProgress } from "@/lib/training/indicators";
import { formatProjectCode } from "@/lib/training/misc";
import {
  memberAddSchema, memberUpdateSchema, programSchema, programUpdateSchema, projectCloseSchema, projectCreateSchema,
  projectListSchema, projectReasonSchema, projectStatusSchema, projectUpdateSchema,
} from "@/lib/validation/training";
import type { Paged } from "@/lib/types";
import {
  accessibleProjectWhere, assertEditable, assertEditableLocked, assertModuleEnabled, loadProjectAccess, lockProjectExclusive, requireAbility, requireGlobalCap, requireModule,
} from "./access";
import { assertUuid, auditProject, iso, liveTaskWhere, today } from "./shared";
import { loadConfig } from "./indicator-config";
import { assertFollowUpAssignees, settleOpenTasksForClosure } from "./work";
import { applyTemplatesTx, loadProgramRow, regenerateWorkloadTx, toProgramRow } from "./indicator-data";
import type { Track } from "@/lib/training/indicators/config";

// ═════════════════════════════ Program ═════════════════════════════

export interface ProgramDto {
  id: string; name: string; kind: ActivityKind; description: string | null; isActive: boolean; projectCount: number;
}

export async function listPrograms(actor: Actor, opts: { includeInactive?: boolean } = {}): Promise<ProgramDto[]> {
  await requireModule(actor);
  const rows = await prisma.trainingProgram.findMany({
    where: opts.includeInactive ? {} : { isActive: true }, orderBy: [{ isActive: "desc" }, { name: "asc" }],
    include: { _count: { select: { projects: true } } },
  });
  return rows.map((p) => ({ id: p.id, name: p.name, kind: p.kind, description: p.description, isActive: p.isActive, projectCount: p._count.projects }));
}

export async function createProgram(actor: Actor, raw: unknown): Promise<ProgramDto> {
  await requireGlobalCap(actor, "managePrograms");
  const input = parseInput(programSchema, raw);
  return transaction(async (tx) => {
    try {
      const p = await tx.trainingProgram.create({ data: { ...input, createdById: actor.userId } });
      await writeAudit(tx, actor, { action: "training.program.create", entityType: "TrainingProgram", entityId: p.id, summary: `Program "${p.name}" dibuat`, after: { name: p.name, kind: p.kind } });
      return { id: p.id, name: p.name, kind: p.kind, description: p.description, isActive: p.isActive, projectCount: 0 };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw Errors.conflict("Sudah ada program dengan nama yang sama.");
      throw e;
    }
  });
}

export async function updateProgram(actor: Actor, id: string, raw: unknown): Promise<void> {
  await requireGlobalCap(actor, "managePrograms");
  assertUuid(id, "Program");
  const input = parseInput(programUpdateSchema, raw);
  await transaction(async (tx) => {
    const before = await tx.trainingProgram.findUnique({ where: { id } });
    if (!before) throw Errors.notFound("Program");
    const d = diffFields({ name: before.name, kind: before.kind, description: before.description, isActive: before.isActive }, input);
    if (d.changed.length === 0) return;
    try {
      await tx.trainingProgram.update({ where: { id }, data: input });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw Errors.conflict("Sudah ada program dengan nama yang sama.");
      throw e;
    }
    await writeAudit(tx, actor, { action: "training.program.update", entityType: "TrainingProgram", entityId: id, summary: `Program "${before.name}" diperbarui`, before: d.before, after: d.after });
  });
}

// ═════════════════════════════ Proyek ═════════════════════════════

export interface ProjectListItemDto {
  id: string; code: string; name: string; programName: string | null; kind: ActivityKind; clientName: string | null;
  status: ProjectStatus; startDate: string | null; endDate: string | null; picName: string | null; track: Track;
  checklist: ChecklistProgress; openTasks: number; overdueTasks: number; attention: AttentionCode[];
}

export interface ProjectDetailDto {
  id: string; code: string; name: string; programId: string | null; programName: string | null; kind: ActivityKind; clientName: string | null;
  deliveryMode: DeliveryMode; location: string | null; startDate: string | null; endDate: string | null; status: ProjectStatus;
  description: string | null; notes: string | null; checklistTemplateName: string | null;
  /** Pemantauan: jenis program & data pelaksana indikator. */
  track: Track; bnsp: boolean; participantsMin: number | null; participantsMax: number | null; requestDate: string | null; registrationCloseDate: string | null; indicatorsApplied: boolean;
  picName: string | null; picEmployeeId: string | null; createdAt: string; updatedAt: string;
  closedAt: string | null; closedByName: string | null; closureSummary: string | null; closureFollowUp: string | null; closureOverrideReason: string | null;
  cancelledAt: string | null; cancelReason: string | null;
  checklist: ChecklistProgress; openTasks: number; overdueTasks: number; attention: AttentionCode[];
  /** Kemampuan pelaku pada proyek ini (untuk menampilkan tombol; penegakan tetap di server). */
  abilities: ProjectAbility[];
  /** Peran proyek pelaku (null bila hanya pemantau/Manajer). */
  myRole: ProjectRole | null;
}

interface Signals { open: number; overdue: number; checklist: ChecklistProgress; requiredOutstanding: number; hasPic: boolean; picName: string | null }

/** Hitung sinyal proyek (tugas, checklist, PIC) untuk banyak proyek sekaligus — beberapa query, bukan N+1. */
async function loadSignals(db: Tx | typeof prisma, ids: string[]): Promise<Map<string, Signals>> {
  const out = new Map<string, Signals>();
  if (ids.length === 0) return out;
  const t = isoToDate(today());
  const [tasks, overdue, items, pics] = await Promise.all([
    db.trainingTask.groupBy({ by: ["projectId"], where: { AND: [liveTaskWhere, { projectId: { in: ids }, status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] } }] }, _count: { _all: true } }),
    db.trainingTask.groupBy({ by: ["projectId"], where: { AND: [liveTaskWhere, { projectId: { in: ids }, status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] }, dueDate: { lt: t } }] }, _count: { _all: true } }),
    db.trainingProjectChecklistItem.groupBy({ by: ["projectId", "isDone", "isRequired"], where: { projectId: { in: ids } }, _count: { _all: true } }),
    db.trainingProjectMember.findMany({ where: { projectId: { in: ids }, role: "PROJECT_MANAGER", endedAt: null }, select: { projectId: true, employee: { select: { fullName: true } } } }),
  ]);
  for (const id of ids) out.set(id, { open: 0, overdue: 0, checklist: { done: 0, total: 0, percent: null }, requiredOutstanding: 0, hasPic: false, picName: null });
  for (const r of tasks) out.get(r.projectId)!.open = r._count._all;
  for (const r of overdue) out.get(r.projectId)!.overdue = r._count._all;
  const acc = new Map<string, { done: number; total: number; req: number }>();
  for (const r of items) {
    const a = acc.get(r.projectId) ?? { done: 0, total: 0, req: 0 };
    a.total += r._count._all;
    if (r.isDone) a.done += r._count._all;
    if (r.isRequired && !r.isDone) a.req += r._count._all;
    acc.set(r.projectId, a);
  }
  for (const [pid, a] of acc) {
    const s = out.get(pid)!;
    s.checklist = checklistProgress([...Array(a.done).fill({ isDone: true }), ...Array(a.total - a.done).fill({ isDone: false })]);
    s.requiredOutstanding = a.req;
  }
  for (const r of pics) { const s = out.get(r.projectId)!; s.hasPic = true; s.picName = r.employee.fullName; }
  return out;
}

function attentionFor(p: { status: ProjectStatus; startDate: Date | null; endDate: Date | null }, s: Signals): AttentionCode[] {
  return attentionReasons({
    status: p.status, startDate: p.startDate ? dateToIso(p.startDate) : null, endDate: p.endDate ? dateToIso(p.endDate) : null,
    hasPic: s.hasPic, overdueTasks: s.overdue, requiredOutstanding: s.requiredOutstanding, today: today(),
  });
}

const listInclude = { program: { select: { name: true } } } satisfies Prisma.TrainingProjectInclude;

export async function listProjects(actor: Actor, raw: unknown = {}): Promise<Paged<ProjectListItemDto>> {
  const mod = await requireModule(actor);
  const f = parseInput(projectListSchema, raw);
  const pageSize = f.pageSize ?? 20;
  const page = f.page ?? 1;
  const and: Prisma.TrainingProjectWhereInput[] = [accessibleProjectWhere(actor, mod)];
  if (f.q) and.push({ OR: [{ name: { contains: f.q, mode: "insensitive" } }, { code: { contains: f.q, mode: "insensitive" } }, { clientName: { contains: f.q, mode: "insensitive" } }] });
  if (f.status) and.push({ status: f.status });
  if (f.active) and.push({ status: { in: ["PREPARATION", "RUNNING"] } });
  if (f.kind) and.push({ kind: f.kind });
  if (f.programId) and.push({ programId: f.programId });
  if (f.picId) and.push({ members: { some: { employeeId: f.picId, role: "PROJECT_MANAGER", endedAt: null } } });
  // Rentang tanggal: proyek yang periodenya beririsan dengan [from, to].
  if (f.from) and.push({ OR: [{ endDate: null }, { endDate: { gte: isoToDate(f.from) } }] });
  if (f.to) and.push({ OR: [{ startDate: null }, { startDate: { lte: isoToDate(f.to) } }] });
  if (f.attention) {
    const active = await prisma.trainingProject.findMany({ where: { AND: [...and, { status: { in: ["PREPARATION", "RUNNING"] } }] }, select: { id: true, status: true, startDate: true, endDate: true } });
    const sig = await loadSignals(prisma, active.map((p) => p.id));
    and.push({ id: { in: active.filter((p) => attentionFor(p, sig.get(p.id)!).length > 0).map((p) => p.id) } });
  }
  const where: Prisma.TrainingProjectWhereInput = { AND: and };
  const orderBy: Prisma.TrainingProjectOrderByWithRelationInput[] =
    f.sort === "start_asc" ? [{ startDate: { sort: "asc", nulls: "last" } }, { code: "asc" }]
    : f.sort === "code_desc" ? [{ code: "desc" }]
    : f.sort === "name_asc" ? [{ name: "asc" }]
    : [{ startDate: { sort: "desc", nulls: "first" } }, { code: "desc" }];
  const [total, rows] = await Promise.all([
    prisma.trainingProject.count({ where }),
    prisma.trainingProject.findMany({ where, include: listInclude, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  const sig = await loadSignals(prisma, rows.map((r) => r.id));
  const items = rows.map((r): ProjectListItemDto => {
    const s = sig.get(r.id)!;
    return {
      id: r.id, code: r.code, name: r.name, programName: r.program?.name ?? null, kind: r.kind, clientName: r.clientName, status: r.status,
      startDate: r.startDate ? dateToIso(r.startDate) : null, endDate: r.endDate ? dateToIso(r.endDate) : null, picName: s.picName, track: r.track,
      checklist: s.checklist, openTasks: s.open, overdueTasks: s.overdue, attention: attentionFor(r, s),
    };
  });
  return { items, total, page, pageSize, pageCount: Math.max(Math.ceil(total / pageSize), 1) };
}

export async function getProject(actor: Actor, id: string): Promise<ProjectDetailDto> {
  const access = await loadProjectAccess(actor, id);
  const r = await prisma.trainingProject.findUniqueOrThrow({ where: { id }, include: { program: { select: { name: true } } } });
  const sig = (await loadSignals(prisma, [id])).get(id)!;
  const pic = await prisma.trainingProjectMember.findFirst({ where: { projectId: id, role: "PROJECT_MANAGER", endedAt: null }, select: { employeeId: true } });
  const closer = r.closedById ? await prisma.user.findUnique({ where: { id: r.closedById }, select: { name: true } }) : null;
  return {
    id: r.id, code: r.code, name: r.name, programId: r.programId, programName: r.program?.name ?? null, kind: r.kind, clientName: r.clientName,
    deliveryMode: r.deliveryMode, location: r.location, startDate: r.startDate ? dateToIso(r.startDate) : null, endDate: r.endDate ? dateToIso(r.endDate) : null,
    status: r.status, description: r.description, notes: r.notes, checklistTemplateName: r.checklistTemplateName,
    track: r.track, bnsp: r.bnsp, participantsMin: r.participantsMin, participantsMax: r.participantsMax,
    requestDate: r.requestDate ? dateToIso(r.requestDate) : null, registrationCloseDate: r.registrationCloseDate ? dateToIso(r.registrationCloseDate) : null, indicatorsApplied: r.indicatorsAppliedAt !== null,
    picName: sig.picName, picEmployeeId: pic?.employeeId ?? null,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    closedAt: iso(r.closedAt), closedByName: closer?.name ?? null, closureSummary: r.closureSummary, closureFollowUp: r.closureFollowUp, closureOverrideReason: r.closureOverrideReason,
    cancelledAt: iso(r.cancelledAt), cancelReason: r.cancelReason,
    checklist: sig.checklist, openTasks: sig.open, overdueTasks: sig.overdue, attention: attentionFor(r, sig),
    abilities: [...access.abilities], myRole: access.memberRole,
  };
}

/** Nomor urut berikutnya pada tahun tsb — dipanggil dalam transaksi SETELAH advisory lock (tidak ada kode ganda saat dibuat bersamaan). */
async function nextProjectSeq(tx: Tx, year: number): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`training:project:${year}`}))`;
  const agg = await tx.trainingProject.aggregate({ where: { seqYear: year }, _max: { seqNo: true } });
  return (agg._max.seqNo ?? 0) + 1;
}

async function assertActiveEmployee(tx: Tx | typeof prisma, employeeId: string): Promise<{ id: string; fullName: string; userId: string | null }> {
  const e = await tx.employee.findUnique({ where: { id: employeeId }, select: { id: true, fullName: true, userId: true, isActive: true } });
  if (!e || !e.isActive) throw Errors.validation("Karyawan tidak ditemukan atau sudah nonaktif.", { employeeId: "Karyawan tidak valid" });
  return e;
}

async function addMemberRow(tx: Tx, actor: Actor, project: { id: string; code: string; name: string }, employeeId: string, role: ProjectRole, note: string | null): Promise<void> {
  const emp = await assertActiveEmployee(tx, employeeId);
  if ((INTERN_FORBIDDEN_PROJECT_ROLES as readonly string[]).includes(role)) await assertNotIntern(tx, employeeId, `menjadi ${PROJECT_ROLE_LABEL[role]}`, "employeeId");
  const dup = await tx.trainingProjectMember.findFirst({ where: { projectId: project.id, employeeId, endedAt: null }, select: { role: true } });
  if (dup) throw Errors.conflict(`${emp.fullName} sudah menjadi anggota proyek ini (${PROJECT_ROLE_LABEL[dup.role]}). Ubah perannya bila perlu.`);
  if (role === "PROJECT_MANAGER") {
    const pic = await tx.trainingProjectMember.findFirst({ where: { projectId: project.id, role: "PROJECT_MANAGER", endedAt: null }, select: { employee: { select: { fullName: true } } } });
    if (pic) throw Errors.conflict(`Proyek ini sudah memiliki Project Manager (PIC): ${pic.employee.fullName}. Akhiri penugasannya atau ubah perannya terlebih dulu.`);
  }
  try {
    const m = await tx.trainingProjectMember.create({ data: { projectId: project.id, employeeId, role, note, createdById: actor.userId } });
    await auditProject(tx, actor, project.id, { action: "training.member.add", summary: `${emp.fullName} ditambahkan ke ${project.code} sebagai ${PROJECT_ROLE_LABEL[role]}`, after: { memberId: m.id, employeeId, role } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw Errors.conflict("Karyawan sudah menjadi anggota, atau proyek sudah memiliki PIC. Muat ulang halaman.");
    throw e;
  }
  if (emp.userId && emp.userId !== actor.userId) {
    await notifyUsers(tx, [emp.userId], { type: "training.member.added", title: "Anda ditambahkan ke proyek pelatihan", body: `${project.code} · ${project.name} · ${PROJECT_ROLE_LABEL[role]}`, href: `/training/proyek/${project.id}` });
  }
}

export async function createProject(actor: Actor, raw: unknown): Promise<{ id: string; code: string; indicatorWarnings: string[] }> {
  const mod = await requireGlobalCap(actor, "createProject");
  const input = parseInput(projectCreateSchema, raw);
  const isManager = mod.caps.fullAccess; // Koordinator Program atau Direktur: boleh menetapkan PIC
  if (input.picEmployeeId && !isManager) throw Errors.forbidden("Hanya Koordinator Program yang dapat menetapkan Project Manager (PIC). Proyek dapat dibuat dulu tanpa PIC.");
  // Pembuat berlevel Admin Program mengelola proyeknya lewat keanggotaan; tanpa data karyawan ia tidak akan bisa membuka proyeknya sendiri.
  if (!isManager && !actor.employeeId) throw Errors.forbidden("Akun Anda belum tertaut ke data karyawan, sehingga tidak dapat menjadi anggota proyek. Minta HR menautkan akun Anda.");
  const year = Number(today().slice(0, 4));

  return transaction(async (tx) => {
    if (input.programId) {
      const prog = await tx.trainingProgram.findUnique({ where: { id: input.programId }, select: { isActive: true } });
      if (!prog || !prog.isActive) throw Errors.validation("Program tidak ditemukan atau sudah nonaktif.", { programId: "Program tidak valid" });
    }
    const template = input.checklistTemplateId
      ? await tx.trainingChecklistTemplate.findUnique({ where: { id: input.checklistTemplateId }, include: { items: { orderBy: [{ phase: "asc" }, { sortOrder: "asc" }] } } })
      : null;
    if (input.checklistTemplateId && (!template || !template.isActive)) throw Errors.validation("Template checklist tidak ditemukan atau nonaktif.", { checklistTemplateId: "Template tidak valid" });

    assertProgramNumbers(input.participantsMin, input.participantsMax, input.startDate, input.registrationCloseDate);
    const seqNo = await nextProjectSeq(tx, year);
    const code = formatProjectCode(year, seqNo);
    const p = await tx.trainingProject.create({
      data: {
        seqYear: year, seqNo, code, name: input.name, programId: input.programId, kind: input.kind, clientName: input.clientName, deliveryMode: input.deliveryMode,
        location: input.location, startDate: input.startDate ? isoToDate(input.startDate) : null, endDate: input.endDate ? isoToDate(input.endDate) : null,
        description: input.description, notes: input.notes, checklistTemplateName: template?.name ?? null, createdById: actor.userId,
        track: input.track, participantsMin: input.participantsMin, participantsMax: input.participantsMax, bnsp: input.bnsp,
        requestDate: input.requestDate ? isoToDate(input.requestDate) : null, registrationCloseDate: input.registrationCloseDate ? isoToDate(input.registrationCloseDate) : null,
      },
    });
    await auditProject(tx, actor, p.id, { action: "training.project.create", summary: `Proyek ${code} "${p.name}" dibuat`, after: { code, name: p.name, kind: p.kind, programId: p.programId } });
    if (input.picEmployeeId) await addMemberRow(tx, actor, p, input.picEmployeeId, "PROJECT_MANAGER", null);
    // Pembuat berlevel Admin Program otomatis menjadi anggota (Admin Program) agar dapat mengelola proyek yang ia buat.
    if (!isManager && actor.employeeId) await addMemberRow(tx, actor, p, actor.employeeId, "ADMIN_PROGRAM", "Pembuat proyek");
    if (template) {
      await tx.trainingProjectChecklistItem.createMany({
        data: template.items.map((it, i) => ({ projectId: p.id, phase: it.phase, title: it.title, isRequired: it.isRequired, sortOrder: i, sourceTemplateName: template.name, createdById: actor.userId })),
      });
      await auditProject(tx, actor, p.id, { action: "training.checklist.apply", summary: `Template checklist "${template.name}" diterapkan (${template.items.length} item)`, after: { template: template.name, items: template.items.length } });
    }
    // Template pemantauan (milestone, item kesiapan, jam kerja) mengikuti jenis program; dapat dimatikan di konfigurasi indikator.
    let indicatorWarnings: string[] = [];
    const cfg = (await loadConfig(tx)).config;
    if (cfg.autoApplyOnCreate) indicatorWarnings = (await applyTemplatesTx(tx, actor, toProgramRow(p), cfg)).warnings;
    return { id: p.id, code, indicatorWarnings };
  });
}

/** Aturan angka & tanggal program: maksimum ≥ minimum; tutup pendaftaran tidak setelah hari pertama. */
function assertProgramNumbers(min: number | null | undefined, max: number | null | undefined, start: string | null | undefined, close: string | null | undefined): void {
  if (min != null && max != null && max < min) throw Errors.validation("Peserta maksimum tidak boleh lebih kecil dari peserta minimum.", { participantsMax: "Lebih kecil dari minimum" });
  if (start && close && close > start) throw Errors.validation("Tutup pendaftaran tidak boleh setelah tanggal mulai.", { registrationCloseDate: "Setelah tanggal mulai" });
}

export async function updateProject(actor: Actor, id: string, raw: unknown): Promise<void> {
  const access = await loadProjectAccess(actor, id);
  requireAbility(access, "update");
  assertEditable(access.project);
  const input = parseInput(projectUpdateSchema, raw);
  await transaction(async (tx) => {
    await assertEditableLocked(tx, id);                              // proyek yang sedang/sudah ditutup tidak dapat diubah datanya
    const b = await tx.trainingProject.findUniqueOrThrow({ where: { id } });
    const data: Prisma.TrainingProjectUncheckedUpdateInput = {};
    const next = { ...input };
    if ("programId" in next && next.programId) {
      const prog = await tx.trainingProgram.findUnique({ where: { id: next.programId }, select: { isActive: true } });
      if (!prog || !prog.isActive) throw Errors.validation("Program tidak ditemukan atau sudah nonaktif.", { programId: "Program tidak valid" });
    }
    const s = "startDate" in next ? next.startDate : b.startDate ? dateToIso(b.startDate) : null;
    const e = "endDate" in next ? next.endDate : b.endDate ? dateToIso(b.endDate) : null;
    if (s && e && e < s) throw Errors.validation("Tanggal selesai tidak boleh sebelum tanggal mulai.", { endDate: "Sebelum tanggal mulai" });
    if (b.status !== "DRAFT" && (!s || !e)) throw Errors.validation("Proyek yang sudah masuk persiapan wajib memiliki tanggal mulai dan selesai.", { startDate: "Wajib diisi" });
    const close = "registrationCloseDate" in next ? next.registrationCloseDate : b.registrationCloseDate ? dateToIso(b.registrationCloseDate) : null;
    assertProgramNumbers("participantsMin" in next ? next.participantsMin : b.participantsMin, "participantsMax" in next ? next.participantsMax : b.participantsMax, s, close);
    for (const k of ["name", "programId", "kind", "clientName", "deliveryMode", "location", "description", "notes", "track", "bnsp", "participantsMin", "participantsMax"] as const) if (k in next) (data as Record<string, unknown>)[k] = next[k];
    if ("startDate" in next) data.startDate = next.startDate ? isoToDate(next.startDate) : null;
    if ("endDate" in next) data.endDate = next.endDate ? isoToDate(next.endDate) : null;
    if ("requestDate" in next) data.requestDate = next.requestDate ? isoToDate(next.requestDate) : null;
    if ("registrationCloseDate" in next) data.registrationCloseDate = next.registrationCloseDate ? isoToDate(next.registrationCloseDate) : null;
    const before = {
      name: b.name, programId: b.programId, kind: b.kind, clientName: b.clientName, deliveryMode: b.deliveryMode, location: b.location, startDate: b.startDate ? dateToIso(b.startDate) : null, endDate: b.endDate ? dateToIso(b.endDate) : null,
      description: b.description, notes: b.notes, track: b.track, bnsp: b.bnsp, participantsMin: b.participantsMin, participantsMax: b.participantsMax,
      requestDate: b.requestDate ? dateToIso(b.requestDate) : null, registrationCloseDate: b.registrationCloseDate ? dateToIso(b.registrationCloseDate) : null,
    };
    const after = { ...before, ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v instanceof Date ? dateToIso(v) : v])) };
    const d = diffFields(before, after);
    if (d.changed.length === 0) return;
    const trackChanged = d.changed.includes("track") && b.indicatorsAppliedAt !== null;
    if (trackChanged) {
      // Jenis program menentukan template. Boleh diganti hanya selama belum ada kemajuan yang tercatat (tidak ada milestone selesai, item bukan "terbuka", jam kerja manual/disesuaikan/selesai).
      const [doneMs, touchedItems, manualWork] = await Promise.all([
        tx.trainingMilestone.count({ where: { projectId: id, OR: [{ doneAt: { not: null } }, { notApplicable: true }] } }),
        tx.trainingReadinessItem.count({ where: { projectId: id, status: { not: "OPEN" } } }),
        tx.trainingWorkloadTask.count({ where: { projectId: id, OR: [{ source: "MANUAL" }, { adjusted: true }, { status: { not: "OPEN" } }] } }),
      ]);
      if (doneMs + touchedItems + manualWork > 0) throw Errors.conflict("Jenis program tidak dapat diganti karena milestone/item kesiapan sudah mulai dikerjakan atau ada jam kerja manual. Buat proyek baru dengan jenis yang benar.");
    }
    await tx.trainingProject.update({ where: { id }, data });
    await auditProject(tx, actor, id, { action: "training.project.update", summary: `Data proyek ${b.code} diperbarui (${d.changed.join(", ")})`, before: d.before, after: d.after });
    // Tanggal H/T, peserta acuan, moda, atau jenis program berubah → tugas jam kerja dari template dihitung ulang (yang manual tidak disentuh).
    if (b.indicatorsAppliedAt && d.changed.some((k) => ["startDate", "endDate", "requestDate", "deliveryMode", "participantsMin", "track"].includes(k))) {
      const cfg = (await loadConfig(tx)).config;
      const row = await loadProgramRow(tx, id);
      if (trackChanged) {
        await tx.trainingMilestone.deleteMany({ where: { projectId: id } });
        await tx.trainingReadinessItem.deleteMany({ where: { projectId: id } });
        // Jam kerja TIDAK dihapus di sini: `applyTemplatesTx` menyinkronkannya (baris yang belum disentuh mengikuti template baru; yang disesuaikan/selesai dipertahankan).
        await applyTemplatesTx(tx, actor, row, cfg);
      } else {
        const r = await regenerateWorkloadTx(tx, actor, row, cfg);
        await auditProject(tx, actor, id, { action: "training.indicator.workload", summary: `Tugas jam kerja dari template dihitung ulang karena data program berubah (${r.created} baru, ${r.updated} diperbarui, ${r.removed} dihapus${r.warnings.length ? `; ${r.warnings.length} peringatan` : ""})`, after: { created: r.created, updated: r.updated, removed: r.removed, warnings: r.warnings } });
      }
    }
  });
}

/** Perpindahan maju Draf → Persiapan → Berjalan. Penutupan/pembatalan/pembukaan kembali punya alur sendiri di bawah. */
export async function changeProjectStatus(actor: Actor, id: string, raw: unknown): Promise<{ status: ProjectStatus }> {
  const access = await loadProjectAccess(actor, id);
  requireAbility(access, "change_status");
  assertEditable(access.project);
  const { to } = parseInput(projectStatusSchema, raw);
  return transaction(async (tx) => {
    await lockProjectExclusive(tx, id);
    const p = await tx.trainingProject.findUniqueOrThrow({ where: { id } });
    if (PROJECT_FORWARD[p.status] !== to) {
      throw Errors.conflict(`Status proyek saat ini "${PROJECT_STATUS_LABEL[p.status]}"; status berikutnya yang sah adalah ${PROJECT_FORWARD[p.status] ? `"${PROJECT_STATUS_LABEL[PROJECT_FORWARD[p.status]!]}"` : "—"}.`);
    }
    if (to === "PREPARATION") {
      const pic = await tx.trainingProjectMember.count({ where: { projectId: id, role: "PROJECT_MANAGER", endedAt: null } });
      const chk = checkReadyForPreparation({ startDate: p.startDate ? dateToIso(p.startDate) : null, endDate: p.endDate ? dateToIso(p.endDate) : null, hasPic: pic > 0 });
      if (!chk.ok) throw Errors.conflict(chk.problems.join(" "), { problems: chk.problems });
    }
    const r = await tx.trainingProject.updateMany({ where: { id, status: p.status }, data: { status: to } });
    if (r.count === 0) throw Errors.conflict("Status proyek baru saja diubah pengguna lain. Muat ulang halaman.");
    await auditProject(tx, actor, id, { action: "training.project.status", summary: `${p.code}: ${PROJECT_STATUS_LABEL[p.status]} → ${PROJECT_STATUS_LABEL[to]}`, before: { status: p.status }, after: { status: to } });
    return { status: to };
  });
}

export interface CloseResult { code: string; closedWithOverride: boolean; outstandingRequired: string[]; openTasks: number; followUpTasks: number; cancelledTasks: number; acknowledgedRelaxations: number }

/**
 * Penutupan proyek (Koordinator Program). Syarat:
 *  1. semua item checklist WAJIB selesai — bila ada yang belum, hanya boleh dengan alasan pengecualian tertulis (item yang dilewati dicatat di audit);
 *  2. SETIAP tugas yang masih terbuka diputuskan: dijadikan tindak lanjut (penanggung jawab + tenggat; tetap dapat dikerjakan setelah proyek Selesai) atau dibatalkan (beralasan).
 *     Tugas terbuka tidak menghalangi penutupan, tetapi tidak boleh menggantung;
 *  3. pelonggaran checklist wajib (dijadikan tidak wajib/dihapus) yang belum diakui harus DIAKUI (`acknowledgeRelaxed`), lalu tercatat di audit.
 * Menutup proyek TIDAK mengubah surat tugas, uang harian, invoice, sertifikat, atau kompetensi peserta.
 */
export async function closeProject(actor: Actor, id: string, raw: unknown): Promise<CloseResult> {
  const access = await loadProjectAccess(actor, id);
  requireAbility(access, "close", "Hanya Koordinator Program yang dapat menutup proyek.");
  assertEditable(access.project);
  const input = parseInput(projectCloseSchema, raw);
  return transaction(async (tx) => {
    // Kunci EKSKLUSIF proyek: menunggu penulis (tugas/checklist/anggota) yang sedang berjalan selesai — sehingga semua yang dibaca di bawah adalah data TERBARU — dan menahan penulis
    // berikutnya sampai penutupan commit (mereka lalu melihat status baru dan ditolak). Harus langkah pertama di transaksi.
    await lockProjectExclusive(tx, id);
    const p = await tx.trainingProject.findUniqueOrThrow({ where: { id } });
    if (p.status === "COMPLETED") throw Errors.conflict("Proyek ini sudah ditutup (Selesai) oleh pengguna lain. Muat ulang halaman.");
    if (p.status === "CANCELLED") throw Errors.conflict("Proyek ini sudah dibatalkan sehingga tidak dapat ditutup.");
    if (p.status !== "PREPARATION" && p.status !== "RUNNING") throw Errors.conflict("Hanya proyek berstatus Persiapan atau Berjalan yang dapat ditutup.");
    const [items, tasks, relaxations] = await Promise.all([
      tx.trainingProjectChecklistItem.findMany({ where: { projectId: id }, select: { title: true, isRequired: true, isDone: true } }),
      tx.trainingTask.findMany({ where: { projectId: id }, select: { id: true, title: true, status: true, assigneeId: true, dueDate: true } }),
      tx.trainingChecklistRelaxation.findMany({ where: { projectId: id }, orderBy: { createdAt: "asc" }, select: { id: true, itemTitle: true, kind: true, reason: true, acknowledgedAt: true } }),
    ]);
    const lite = tasks.map((t) => ({ id: t.id, title: t.title, status: t.status, assigneeId: t.assigneeId, dueDate: t.dueDate ? dateToIso(t.dueDate) : null }));
    const ready = closureReadiness(items, lite.map((t) => ({ status: t.status, dueDate: t.dueDate })));
    const outstanding = items.filter((i) => i.isRequired && !i.isDone).map((i) => i.title);
    if (!ready.canCloseClean && !input.overrideReason) {
      throw Errors.conflict(`Masih ada ${outstanding.length} checklist wajib yang belum selesai. Selesaikan, atau tutup dengan alasan pengecualian tertulis.`, { outstanding });
    }
    const pending = unacknowledgedRelaxations(relaxations.map((r) => ({ ...r, acknowledgedAt: r.acknowledgedAt ? r.acknowledgedAt.toISOString() : null })));
    if (pending.length > 0 && !input.acknowledgeRelaxed) {
      throw Errors.conflict(`Ada ${pending.length} checklist wajib yang dilonggarkan (dijadikan tidak wajib/dihapus). Periksa alasannya, lalu centang pengakuan untuk menutup.`, { relaxed: pending.map((r) => r.itemTitle) });
    }
    const chk = checkClosureTasks(lite, input.taskDecisions, today());
    if (!chk.ok) {
      const head = chk.undecided.length ? `Masih ada ${chk.undecided.length} tugas terbuka yang belum diputuskan. Pilih: jadikan tindak lanjut atau batalkan.`
        : chk.unknown.length ? "Daftar tugas terbuka berubah sejak halaman dimuat. Muat ulang halaman penutupan."
        : chk.invalid[0]!.message;
      throw Errors.conflict(head, { undecided: chk.undecided.map((t) => t.title), unknown: chk.unknown, invalid: chk.invalid.map((x) => `${x.title}: ${x.message}`) });
    }
    await assertFollowUpAssignees(tx, id, chk.plan);
    const r = await tx.trainingProject.updateMany({
      where: { id, status: p.status },
      data: { status: "COMPLETED", closedAt: new Date(), closedById: actor.userId, closureSummary: input.summary, closureFollowUp: input.followUp, closureOverrideReason: ready.canCloseClean ? null : input.overrideReason },
    });
    if (r.count === 0) throw Errors.conflict("Status proyek baru saja diubah pengguna lain. Muat ulang halaman.");
    await settleOpenTasksForClosure(tx, actor, { id, code: p.code }, chk.plan);
    if (pending.length > 0) await tx.trainingChecklistRelaxation.updateMany({ where: { id: { in: pending.map((x) => x.id) } }, data: { acknowledgedAt: new Date(), acknowledgedById: actor.userId } });
    const note = [
      ready.canCloseClean ? "" : ` DENGAN PENGECUALIAN (${outstanding.length} checklist wajib dilewati)`,
      chk.plan.followUp.length || chk.plan.cancel.length ? `; tugas terbuka: ${chk.plan.followUp.length} jadi tindak lanjut, ${chk.plan.cancel.length} dibatalkan` : "",
      pending.length ? `; ${pending.length} pelonggaran checklist wajib diakui` : "",
    ].join("");
    await auditProject(tx, actor, id, {
      action: "training.project.close", summary: `Proyek ${p.code} ditutup${note}`,
      before: { status: p.status },
      after: {
        status: "COMPLETED", skippedRequired: ready.canCloseClean ? [] : outstanding, openTasks: ready.openTasks,
        followUp: chk.plan.followUp.map((f) => ({ taskId: f.taskId, title: f.title, assigneeId: f.assigneeId, dueDate: f.dueDate })),
        cancelled: chk.plan.cancel.map((c) => ({ taskId: c.taskId, title: c.title, reason: c.reason })),
        relaxedAcknowledged: pending.map((x) => ({ title: x.itemTitle, kind: x.kind, reason: x.reason })),
      },
      reason: ready.canCloseClean ? null : input.overrideReason,
    });
    return { code: p.code, closedWithOverride: !ready.canCloseClean, outstandingRequired: outstanding, openTasks: ready.openTasks, followUpTasks: chk.plan.followUp.length, cancelledTasks: chk.plan.cancel.length, acknowledgedRelaxations: pending.length };
  });
}

export async function cancelProject(actor: Actor, id: string, raw: unknown): Promise<void> {
  const access = await loadProjectAccess(actor, id);
  requireAbility(access, "cancel", "Hanya Koordinator Program yang dapat membatalkan proyek.");
  assertEditable(access.project);
  const { reason } = parseInput(projectReasonSchema, raw);
  await transaction(async (tx) => {
    await lockProjectExclusive(tx, id);                              // serial dengan penutupan & penulis; status dibaca SEGAR di bawah
    const p = await tx.trainingProject.findUniqueOrThrow({ where: { id } });
    if (p.status === "COMPLETED") throw Errors.conflict("Proyek ini sudah ditutup (Selesai) sehingga tidak dapat dibatalkan. Koordinator Program dapat membukanya kembali dengan alasan.");
    if (p.status === "CANCELLED") throw Errors.conflict("Proyek ini sudah dibatalkan.");
    const r = await tx.trainingProject.updateMany({ where: { id, status: p.status }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason } });
    if (r.count === 0) throw Errors.conflict("Status proyek baru saja diubah pengguna lain. Muat ulang halaman.");
    await auditProject(tx, actor, id, { action: "training.project.cancel", summary: `Proyek ${p.code} dibatalkan`, before: { status: p.status }, after: { status: "CANCELLED" }, reason });
  });
}

/** Membuka kembali proyek Selesai (salah tutup). Proyek Dibatalkan bersifat final. Catatan penutupan lama tetap ada di audit. */
export async function reopenProject(actor: Actor, id: string, raw: unknown): Promise<void> {
  const access = await loadProjectAccess(actor, id);
  requireAbility(access, "reopen", "Hanya Koordinator Program yang dapat membuka kembali proyek.");
  const { reason } = parseInput(projectReasonSchema, raw);
  await transaction(async (tx) => {
    await lockProjectExclusive(tx, id);
    const p = await tx.trainingProject.findUniqueOrThrow({ where: { id } });
    if (p.status !== "COMPLETED") throw Errors.conflict("Hanya proyek berstatus Selesai yang dapat dibuka kembali.");
    await tx.trainingProject.update({ where: { id }, data: { status: "RUNNING", closedAt: null, closedById: null, closureSummary: null, closureFollowUp: null, closureOverrideReason: null } });
    // Proyek aktif lagi: tugas tindak lanjut kembali menjadi tugas biasa (penutupan berikutnya meminta keputusan untuk semua tugas yang terbuka).
    const cleared = await tx.trainingTask.updateMany({ where: { projectId: id, isFollowUp: true }, data: { isFollowUp: false } });
    await auditProject(tx, actor, id, {
      action: "training.project.reopen", summary: `Proyek ${p.code} dibuka kembali (Selesai → Berjalan)${cleared.count ? `; ${cleared.count} tugas tindak lanjut kembali menjadi tugas biasa` : ""}`,
      before: { status: "COMPLETED", closedAt: iso(p.closedAt), closureSummary: p.closureSummary, closureFollowUp: p.closureFollowUp, closureOverrideReason: p.closureOverrideReason }, after: { status: "RUNNING" }, reason,
    });
  });
}

// ═════════════════════════════ Tim proyek ═════════════════════════════

export interface MemberDto {
  id: string; employeeId: string; employeeNo: string; name: string; position: string; role: ProjectRole; note: string | null;
  startedAt: string; endedAt: string | null; active: boolean;
  /** Tanggung jawab: tugas terbuka & checklist belum selesai yang ditugaskan kepadanya pada proyek ini. */
  openTasks: number; openChecklist: number;
  /** Karyawan sudah berhenti / akunnya nonaktif padahal keanggotaan masih aktif → PIC perlu mengalihkan tugasnya lalu mengakhiri penugasan. */
  unavailable: "EMPLOYEE_INACTIVE" | "ACCOUNT_INACTIVE" | null;
}

export async function listMembers(actor: Actor, projectId: string): Promise<MemberDto[]> {
  await loadProjectAccess(actor, projectId);
  const rows = await prisma.trainingProjectMember.findMany({
    where: { projectId }, orderBy: [{ endedAt: { sort: "asc", nulls: "first" } }, { role: "asc" }, { startedAt: "asc" }],
    include: { employee: { select: { employeeNo: true, fullName: true, position: true, isActive: true, user: { select: { isActive: true } } } } },
  });
  const ids = rows.map((r) => r.employeeId);
  const [tasks, chk] = await Promise.all([
    prisma.trainingTask.groupBy({ by: ["assigneeId"], where: { projectId, assigneeId: { in: ids }, status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] } }, _count: { _all: true } }),
    prisma.trainingProjectChecklistItem.groupBy({ by: ["assigneeId"], where: { projectId, assigneeId: { in: ids }, isDone: false }, _count: { _all: true } }),
  ]);
  const t = new Map(tasks.map((x) => [x.assigneeId, x._count._all]));
  const c = new Map(chk.map((x) => [x.assigneeId, x._count._all]));
  return rows.map((r) => ({
    id: r.id, employeeId: r.employeeId, employeeNo: r.employee.employeeNo, name: r.employee.fullName, position: r.employee.position, role: r.role, note: r.note,
    startedAt: r.startedAt.toISOString(), endedAt: iso(r.endedAt), active: r.endedAt === null, openTasks: t.get(r.employeeId) ?? 0, openChecklist: c.get(r.employeeId) ?? 0,
    unavailable: r.endedAt !== null ? null : (assigneeUnavailableReason({ activeMember: true, employeeActive: r.employee.isActive, accountActive: r.employee.user?.isActive ?? null }) as MemberDto["unavailable"]),
  }));
}

function requireTeamRights(access: Awaited<ReturnType<typeof loadProjectAccess>>, roles: ProjectRole[]): void {
  requireAbility(access, "manage_team", "Hanya Project Manager atau Koordinator Program yang dapat mengatur tim proyek.");
  if (roles.includes("PROJECT_MANAGER")) requireAbility(access, "manage_pic", "Hanya Koordinator Program yang dapat menetapkan, mengganti, atau mengakhiri Project Manager (PIC).");
}

export async function addMember(actor: Actor, projectId: string, raw: unknown): Promise<void> {
  const access = await loadProjectAccess(actor, projectId);
  assertEditable(access.project);
  const input = parseInput(memberAddSchema, raw);
  requireTeamRights(access, [input.role]);
  await transaction(async (tx) => { await assertEditableLocked(tx, projectId); await addMemberRow(tx, actor, access.project, input.employeeId, input.role, input.note); });
}

export async function updateMember(actor: Actor, projectId: string, memberId: string, raw: unknown): Promise<void> {
  const access = await loadProjectAccess(actor, projectId);
  assertEditable(access.project);
  assertUuid(memberId, "Anggota");
  const input = parseInput(memberUpdateSchema, raw);
  await transaction(async (tx) => {
    await assertEditableLocked(tx, projectId);
    // `projectId` ikut pada where: anggota proyek lain dengan ID yang ditebak → 404.
    const m = await tx.trainingProjectMember.findFirst({ where: { id: memberId, projectId, endedAt: null }, include: { employee: { select: { fullName: true } } } });
    if (!m) throw Errors.notFound("Anggota");
    requireTeamRights(access, [m.role, ...(input.role ? [input.role] : [])]);
    if (input.role && (INTERN_FORBIDDEN_PROJECT_ROLES as readonly string[]).includes(input.role)) await assertNotIntern(tx, m.employeeId, `menjadi ${PROJECT_ROLE_LABEL[input.role]}`, "role");
    if (input.role === "PROJECT_MANAGER" && m.role !== "PROJECT_MANAGER") {
      const pic = await tx.trainingProjectMember.count({ where: { projectId, role: "PROJECT_MANAGER", endedAt: null } });
      if (pic > 0) throw Errors.conflict("Proyek ini sudah memiliki Project Manager (PIC). Akhiri penugasan PIC lama terlebih dulu.");
    }
    const data: Prisma.TrainingProjectMemberUpdateInput = {};
    if (input.role !== undefined) data.role = input.role;
    if (input.note !== undefined) data.note = input.note;
    await tx.trainingProjectMember.update({ where: { id: memberId }, data });
    await auditProject(tx, actor, projectId, {
      action: "training.member.update", summary: `Penugasan ${m.employee.fullName} di ${access.project.code} diubah${input.role ? `: ${PROJECT_ROLE_LABEL[m.role]} → ${PROJECT_ROLE_LABEL[input.role]}` : ""}`,
      before: { role: m.role }, after: { role: input.role ?? m.role },
    });
  });
}

/**
 * Akhiri keanggotaan. TIDAK menolak bila anggota masih memegang tugas/checklist — hanya MEMPERINGATKAN (hasil `openTasks`/`openChecklist` ditampilkan ke PIC) dan
 * mencatatnya. Sejak berakhir ia tidak lagi menjadi "pemilik" tugas/checklist itu (tidak dapat mengubah statusnya; tidak masuk "Tugas Saya"); tugasnya tetap
 * tercatat atas namanya dan ditandai "perlu dialihkan" sampai PIC mengalihkannya.
 */
export async function endMember(actor: Actor, projectId: string, memberId: string): Promise<{ openTasks: number; openChecklist: number }> {
  const access = await loadProjectAccess(actor, projectId);
  assertEditable(access.project);
  assertUuid(memberId, "Anggota");
  return transaction(async (tx) => {
    await assertEditableLocked(tx, projectId);
    const m = await tx.trainingProjectMember.findFirst({ where: { id: memberId, projectId, endedAt: null }, include: { employee: { select: { fullName: true } } } });
    if (!m) throw Errors.notFound("Anggota");
    requireTeamRights(access, [m.role]);
    // `startedAt` diisi jam DATABASE (now()), `endedAt` jam APLIKASI: bila jam aplikasi sedikit tertinggal, CHECK endedAt >= startedAt akan
    // menolak "tambah lalu segera akhiri". Jadi endedAt tidak boleh lebih awal dari startedAt yang dibaca dari DB.
    const endedAt = new Date(Math.max(Date.now(), m.startedAt.getTime()));
    await tx.trainingProjectMember.update({ where: { id: memberId }, data: { endedAt, endedById: actor.userId } });
    const openTasks = await tx.trainingTask.count({ where: { projectId, assigneeId: m.employeeId, status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] } } });
    const openChecklist = await tx.trainingProjectChecklistItem.count({ where: { projectId, assigneeId: m.employeeId, isDone: false } });
    const holding = [openTasks && `${openTasks} tugas terbuka`, openChecklist && `${openChecklist} item checklist`].filter(Boolean).join(" dan ");
    await auditProject(tx, actor, projectId, { action: "training.member.end", summary: `Penugasan ${m.employee.fullName} di ${access.project.code} diakhiri${holding ? ` (masih memegang ${holding}; perlu dialihkan)` : ""}`, before: { role: m.role }, after: { ended: true } });
    return { openTasks, openChecklist };
  });
}

/** PIC (Project Manager aktif) pada proyek yang boleh dilihat pelaku — untuk filter daftar proyek. Hanya nama & id. */
export async function listPicOptions(actor: Actor): Promise<{ id: string; name: string }[]> {
  const mod = await requireModule(actor);
  const rows = await prisma.trainingProjectMember.findMany({
    where: { role: "PROJECT_MANAGER", endedAt: null, project: accessibleProjectWhere(actor, mod) },
    select: { employee: { select: { id: true, fullName: true } } }, distinct: ["employeeId"], orderBy: { employee: { fullName: "asc" } },
  });
  return rows.map((r) => ({ id: r.employee.id, name: r.employee.fullName }));
}

// ═════════════════════════════ Opsi formulir ═════════════════════════════

export interface ProjectFormOptions {
  programs: { id: string; name: string; kind: ActivityKind }[];
  templates: { id: string; name: string; itemCount: number }[];
}

export async function getProjectFormOptions(actor: Actor): Promise<ProjectFormOptions> {
  assertModuleEnabled();
  await requireGlobalCap(actor, "createProject");
  const [programs, templates] = await Promise.all([
    prisma.trainingProgram.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true } }),
    prisma.trainingChecklistTemplate.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, _count: { select: { items: true } } } }),
  ]);
  return { programs, templates: templates.map((t) => ({ id: t.id, name: t.name, itemCount: t._count.items })) };
}
