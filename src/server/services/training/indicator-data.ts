import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, transaction, type Tx } from "../../db";
import { Errors } from "../../errors";
import { parseInput } from "../../validate";
import type { Actor } from "../../actor";
import { writeAudit } from "../../audit";
import { dateToIso, isoToDate } from "../../json";
import { addDays, diffDays } from "@/lib/time";
import {
  resolveDueMap, resolveOffset, standardHours, type DateContext, type ItemStatus, type OffsetSpec, type WorkCal,
} from "@/lib/training/indicators/engine";
import { offsetLabel } from "@/lib/training/indicators/format";
import { assigneeUnavailableReason, type AssigneeUnavailable } from "@/lib/training/availability";
import { COMPONENT_LABEL, type Anchor, type IndicatorConfig, type ItemComponent, type Track } from "@/lib/training/indicators/config";
import {
  milestoneAddSchema, milestoneCompleteSchema, milestoneUpdateSchema, readinessAddSchema, readinessStatusSchema, staffCapacitySchema, workloadSchema, workloadUpdateSchema,
} from "@/lib/validation/training";
import { assertEditable, getModuleContext, loadProjectAccess, requireAbility, assertModuleEnabled } from "./access";
import { loadConfig } from "./indicator-config";
import { assertUuid, auditProject, today } from "./shared";

type Db = Tx | typeof prisma;

// ═════════════════════════ Data program untuk indikator ═════════════════════════

export interface ProgramRow {
  id: string; code: string; name: string; status: string; track: Track; bnsp: boolean; deliveryMode: "ONSITE" | "ONLINE" | "HYBRID";
  startDate: string | null; endDate: string | null; requestDate: string | null; participantsMin: number | null; registrationCloseDate: string | null; indicatorsAppliedAt: Date | null;
}

export async function loadProgramRow(db: Db, id: string): Promise<ProgramRow> {
  const p = await db.trainingProject.findUniqueOrThrow({ where: { id } });
  return toProgramRow(p);
}
export function toProgramRow(p: Prisma.TrainingProjectGetPayload<object>): ProgramRow {
  return {
    id: p.id, code: p.code, name: p.name, status: p.status, track: p.track, bnsp: p.bnsp, deliveryMode: p.deliveryMode,
    startDate: p.startDate ? dateToIso(p.startDate) : null, endDate: p.endDate ? dateToIso(p.endDate) : null, requestDate: p.requestDate ? dateToIso(p.requestDate) : null,
    participantsMin: p.participantsMin, registrationCloseDate: p.registrationCloseDate ? dateToIso(p.registrationCloseDate) : null, indicatorsAppliedAt: p.indicatorsAppliedAt,
  };
}
/**
 * Kalender kerja untuk menghitung tenggat "hari kerja" (T+2 hari kerja, dst.): hari kerja dari konfigurasi; hari libur kalender HRIS hanya
 * dikecualikan bila `skipHolidays` aktif (dokumen memakai NETWORKDAYS tanpa hari libur).
 */
export async function loadCal(db: Db, cfg: IndicatorConfig): Promise<WorkCal> {
  if (!cfg.capacity.skipHolidays) return { workDays: cfg.capacity.workDays };
  const t = today();
  const rows = await db.calendarDay.findMany({ where: { kind: "HOLIDAY", date: { gte: isoToDate(addDays(t, -400)), lte: isoToDate(addDays(t, 800)) } }, select: { date: true } });
  return { workDays: cfg.capacity.workDays, holidays: new Set(rows.map((r) => dateToIso(r.date))) };
}

/** Tanggal acuan: H = tanggal mulai; hari terakhir = tanggal selesai; T = permintaan klien masuk. */
export const dateCtx = (p: ProgramRow): DateContext => ({ h: p.startDate, hEnd: p.endDate ?? p.startDate, t: p.requestDate });
export const classDaysOf = (p: ProgramRow): number => (p.startDate && p.endDate ? Math.max(1, diffDays(p.endDate, p.startDate) + 1) : 1);

// ═════════════════════════ Terapkan template ═════════════════════════

export interface ApplyResult { milestones: number; items: number; workloadTasks: number; warnings: string[] }

async function activeHolders(db: Db, cfg: IndicatorConfig): Promise<Map<string, string>> {
  const ids = [...new Set(Object.values(cfg.roleHolders).filter((x): x is string => !!x))];
  const ok = ids.length ? new Set((await db.employee.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true } })).map((e) => e.id)) : new Set<string>();
  const out = new Map<string, string>();
  for (const [role, id] of Object.entries(cfg.roleHolders)) if (id && ok.has(id)) out.set(role, id);
  return out;
}

