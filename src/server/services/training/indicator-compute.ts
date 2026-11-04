import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma, type Tx } from "../../db";
import type { Actor } from "../../actor";
import { dateToIso, isoToDate } from "../../json";
import { addDays, diffDays, endOfIsoWeek, startOfIsoWeek } from "@/lib/time";
import type { IndicatorConfig, Track } from "@/lib/training/indicators/config";
import {
  combineStatus, computeProjection, computeReadiness, computeTimeliness, countWorkdays, imbalanceIndex, isWorkday, loadBand, loadColor, loadPct,
  parallelDensity, participantRamp, programLoad, resolveDueMap, resolveOffset, taskHoursInWeek, weekCapacity,
  type Color, type ItemIn, type LoadBand, type MilestoneIn, type ProjectionResult, type ReadinessResult, type TimelinessResult, type TriggerCode, type WorkCal, type WorkTaskIn,
} from "@/lib/training/indicators/engine";
import type { ProjectStatus } from "@/lib/training/types";
import { parseInput } from "../../validate";
import { densityQuerySchema, heatmapQuerySchema } from "@/lib/validation/training";
import { accessibleProjectWhere, loadProjectAccess, requireModule } from "./access";
import { loadConfig } from "./indicator-config";
import { dateCtx, loadCal, specOf, toProgramRow, type ProgramRow } from "./indicator-data";
import { statusRun, type SnapshotIn, type StatusRun } from "@/lib/training/indicators/escalation";
import { today } from "./shared";

type Db = Tx | typeof prisma;

/** Persen tak terhingga (kapasitas 0) dikirim sebagai 9999 — JSON tidak mengenal Infinity. */
const cap = (n: number): number => (Number.isFinite(n) ? n : 9999);

// ═════════════════════════ Lingkungan hitung (dimuat sekali per permintaan) ═════════════════════════

interface TaskRow extends WorkTaskIn { projectId: string; projectCode: string; projectName: string; task: string }
interface Person { id: string; name: string; divisionId: string | null; divisionName: string | null }

export interface Env {
  today: string; cfg: IndicatorConfig; cal: WorkCal;
  /** Senin minggu berjalan + minggu-minggu ke depan (cfg.capacity.weeksAhead). */
  weeks: string[];
  tasksOf: (employeeId: string) => TaskRow[];
  capacityOf: (employeeId: string) => { hoursPerDay: number; cal: WorkCal };
  leaveDaysIn: (employeeId: string, weekStart: string) => number;
  onLeave: (employeeId: string, date: string) => boolean;
  person: (employeeId: string) => Person | undefined;
  /** Karyawan aktif yang memegang tugas jam kerja terbuka pada jendela. */
  taskHolders: string[];
}

export interface WeekLoad { weekStart: string; hours: number; capacity: number; pct: number; band: LoadBand; color: Color }

export function weekLoadOf(env: Env, employeeId: string, weekStart: string): WeekLoad {
  const c = env.capacityOf(employeeId);
  const hours = env.tasksOf(employeeId).reduce((a, t) => a + taskHoursInWeek(t, weekStart, c.cal), 0);
  const capacity = weekCapacity(weekStart, c.cal, env.leaveDaysIn(employeeId, weekStart), c.hoursPerDay);
  const pct = loadPct(hours, capacity);
  const band = loadBand(pct, env.cfg.thresholds);
  return { weekStart, hours: Math.round(hours * 10) / 10, capacity: Math.round(capacity * 10) / 10, pct: cap(pct), band, color: loadColor(band) };
}

/**
 * Muat semua data yang dibutuhkan beban tim: tugas jam kerja terbuka dari proyek yang belum selesai/batal, kapasitas per staf,
 * cuti disetujui dari HRIS (hanya tanggal & porsi hari yang dibaca), dan hari libur kalender (bila diaktifkan).
 */
