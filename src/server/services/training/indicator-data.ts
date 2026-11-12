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
  classifyLegacy, isLegacyUnresolved, planWorkloadSync, revertChanges, valueChanges, type DesiredRow, type ExistingRow, type RevertChange, type SyncPlan, type TemplateEntry,
} from "@/lib/training/workload-sync";
import {
  milestoneAddSchema, milestoneCompleteSchema, milestoneUpdateSchema, readinessAddSchema, readinessStatusSchema, staffCapacitySchema, workloadMergeSchema, workloadReviewSchema, workloadSchema, workloadUpdateSchema,
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

/** Baris Tabel Jam Standar yang BERLAKU untuk proyek (jenis program & moda cocok). */
const applicableHourRows = (p: ProgramRow, cfg: IndicatorConfig) => cfg.hourTable.filter((h) => h.tracks.includes(p.track) && (!h.modes.length || h.modes.includes(p.deliveryMode)));
const entriesOf = (p: ProgramRow, cfg: IndicatorConfig): TemplateEntry[] => applicableHourRows(p, cfg).map((h) => ({ key: h.id, roleKey: h.roleKey, task: h.task }));

/** Hitungan template (apa yang SEHARUSNYA ada) — tiap baris membawa ID tetap baris tabel jam. Baris yang tak dapat dihitung dilewati dengan peringatan. */
function buildDesiredRows(p: ProgramRow, cfg: IndicatorConfig, cal: WorkCal, holders: Map<string, string>, warnings: string[]): DesiredRow[] {
  const ctx = dateCtx(p);
  const roleLabel = new Map(cfg.roles.map((r) => [r.key, r.label]));
  const rows: DesiredRow[] = [];
  for (const h of applicableHourRows(p, cfg)) {
    const emp = holders.get(h.roleKey);
    if (!emp) { warnings.push(`Jam kerja "${h.task}" dilewati: jabatan ${roleLabel.get(h.roleKey) ?? h.roleKey} belum memiliki pemegang aktif.`); continue; }
    const hours = standardHours({ fixed: h.fixed[p.track], perParticipant: h.perParticipant, perClassDay: h.perClassDay }, p.participantsMin ?? 0, classDaysOf(p));
    if (hours <= 0) continue;
    const start = resolveOffset({ anchor: h.start.anchor, days: h.start.days, work: false }, ctx, () => null, cal);
    const end = resolveOffset({ anchor: h.end.anchor, days: h.end.days, work: false }, ctx, () => null, cal);
    if (!start || !end || end < start) { warnings.push(`Jam kerja "${h.task}" dilewati: tanggal acuan (H/T) belum lengkap atau jendela waktu terbalik.`); continue; }
    rows.push({ templateKey: h.id, roleKey: h.roleKey, name: h.task, employeeId: emp, hours, startDate: start, endDate: end });
  }
  return rows;
}

type WorkloadRow = Prisma.TrainingWorkloadTaskGetPayload<object>;
const toExisting = (r: WorkloadRow): ExistingRow => ({
  id: r.id, source: r.source === "MANUAL" ? "MANUAL" : "TEMPLATE", templateKey: r.templateKey, roleKey: r.roleKey, name: r.name, employeeId: r.employeeId, hours: r.hours,
  startDate: dateToIso(r.startDate), endDate: dateToIso(r.endDate), status: r.status, adjusted: r.adjusted, originReviewed: r.originReviewedAt !== null,
});

/** Kunci penasihat per proyek: dua orang menekan "Hitung ulang" (atau program berubah bersamaan) diserialkan — yang kedua melihat hasil yang pertama, bukan membuat salinan. */
const lockWorkload = (tx: Tx, projectId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`training:workload:${projectId}`}))`;

export interface WorkloadSyncResult { created: number; updated: number; removed: number; linked: number; total: number; review: number; warnings: string[] }

/**
 * Samakan tugas jam kerja proyek dengan Tabel Jam Standar. IDEMPOTEN: masukan yang sama → tidak ada perubahan (jumlah baris & total jam tetap). Aturan per jenis baris ada di
 * `lib/training/workload-sync` (belum disentuh → mengikuti template; disesuaikan/selesai → dipertahankan; manual → tidak disentuh; baris lama → tidak ditebak).
 * Dipakai saat template diterapkan, dihitung ulang, dan jenis program berganti.
 */
export async function syncWorkloadTx(tx: Tx, actor: Actor, p: ProgramRow, cfg: IndicatorConfig): Promise<WorkloadSyncResult & { plan: SyncPlan }> {
  await lockWorkload(tx, p.id);
  const warnings: string[] = [];
  const holders = await activeHolders(tx, cfg);
  const desired = buildDesiredRows(p, cfg, await loadCal(tx, cfg), holders, warnings);
  const rows = await tx.trainingWorkloadTask.findMany({ where: { projectId: p.id } });
  const plan = planWorkloadSync({ entries: entriesOf(p, cfg), desired, existing: rows.map(toExisting), skipWarnings: warnings });
  // Urutan: hapus → tautkan → perbarui → buat (agar kunci unik (proyek, ID) tidak pernah bertabrakan).
  if (plan.remove.length) await tx.trainingWorkloadTask.deleteMany({ where: { id: { in: plan.remove.map((x) => x.id) } } });
  for (const l of plan.link) await tx.trainingWorkloadTask.update({ where: { id: l.id }, data: { templateKey: l.templateKey, adjusted: l.adjusted, adjustedAt: l.adjusted ? new Date() : null } });
  for (const u of plan.update) {
    await tx.trainingWorkloadTask.update({ where: { id: u.id }, data: { name: u.to.name, employeeId: u.to.employeeId, hours: u.to.hours, startDate: isoToDate(u.to.startDate), endDate: isoToDate(u.to.endDate), roleKey: u.to.roleKey } });
  }
  if (plan.create.length) {
    await tx.trainingWorkloadTask.createMany({
      data: plan.create.map((d) => ({ projectId: p.id, employeeId: d.employeeId, name: d.name, hours: d.hours, startDate: isoToDate(d.startDate), endDate: isoToDate(d.endDate), source: "TEMPLATE", roleKey: d.roleKey, templateKey: d.templateKey, createdById: actor.userId })),
    });
  }
  const total = rows.length - plan.remove.length + plan.create.length;
  return { created: plan.create.length, updated: plan.update.length, removed: plan.remove.length, linked: plan.link.length, total, review: plan.review.length, warnings: plan.warnings, plan };
}

/** Hitung ulang tugas jam kerja dari template (mis. setelah tanggal/peserta/moda program atau pemegang jabatan berubah). Lihat `syncWorkloadTx`. */
export async function regenerateWorkloadTx(tx: Tx, actor: Actor, p: ProgramRow, cfg: IndicatorConfig): Promise<WorkloadSyncResult> {
  const { plan: _plan, ...r } = await syncWorkloadTx(tx, actor, p, cfg);
  return r;
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
  const wl = await syncWorkloadTx(tx, actor, p, cfg);
  warnings.push(...wl.warnings);
  await tx.trainingProject.update({ where: { id: p.id }, data: { indicatorsAppliedAt: new Date() } });
  const roleLabel = new Map(cfg.roles.map((r) => [r.key, r.label]));
  if (missing.size) warnings.unshift(`Belum ada pemegang aktif untuk: ${[...missing].map((k) => roleLabel.get(k) ?? k).join(", ")}. Milestone/item terkait dibuat tanpa PIC; tetapkan pemegang jabatan di Rumus Indikator.`);
  await auditProject(tx, actor, p.id, {
    action: "training.indicator.apply", summary: `Template pemantauan (${p.track === "REGULAR" ? "Reguler" : "Kerjasama"}) diterapkan ke ${p.code}: ${tpl.milestones.length} milestone, ${tpl.items.length} item kesiapan, ${wl.created} tugas jam kerja`,
    after: { milestones: tpl.milestones.length, items: tpl.items.length, workloadTasks: wl.created },
  });
  return { milestones: tpl.milestones.length, items: tpl.items.length, workloadTasks: wl.created, warnings };
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

/** Hitung ulang tugas jam kerja dari template (mis. setelah pemegang jabatan diganti). Idempoten; baris disesuaikan/selesai/manual dipertahankan (lihat `syncWorkloadTx`). */
export async function regenerateProjectWorkload(actor: Actor, projectId: string): Promise<WorkloadSyncResult> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "update");
  assertEditable(access.project);
  return transaction(async (tx) => {
    const p = await loadProgramRow(tx, projectId);
    if (!p.indicatorsAppliedAt) throw Errors.conflict("Terapkan template pemantauan terlebih dulu.");
    const r = await regenerateWorkloadTx(tx, actor, p, (await loadConfig(tx)).config);
    await auditProject(tx, actor, projectId, {
      action: "training.indicator.workload", summary: `Tugas jam kerja dari template dihitung ulang (${r.created} baru, ${r.updated} diperbarui, ${r.removed} dihapus, ${r.linked} baris lama ditautkan)`,
      after: { created: r.created, updated: r.updated, removed: r.removed, linked: r.linked, review: r.review },
    });
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

export interface WorkloadTaskDto {
  id: string; employeeId: string; employeeName: string; name: string; hours: number; startDate: string; endDate: string; status: "OPEN" | "DONE" | "CANCELLED";
  /** ASAL baris (tidak berubah karena diedit). */
  source: "TEMPLATE" | "MANUAL"; roleKey: string | null; canManage: boolean;
  /** ID tetap baris Tabel Jam Standar asal (null = manual dari awal atau baris lama yang belum ditinjau). */
  templateKey: string | null;
  /** Sudah disesuaikan manual: dipertahankan saat dihitung ulang dan tidak lagi mengikuti template. */
  adjusted: boolean;
  /** Disesuaikan DAN kini berbeda dari hitungan template (jam/tanggal/staf/nama) — peringatan "tidak ikut berubah". */
  differsFromTemplate: boolean;
  /** Dapat dikembalikan ke template (Terbuka, asal template jelas, pekerjaan itu masih berlaku, dan ada yang berbeda atau penanda disesuaikan). */
  canRevert: boolean;
  /** Baris LAMA yang tidak dapat ditentukan asalnya ("UNLINKED") atau kembar dengan baris lain untuk pekerjaan yang sama ("DUPLICATE"); null = jelas. */
  review: "UNLINKED" | "DUPLICATE" | null;
  /** Untuk "DUPLICATE": semua baris dalam kelompok kembar yang sama (termasuk baris ini). */
  duplicateGroup: string[] | null;
}

export async function listWorkloadTasks(actor: Actor, projectId: string): Promise<WorkloadTaskDto[]> {
  const access = await loadProjectAccess(actor, projectId);
  // Jam kerja per orang = data beban kerja rekan: hanya pengelola tugas proyek atau yang melihat semua proyek yang melihat seluruh baris; anggota biasa hanya barisnya sendiri.
  const canManage = access.abilities.has("manage_tasks");
  const seeAll = canManage || access.module.caps.viewAll;
  const all = await prisma.trainingWorkloadTask.findMany({ where: { projectId }, orderBy: [{ startDate: "asc" }, { name: "asc" }], include: { employee: { select: { fullName: true } } } });
  const rows = seeAll ? all : all.filter((r) => r.employeeId === (actor.employeeId ?? "00000000-0000-0000-0000-000000000000"));
  // Status "perlu diperiksa"/"kembar"/"berbeda dari template" dihitung dari seluruh baris proyek (bukan hanya yang terlihat) dan hanya diperlihatkan pada yang melihat semua.
  let desired = new Map<string, DesiredRow>();
  let cls = classifyLegacy([], []);
  if (seeAll) {
    const p = await loadProgramRow(prisma, projectId);
    const cfg = (await loadConfig()).config;
    cls = classifyLegacy(all.map(toExisting), entriesOf(p, cfg));
    if (p.indicatorsAppliedAt) desired = new Map(buildDesiredRows(p, cfg, await loadCal(prisma, cfg), await activeHolders(prisma, cfg), []).map((d) => [d.templateKey, d]));
  }
  const groupOf = new Map<string, string[]>();
  for (const g of cls.duplicateGroups) for (const id of g.rowIds) groupOf.set(id, g.rowIds);
  return rows.map((r) => {
    const ex = toExisting(r);
    const legacy = cls.byRow.get(r.id);
    const key = r.templateKey ?? (legacy?.state === "LINK" ? legacy.key : null);
    const tpl = key ? desired.get(key) : undefined;
    const diff = tpl ? valueChanges(ex, tpl) : [];
    const adjusted = r.adjusted || (legacy?.state === "LINK" && legacy.adjusted);
    const dup = groupOf.get(r.id) ?? null;
    return {
      id: r.id, employeeId: r.employeeId, employeeName: r.employee.fullName, name: r.name, hours: r.hours, startDate: dateToIso(r.startDate), endDate: dateToIso(r.endDate), status: r.status,
      source: r.source === "MANUAL" ? "MANUAL" as const : "TEMPLATE" as const, roleKey: r.roleKey, canManage,
      templateKey: r.templateKey, adjusted, differsFromTemplate: adjusted && r.status === "OPEN" && diff.length > 0,
      canRevert: canManage && r.status === "OPEN" && !!r.templateKey && !!tpl && (r.adjusted || diff.length > 0),
      review: legacy && legacy.state !== "LINK" ? (legacy.state === "DUPLICATE" ? "DUPLICATE" as const : "UNLINKED" as const) : dup ? "DUPLICATE" as const : null,
      duplicateGroup: dup,
    };
  });
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
  const newName = input.name ?? w.name, newHours = input.hours ?? w.hours;
  // "Disesuaikan" = nama/jam/tanggal berbeda dari sebelumnya. Mengganti STATUS saja (mis. Selesai) bukan penyesuaian. ASAL baris (`source`) tidak pernah berubah karena diedit.
  const adjustedNow = newName !== w.name || Math.abs(newHours - w.hours) > 1e-9 || start !== dateToIso(w.startDate) || end !== dateToIso(w.endDate);
  await transaction(async (tx) => {
    await lockWorkload(tx, w.projectId);
    await tx.trainingWorkloadTask.update({
      where: { id }, data: { name: newName, hours: newHours, startDate: isoToDate(start), endDate: isoToDate(end), ...(input.status ? { status: input.status } : {}), ...(adjustedNow ? { adjusted: true, adjustedAt: new Date() } : {}) },
    });
    await auditProject(tx, actor, w.projectId, {
      action: "training.workload.update", summary: `Tugas jam kerja "${w.name}" diubah${adjustedNow && w.source === "TEMPLATE" ? " (disesuaikan dari template)" : ""}`,
      before: { taskId: id, name: w.name, hours: w.hours, status: w.status, adjusted: w.adjusted }, after: { taskId: id, ...input, adjusted: w.adjusted || adjustedNow },
    });
  });
}

// ───────── Kembalikan ke template · tinjau baris lama · rapikan kembar ─────────

async function loadWorkloadForManage(actor: Actor, id: string) {
  assertUuid(id, "Tugas jam kerja");
  const w = await prisma.trainingWorkloadTask.findUnique({ where: { id }, include: { employee: { select: { fullName: true } } } });
  if (!w) throw Errors.notFound("Tugas jam kerja");
  const access = await loadProjectAccess(actor, w.projectId);
  requireAbility(access, "manage_tasks");
  assertEditable(access.project);
  return w;
}

/** Hitungan template terkini untuk satu proyek (apa yang seharusnya ada), beserta nama staf untuk pratinjau. */
async function desiredFor(db: Db, projectId: string): Promise<{ p: ProgramRow; cfg: IndicatorConfig; desired: Map<string, DesiredRow> }> {
  const p = await loadProgramRow(db, projectId);
  const cfg = (await loadConfig(db)).config;
  const desired = new Map(buildDesiredRows(p, cfg, await loadCal(db, cfg), await activeHolders(db, cfg), []).map((d) => [d.templateKey, d]));
  return { p, cfg, desired };
}

export interface WorkloadRevertPreview { rowId: string; name: string; changes: RevertChange[]; canApply: boolean; reason: string | null }

/** Pratinjau "Kembalikan ke template": apa yang akan berubah. Tidak mengubah data. Baris yang sudah selesai/dibatalkan TIDAK dikembalikan (status & riwayat dijaga). */
export async function previewWorkloadRevert(actor: Actor, id: string): Promise<WorkloadRevertPreview> {
  const w = await loadWorkloadForManage(actor, id);
  const { desired } = await desiredFor(prisma, w.projectId);
  const tpl = w.templateKey ? desired.get(w.templateKey) : undefined;
  const base = { rowId: id, name: w.name, changes: [] as RevertChange[] };
  if (!w.templateKey) return { ...base, canApply: false, reason: "Baris ini tidak punya asal template yang jelas. Tinjau asalnya dulu." };
  if (w.status !== "OPEN") return { ...base, canApply: false, reason: "Baris yang sudah selesai atau dibatalkan tidak dikembalikan ke template, agar status dan riwayatnya tidak hilang atau terbuka kembali sendiri." };
  if (!tpl) return { ...base, canApply: false, reason: "Pekerjaan ini tidak lagi dihitung oleh template (dihapus dari Tabel Jam Standar, bukan untuk jenis/moda program ini, atau jabatannya belum punya pemegang aktif)." };
  const names = new Map([[w.employeeId, w.employee.fullName]]);
  const emp = await prisma.employee.findUnique({ where: { id: tpl.employeeId }, select: { fullName: true } });
  names.set(tpl.employeeId, emp?.fullName ?? tpl.employeeId);
  const changes = revertChanges(toExisting(w), tpl, (eid) => names.get(eid) ?? eid);
  return { rowId: id, name: w.name, changes, canApply: true, reason: changes.length === 0 && !w.adjusted ? "Baris ini sudah sama dengan template." : null };
}

/** Terapkan "Kembalikan ke template": nama/jam/tanggal/staf mengikuti hitungan template lagi dan penanda "disesuaikan" dicabut. Tercatat. */
export async function revertWorkloadToTemplate(actor: Actor, id: string): Promise<WorkloadRevertPreview> {
  const w = await loadWorkloadForManage(actor, id);
  return transaction(async (tx) => {
    await lockWorkload(tx, w.projectId);
    const cur = await tx.trainingWorkloadTask.findUniqueOrThrow({ where: { id } });
    if (cur.status !== "OPEN") throw Errors.conflict("Baris yang sudah selesai atau dibatalkan tidak dikembalikan ke template.");
    if (!cur.templateKey) throw Errors.conflict("Baris ini tidak punya asal template yang jelas. Tinjau asalnya dulu.");
    const { desired } = await desiredFor(tx, w.projectId);
    const tpl = desired.get(cur.templateKey);
    if (!tpl) throw Errors.conflict("Pekerjaan ini tidak lagi dihitung oleh template, sehingga tidak dapat dikembalikan.");
    const before = toExisting(cur);
    await tx.trainingWorkloadTask.update({
      where: { id }, data: { name: tpl.name, employeeId: tpl.employeeId, hours: tpl.hours, startDate: isoToDate(tpl.startDate), endDate: isoToDate(tpl.endDate), roleKey: tpl.roleKey, adjusted: false, adjustedAt: null },
    });
    await auditProject(tx, actor, w.projectId, {
      action: "training.workload.revert", summary: `Tugas jam kerja "${cur.name}" dikembalikan ke template (${valueChanges(before, tpl).join(", ") || "tanpa perubahan nilai"})`,
      before: { taskId: id, name: before.name, employeeId: before.employeeId, hours: before.hours, startDate: before.startDate, endDate: before.endDate, adjusted: before.adjusted },
      after: { taskId: id, name: tpl.name, employeeId: tpl.employeeId, hours: tpl.hours, startDate: tpl.startDate, endDate: tpl.endDate, adjusted: false },
    });
    return { rowId: id, name: tpl.name, changes: [], canApply: true, reason: null };
  });
}

export interface WorkloadTemplateEntryDto { key: string; task: string; roleKey: string; roleLabel: string; claimedBy: string | null }

/** Pekerjaan template yang berlaku untuk proyek ini — pilihan saat menautkan baris lama. `claimedBy` = baris yang sudah memakainya. */
export async function listWorkloadTemplateEntries(actor: Actor, projectId: string): Promise<WorkloadTemplateEntryDto[]> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "manage_tasks");
  const p = await loadProgramRow(prisma, projectId);
  const cfg = (await loadConfig()).config;
  const rows = await prisma.trainingWorkloadTask.findMany({ where: { projectId, templateKey: { not: null } }, select: { id: true, templateKey: true } });
  const claimed = new Map(rows.map((r) => [r.templateKey!, r.id]));
  const roleLabel = new Map(cfg.roles.map((r) => [r.key, r.label]));
  return applicableHourRows(p, cfg).map((h) => ({ key: h.id, task: h.task, roleKey: h.roleKey, roleLabel: roleLabel.get(h.roleKey) ?? h.roleKey, claimedBy: claimed.get(h.id) ?? null }));
}

/**
 * Tinjau baris jam kerja LAMA yang asalnya belum jelas: TAUTKAN ke pekerjaan template (jadi baris asal-template yang disesuaikan bila sebelumnya ditandai manual)
 * atau nyatakan BERDIRI SENDIRI (manual dari awal; template tetap dibuat terpisah). Tercatat; tidak ada baris yang dibuat atau dihapus.
 */
export async function reviewWorkloadRow(actor: Actor, id: string, raw: unknown): Promise<void> {
  const w = await loadWorkloadForManage(actor, id);
  const input = parseInput(workloadReviewSchema, raw);
  await transaction(async (tx) => {
    await lockWorkload(tx, w.projectId);
    const cur = await tx.trainingWorkloadTask.findUniqueOrThrow({ where: { id } });
    if (!isLegacyUnresolved(toExisting(cur))) throw Errors.conflict("Baris ini tidak perlu ditinjau (asalnya sudah jelas).");
    const now = new Date();
    if (input.action === "STANDALONE") {
      await tx.trainingWorkloadTask.update({ where: { id }, data: { source: "MANUAL", originReviewedAt: now } });
      await auditProject(tx, actor, w.projectId, { action: "training.workload.review", summary: `Tugas jam kerja lama "${cur.name}" dinyatakan berdiri sendiri (bukan dari template)`, before: { taskId: id, source: cur.source }, after: { taskId: id, source: "MANUAL" } });
      return;
    }
    const p = await loadProgramRow(tx, w.projectId);
    const cfg = (await loadConfig(tx)).config;
    const entry = entriesOf(p, cfg).find((e) => e.key === input.templateKey);
    if (!entry) throw Errors.validation("Pekerjaan template itu tidak berlaku untuk jenis/moda program ini.", { templateKey: "Tidak valid" });
    if (await tx.trainingWorkloadTask.count({ where: { projectId: w.projectId, templateKey: entry.key } })) throw Errors.conflict("Pekerjaan template itu sudah punya baris. Jika keduanya untuk pekerjaan yang sama, gunakan \"Rapikan duplikat\".");
    const adjusted = cur.source === "MANUAL" || cur.adjusted;
    await tx.trainingWorkloadTask.update({ where: { id }, data: { templateKey: entry.key, adjusted, adjustedAt: adjusted ? now : null, originReviewedAt: now } });
    await auditProject(tx, actor, w.projectId, {
      action: "training.workload.review", summary: `Tugas jam kerja lama "${cur.name}" ditautkan ke pekerjaan template "${entry.task}"${adjusted ? " (sebagai baris yang disesuaikan)" : ""}`,
      before: { taskId: id, templateKey: null }, after: { taskId: id, templateKey: entry.key, adjusted },
    });
  });
}

/**
 * Rapikan baris KEMBAR (satu pekerjaan template terhitung dua kali): pengguna melihat kedua baris, memilih satu yang DIPERTAHANKAN, dan sisanya dihapus. Yang dipertahankan
 * menjadi baris asal-template (disesuaikan bila ia baris yang diubah manual). Baris yang sudah selesai/dibatalkan tidak boleh dihapus (riwayat). Tercatat: siapa, baris mana
 * yang dipertahankan dan yang dihapus (beserta nilainya).
 */
export async function mergeWorkloadDuplicates(actor: Actor, projectId: string, raw: unknown): Promise<{ kept: string; removed: number }> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "manage_tasks");
  assertEditable(access.project);
  const input = parseInput(workloadMergeSchema, raw);
  return transaction(async (tx) => {
    await lockWorkload(tx, projectId);
    const rows = await tx.trainingWorkloadTask.findMany({ where: { projectId }, include: { employee: { select: { fullName: true } } } });
    const p = await loadProgramRow(tx, projectId);
    const cfg = (await loadConfig(tx)).config;
    const group = classifyLegacy(rows.map(toExisting), entriesOf(p, cfg)).duplicateGroups.find((g) => g.rowIds.includes(input.keepId));
    if (!group) throw Errors.conflict("Baris itu tidak (lagi) termasuk baris kembar. Muat ulang halaman.");
    const others = group.rowIds.filter((x) => x !== input.keepId);
    if (new Set(input.removeIds).size !== others.length || !input.removeIds.every((x) => others.includes(x))) {
      throw Errors.validation("Pilih satu baris untuk dipertahankan; semua baris kembar lainnya dihapus.", { removeIds: "Tidak sesuai kelompok kembar" });
    }
    const byId = new Map(rows.map((r) => [r.id, r]));
    const kept = byId.get(input.keepId)!;
    const gone = input.removeIds.map((x) => byId.get(x)!);
    const done = gone.find((r) => r.status !== "OPEN");
    if (done) throw Errors.conflict(`Baris "${done.name}" sudah ${done.status === "DONE" ? "selesai" : "dibatalkan"} dan tidak dapat dihapus (riwayatnya dijaga). Pertahankan baris itu, hapus yang lain.`);
    const snap = (r: (typeof rows)[number]) => ({ id: r.id, name: r.name, employee: r.employee.fullName, hours: r.hours, startDate: dateToIso(r.startDate), endDate: dateToIso(r.endDate), status: r.status, source: r.source, adjusted: r.adjusted, templateKey: r.templateKey });
    await tx.trainingWorkloadTask.deleteMany({ where: { id: { in: input.removeIds } } });
    const now = new Date();
    const adjusted = kept.adjusted || kept.source === "MANUAL";
    await tx.trainingWorkloadTask.update({
      where: { id: kept.id }, data: { templateKey: group.key, adjusted, adjustedAt: adjusted ? kept.adjustedAt ?? now : null, originReviewedAt: now },
    });
    await auditProject(tx, actor, projectId, {
      action: "training.workload.merge", summary: `Baris jam kerja kembar "${kept.name}" dirapikan: 1 dipertahankan, ${gone.length} dihapus`,
      before: { kept: snap(kept), removed: gone.map(snap) }, after: { keptId: kept.id, templateKey: group.key, adjusted, removedIds: input.removeIds },
    });
    return { kept: kept.id, removed: gone.length };
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