function buildWorkloadRows(p: ProgramRow, cfg: IndicatorConfig, cal: WorkCal, holders: Map<string, string>, createdById: string, warnings: string[]): Prisma.TrainingWorkloadTaskCreateManyInput[] {
  const ctx = dateCtx(p);
  const roleLabel = new Map(cfg.roles.map((r) => [r.key, r.label]));
  const rows: Prisma.TrainingWorkloadTaskCreateManyInput[] = [];
  for (const h of cfg.hourTable) {
    if (!h.tracks.includes(p.track)) continue;
    if (h.modes.length && !h.modes.includes(p.deliveryMode)) continue;
    const emp = holders.get(h.roleKey);
    if (!emp) { warnings.push(`Jam kerja "${h.task}" dilewati: jabatan ${roleLabel.get(h.roleKey) ?? h.roleKey} belum memiliki pemegang aktif.`); continue; }
    const hours = standardHours({ fixed: h.fixed[p.track], perParticipant: h.perParticipant, perClassDay: h.perClassDay }, p.participantsMin ?? 0, classDaysOf(p));
    if (hours <= 0) continue;
    const start = resolveOffset({ anchor: h.start.anchor, days: h.start.days, work: false }, ctx, () => null, cal);
    const end = resolveOffset({ anchor: h.end.anchor, days: h.end.days, work: false }, ctx, () => null, cal);
    if (!start || !end || end < start) { warnings.push(`Jam kerja "${h.task}" dilewati: tanggal acuan (H/T) belum lengkap atau jendela waktu terbalik.`); continue; }
    rows.push({ projectId: p.id, employeeId: emp, name: h.task, hours, startDate: isoToDate(start), endDate: isoToDate(end), source: "TEMPLATE", roleKey: h.roleKey, createdById });
  }
  return rows;
}

/** Buat ulang tugas beban kerja berasal-template (yang masih terbuka) setelah tanggal/peserta/moda program berubah. Tugas MANUAL tidak disentuh. */
export async function regenerateWorkloadTx(tx: Tx, actor: Actor, p: ProgramRow, cfg: IndicatorConfig): Promise<{ created: number; warnings: string[] }> {
  const warnings: string[] = [];
  const holders = await activeHolders(tx, cfg);
  await tx.trainingWorkloadTask.deleteMany({ where: { projectId: p.id, source: "TEMPLATE", status: "OPEN" } });
  const rows = buildWorkloadRows(p, cfg, await loadCal(tx, cfg), holders, actor.userId, warnings);
  if (rows.length) await tx.trainingWorkloadTask.createMany({ data: rows });
  return { created: rows.length, warnings };
}

/** Salin template milestone, item kesiapan, dan jam kerja ke proyek (sesuai jenis program). Tenggat tidak disimpan — dihitung dari tanggal H/T + offset. */
export async function applyTemplatesTx(tx: Tx, actor: Actor, p: ProgramRow, cfg: IndicatorConfig): Promise<ApplyResult> {
  const warnings: string[] = [];
  const holders = await activeHolders(tx, cfg);
  const tpl = cfg.templates[p.track];
  const missing = new Set<string>();
  const holderOf = (role?: string | null) => { if (!role) return null; const h = holders.get(role); if (!h) missing.add(role); return h ?? null; };
  await tx.trainingMilestone.createMany({
    data: tpl.milestones.map((m, i) => ({
      projectId: p.id, code: m.code, name: m.name, anchor: m.anchor, offsetDays: m.days, offsetWork: m.work, refCode: m.ref ?? null, weight: m.weight, critical: m.critical, bnspOnly: m.bnspOnly,
      assigneeId: holderOf(m.roleKey), roleKey: m.roleKey ?? null, reference: m.reference ?? null, sortOrder: i,
    })),
  });
  await tx.trainingReadinessItem.createMany({
    data: tpl.items.map((x, i) => ({
      projectId: p.id, component: x.component, name: x.name, critical: x.critical, anchor: x.anchor, offsetDays: x.days, offsetWork: x.work, refCode: x.ref ?? null, bnspOnly: x.bnspOnly,
      assigneeId: holderOf(x.roleKey), roleKey: x.roleKey ?? null, sortOrder: i,
    })),
  });
  const rows = buildWorkloadRows(p, cfg, await loadCal(tx, cfg), holders, actor.userId, warnings);
  if (rows.length) await tx.trainingWorkloadTask.createMany({ data: rows });
  await tx.trainingProject.update({ where: { id: p.id }, data: { indicatorsAppliedAt: new Date() } });
  const roleLabel = new Map(cfg.roles.map((r) => [r.key, r.label]));
  if (missing.size) warnings.unshift(`Belum ada pemegang aktif untuk: ${[...missing].map((k) => roleLabel.get(k) ?? k).join(", ")}. Milestone/item terkait dibuat tanpa PIC; tetapkan pemegang jabatan di Rumus Indikator.`);
  await auditProject(tx, actor, p.id, {
    action: "training.indicator.apply", summary: `Template pemantauan (${p.track === "REGULAR" ? "Reguler" : "Kerjasama"}) diterapkan ke ${p.code}: ${tpl.milestones.length} milestone, ${tpl.items.length} item kesiapan, ${rows.length} tugas jam kerja`,
    after: { milestones: tpl.milestones.length, items: tpl.items.length, workloadTasks: rows.length },
  });
  return { milestones: tpl.milestones.length, items: tpl.items.length, workloadTasks: rows.length, warnings };
}