export async function buildEnv(db: Db, cfg: IndicatorConfig, opts: { weeks?: number; people?: string[] } = {}): Promise<Env> {
  const t = today();
  const cal = await loadCal(db, cfg);
  const first = startOfIsoWeek(t);
  const count = Math.min(12, Math.max(1, opts.weeks ?? cfg.capacity.weeksAhead + 1));
  const weeks = Array.from({ length: count }, (_, i) => addDays(first, i * 7));
  const windowEnd = endOfIsoWeek(weeks[weeks.length - 1]!);

  const taskRows = await db.trainingWorkloadTask.findMany({
    where: {
      status: "OPEN", startDate: { lte: isoToDate(windowEnd) }, endDate: { gte: isoToDate(first) },
      project: { status: { notIn: ["COMPLETED", "CANCELLED"] } }, employee: { isActive: true },
      ...(opts.people ? { employeeId: { in: opts.people } } : {}),
    },
    include: { project: { select: { code: true, name: true } }, employee: { select: { fullName: true, divisionId: true, division: { select: { name: true } } } } },
  });
  const byEmp = new Map<string, TaskRow[]>();
  const people = new Map<string, Person>();
  for (const r of taskRows) {
    const list = byEmp.get(r.employeeId) ?? [];
    list.push({ employeeId: r.employeeId, hours: r.hours, start: dateToIso(r.startDate), end: dateToIso(r.endDate), projectId: r.projectId, projectCode: r.project.code, projectName: r.project.name, task: r.name });
    byEmp.set(r.employeeId, list);
    people.set(r.employeeId, { id: r.employeeId, name: r.employee.fullName, divisionId: r.employee.divisionId, divisionName: r.employee.division?.name ?? null });
  }

  const capRows = await db.trainingStaffCapacity.findMany({});
  const capByEmp = new Map(capRows.map((c) => [c.employeeId, c]));

  const leave = new Map<string, { start: string; end: string; part: "FULL" | "MORNING" | "AFTERNOON" }[]>();
  if (cfg.capacity.useHrisLeave) {
    const lr = await db.leaveRequest.findMany({
      where: { status: "APPROVED", startDate: { lte: isoToDate(windowEnd) }, endDate: { gte: isoToDate(first) } },
      select: { employeeId: true, startDate: true, endDate: true, dayPart: true },
    });
    for (const l of lr) {
      const list = leave.get(l.employeeId) ?? [];
      list.push({ start: dateToIso(l.startDate), end: dateToIso(l.endDate), part: l.dayPart });
      leave.set(l.employeeId, list);
    }
  }

  const capacityOf: Env["capacityOf"] = (id) => {
    const row = capByEmp.get(id);
    return { hoursPerDay: row?.hoursPerDay ?? cfg.capacity.hoursPerDay, cal: { workDays: row ? row.workDays : cfg.capacity.workDays, holidays: cal.holidays } };
  };
  const leaveDaysIn: Env["leaveDaysIn"] = (id, weekStart) => {
    const c = capacityOf(id).cal;
    const wEnd = endOfIsoWeek(weekStart);
    let days = 0;
    for (const l of leave.get(id) ?? []) {
      const from = l.start > weekStart ? l.start : weekStart;
      const to = l.end < wEnd ? l.end : wEnd;
      if (to < from) continue;
      days += countWorkdays(from, to, c) * (l.part === "FULL" ? 1 : 0.5);
    }
    return days;
  };
  return {
    today: t, cfg, cal, weeks, tasksOf: (id) => byEmp.get(id) ?? [], capacityOf, leaveDaysIn,
    onLeave: (id, date) => (leave.get(id) ?? []).some((l) => l.part === "FULL" && l.start <= date && date <= l.end),
    person: (id) => people.get(id), taskHolders: [...byEmp.keys()],
  };
}

// ═════════════════════════ Kepadatan kelas paralel (KP) ═════════════════════════

export interface DensityDay {
  date: string; classes: { projectId: string; code: string; name: string; mode: "ONSITE" | "ONLINE" | "HYBRID" }[];
  /** Beban kelas: luring + daring + 2 × hybrid. */
  load: number; facilitators: number; kp: number; status: Color;
}

/**
 * Kelas berjalan = proyek Persiapan/Berjalan; hari kelas = hari kerja antara tanggal mulai dan selesai (jadwal sesi per hari tidak dipakai).
 * Fasilitator tersedia = fasilitator pada konfigurasi yang aktif dan tidak sedang cuti penuh disetujui.
 */
