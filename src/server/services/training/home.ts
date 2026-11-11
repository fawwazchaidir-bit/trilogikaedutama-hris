import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db";
import { env } from "../../env";
import type { Actor } from "../../actor";
import { dateToIso, isoToDate } from "../../json";
import { addDays, currentYearMonth, localDate, monthRange } from "@/lib/time";
import { checklistProgress, type ChecklistProgress } from "@/lib/training/indicators";
import type { ProjectStatus } from "@/lib/training/types";
import { INTERN_FORBIDDEN_PROJECT_ROLES } from "@/lib/training/access";
import { accessibleProjectWhere, requireModule } from "./access";
import { listProgramCards } from "./indicator-compute";
import { listCalendar } from "./operations";
import { auditVisibilityWhere, liveTaskWhere, today } from "./shared";

/**
 * Data beranda Training & Operations (kartu ringkasan, grafik aktivitas, proyek saya, kalender, aktivitas terbaru). SEMUA dari data nyata dan
 * dibatasi lingkup akses pelaku (proyek di luar lingkup tidak ikut terhitung). Tidak ada angka keuangan/kepuasan: belum ada sumber datanya.
 */
export interface TrainingHomeDto {
  today: string;
  /** Saat data dibuat (ms) — dasar "x jam lalu" pada umpan aktivitas (render tidak boleh memanggil Date.now). */
  nowMs: number;
  scope: "all" | "mine";
  kpis: {
    activeProjects: number; participants: number;
    /** Persen tugas terbuka yang belum lewat tenggat (null = tidak ada tugas terbuka). */
    tasksOnTrackPct: number | null; openTasks: number;
    /** Program berstatus Kuning/Merah (null = belum ada program dinilai). */
    attentionPrograms: number | null; redPrograms: number;
  };
  chart: { days: string[]; tasksDone: number[]; participantsAdded: number[] };
  myProjects: { id: string; code: string; name: string; status: ProjectStatus; startDate: string | null; endDate: string | null; participants: number; checklist: ChecklistProgress; isMember: boolean }[];
  /** Hari pada bulan berjalan yang punya sesi, beserta jumlahnya. */
  calendar: { month: string; today: string; days: { date: string; count: number }[] };
  activity: { id: string; at: string; actorName: string | null; summary: string; action: string; projectId: string; projectCode: string | null }[];
}

const OPEN = ["TODO", "IN_PROGRESS", "IN_REVIEW"] as const;