export async function applyIndicatorTemplates(actor: Actor, projectId: string): Promise<ApplyResult> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "update");
  assertEditable(access.project);
  return transaction(async (tx) => {
    const p = await loadProgramRow(tx, projectId);
    if (p.indicatorsAppliedAt) throw Errors.conflict("Template pemantauan sudah diterapkan pada proyek ini.");
    const cfg = (await loadConfig(tx)).config;
    return applyTemplatesTx(tx, actor, p, cfg);
  });
}

/** Hitung ulang tugas jam kerja dari template (mis. setelah pemegang jabatan diganti). Tugas MANUAL dipertahankan. */
export async function regenerateProjectWorkload(actor: Actor, projectId: string): Promise<{ created: number; warnings: string[] }> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "update");
  assertEditable(access.project);
  return transaction(async (tx) => {
    const p = await loadProgramRow(tx, projectId);
    if (!p.indicatorsAppliedAt) throw Errors.conflict("Terapkan template pemantauan terlebih dulu.");
    const r = await regenerateWorkloadTx(tx, actor, p, (await loadConfig(tx)).config);
    await auditProject(tx, actor, projectId, { action: "training.indicator.workload", summary: `Tugas jam kerja dari template dihitung ulang (${r.created} tugas)`, after: { created: r.created } });
    return r;
  });
}

// ═════════════════════════ Milestone ═════════════════════════

export interface MilestoneDto {
  id: string; code: string; name: string; offsetLabel: string; due: string | null; doneAt: string | null; evidence: string | null;
  /** Tidak berlaku (ditandai atau khusus BNSP padahal program tanpa BNSP). */
  notApplicable: boolean; weight: number; critical: boolean; assigneeId: string | null; assigneeName: string | null; reference: string | null;
  overdue: boolean; daysOverdue: number; canComplete: boolean; canManage: boolean; manualDate: string | null; anchor: Anchor;
  /** PIC milestone sudah berhenti / akunnya nonaktif → perlu dialihkan (satu definisi di `lib/training/availability`). */
  assigneeUnavailable: AssigneeUnavailable | null;
}

export async function listMilestones(actor: Actor, projectId: string): Promise<MilestoneDto[]> {
  const access = await loadProjectAccess(actor, projectId);
  const cal = await loadCal(prisma, (await loadConfig()).config);
  const [p, rows] = await Promise.all([loadProgramRow(prisma, projectId), prisma.trainingMilestone.findMany({ where: { projectId }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }], include: { assignee: { select: { fullName: true, isActive: true, user: { select: { isActive: true } } } } } })]);
  const dues = resolveDueMap(rows.map((r) => ({ code: r.code, spec: specOf(r) })), dateCtx(p), cal);
  const t = today();
  const canManage = access.abilities.has("manage_tasks");
  return rows.map((r) => {
    const due = dues.get(r.code) ?? null;
    const na = r.notApplicable || (r.bnspOnly && !p.bnsp);
    const done = r.doneAt ? dateToIso(r.doneAt) : null;
    const overdue = !na && done === null && due !== null && due < t;
    return {
      id: r.id, code: r.code, name: r.name, offsetLabel: offsetLabel({ anchor: r.anchor, days: r.offsetDays, work: r.offsetWork, ref: r.refCode }), due, doneAt: done, evidence: r.evidence, notApplicable: na,
      weight: r.weight, critical: r.critical, assigneeId: r.assigneeId, assigneeName: r.assignee?.fullName ?? null, reference: r.reference, overdue, daysOverdue: overdue ? diffDays(t, due!) : 0,
      canComplete: !na && (canManage || (!!actor.employeeId && r.assigneeId === actor.employeeId)), canManage, manualDate: r.manualDate ? dateToIso(r.manualDate) : null, anchor: r.anchor,
      assigneeUnavailable: r.assigneeId && r.assignee ? assigneeUnavailableReason({ activeMember: true, employeeActive: r.assignee.isActive, accountActive: r.assignee.user?.isActive ?? null }) : null,
    };
  });
}