export async function densityDays(db: Db, env: Env, from: string, days: number, onlyProject?: string): Promise<DensityDay[]> {
  const to = addDays(from, days - 1);
  const projects = await db.trainingProject.findMany({
    where: { status: { in: ["PREPARATION", "RUNNING"] }, startDate: { lte: isoToDate(to) }, OR: [{ endDate: { gte: isoToDate(from) } }, { endDate: null, startDate: { gte: isoToDate(from) } }] },
    select: { id: true, code: true, name: true, deliveryMode: true, startDate: true, endDate: true },
  });
  const active = env.cfg.facilitators.length
    ? new Set((await db.employee.findMany({ where: { id: { in: env.cfg.facilitators }, isActive: true }, select: { id: true } })).map((e) => e.id))
    : new Set<string>();
  // Cuti fasilitator di luar jendela minggu berjalan tidak dimuat oleh buildEnv: untuk tanggal di luar jendela dianggap tersedia.
  const out: DensityDay[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    if (!isWorkday(date, env.cal)) continue;
    const classes = projects
      .filter((p) => p.startDate && dateToIso(p.startDate) <= date && date <= dateToIso(p.endDate ?? p.startDate))
      .map((p) => ({ projectId: p.id, code: p.code, name: p.name, mode: p.deliveryMode }));
    if (classes.length === 0) continue;
    if (onlyProject && !classes.some((c) => c.projectId === onlyProject)) continue;
    const facilitators = [...active].filter((id) => !env.onLeave(id, date)).length;
    const kp = parallelDensity(classes.map((c) => c.mode), facilitators);
    const load = classes.reduce((a, c) => a + (c.mode === "HYBRID" ? 2 : 1), 0);
    out.push({ date, classes, load, facilitators, kp: cap(kp), status: kp > env.cfg.thresholds.parallelDensityMax ? "RED" : "GREEN" });
  }
  return out;
}

// ═════════════════════════ Indikator satu program ═════════════════════════

export interface ProgramIndicatorDto {
  projectId: string; code: string; name: string; status: ProjectStatus; track: Track; bnsp: boolean;
  startDate: string | null; endDate: string | null; daysToStart: number | null; applied: boolean;
  timeliness: TimelinessResult | null; readiness: ReadinessResult | null; projection: ProjectionResult | null;
  load: { pct: number | null; band: LoadBand | null; status: Color | null; topPerson: string | null };
  triggers: TriggerCode[];
  /** Terburuk(tiga indikator) + pemicu Merah. Null bila template belum diterapkan. */
  overall: Color | null;
  /** Hal yang membuat hitungan belum lengkap (tanggal acuan kosong, peserta acuan kosong, ...). */
  gaps: string[];
  next: { code: string; name: string; due: string; daysLeft: number } | null;
  /** Milestone yang sudah lewat tenggat lebih dari ambang eskalasi (kode). */
  escalate: string[];
  /** Deret hari kerja berturut-turut Kuning / Merah (dari snapshot harian + keadaan hari ini). Null = tidak dimuat (daftar kartu). */
  runs: { yellow: StatusRun; red: StatusRun; yellowStreakDays: number } | null;
}

export interface ProjectData {
  milestones: Prisma.TrainingMilestoneGetPayload<{ include: { assignee: { select: { id: true } } } }>[];
  items: Prisma.TrainingReadinessItemGetPayload<object>[];
  participants: { confirmedAt: Date | null; createdAt: Date }[];
}