export async function getTrainingHome(actor: Actor): Promise<TrainingHomeDto> {
  const mod = await requireModule(actor);
  const tz = env().APP_TIMEZONE;
  const t = today();
  const scope = accessibleProjectWhere(actor, mod);
  const activeWhere: Prisma.TrainingProjectWhereInput = { AND: [scope, { status: { in: ["PREPARATION", "RUNNING"] } }] };
  const from14 = addDays(t, -13);
  const since = new Date(isoToDate(from14).getTime() - 24 * 3_600_000); // longgar sehari; disaring per tanggal lokal di bawah
  const ym = currentYearMonth(tz);
  const month = monthRange(ym);

  const [activeIds, tasksOpen, tasksLate, doneRows, partRows, sessions, memberRows] = await Promise.all([
    prisma.trainingProject.findMany({ where: activeWhere, select: { id: true } }),
    prisma.trainingTask.count({ where: { AND: [liveTaskWhere, { project: scope, status: { in: [...OPEN] } }] } }),
    prisma.trainingTask.count({ where: { AND: [liveTaskWhere, { project: scope, status: { in: [...OPEN] }, dueDate: { lt: isoToDate(t) } }] } }),
    prisma.trainingTask.findMany({ where: { project: scope, status: "DONE", completedAt: { gte: since } }, select: { completedAt: true } }),
    prisma.trainingParticipant.findMany({ where: { project: scope, status: { not: "CANCELLED" }, createdAt: { gte: since } }, select: { createdAt: true } }),
    listCalendar(actor, { from: month.from, to: month.to }),
    actor.employeeId ? prisma.trainingProjectMember.findMany({ where: { employeeId: actor.employeeId, endedAt: null }, select: { projectId: true, role: true } }) : Promise.resolve([]),
  ]);
  const activeProjectIds = activeIds.map((p) => p.id);
  const participants = activeProjectIds.length ? await prisma.trainingParticipant.count({ where: { projectId: { in: activeProjectIds }, status: { not: "CANCELLED" } } }) : 0;

  // Grafik 14 hari: tugas selesai & peserta ditambahkan per tanggal lokal (WIB).
  const days = Array.from({ length: 14 }, (_, i) => addDays(from14, i));
  const idx = new Map(days.map((d, i) => [d, i]));
  const tasksDone = days.map(() => 0), participantsAdded = days.map(() => 0);
  for (const r of doneRows) { const i = idx.get(localDate(r.completedAt!, tz)); if (i !== undefined) tasksDone[i]!++; }
  for (const r of partRows) { const i = idx.get(localDate(r.createdAt, tz)); if (i !== undefined) participantsAdded[i]!++; }

  // Proyek saya: proyek yang diikuti pelaku; bila tidak ada (mis. Direktur/Pemantau), proyek aktif terdekat dalam lingkupnya.
  const memberIds = memberRows.map((m) => m.projectId);
  const mineWhere: Prisma.TrainingProjectWhereInput = memberIds.length
    ? { id: { in: memberIds }, status: { notIn: ["COMPLETED", "CANCELLED"] } }
    : activeWhere;
  const projects = await prisma.trainingProject.findMany({
    where: mineWhere, orderBy: [{ startDate: { sort: "asc", nulls: "last" } }, { code: "asc" }], take: 4,
    select: { id: true, code: true, name: true, status: true, startDate: true, endDate: true },
  });
  const ids = projects.map((p) => p.id);
  const [chk, pc] = ids.length ? await Promise.all([
    prisma.trainingProjectChecklistItem.groupBy({ by: ["projectId", "isDone"], where: { projectId: { in: ids } }, _count: { _all: true } }),
    prisma.trainingParticipant.groupBy({ by: ["projectId"], where: { projectId: { in: ids }, status: { not: "CANCELLED" } }, _count: { _all: true } }),
  ]) : [[], []];
  const done = new Map<string, number>(), total = new Map<string, number>();
  for (const r of chk) { total.set(r.projectId, (total.get(r.projectId) ?? 0) + r._count._all); if (r.isDone) done.set(r.projectId, r._count._all); }
  const myProjects = projects.map((p) => {
    const d = done.get(p.id) ?? 0, n = total.get(p.id) ?? 0;
    return {
      id: p.id, code: p.code, name: p.name, status: p.status, startDate: p.startDate ? dateToIso(p.startDate) : null, endDate: p.endDate ? dateToIso(p.endDate) : null,
      participants: pc.find((x) => x.projectId === p.id)?._count._all ?? 0, isMember: memberIds.includes(p.id),
      checklist: checklistProgress([...Array(d).fill({ isDone: true }), ...Array(n - d).fill({ isDone: false })]),
    };
  });

  // Aktivitas terbaru: audit proyek dalam lingkup (Direktur/Pemantau/Manajer: semua proyek; lainnya: proyek yang diikuti).
  const actWhere: Prisma.AuditLogWhereInput = mod.caps.viewAll ? { entityType: "TrainingProject" } : { entityType: "TrainingProject", entityId: { in: memberIds.length ? memberIds : ["00000000-0000-0000-0000-000000000000"] } };
  // Baris berisi data peserta disembunyikan bagi yang tak berhak (Magang); dokumen peserta hanya terlihat di proyek tempat pelaku mengelola peserta.
  const hidden = auditVisibilityWhere({
    viewParticipants: mod.caps.viewParticipants, manageAll: mod.caps.fullAccess,
    manageProjectIds: mod.caps.viewParticipants ? memberRows.filter((m) => INTERN_FORBIDDEN_PROJECT_ROLES.includes(m.role)).map((m) => m.projectId) : [],
  });
  const logs = (await prisma.auditLog.findMany({ where: hidden ? { AND: [actWhere, hidden] } : actWhere, orderBy: { id: "desc" }, take: 6, select: { id: true, createdAt: true, action: true, summary: true, entityId: true, actor: { select: { name: true } } } })).flatMap((l) => (l.entityId ? [{ ...l, entityId: l.entityId }] : []));
  const codes = logs.length ? await prisma.trainingProject.findMany({ where: { id: { in: [...new Set(logs.map((l) => l.entityId))] } }, select: { id: true, code: true } }) : [];
  const activity = logs.map((l) => ({ id: l.id.toString(), at: l.createdAt.toISOString(), actorName: l.actor?.name ?? null, summary: l.summary ?? l.action, action: l.action, projectId: l.entityId, projectCode: codes.find((c) => c.id === l.entityId)?.code ?? null }));

  // Kalender
  const byDate = new Map<string, number>();
  for (const s of sessions) byDate.set(s.date, (byDate.get(s.date) ?? 0) + 1);

  // Program perlu perhatian (Kuning/Merah) — dihitung dengan rumus indikator yang sama dengan halaman Pemantauan.
  let attention: number | null = null, red = 0;
  try {
    const { cards } = await listProgramCards(actor);
    const rated = cards.filter((c) => c.overall !== null);
    attention = rated.length ? rated.filter((c) => c.overall !== "GREEN").length : null;
    red = rated.filter((c) => c.overall === "RED").length;
  } catch { attention = null; }

  return {
    today: t, nowMs: Date.now(), scope: mod.caps.viewAll ? "all" : "mine",
    kpis: { activeProjects: activeProjectIds.length, participants, tasksOnTrackPct: tasksOpen ? Math.round((100 * (tasksOpen - tasksLate)) / tasksOpen) : null, openTasks: tasksOpen, attentionPrograms: attention, redPrograms: red },
    chart: { days, tasksDone, participantsAdded }, myProjects,
    calendar: { month: ym, today: t, days: [...byDate].map(([date, count]) => ({ date, count })) }, activity,
  };
}