export const specOf = (r: { anchor: Anchor; offsetDays: number; offsetWork: boolean; refCode: string | null; manualDate: Date | null }): OffsetSpec =>
  ({ anchor: r.anchor, days: r.offsetDays, work: r.offsetWork, ref: r.refCode, manualDate: r.manualDate ? dateToIso(r.manualDate) : null });

async function loadMilestone(actor: Actor, id: string) {
  assertUuid(id, "Milestone");
  const m = await prisma.trainingMilestone.findUnique({ where: { id } });
  if (!m) throw Errors.notFound("Milestone");
  return { m, access: await loadProjectAccess(actor, m.projectId) };
}

/** Selesaikan milestone. PIC (penanggung jawab) atau pengelola tugas; wajib bukti (tautan/rujukan dokumen) bila konfigurasi mewajibkan. */
export async function completeMilestone(actor: Actor, id: string, raw: unknown): Promise<void> {
  const { m, access } = await loadMilestone(actor, id);
  assertEditable(access.project);
  const input = parseInput(milestoneCompleteSchema, raw);
  const isPic = !!actor.employeeId && m.assigneeId === actor.employeeId;
  if (!isPic && !access.abilities.has("manage_tasks")) throw Errors.forbidden("Hanya PIC milestone atau pengelola tugas yang dapat menyelesaikannya.");
  const cfg = (await loadConfig()).config;
  const p = await loadProgramRow(prisma, m.projectId);
  if (m.notApplicable || (m.bnspOnly && !p.bnsp)) throw Errors.conflict("Milestone ini berstatus Tidak berlaku.");
  if (m.doneAt) throw Errors.conflict("Milestone sudah selesai.");
  if (cfg.requireEvidence && (!input.evidence || input.evidence.trim().length < 3)) throw Errors.validation("Milestone tidak dianggap selesai tanpa bukti: isi tautan atau rujukan dokumen (Berita Acara, Form Serah Terima, Checklist Kesiapan Kelas, dst.).", { evidence: "Bukti wajib diisi" });
  const t = today();
  const doneAt = input.doneAt ?? t;
  if (doneAt > t) throw Errors.validation("Tanggal selesai tidak boleh di masa depan.", { doneAt: "Di masa depan" });
  await transaction(async (tx) => {
    const r = await tx.trainingMilestone.updateMany({ where: { id, doneAt: null }, data: { doneAt: isoToDate(doneAt), doneById: actor.userId, evidence: input.evidence } });
    if (r.count === 0) throw Errors.conflict("Milestone baru saja diselesaikan pengguna lain.");
    await auditProject(tx, actor, m.projectId, { action: "training.milestone.complete", summary: `Milestone ${m.code} "${m.name}" diselesaikan (${doneAt})`, after: { milestoneId: id, code: m.code, doneAt } });
  });
}

export async function reopenMilestone(actor: Actor, id: string, raw: unknown = {}): Promise<void> {
  const { m, access } = await loadMilestone(actor, id);
  requireAbility(access, "manage_tasks");
  assertEditable(access.project);
  const reason = typeof (raw as { reason?: unknown })?.reason === "string" ? ((raw as { reason: string }).reason).trim() : "";
  if (reason.length < 3) throw Errors.validation("Alasan membuka kembali milestone wajib diisi.", { reason: "Wajib diisi" });
  if (!m.doneAt) throw Errors.conflict("Milestone belum selesai.");
  await transaction(async (tx) => {
    await tx.trainingMilestone.update({ where: { id }, data: { doneAt: null, doneById: null } });
    await auditProject(tx, actor, m.projectId, { action: "training.milestone.reopen", summary: `Milestone ${m.code} dibuka kembali`, before: { doneAt: dateToIso(m.doneAt!) }, reason });
  });
}