function compute(env: Env, p: ProgramRow, d: ProjectData, density: DensityDay[], viewAll: boolean): ProgramIndicatorDto {
  const th = env.cfg.thresholds;
  const t = env.today;
  const ctx = dateCtx(p);
  const gaps: string[] = [];
  const base = {
    projectId: p.id, code: p.code, name: p.name, status: p.status as ProjectStatus, track: p.track, bnsp: p.bnsp,
    startDate: p.startDate, endDate: p.endDate, daysToStart: p.startDate ? diffDays(p.startDate, t) : null,
  };
  if (!p.indicatorsAppliedAt) {
    return { ...base, applied: false, timeliness: null, readiness: null, projection: null, load: { pct: null, band: null, status: null, topPerson: null }, triggers: [], overall: null, gaps: [], next: null, escalate: [], runs: null };
  }
  if (!p.startDate) gaps.push("Tanggal mulai (H) belum diisi — tenggat milestone dan item tidak dapat dihitung.");
  if (p.track === "PARTNER" && !p.requestDate) gaps.push("Tanggal permintaan klien (T) belum diisi — milestone berpatokan T tidak terhitung.");
  if (!p.participantsMin) gaps.push("Peserta acuan belum diisi — komponen Peserta dikeluarkan dari IKP.");

  const dues = resolveDueMap(d.milestones.map((m) => ({ code: m.code, spec: specOf(m) })), ctx, env.cal);
  const mIn: MilestoneIn[] = d.milestones.map((m) => ({
    code: m.code, name: m.name, weight: m.weight, critical: m.critical, due: dues.get(m.code) ?? null, doneAt: m.doneAt ? dateToIso(m.doneAt) : null,
    notApplicable: m.notApplicable || (m.bnspOnly && !p.bnsp),
  }));
  const timeliness = computeTimeliness(mIn, t, th);

  const items: ItemIn[] = d.items.map((i) => ({
    component: i.component, name: i.name, critical: i.critical, due: resolveOffset(specOf(i), ctx, (c) => dues.get(c) ?? null, env.cal),
    status: i.bnspOnly && !p.bnsp ? "NOT_APPLICABLE" : i.status,
  }));
  const confirmed = d.participants.filter((x) => x.confirmedAt !== null).length;
  const reference = p.participantsMin && p.participantsMin > 0 ? p.participantsMin : null;
  const readiness = computeReadiness({
    items, weights: env.cfg.weights[p.track], today: t, h: p.startDate,
    participants: { confirmed, reference, rampR: participantRamp(p.track, t, (c) => dues.get(c) ?? null, env.cfg.participants) },
  }, th);

  let projection: ProjectionResult | null = null;
  if (p.track === "REGULAR" && p.startDate) {
    const closeDate = p.registrationCloseDate ?? addDays(p.startDate, -th.projection.defaultCloseDaysBeforeH);
    const since = addDays(t, -th.projection.windowDays);
    const recent = d.participants.filter((x) => dateToIso(x.createdAt) >= since).length;
    projection = computeProjection({ confirmed, recent, today: t, closeDate, reference }, th);
  }

  // (4.5) beban program = beban tertinggi staf yang masih memegang milestone terbuka, pada minggu berjalan dan berikutnya.
  const holders = [...new Set(d.milestones.filter((m, i) => !mIn[i]!.notApplicable && !m.doneAt && m.assigneeId).map((m) => m.assigneeId!))];
  let pct: number | null = null, top: string | null = null;
  if (holders.length) {
    const horizon = env.weeks.slice(0, 2);
    const per = holders.map((id) => ({ id, pct: Math.max(...horizon.map((w) => weekLoadOf(env, id, w).pct)) }));
    pct = programLoad(per.map((x) => x.pct));
    const worstOne = per.find((x) => x.pct === pct);
    top = worstOne ? env.person(worstOne.id)?.name ?? null : null;
  }
  const band = pct === null ? null : loadBand(pct, th);

  const triggers: TriggerCode[] = [];
  if (timeliness.criticalOverdue.length) triggers.push("CRITICAL_MILESTONE");
  if (readiness.criticalOpen.length) triggers.push("CRITICAL_ITEM");
  if (p.startDate) {
    const last = p.endDate ?? p.startDate;
    if (density.some((x) => x.date >= p.startDate! && x.date <= last && x.classes.some((c) => c.projectId === p.id) && x.kp > th.parallelDensityMax)) triggers.push("PARALLEL_DENSITY");
    if (projection && p.track === "REGULAR" && t >= addDays(p.startDate, -th.projection.triggerDaysBeforeH) && t <= p.startDate && projection.ratio < th.projection.yellowMin) triggers.push("PROJECTION_LOW");
  }
  const overall = combineStatus({ timeliness: timeliness.bandStatus, readiness: readiness.bandStatus, load: band ? loadColor(band) : null, programTriggers: triggers });

  const upcoming = mIn.filter((m) => !m.notApplicable && !m.doneAt && m.due !== null && m.due >= t).sort((a, b) => a.due!.localeCompare(b.due!))[0];
  return {
    ...base, applied: true, timeliness, readiness, projection,
    load: { pct: pct === null ? null : cap(pct), band, status: band ? loadColor(band) : null, topPerson: viewAll ? top : null },
    triggers, overall, gaps,
    next: upcoming ? { code: upcoming.code, name: upcoming.name, due: upcoming.due!, daysLeft: diffDays(upcoming.due!, t) } : null,
    escalate: timeliness.escalate, runs: null,
  };
}