export async function updateMilestone(actor: Actor, id: string, raw: unknown): Promise<void> {
  const { m, access } = await loadMilestone(actor, id);
  requireAbility(access, "manage_tasks");
  assertEditable(access.project);
  const input = parseInput(milestoneUpdateSchema, raw);
  if (input.notApplicable && m.doneAt) throw Errors.conflict("Milestone yang sudah selesai tidak dapat ditandai Tidak berlaku.");
  await transaction(async (tx) => {
    if (input.assigneeId) { const e = await tx.employee.count({ where: { id: input.assigneeId, isActive: true } }); if (!e) throw Errors.validation("PIC harus karyawan aktif.", { assigneeId: "Tidak valid" }); }
    const data: Prisma.TrainingMilestoneUncheckedUpdateInput = {};
    for (const k of ["name", "weight", "critical", "assigneeId", "notApplicable", "reference"] as const) if (k in input) (data as Record<string, unknown>)[k] = input[k];
    if ("manualDate" in input) data.manualDate = input.manualDate ? isoToDate(input.manualDate) : null;
    if (Object.keys(data).length === 0) return;
    await tx.trainingMilestone.update({ where: { id }, data });
    await auditProject(tx, actor, m.projectId, { action: "training.milestone.update", summary: `Milestone ${m.code} diubah (${Object.keys(input).join(", ")})`, after: { milestoneId: id, ...Object.fromEntries(Object.entries(input).map(([k, v]) => [k, v ?? null])) } });
  });
}

export async function addMilestone(actor: Actor, projectId: string, raw: unknown): Promise<{ id: string }> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "manage_tasks");
  assertEditable(access.project);
  const input = parseInput(milestoneAddSchema, raw);
  return transaction(async (tx) => {
    if (input.assigneeId && !(await tx.employee.count({ where: { id: input.assigneeId, isActive: true } }))) throw Errors.validation("PIC harus karyawan aktif.", { assigneeId: "Tidak valid" });
    if (input.anchor === "MILESTONE" && (!input.ref || !(await tx.trainingMilestone.count({ where: { projectId, code: input.ref } })))) throw Errors.validation("Milestone acuan tidak ditemukan.", { ref: "Tidak ditemukan" });
    const max = await tx.trainingMilestone.aggregate({ where: { projectId }, _max: { sortOrder: true } });
    try {
      const m = await tx.trainingMilestone.create({ data: { projectId, code: input.code, name: input.name, anchor: input.anchor, offsetDays: input.days, offsetWork: input.work, refCode: input.ref, manualDate: input.manualDate ? isoToDate(input.manualDate) : null, weight: input.weight, critical: input.critical, assigneeId: input.assigneeId, reference: input.reference, sortOrder: (max._max.sortOrder ?? -1) + 1 } });
      await auditProject(tx, actor, projectId, { action: "training.milestone.add", summary: `Milestone ${input.code} "${input.name}" ditambahkan`, after: { milestoneId: m.id, weight: input.weight, critical: input.critical } });
      return { id: m.id };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw Errors.conflict(`Kode milestone ${input.code} sudah dipakai pada proyek ini.`);
      throw e;
    }
  });
}

// ═════════════════════════ Item kesiapan ═════════════════════════

export interface ReadinessItemDto {
  id: string; component: ItemComponent; componentLabel: string; name: string; critical: boolean; offsetLabel: string; due: string | null; status: ItemStatus;
  /** Tidak berlaku karena khusus BNSP padahal program tanpa BNSP (status tampilan, tidak mengubah baris). */
  bnspExcluded: boolean; assigneeId: string | null; assigneeName: string | null; canUpdate: boolean; canManage: boolean; overdue: boolean;
  /** Penanggung jawab item sudah berhenti / akunnya nonaktif → perlu dialihkan. */
  assigneeUnavailable: AssigneeUnavailable | null;
}

export async function listReadiness(actor: Actor, projectId: string): Promise<ReadinessItemDto[]> {
  const access = await loadProjectAccess(actor, projectId);
  const cal = await loadCal(prisma, (await loadConfig()).config);
  const [p, rows, milestones] = await Promise.all([
    loadProgramRow(prisma, projectId),
    prisma.trainingReadinessItem.findMany({ where: { projectId }, orderBy: [{ component: "asc" }, { sortOrder: "asc" }], include: { assignee: { select: { fullName: true, isActive: true, user: { select: { isActive: true } } } } } }),
    prisma.trainingMilestone.findMany({ where: { projectId } }),
  ]);
  const dues = resolveDueMap(milestones.map((r) => ({ code: r.code, spec: specOf(r) })), dateCtx(p), cal);
  const t = today();
  const canManage = access.abilities.has("manage_checklist");
  return rows.map((r) => {
    const bnspExcluded = r.bnspOnly && !p.bnsp;
    const status: ItemStatus = bnspExcluded ? "NOT_APPLICABLE" : r.status;
    const due = resolveOffset(specOf(r), dateCtx(p), (c) => dues.get(c) ?? null, cal);
    return {
      id: r.id, component: r.component, componentLabel: COMPONENT_LABEL[r.component], name: r.name, critical: r.critical, offsetLabel: offsetLabel({ anchor: r.anchor, days: r.offsetDays, work: r.offsetWork, ref: r.refCode }), due, status, bnspExcluded,
      assigneeId: r.assigneeId, assigneeName: r.assignee?.fullName ?? null, overdue: status === "OPEN" && due !== null && due < t,
      canUpdate: !bnspExcluded && (canManage || (!!actor.employeeId && r.assigneeId === actor.employeeId)), canManage,
      assigneeUnavailable: r.assigneeId && r.assignee ? assigneeUnavailableReason({ activeMember: true, employeeActive: r.assignee.isActive, accountActive: r.assignee.user?.isActive ?? null }) : null,
    };
  });
}

export async function setReadinessStatus(actor: Actor, id: string, raw: unknown): Promise<void> {
  assertUuid(id, "Item kesiapan");
  const item = await prisma.trainingReadinessItem.findUnique({ where: { id } });
  if (!item) throw Errors.notFound("Item kesiapan");
  const access = await loadProjectAccess(actor, item.projectId);
  assertEditable(access.project);
  const { status } = parseInput(readinessStatusSchema, raw);
  const isPic = !!actor.employeeId && item.assigneeId === actor.employeeId;
  if (!isPic && !access.abilities.has("manage_checklist")) throw Errors.forbidden("Hanya penanggung jawab item atau pengelola checklist yang dapat mengubah status item kesiapan.");
  if (status === item.status) return;
  // "Tidak berlaku" mengeluarkan item dari IKP: hanya pengelola checklist (bukan PIC sendiri) agar item kritikal tidak dibuang sepihak.
  if (status === "NOT_APPLICABLE" && !access.abilities.has("manage_checklist")) throw Errors.forbidden("Hanya pengelola checklist yang dapat menandai item Tidak berlaku.");
  await transaction(async (tx) => {
    await tx.trainingReadinessItem.update({ where: { id }, data: { status, updatedById: actor.userId } });
    await auditProject(tx, actor, item.projectId, { action: "training.readiness.status", summary: `Item kesiapan "${item.name}"${item.critical ? " (kritikal)" : ""}: ${item.status} → ${status}`, before: { itemId: id, status: item.status }, after: { itemId: id, status } });
  });
}

export async function addReadinessItem(actor: Actor, projectId: string, raw: unknown): Promise<{ id: string }> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "manage_checklist");
  assertEditable(access.project);
  const input = parseInput(readinessAddSchema, raw);
  return transaction(async (tx) => {
    if (input.assigneeId && !(await tx.employee.count({ where: { id: input.assigneeId, isActive: true } }))) throw Errors.validation("Penanggung jawab harus karyawan aktif.", { assigneeId: "Tidak valid" });
    if (input.anchor === "MILESTONE" && (!input.ref || !(await tx.trainingMilestone.count({ where: { projectId, code: input.ref } })))) throw Errors.validation("Milestone acuan tidak ditemukan.", { ref: "Tidak ditemukan" });
    const max = await tx.trainingReadinessItem.aggregate({ where: { projectId, component: input.component }, _max: { sortOrder: true } });
    const it = await tx.trainingReadinessItem.create({ data: { projectId, component: input.component, name: input.name, critical: input.critical, anchor: input.anchor, offsetDays: input.days, offsetWork: input.work, refCode: input.ref, manualDate: input.manualDate ? isoToDate(input.manualDate) : null, assigneeId: input.assigneeId, sortOrder: (max._max.sortOrder ?? -1) + 1 } });
    await auditProject(tx, actor, projectId, { action: "training.readiness.add", summary: `Item kesiapan "${input.name}" ditambahkan (${COMPONENT_LABEL[input.component]}${input.critical ? ", kritikal" : ""})`, after: { itemId: it.id } });
    return { id: it.id };
  });
}