/** Snapshot harian beberapa hari terakhir per program (sebelum hari ini) — dasar aturan "berturut-turut". */
export async function loadSnapshots(db: Db, ids: string[], today: string, days = 30): Promise<Map<string, SnapshotIn[]>> {
  const out = new Map<string, SnapshotIn[]>(ids.map((id) => [id, []]));
  if (!ids.length) return out;
  const rows = await db.trainingStatusSnapshot.findMany({ where: { projectId: { in: ids }, date: { gte: isoToDate(addDays(today, -days)), lt: isoToDate(today) } }, select: { projectId: true, date: true, overall: true } });
  for (const r of rows) out.get(r.projectId)!.push({ date: dateToIso(r.date), overall: r.overall as Color });
  return out;
}

export function runsOf(prior: SnapshotIn[], today: string, overall: Color | null, cal: WorkCal): { yellow: StatusRun; red: StatusRun } {
  const snaps = overall ? [...prior.filter((s) => s.date !== today), { date: today, overall }] : prior;
  return { yellow: statusRun(snaps, today, "YELLOW", cal), red: statusRun(snaps, today, "RED", cal) };
}

export async function loadData(db: Db, ids: string[]): Promise<Map<string, ProjectData>> {
  const out = new Map<string, ProjectData>(ids.map((id) => [id, { milestones: [], items: [], participants: [] }]));
  if (!ids.length) return out;
  const [ms, items, parts] = await Promise.all([
    db.trainingMilestone.findMany({ where: { projectId: { in: ids } }, orderBy: { sortOrder: "asc" }, include: { assignee: { select: { id: true } } } }),
    db.trainingReadinessItem.findMany({ where: { projectId: { in: ids } }, orderBy: [{ component: "asc" }, { sortOrder: "asc" }] }),
    db.trainingParticipant.findMany({ where: { projectId: { in: ids }, status: { not: "CANCELLED" } }, select: { projectId: true, confirmedAt: true, createdAt: true } }),
  ]);
  for (const m of ms) out.get(m.projectId)!.milestones.push(m);
  for (const i of items) out.get(i.projectId)!.items.push(i);
  for (const x of parts) out.get(x.projectId)!.participants.push({ confirmedAt: x.confirmedAt, createdAt: x.createdAt });
  return out;
}

/** Indikator satu program (tab Pemantauan). Mengikuti akses proyek: tidak boleh melihat → 404. */
export async function getProgramIndicators(actor: Actor, projectId: string): Promise<ProgramIndicatorDto & { configVersion: number; configDamaged: boolean }> {
  const access = await loadProjectAccess(actor, projectId);
  const loaded = await loadConfig();
  const [row, data] = await Promise.all([prisma.trainingProject.findUniqueOrThrow({ where: { id: projectId } }), loadData(prisma, [projectId])]);
  const env = await buildEnv(prisma, loaded.config);
  const density = await densityDays(prisma, env, env.today, 31, projectId);
  const dto = compute(env, toProgramRow(row), data.get(projectId)!, density, access.module.caps.viewAll);
  const prior = (await loadSnapshots(prisma, [projectId], env.today)).get(projectId)!;
  return { ...dto, runs: dto.applied ? { ...runsOf(prior, env.today, dto.overall, env.cal), yellowStreakDays: loaded.config.escalation.yellowStreakDays } : null, configVersion: loaded.version, configDamaged: loaded.damaged };
}