export async function removeReadinessItem(actor: Actor, id: string): Promise<void> {
  assertUuid(id, "Item kesiapan");
  const item = await prisma.trainingReadinessItem.findUnique({ where: { id } });
  if (!item) throw Errors.notFound("Item kesiapan");
  const access = await loadProjectAccess(actor, item.projectId);
  requireAbility(access, "manage_checklist");
  assertEditable(access.project);
  if (item.status === "DONE") throw Errors.conflict("Item yang sudah selesai tidak dapat dihapus. Ubah statusnya dulu bila keliru.");
  await transaction(async (tx) => {
    await tx.trainingReadinessItem.delete({ where: { id } });
    await auditProject(tx, actor, item.projectId, { action: "training.readiness.remove", summary: `Item kesiapan "${item.name}" dihapus${item.critical ? " (kritikal)" : ""}`, before: { itemId: id, component: item.component, critical: item.critical } });
  });
}

// ═════════════════════════ Jam kerja & kapasitas ═════════════════════════

export interface WorkloadTaskDto { id: string; employeeId: string; employeeName: string; name: string; hours: number; startDate: string; endDate: string; status: "OPEN" | "DONE" | "CANCELLED"; source: "TEMPLATE" | "MANUAL"; roleKey: string | null; canManage: boolean }

export async function listWorkloadTasks(actor: Actor, projectId: string): Promise<WorkloadTaskDto[]> {
  const access = await loadProjectAccess(actor, projectId);
  // Jam kerja per orang = data beban kerja rekan: hanya pengelola tugas proyek atau yang melihat semua proyek yang melihat seluruh baris; anggota biasa hanya barisnya sendiri.
  const canManage = access.abilities.has("manage_tasks");
  const seeAll = canManage || access.module.caps.viewAll;
  const rows = await prisma.trainingWorkloadTask.findMany({
    where: { projectId, ...(seeAll ? {} : { employeeId: actor.employeeId ?? "00000000-0000-0000-0000-000000000000" }) },
    orderBy: [{ startDate: "asc" }, { name: "asc" }], include: { employee: { select: { fullName: true } } },
  });
  return rows.map((r) => ({ id: r.id, employeeId: r.employeeId, employeeName: r.employee.fullName, name: r.name, hours: r.hours, startDate: dateToIso(r.startDate), endDate: dateToIso(r.endDate), status: r.status, source: r.source === "MANUAL" ? "MANUAL" : "TEMPLATE", roleKey: r.roleKey, canManage }));
}

export async function addWorkloadTask(actor: Actor, projectId: string, raw: unknown): Promise<{ id: string }> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "manage_tasks");
  assertEditable(access.project);
  const input = parseInput(workloadSchema, raw);
  return transaction(async (tx) => {
    const emp = await tx.employee.findUnique({ where: { id: input.employeeId }, select: { fullName: true, isActive: true } });
    if (!emp || !emp.isActive) throw Errors.validation("Staf harus karyawan aktif.", { employeeId: "Tidak valid" });
    const w = await tx.trainingWorkloadTask.create({ data: { projectId, employeeId: input.employeeId, name: input.name, hours: input.hours, startDate: isoToDate(input.startDate), endDate: isoToDate(input.endDate), source: "MANUAL", createdById: actor.userId } });
    await auditProject(tx, actor, projectId, { action: "training.workload.add", summary: `Tugas jam kerja "${input.name}" (${input.hours} jam) untuk ${emp.fullName} ditambahkan`, after: { taskId: w.id, hours: input.hours } });
    return { id: w.id };
  });
}

export async function updateWorkloadTask(actor: Actor, id: string, raw: unknown): Promise<void> {
  assertUuid(id, "Tugas jam kerja");
  const w = await prisma.trainingWorkloadTask.findUnique({ where: { id } });
  if (!w) throw Errors.notFound("Tugas jam kerja");
  const access = await loadProjectAccess(actor, w.projectId);
  requireAbility(access, "manage_tasks");
  assertEditable(access.project);
  const input = parseInput(workloadUpdateSchema, raw);
  const start = input.startDate ?? dateToIso(w.startDate), end = input.endDate ?? dateToIso(w.endDate);
  if (end < start) throw Errors.validation("Tanggal selesai tidak boleh sebelum tanggal mulai.", { endDate: "Sebelum tanggal mulai" });
  await transaction(async (tx) => {
    // Diubah manual → tidak lagi ditimpa saat tugas dari template dibuat ulang.
    await tx.trainingWorkloadTask.update({ where: { id }, data: { ...(input.name ? { name: input.name } : {}), ...(input.hours !== undefined ? { hours: input.hours } : {}), startDate: isoToDate(start), endDate: isoToDate(end), ...(input.status ? { status: input.status } : {}), source: "MANUAL" } });
    await auditProject(tx, actor, w.projectId, { action: "training.workload.update", summary: `Tugas jam kerja "${w.name}" diubah`, before: { taskId: id, hours: w.hours, status: w.status }, after: { taskId: id, ...input } });
  });
}