/** Untuk pekerja harian (tanpa pelaku): indikator semua program Persiapan/Berjalan yang templatenya sudah diterapkan. Hanya dipanggil dari service. */
export async function computeActivePrograms(db: Db = prisma): Promise<{ env: Env; loaded: Awaited<ReturnType<typeof loadConfig>>; cards: ProgramIndicatorDto[] }> {
  const loaded = await loadConfig(db);
  const rows = await db.trainingProject.findMany({ where: { status: { in: ["PREPARATION", "RUNNING"] }, indicatorsAppliedAt: { not: null } }, orderBy: { code: "asc" }, take: 500 });
  const data = await loadData(db, rows.map((r) => r.id));
  const env = await buildEnv(db, loaded.config);
  const density = await densityDays(db, env, env.today, 31);
  return { env, loaded, cards: rows.map((r) => compute(env, toProgramRow(r), data.get(r.id)!, density, true)) };
}

const ORDER: Record<Color, number> = { RED: 0, YELLOW: 1, GREEN: 2 };

/** Kartu pemantauan semua program yang boleh dilihat pelaku (Draf/Persiapan/Berjalan), terburuk dulu. */
export async function listProgramCards(actor: Actor): Promise<{ cards: ProgramIndicatorDto[]; configVersion: number; configDamaged: boolean; today: string }> {
  const mod = await requireModule(actor);
  const loaded = await loadConfig();
  const rows = await prisma.trainingProject.findMany({
    where: { AND: [accessibleProjectWhere(actor, mod), { status: { in: ["DRAFT", "PREPARATION", "RUNNING"] } }] },
    orderBy: [{ startDate: { sort: "asc", nulls: "last" } }, { code: "asc" }], take: 200,
  });
  const data = await loadData(prisma, rows.map((r) => r.id));
  const env = await buildEnv(prisma, loaded.config);
  const density = await densityDays(prisma, env, env.today, 31);
  const cards = rows.map((r) => compute(env, toProgramRow(r), data.get(r.id)!, density, mod.caps.viewAll));
  cards.sort((a, b) => (a.overall === null ? 3 : ORDER[a.overall]) - (b.overall === null ? 3 : ORDER[b.overall]) || (a.startDate ?? "9999").localeCompare(b.startDate ?? "9999"));
  return { cards, configVersion: loaded.version, configDamaged: loaded.damaged, today: env.today };
}

// ═════════════════════════ Peta beban tim ═════════════════════════

export interface HeatmapRow {
  employeeId: string; name: string; division: string | null; weeks: (WeekLoad & { items: { projectCode: string; projectName: string; task: string; hours: number }[] })[];
  peak: number; peakBand: LoadBand;
  /** Beban melewati batas Overload pada dua minggu berturut-turut (pemicu eskalasi ke Manajer Operasional dan Keuangan). */
  overloadStreak: boolean;
}
export interface HeatmapDto {
  today: string; weekStarts: string[]; scope: "all" | "self"; rows: HeatmapRow[];
  divisions: { name: string; members: number; index: number | null; flagged: boolean }[];
  thresholds: IndicatorConfig["thresholds"]["load"];
}

/** Peta beban per staf per minggu. Semua pengguna modul yang boleh melihat semua proyek melihat seluruh tim; lainnya hanya barisnya sendiri. */
export async function getTeamHeatmap(actor: Actor, raw: unknown = {}): Promise<HeatmapDto> {
  const mod = await requireModule(actor);
  const opts = parseInput(heatmapQuerySchema, raw);
  const loaded = await loadConfig();
  const all = mod.caps.viewAll;
  const env = await buildEnv(prisma, loaded.config, { weeks: opts.weeks });
  const th = loaded.config.thresholds;

  // Staf yang tampil: yang memegang tugas + (agar ketimpangan bermakna) seluruh anggota aktif divisi yang punya tugas.
  const withTasks = new Set<string>();
  const divisionIds = new Set<string>();
  for (const id of await taskHolderIds()) {
    withTasks.add(id);
    const d = env.person(id)?.divisionId;
    if (d) divisionIds.add(d);
  }
  let people: Person[] = [];
  if (all) {
    const emps = await prisma.employee.findMany({
      where: { isActive: true, OR: [{ id: { in: [...withTasks] } }, ...(divisionIds.size ? [{ divisionId: { in: [...divisionIds] } }] : [])] },
      select: { id: true, fullName: true, divisionId: true, division: { select: { name: true } } }, orderBy: { fullName: "asc" }, take: 300,
    });
    people = emps.map((e) => ({ id: e.id, name: e.fullName, divisionId: e.divisionId, divisionName: e.division?.name ?? null }));
  } else if (actor.employeeId) {
    const e = await prisma.employee.findUnique({ where: { id: actor.employeeId }, select: { id: true, fullName: true, divisionId: true, division: { select: { name: true } }, isActive: true } });
    if (e?.isActive) people = [{ id: e.id, name: e.fullName, divisionId: e.divisionId, divisionName: e.division?.name ?? null }];
  }

  const rows: HeatmapRow[] = people.map((p) => {
    const weeks = env.weeks.map((w) => weekLoadOf(env, p.id, w));
    const peak = Math.max(...weeks.map((w) => w.pct));
    const overloaded = weeks.map((w) => w.band === "OVERLOAD");
    return {
      employeeId: p.id, name: p.name, division: p.divisionName,
      weeks: weeks.map((w) => ({ ...w, items: env.tasksOf(p.id).map((t) => ({ t, h: taskHoursInWeek(t, w.weekStart, env.capacityOf(p.id).cal) })).filter((x) => x.h > 0).map((x) => ({ projectCode: x.t.projectCode, projectName: x.t.projectName, task: x.t.task, hours: Math.round(x.h * 10) / 10 })) })),
      peak, peakBand: loadBand(peak, th), overloadStreak: overloaded.some((v, i) => v && overloaded[i + 1] === true),
    };
  });

  const divisions: HeatmapDto["divisions"] = [];
  if (all) {
    const by = new Map<string, { name: string; loads: number[] }>();
    for (const [i, p] of people.entries()) {
      if (!p.divisionId) continue;
      const g = by.get(p.divisionId) ?? { name: p.divisionName ?? "Tanpa nama", loads: [] };
      g.loads.push(rows[i]!.weeks[0]!.pct);
      by.set(p.divisionId, g);
    }
    for (const g of by.values()) {
      const idx = imbalanceIndex(g.loads);
      // Ketimpangan hanya ditandai bila beban tertinggi sudah melewati batas "Ada ruang": bila semua orang masih longgar, rasio besar hanyalah noise dari angka kecil.
      const peak = Math.max(...g.loads);
      divisions.push({ name: g.name, members: g.loads.length, index: idx === null ? null : Math.round(idx * 100) / 100, flagged: idx !== null && idx > th.imbalanceMax && Math.round(peak) > th.load.roomyMax });
    }
    divisions.sort((a, b) => a.name.localeCompare(b.name));
  }
  rows.sort((a, b) => b.peak - a.peak || a.name.localeCompare(b.name));
  return { today: env.today, weekStarts: env.weeks, scope: all ? "all" : "self", rows, divisions, thresholds: th.load };

  async function taskHolderIds(): Promise<string[]> {
    const grouped = await prisma.trainingWorkloadTask.groupBy({ by: ["employeeId"], where: { status: "OPEN", project: { status: { notIn: ["COMPLETED", "CANCELLED"] } }, employee: { isActive: true } } });
    return grouped.map((g) => g.employeeId);
  }
}

// ═════════════════════════ Kepadatan kelas (halaman) ═════════════════════════

export interface DensityDto { from: string; days: number; list: DensityDay[]; facilitatorsConfigured: number; max: number; restricted: boolean }

/** Kepadatan kelas paralel menggabungkan SEMUA program, jadi hanya untuk yang boleh melihat semua proyek; lainnya `restricted` (daftar kosong). */
export async function getClassDensity(actor: Actor, raw: unknown = {}): Promise<DensityDto> {
  const mod = await requireModule(actor);
  const opts = parseInput(densityQuerySchema, raw);
  const loaded = await loadConfig();
  const env = await buildEnv(prisma, loaded.config);
  const from = opts.from ?? env.today;
  const days = opts.days ?? 31;
  const restricted = !mod.caps.viewAll;
  const list = restricted ? [] : await densityDays(prisma, env, from, days);
  return { from, days, list, facilitatorsConfigured: loaded.config.facilitators.length, max: loaded.config.thresholds.parallelDensityMax, restricted };
}