/** Kapasitas per staf (jam efektif & hari kerja). Hanya Koordinator Program / Direktur (peran "Manajer Operasional dan Keuangan" di dokumen). */
export async function upsertStaffCapacity(actor: Actor, employeeId: string, raw: unknown): Promise<void> {
  assertModuleEnabled();
  const mod = await getModuleContext(actor);
  if (!mod.canSee) throw Errors.notFound("Halaman");
  if (!mod.caps.fullAccess) throw Errors.forbidden("Hanya Koordinator Program atau Direktur yang dapat mengatur kapasitas staf.");
  assertUuid(employeeId, "Karyawan");
  const input = parseInput(staffCapacitySchema, raw);
  await transaction(async (tx) => {
    const e = await tx.employee.findUnique({ where: { id: employeeId }, select: { fullName: true, isActive: true } });
    if (!e || !e.isActive) throw Errors.validation("Karyawan tidak ditemukan atau nonaktif.", { employeeId: "Tidak valid" });
    const workDays = [...new Set(input.workDays)].sort();
    await tx.trainingStaffCapacity.upsert({ where: { employeeId }, create: { employeeId, hoursPerDay: input.hoursPerDay, workDays, note: input.note, updatedById: actor.userId }, update: { hoursPerDay: input.hoursPerDay, workDays, note: input.note, updatedById: actor.userId } });
    await writeAudit(tx, actor, { action: "training.capacity.update", entityType: "TrainingStaffCapacity", entityId: employeeId, summary: `Kapasitas ${e.fullName}: ${input.hoursPerDay ?? "bawaan"} jam/hari, hari kerja ${workDays.join(",")}`, after: { hoursPerDay: input.hoursPerDay, workDays } });
  });
}

export interface StaffCapacityDto { employeeId: string; name: string; hoursPerDay: number | null; workDays: number[]; note: string | null }
export interface StaffCapacityList { rows: StaffCapacityDto[]; defaults: { hoursPerDay: number; workDays: number[] }; employees: { id: string; name: string }[] }

/** Pengecualian kapasitas per staf (selain bawaan konfigurasi). Hanya Koordinator Program / Direktur. */
export async function listStaffCapacity(actor: Actor): Promise<StaffCapacityList> {
  assertModuleEnabled();
  const mod = await getModuleContext(actor);
  if (!mod.canSee) throw Errors.notFound("Halaman");
  if (!mod.caps.fullAccess) throw Errors.forbidden("Hanya Koordinator Program atau Direktur yang dapat melihat pengaturan kapasitas staf.");
  const [rows, emps, cfg] = await Promise.all([
    prisma.trainingStaffCapacity.findMany({ include: { employee: { select: { fullName: true, isActive: true } } }, orderBy: { employee: { fullName: "asc" } } }),
    prisma.employee.findMany({ where: { isActive: true }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }),
    loadConfig(),
  ]);
  return {
    rows: rows.filter((r) => r.employee.isActive).map((r) => ({ employeeId: r.employeeId, name: r.employee.fullName, hoursPerDay: r.hoursPerDay, workDays: r.workDays, note: r.note })),
    defaults: { hoursPerDay: cfg.config.capacity.hoursPerDay, workDays: cfg.config.capacity.workDays },
    employees: emps.map((e) => ({ id: e.id, name: e.fullName })),
  };
}

/** Hapus pengecualian kapasitas — staf kembali memakai bawaan konfigurasi. */
export async function clearStaffCapacity(actor: Actor, employeeId: string): Promise<void> {
  assertModuleEnabled();
  const mod = await getModuleContext(actor);
  if (!mod.canSee) throw Errors.notFound("Halaman");
  if (!mod.caps.fullAccess) throw Errors.forbidden("Hanya Koordinator Program atau Direktur yang dapat mengatur kapasitas staf.");
  assertUuid(employeeId, "Karyawan");
  await transaction(async (tx) => {
    const row = await tx.trainingStaffCapacity.findUnique({ where: { employeeId }, include: { employee: { select: { fullName: true } } } });
    if (!row) return;
    await tx.trainingStaffCapacity.delete({ where: { employeeId } });
    await writeAudit(tx, actor, { action: "training.capacity.clear", entityType: "TrainingStaffCapacity", entityId: employeeId, summary: `Pengecualian kapasitas ${row.employee.fullName} dihapus (kembali ke bawaan)`, before: { hoursPerDay: row.hoursPerDay, workDays: row.workDays } });
  });
}
