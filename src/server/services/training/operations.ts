import "server-only";
import { Prisma } from "@prisma/client";
import { prisma, transaction } from "../../db";
import { env } from "../../env";
import { Errors } from "../../errors";
import { parseInput } from "../../validate";
import { actorCan, type Actor } from "../../actor";
import { writeAudit, diffFields } from "../../audit";
import { dateToIso, isoToDate } from "../../json";
import { storeFile } from "../files";
import { addDays, localDate, localTime, startOfLocalDay, zonedInstant } from "@/lib/time";
import { SENSITIVE_DOC_CATEGORIES, type Confirmation, type DocCategory, type ExternalSystem, type InstructorKind, type ParticipantStatus, type ScheduleStatus } from "@/lib/training/types";
import { conflictMessage, intervalsOverlap, matchRoom } from "@/lib/training/misc";
import {
  assignmentLinkSchema, calendarQuerySchema, documentMetaSchema, externalRefSchema, instructorAssignSchema, instructorAssignUpdateSchema, instructorSchema,
  instructorUpdateSchema, participantListSchema, participantSchema, participantUpdateSchema, scheduleSchema, scheduleUpdateSchema,
} from "@/lib/validation/training";
import type { Paged } from "@/lib/types";
import { accessibleProjectWhere, assertEditable, assertEditableLocked, loadProjectAccess, requireAbility, requireGlobalCap, requireModule, type ModuleContext } from "./access";
import { assertUuid, auditProject, today } from "./shared";

// ═════════════════════════════ Jadwal ═════════════════════════════

export interface ConflictDto {
  /**
   * ROOM = ruangan DAN lokasi sama (bentrok pasti); ROOM_CHECK = nama ruangan sama tetapi lokasi belum cukup jelas (perlu diperiksa — bukan dianggap aman);
   * INSTRUCTOR = instruktur/asesor (orang) yang sama.
   */
  kind: "ROOM" | "ROOM_CHECK" | "INSTRUCTOR";
  /** Rincian hanya diberikan bila pelaku boleh melihat proyek lawan; bila tidak, hanya peringatan umum (lokasi lawan tidak dibuka). */
  visible: boolean;
  withProjectCode: string | null;
  withTitle: string | null;
  /** Hanya untuk ROOM_CHECK: lokasi kosong, atau berbeda tetapi mirip. */
  why: "NO_LOCATION" | "SIMILAR_LOCATION" | null;
}

export interface ScheduleDto {
  id: string; projectId: string; projectCode: string; projectName: string; title: string;
  date: string; startTime: string; endTime: string; startAt: string; endAt: string;
  location: string | null; room: string | null; inchargeId: string | null; inchargeName: string | null;
  projectInstructorId: string | null; instructorName: string | null; status: ScheduleStatus; note: string | null;
  conflicts: ConflictDto[];
}

const scheduleInclude = {
  project: { select: { code: true, name: true, status: true } },
  incharge: { select: { fullName: true } },
  projectInstructor: { select: { instructorId: true, instructor: { select: { name: true } } } },
} satisfies Prisma.TrainingScheduleInclude;
type ScheduleRow = Prisma.TrainingScheduleGetPayload<{ include: typeof scheduleInclude }>;

/**
 * Peringatan bentrok (bukan pemblokiran), lintas proyek, pada waktu yang beririsan:
 *   · RUANGAN menurut LOKASI + RUANGAN + waktu (`matchRoom`): "Ruang Jasmine" di dua hotel berbeda BUKAN bentrok; bila lokasi belum cukup jelas (kosong/mirip)
 *     hasilnya ROOM_CHECK ("perlu diperiksa"), tidak dianggap aman;
 *   · INSTRUKTUR menurut orang (satu entri direktori) + waktu.
 * Jadwal yang dibatalkan, dan jadwal milik proyek yang DIBATALKAN (ruangan/instrukturnya tidak jadi dipakai), tidak dihitung — baik sebagai pembanding maupun sebagai baris yang diperiksa.
 */
async function conflictsFor(actor: Actor, mod: ModuleContext, rows: ScheduleRow[]): Promise<Map<string, ConflictDto[]>> {
  const out = new Map<string, ConflictDto[]>();
  const live = rows.filter((r) => r.status !== "CANCELLED" && r.project.status !== "CANCELLED");
  for (const r of rows) out.set(r.id, []);
  if (live.length === 0) return out;
  const minStart = new Date(Math.min(...live.map((r) => r.startAt.getTime())));
  const maxEnd = new Date(Math.max(...live.map((r) => r.endAt.getTime())));
  const [others, mine] = await Promise.all([
    prisma.trainingSchedule.findMany({ where: { status: { not: "CANCELLED" }, project: { status: { not: "CANCELLED" } }, startAt: { lt: maxEnd }, endAt: { gt: minStart } }, include: scheduleInclude }),
    actor.employeeId ? prisma.trainingProjectMember.findMany({ where: { employeeId: actor.employeeId, endedAt: null }, select: { projectId: true } }) : Promise.resolve([]),
  ]);
  const visibleProjects = new Set(mine.map((m) => m.projectId));
  for (const a of live) {
    for (const b of others) {
      if (b.id === a.id || !intervalsOverlap(a.startAt, a.endAt, b.startAt, b.endAt)) continue;
      const room = matchRoom(a, b);
      const sameInstructor = !!a.projectInstructor && !!b.projectInstructor && a.projectInstructor.instructorId === b.projectInstructor.instructorId;
      const visible = mod.caps.viewAll || visibleProjects.has(b.projectId);
      const who = { visible, withProjectCode: visible ? b.project.code : null, withTitle: visible ? b.title : null };
      if (room.match === "SAME") out.get(a.id)!.push({ kind: "ROOM", ...who, why: null });
      else if (room.match === "CHECK") out.get(a.id)!.push({ kind: "ROOM_CHECK", ...who, why: room.why });
      if (sameInstructor) out.get(a.id)!.push({ kind: "INSTRUCTOR", ...who, why: null });
    }
  }
  return out;
}

async function toScheduleDtos(actor: Actor, mod: ModuleContext, rows: ScheduleRow[]): Promise<ScheduleDto[]> {
  const tz = env().APP_TIMEZONE;
  const conflicts = await conflictsFor(actor, mod, rows);
  return rows.map((r) => ({
    id: r.id, projectId: r.projectId, projectCode: r.project.code, projectName: r.project.name, title: r.title,
    date: localDate(r.startAt, tz), startTime: localTime(r.startAt, tz), endTime: localTime(r.endAt, tz), startAt: r.startAt.toISOString(), endAt: r.endAt.toISOString(),
    location: r.location, room: r.room, inchargeId: r.inchargeId, inchargeName: r.incharge?.fullName ?? null,
    projectInstructorId: r.projectInstructorId, instructorName: r.projectInstructor?.instructor.name ?? null, status: r.status, note: r.note,
    conflicts: conflicts.get(r.id) ?? [],
  }));
}

export async function listProjectSchedules(actor: Actor, projectId: string): Promise<ScheduleDto[]> {
  const access = await loadProjectAccess(actor, projectId);
  const rows = await prisma.trainingSchedule.findMany({ where: { projectId }, include: scheduleInclude, orderBy: { startAt: "asc" } });
  return toScheduleDtos(actor, access.module, rows);
}

/** Kalender lintas proyek (hanya proyek yang boleh dilihat pelaku), dalam rentang tanggal lokal (WIB), maksimal 93 hari. */
export async function listCalendar(actor: Actor, raw: unknown): Promise<ScheduleDto[]> {
  const mod = await requireModule(actor);
  const q = parseInput(calendarQuerySchema, raw);
  if (q.to < q.from) throw Errors.validation("Tanggal akhir tidak boleh sebelum tanggal awal.", { to: "Sebelum tanggal awal" });
  if (q.to > addDays(q.from, 93)) throw Errors.validation("Rentang kalender maksimal 93 hari.", { to: "Terlalu panjang" });
  const tz = env().APP_TIMEZONE;
  const rows = await prisma.trainingSchedule.findMany({
    where: { startAt: { gte: startOfLocalDay(q.from, tz), lt: startOfLocalDay(addDays(q.to, 1), tz) }, project: { AND: [accessibleProjectWhere(actor, mod), ...(q.projectId ? [{ id: q.projectId }] : [])] } },
    include: scheduleInclude, orderBy: { startAt: "asc" },
  });
  return toScheduleDtos(actor, mod, rows);
}

async function validateScheduleRefs(tx: Prisma.TransactionClient, projectId: string, inchargeId: string | null | undefined, projectInstructorId: string | null | undefined): Promise<void> {
  if (inchargeId && (await tx.trainingProjectMember.count({ where: { projectId, employeeId: inchargeId, endedAt: null } })) === 0) {
    throw Errors.validation("Penanggung jawab jadwal harus anggota aktif proyek.", { inchargeId: "Bukan anggota proyek" });
  }
  if (projectInstructorId && (await tx.trainingProjectInstructor.count({ where: { id: projectInstructorId, projectId } })) === 0) {
    throw Errors.validation("Instruktur / asesor tidak terdaftar pada proyek ini.", { projectInstructorId: "Tidak terdaftar pada proyek" });
  }
}

export interface ScheduleSaveResult { id: string; warnings: string[] }

async function scheduleWarnings(actor: Actor, mod: ModuleContext, id: string, project: { startDate: Date | null; endDate: Date | null }, date: string): Promise<string[]> {
  const row = await prisma.trainingSchedule.findUniqueOrThrow({ where: { id }, include: scheduleInclude });
  const [dto] = await toScheduleDtos(actor, mod, [row]);
  const w: string[] = [];
  for (const c of dto!.conflicts) w.push(conflictMessage(c));
  if (project.startDate && project.endDate && (date < dateToIso(project.startDate) || date > dateToIso(project.endDate))) w.push("Tanggal ini berada di luar periode proyek.");
  return w;
}

export async function createSchedule(actor: Actor, projectId: string, raw: unknown): Promise<ScheduleSaveResult> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "manage_schedule");
  assertEditable(access.project);
  const input = parseInput(scheduleSchema, raw);
  const tz = env().APP_TIMEZONE;
  const id = await transaction(async (tx) => {
    await assertEditableLocked(tx, projectId);   // kunci bersama proyek (langkah PERTAMA): status dibaca ulang segar — tidak lolos bila penutupan/pembatalan commit lebih dulu
    await validateScheduleRefs(tx, projectId, input.inchargeId, input.projectInstructorId);
    const s = await tx.trainingSchedule.create({
      data: {
        projectId, title: input.title, startAt: zonedInstant(input.date, input.startTime, tz), endAt: zonedInstant(input.date, input.endTime, tz), location: input.location, room: input.room,
        inchargeId: input.inchargeId, projectInstructorId: input.projectInstructorId, status: input.status, note: input.note, createdById: actor.userId,
      },
    });
    await auditProject(tx, actor, projectId, { action: "training.schedule.create", summary: `Jadwal "${s.title}" ${input.date} ${input.startTime}–${input.endTime} ditambahkan`, after: { scheduleId: s.id, date: input.date, startTime: input.startTime, endTime: input.endTime } });
    return s.id;
  });
  const p = await prisma.trainingProject.findUniqueOrThrow({ where: { id: projectId }, select: { startDate: true, endDate: true } });
  return { id, warnings: await scheduleWarnings(actor, access.module, id, p, input.date) };
}

export async function updateSchedule(actor: Actor, scheduleId: string, raw: unknown): Promise<ScheduleSaveResult> {
  assertUuid(scheduleId, "Jadwal");
  const cur = await prisma.trainingSchedule.findUnique({ where: { id: scheduleId } });
  if (!cur) throw Errors.notFound("Jadwal");
  const access = await loadProjectAccess(actor, cur.projectId);
  requireAbility(access, "manage_schedule");
  assertEditable(access.project);
  const input = parseInput(scheduleUpdateSchema, raw);
  const tz = env().APP_TIMEZONE;
  const date = input.date ?? localDate(cur.startAt, tz);
  const startTime = input.startTime ?? localTime(cur.startAt, tz);
  const endTime = input.endTime ?? localTime(cur.endAt, tz);
  if (endTime <= startTime) throw Errors.validation("Jam selesai harus setelah jam mulai (di hari yang sama).", { endTime: "Sebelum jam mulai" });
  await transaction(async (tx) => {
    await assertEditableLocked(tx, cur.projectId);   // kunci bersama proyek (langkah PERTAMA): status dibaca ulang segar — tidak lolos bila penutupan/pembatalan commit lebih dulu
    await validateScheduleRefs(tx, cur.projectId, input.inchargeId, input.projectInstructorId);
    const data: Prisma.TrainingScheduleUncheckedUpdateInput = { startAt: zonedInstant(date, startTime, tz), endAt: zonedInstant(date, endTime, tz) };
    for (const k of ["title", "location", "room", "inchargeId", "projectInstructorId", "status", "note"] as const) if (k in input) (data as Record<string, unknown>)[k] = input[k];
    const before = { title: cur.title, date: localDate(cur.startAt, tz), startTime: localTime(cur.startAt, tz), endTime: localTime(cur.endAt, tz), location: cur.location, room: cur.room, inchargeId: cur.inchargeId, projectInstructorId: cur.projectInstructorId, status: cur.status, note: cur.note };
    const after = { ...before, ...Object.fromEntries(Object.entries(input).filter(([k]) => k in before)), date, startTime, endTime };
    const d = diffFields(before, after);
    await tx.trainingSchedule.update({ where: { id: scheduleId }, data });
    if (d.changed.length) await auditProject(tx, actor, cur.projectId, { action: "training.schedule.update", summary: `Jadwal "${cur.title}" diubah (${d.changed.join(", ")})`, before: { scheduleId, ...d.before }, after: { scheduleId, ...d.after } });
  });
  const p = await prisma.trainingProject.findUniqueOrThrow({ where: { id: cur.projectId }, select: { startDate: true, endDate: true } });
  return { id: scheduleId, warnings: await scheduleWarnings(actor, access.module, scheduleId, p, date) };
}

// ═════════════════════════════ Peserta ═════════════════════════════

export interface ParticipantDto {
  id: string; projectId: string; projectCode: string; projectName: string; fullName: string; organization: string | null;
  /** Null bila pelaku tidak berwenang melihat kontak (bukan berarti kosong). */
  phone: string | null; email: string | null; contactVisible: boolean;
  status: ParticipantStatus; note: string | null; source: string; createdAt: string;
  /** Terkonfirmasi (dicatat manual); tanggalnya, bila ada. */
  confirmed: boolean; confirmedAt: string | null;
}

type PartRow = Prisma.TrainingParticipantGetPayload<{ include: { project: { select: { code: true; name: true } } } }>;

function toParticipantDto(r: PartRow, contactVisible: boolean): ParticipantDto {
  return {
    id: r.id, projectId: r.projectId, projectCode: r.project.code, projectName: r.project.name, fullName: r.fullName, organization: r.organization,
    phone: contactVisible ? r.phone : null, email: contactVisible ? r.email : null, contactVisible, status: r.status, note: r.note, source: r.source, createdAt: r.createdAt.toISOString(),
    confirmed: r.confirmedAt !== null, confirmedAt: r.confirmedAt ? dateToIso(r.confirmedAt) : null,
  };
}

export async function listProjectParticipants(actor: Actor, projectId: string): Promise<ParticipantDto[]> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "view_participants", "Akun Anda tidak berhak melihat daftar peserta.");
  const rows = await prisma.trainingParticipant.findMany({ where: { projectId }, include: { project: { select: { code: true, name: true } } }, orderBy: [{ fullName: "asc" }] });
  const visible = access.abilities.has("manage_participants");
  return rows.map((r) => toParticipantDto(r, visible));
}

/** Daftar peserta lintas proyek (menu "Peserta"): hanya proyek yang boleh dilihat; kontak hanya bila berwenang pada proyek itu. */
export async function listAllParticipants(actor: Actor, raw: unknown = {}): Promise<Paged<ParticipantDto>> {
  const mod = await requireModule(actor);
  if (!mod.caps.viewParticipants) throw Errors.forbidden("Akun Anda tidak berhak melihat daftar peserta.");
  const f = parseInput(participantListSchema, raw);
  const pageSize = f.pageSize ?? 25;
  const page = f.page ?? 1;
  const where: Prisma.TrainingParticipantWhereInput = {
    project: { AND: [accessibleProjectWhere(actor, mod), ...(f.projectId ? [{ id: f.projectId }] : [])] },
    ...(f.status ? { status: f.status } : {}),
    ...(f.q ? { OR: [{ fullName: { contains: f.q, mode: "insensitive" } }, { organization: { contains: f.q, mode: "insensitive" } }] } : {}),
  };
  const [total, rows, mine] = await Promise.all([
    prisma.trainingParticipant.count({ where }),
    prisma.trainingParticipant.findMany({ where, include: { project: { select: { code: true, name: true } } }, orderBy: [{ createdAt: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
    actor.employeeId ? prisma.trainingProjectMember.findMany({ where: { employeeId: actor.employeeId, endedAt: null, role: { in: ["PROJECT_MANAGER", "ADMIN_PROGRAM", "PARTICIPANT_OWNER"] } }, select: { projectId: true } }) : Promise.resolve([]),
  ]);
  const manageIn = new Set(mine.map((m) => m.projectId));
  const items = rows.map((r) => toParticipantDto(r, mod.caps.fullAccess || manageIn.has(r.projectId)));
  return { items, total, page, pageSize, pageCount: Math.max(Math.ceil(total / pageSize), 1) };
}

export async function addParticipant(actor: Actor, projectId: string, raw: unknown): Promise<{ id: string }> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "manage_participants");
  assertEditable(access.project);
  const input = parseInput(participantSchema, raw);
  return transaction(async (tx) => {
    await assertEditableLocked(tx, projectId);   // kunci bersama proyek (langkah PERTAMA): status dibaca ulang segar — tidak lolos bila penutupan/pembatalan commit lebih dulu
    const { confirmed, ...fields } = input;
    const p = await tx.trainingParticipant.create({ data: { projectId, ...fields, confirmedAt: confirmed ? isoToDate(today()) : null, source: "MANUAL", createdById: actor.userId } });
    // Audit tanpa kontak: hanya nama dan status.
    await auditProject(tx, actor, projectId, { action: "training.participant.add", summary: `Peserta "${p.fullName}" ditambahkan ke ${access.project.code}`, after: { participantId: p.id, status: p.status, confirmed: p.confirmedAt !== null } });
    return { id: p.id };
  });
}

export async function updateParticipant(actor: Actor, participantId: string, raw: unknown): Promise<void> {
  assertUuid(participantId, "Peserta");
  const cur = await prisma.trainingParticipant.findUnique({ where: { id: participantId } });
  if (!cur) throw Errors.notFound("Peserta");
  const access = await loadProjectAccess(actor, cur.projectId);
  requireAbility(access, "manage_participants");
  assertEditable(access.project);
  const input = parseInput(participantUpdateSchema, raw);
  const { confirmed, ...fields } = input;
  const confirmedAt = confirmed === undefined ? undefined : confirmed ? cur.confirmedAt ?? isoToDate(today()) : null;
  await transaction(async (tx) => {
    await assertEditableLocked(tx, cur.projectId);   // kunci bersama proyek (langkah PERTAMA): status dibaca ulang segar — tidak lolos bila penutupan/pembatalan commit lebih dulu
    await tx.trainingParticipant.update({ where: { id: participantId }, data: { ...fields, ...(confirmedAt !== undefined ? { confirmedAt } : {}) } });
    if (confirmed !== undefined && (cur.confirmedAt !== null) !== confirmed) {
      await auditProject(tx, actor, cur.projectId, { action: "training.participant.confirm", summary: `Peserta "${cur.fullName}" ${confirmed ? "dikonfirmasi" : "dibatalkan konfirmasinya"}`, before: { participantId, confirmed: cur.confirmedAt !== null }, after: { participantId, confirmed } });
    }
    if (input.status && input.status !== cur.status) {
      await auditProject(tx, actor, cur.projectId, { action: "training.participant.status", summary: `Status peserta "${cur.fullName}": ${cur.status} → ${input.status}`, before: { participantId, status: cur.status }, after: { participantId, status: input.status } });
    } else {
      await auditProject(tx, actor, cur.projectId, { action: "training.participant.update", summary: `Data peserta "${cur.fullName}" diperbarui`, after: { participantId, fields: Object.keys(input) } });
    }
  });
}

// ═════════════════════════════ Instruktur / asesor ═════════════════════════════

export interface InstructorDto {
  id: string; name: string; kind: InstructorKind; employeeId: string | null; organization: string | null; expertise: string | null;
  phone: string | null; email: string | null; contactVisible: boolean; isActive: boolean; assignmentCount: number;
}

export async function listInstructors(actor: Actor, opts: { q?: string; includeInactive?: boolean } = {}): Promise<InstructorDto[]> {
  const mod = await requireModule(actor);
  const rows = await prisma.trainingInstructor.findMany({
    where: { ...(opts.includeInactive ? {} : { isActive: true }), ...(opts.q ? { name: { contains: opts.q, mode: "insensitive" } } : {}) },
    orderBy: [{ isActive: "desc" }, { name: "asc" }], include: { _count: { select: { assignments: true } } },
  });
  const visible = mod.caps.viewDirectoryContacts;
  return rows.map((r) => ({
    id: r.id, name: r.name, kind: r.kind, employeeId: r.employeeId, organization: r.organization, expertise: r.expertise,
    phone: visible ? r.phone : null, email: visible ? r.email : null, contactVisible: visible, isActive: r.isActive, assignmentCount: r._count.assignments,
  }));
}

async function assertInstructorEmployee(employeeId: string | null | undefined): Promise<void> {
  if (!employeeId) return;
  const e = await prisma.employee.findUnique({ where: { id: employeeId }, select: { isActive: true } });
  if (!e || !e.isActive) throw Errors.validation("Karyawan tidak ditemukan atau sudah nonaktif.", { employeeId: "Karyawan tidak valid" });
}

export async function createInstructor(actor: Actor, raw: unknown): Promise<{ id: string }> {
  await requireGlobalCap(actor, "manageDirectory");
  const input = parseInput(instructorSchema, raw);
  await assertInstructorEmployee(input.employeeId);
  return transaction(async (tx) => {
    try {
      const i = await tx.trainingInstructor.create({ data: { ...input, createdById: actor.userId } });
      await writeAudit(tx, actor, { action: "training.instructor.create", entityType: "TrainingInstructor", entityId: i.id, summary: `${i.name} ditambahkan ke direktori instruktur/asesor`, after: { kind: i.kind, internal: !!i.employeeId } });
      return { id: i.id };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw Errors.conflict("Karyawan ini sudah ada di direktori instruktur/asesor.");
      throw e;
    }
  });
}

export async function updateInstructor(actor: Actor, id: string, raw: unknown): Promise<void> {
  await requireGlobalCap(actor, "manageDirectory");
  assertUuid(id, "Instruktur");
  const input = parseInput(instructorUpdateSchema, raw);
  await assertInstructorEmployee(input.employeeId);
  await transaction(async (tx) => {
    const cur = await tx.trainingInstructor.findUnique({ where: { id } });
    if (!cur) throw Errors.notFound("Instruktur");
    try {
      await tx.trainingInstructor.update({ where: { id }, data: input });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw Errors.conflict("Karyawan ini sudah ada di direktori instruktur/asesor.");
      throw e;
    }
    // Audit tanpa kontak (telepon/email tidak dicatat).
    await writeAudit(tx, actor, { action: "training.instructor.update", entityType: "TrainingInstructor", entityId: id, summary: `Data ${cur.name} di direktori diperbarui`, after: { fields: Object.keys(input).filter((k) => k !== "phone" && k !== "email") } });
  });
}

export interface ProjectInstructorDto {
  id: string; projectId: string; instructorId: string; name: string; kind: InstructorKind; confirmation: Confirmation; note: string | null;
  phone: string | null; email: string | null; contactVisible: boolean; scheduleCount: number;
}

export async function listProjectInstructors(actor: Actor, projectId: string): Promise<ProjectInstructorDto[]> {
  const access = await loadProjectAccess(actor, projectId);
  const rows = await prisma.trainingProjectInstructor.findMany({ where: { projectId }, orderBy: { createdAt: "asc" }, include: { instructor: true, _count: { select: { schedules: true } } } });
  const visible = access.abilities.has("manage_instructors");
  return rows.map((r) => ({
    id: r.id, projectId: r.projectId, instructorId: r.instructorId, name: r.instructor.name, kind: r.kind, confirmation: r.confirmation, note: r.note,
    phone: visible ? r.instructor.phone : null, email: visible ? r.instructor.email : null, contactVisible: visible, scheduleCount: r._count.schedules,
  }));
}

export async function assignInstructor(actor: Actor, projectId: string, raw: unknown): Promise<{ id: string }> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "manage_instructors");
  assertEditable(access.project);
  const input = parseInput(instructorAssignSchema, raw);
  return transaction(async (tx) => {
    await assertEditableLocked(tx, projectId);   // kunci bersama proyek (langkah PERTAMA): status dibaca ulang segar — tidak lolos bila penutupan/pembatalan commit lebih dulu
    const ins = await tx.trainingInstructor.findUnique({ where: { id: input.instructorId }, select: { name: true, isActive: true } });
    if (!ins || !ins.isActive) throw Errors.validation("Instruktur / asesor tidak ditemukan atau nonaktif.", { instructorId: "Tidak valid" });
    try {
      const a = await tx.trainingProjectInstructor.create({ data: { projectId, ...input, createdById: actor.userId } });
      await auditProject(tx, actor, projectId, { action: "training.instructor.assign", summary: `${ins.name} ditugaskan pada ${access.project.code} (${input.kind})`, after: { assignmentId: a.id, kind: a.kind, confirmation: a.confirmation } });
      return { id: a.id };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw Errors.conflict(`${ins.name} sudah terdaftar pada proyek ini.`);
      throw e;
    }
  });
}

export async function updateProjectInstructor(actor: Actor, projectId: string, assignmentId: string, raw: unknown): Promise<void> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "manage_instructors");
  assertEditable(access.project);
  assertUuid(assignmentId, "Penugasan");
  const input = parseInput(instructorAssignUpdateSchema, raw);
  await transaction(async (tx) => {
    await assertEditableLocked(tx, projectId);   // kunci bersama proyek (langkah PERTAMA): status dibaca ulang segar — tidak lolos bila penutupan/pembatalan commit lebih dulu
    const cur = await tx.trainingProjectInstructor.findFirst({ where: { id: assignmentId, projectId }, include: { instructor: { select: { name: true } } } });
    if (!cur) throw Errors.notFound("Penugasan");
    await tx.trainingProjectInstructor.update({ where: { id: assignmentId }, data: input });
    await auditProject(tx, actor, projectId, { action: "training.instructor.update", summary: `Penugasan ${cur.instructor.name} diubah${input.confirmation ? ` (konfirmasi: ${cur.confirmation} → ${input.confirmation})` : ""}`, before: { assignmentId, kind: cur.kind, confirmation: cur.confirmation }, after: { assignmentId, ...input } });
  });
}

export async function removeProjectInstructor(actor: Actor, projectId: string, assignmentId: string): Promise<void> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "manage_instructors");
  assertEditable(access.project);
  assertUuid(assignmentId, "Penugasan");
  await transaction(async (tx) => {
    await assertEditableLocked(tx, projectId);   // kunci bersama proyek (langkah PERTAMA): status dibaca ulang segar — tidak lolos bila penutupan/pembatalan commit lebih dulu
    const cur = await tx.trainingProjectInstructor.findFirst({ where: { id: assignmentId, projectId }, include: { instructor: { select: { name: true } }, _count: { select: { schedules: true } } } });
    if (!cur) throw Errors.notFound("Penugasan");
    if (cur._count.schedules > 0) throw Errors.conflict(`${cur.instructor.name} masih dipakai pada ${cur._count.schedules} jadwal. Ganti atau batalkan jadwalnya dulu.`);
    await tx.trainingProjectInstructor.delete({ where: { id: assignmentId } });
    await auditProject(tx, actor, projectId, { action: "training.instructor.remove", summary: `${cur.instructor.name} dilepas dari ${access.project.code}`, before: { assignmentId, kind: cur.kind } });
  });
}

// ═════════════════════════════ Dokumen proyek ═════════════════════════════

export interface DocumentDto {
  id: string; projectId: string; category: DocCategory; title: string; note: string | null; fileId: string; fileName: string; mimeType: string; size: number;
  uploadedByName: string | null; createdAt: string; canDelete: boolean;
}

export async function listDocuments(actor: Actor, projectId: string): Promise<{ items: DocumentDto[]; hiddenSensitive: number }> {
  const access = await loadProjectAccess(actor, projectId);
  const sensitiveOk = access.abilities.has("manage_participants");
  const rows = await prisma.trainingProjectDocument.findMany({ where: { projectId, deletedAt: null }, orderBy: { createdAt: "desc" }, include: { file: { select: { originalName: true, mimeType: true, size: true } } } });
  const visible = rows.filter((r) => sensitiveOk || !SENSITIVE_DOC_CATEGORIES.includes(r.category));
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(visible.map((r) => r.uploadedById))] } }, select: { id: true, name: true } });
  const n = new Map(users.map((u) => [u.id, u.name]));
  const canDeleteAny = access.abilities.has("delete_document");
  return {
    hiddenSensitive: rows.length - visible.length,
    items: visible.map((r) => ({
      id: r.id, projectId: r.projectId, category: r.category, title: r.title, note: r.note, fileId: r.fileId, fileName: r.file.originalName, mimeType: r.file.mimeType, size: r.file.size,
      uploadedByName: n.get(r.uploadedById) ?? null, createdAt: r.createdAt.toISOString(), canDelete: canDeleteAny || r.uploadedById === actor.userId,
    })),
  };
}

/** Semua dokumen dari proyek yang boleh dilihat pelaku (menu "Dokumen Proyek"), tanpa kategori sensitif kecuali berwenang. */
export async function listAllDocuments(actor: Actor): Promise<(DocumentDto & { projectCode: string; projectName: string })[]> {
  const mod = await requireModule(actor);
  const rows = await prisma.trainingProjectDocument.findMany({
    where: { deletedAt: null, project: accessibleProjectWhere(actor, mod) }, orderBy: { createdAt: "desc" }, take: 200,
    include: { file: { select: { originalName: true, mimeType: true, size: true } }, project: { select: { code: true, name: true } } },
  });
  const mine = actor.employeeId ? await prisma.trainingProjectMember.findMany({ where: { employeeId: actor.employeeId, endedAt: null, role: { in: ["PROJECT_MANAGER", "ADMIN_PROGRAM", "PARTICIPANT_OWNER"] } }, select: { projectId: true } }) : [];
  const manageIn = new Set(mine.map((m) => m.projectId));
  const visible = rows.filter((r) => !SENSITIVE_DOC_CATEGORIES.includes(r.category) || mod.caps.fullAccess || manageIn.has(r.projectId));
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(visible.map((r) => r.uploadedById))] } }, select: { id: true, name: true } });
  const n = new Map(users.map((u) => [u.id, u.name]));
  return visible.map((r) => ({
    id: r.id, projectId: r.projectId, projectCode: r.project.code, projectName: r.project.name, category: r.category, title: r.title, note: r.note, fileId: r.fileId,
    fileName: r.file.originalName, mimeType: r.file.mimeType, size: r.file.size, uploadedByName: n.get(r.uploadedById) ?? null, createdAt: r.createdAt.toISOString(), canDelete: false,
  }));
}

/** Pemeriksaan awal SEBELUM badan unggahan dibaca ke memori (menolak lebih dini). `uploadDocument` tetap memeriksa ulang. */
export async function assertCanUploadDocument(actor: Actor, projectId: string): Promise<void> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "upload_document");
  assertEditable(access.project);
}

export async function uploadDocument(actor: Actor, projectId: string, file: { name: string; bytes: Uint8Array }, fields: Record<string, string>): Promise<{ id: string }> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "upload_document");
  assertEditable(access.project);
  const meta = parseInput(documentMetaSchema, fields);
  if (SENSITIVE_DOC_CATEGORIES.includes(meta.category)) requireAbility(access, "manage_participants", "Dokumen peserta hanya dapat diunggah oleh pengelola peserta proyek.");
  return transaction(async (tx) => {
    await assertEditableLocked(tx, projectId);   // kunci bersama proyek (langkah PERTAMA): status dibaca ulang segar — tidak lolos bila penutupan/pembatalan commit lebih dulu
    // Tipe berkas diverifikasi dari magic bytes & ukuran dibatasi oleh storeFile (PDF/PNG/JPEG, MAX_DOCUMENT_UPLOAD_MB).
    const stored = await storeFile(actor, "TRAINING_DOCUMENT", file, tx);
    const d = await tx.trainingProjectDocument.create({ data: { projectId, category: meta.category, title: meta.title, note: meta.note, fileId: stored.id, uploadedById: actor.userId } });
    // Hanya metadata yang dicatat — bukan isi dokumen.
    await auditProject(tx, actor, projectId, { action: "training.document.upload", summary: `Dokumen "${meta.title}" (${meta.category}) diunggah ke ${access.project.code}`, after: { documentId: d.id, category: meta.category, size: stored.size, mimeType: stored.mimeType } });
    return { id: d.id };
  });
}

/** "Hapus" = sembunyikan & cabut akses. Baris dan berkas tetap tersimpan sebagai jejak (trigger melarang penghapusan permanen). */
export async function deleteDocument(actor: Actor, documentId: string): Promise<void> {
  assertUuid(documentId, "Dokumen");
  const doc = await prisma.trainingProjectDocument.findUnique({ where: { id: documentId } });
  if (!doc || doc.deletedAt) throw Errors.notFound("Dokumen");
  const access = await loadProjectAccess(actor, doc.projectId);
  assertEditable(access.project);
  if (SENSITIVE_DOC_CATEGORIES.includes(doc.category)) requireAbility(access, "manage_participants");
  if (!access.abilities.has("delete_document") && doc.uploadedById !== actor.userId) throw Errors.forbidden("Hanya pengunggah atau pengelola proyek yang dapat menghapus dokumen.");
  await transaction(async (tx) => {
    await assertEditableLocked(tx, doc.projectId);   // kunci bersama proyek (langkah PERTAMA): status dibaca ulang segar — tidak lolos bila penutupan/pembatalan commit lebih dulu
    const r = await tx.trainingProjectDocument.updateMany({ where: { id: documentId, deletedAt: null }, data: { deletedAt: new Date(), deletedById: actor.userId } });
    if (r.count === 0) throw Errors.conflict("Dokumen sudah dihapus.");
    await auditProject(tx, actor, doc.projectId, { action: "training.document.delete", summary: `Dokumen "${doc.title}" dihapus dari ${access.project.code}`, before: { documentId, category: doc.category } });
  });
}

// ═════════════════════════════ Referensi (surat tugas & sistem lain) ═════════════════════════════

export interface AssignmentLinkDto { id: string; letterId: string; number: string; purpose: string; destination: string; startDate: string; endDate: string; status: string }

/**
 * Surat tugas yang ditautkan ke proyek. HANYA referensi: nomor, tujuan, tanggal, status. Nominal uang harian dan daftar
 * penerima TIDAK ditampilkan di sini (tetap di HRIS dan hanya untuk yang berizin HRIS).
 */
export async function listAssignmentLinks(actor: Actor, projectId: string): Promise<AssignmentLinkDto[]> {
  await loadProjectAccess(actor, projectId);
  const rows = await prisma.trainingProjectAssignmentLink.findMany({ where: { projectId }, orderBy: { createdAt: "asc" }, include: { letter: { select: { number: true, purpose: true, destination: true, startDate: true, endDate: true, status: true } } } });
  return rows.map((r) => ({ id: r.id, letterId: r.letterId, number: r.letter.number, purpose: r.letter.purpose, destination: r.letter.destination, startDate: dateToIso(r.letter.startDate), endDate: dateToIso(r.letter.endDate), status: r.letter.status }));
}

export interface AssignmentOptionDto { id: string; number: string; purpose: string; destination: string; startDate: string; endDate: string; status: string }

/** Pencarian surat tugas untuk ditautkan — membutuhkan izin HRIS `assignment:view_all` (izin modul ini tidak cukup). */
export async function searchAssignmentLetters(actor: Actor, q?: string): Promise<AssignmentOptionDto[]> {
  await requireModule(actor);
  if (!actorCan(actor, "assignment:view_all")) throw Errors.forbidden("Menautkan surat tugas memerlukan izin HRIS untuk melihat Surat Tugas.");
  const term = (q ?? "").trim().slice(0, 100);
  const rows = await prisma.assignmentLetter.findMany({
    where: term ? { OR: [{ number: { contains: term, mode: "insensitive" } }, { purpose: { contains: term, mode: "insensitive" } }, { destination: { contains: term, mode: "insensitive" } }] } : {},
    orderBy: [{ issueDate: "desc" }, { seqNo: "desc" }], take: 20, select: { id: true, number: true, purpose: true, destination: true, startDate: true, endDate: true, status: true },
  });
  return rows.map((r) => ({ id: r.id, number: r.number, purpose: r.purpose, destination: r.destination, startDate: dateToIso(r.startDate), endDate: dateToIso(r.endDate), status: r.status }));
}

// Referensi boleh ditambahkan pada proyek yang sudah ditutup (mis. nomor invoice terbit setelah pelatihan selesai); tidak memakai assertEditable.
export async function linkAssignment(actor: Actor, projectId: string, raw: unknown): Promise<void> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "link_references");
  if (!actorCan(actor, "assignment:view_all")) throw Errors.forbidden("Menautkan surat tugas memerlukan izin HRIS untuk melihat Surat Tugas.");
  const { letterId } = parseInput(assignmentLinkSchema, raw);
  await transaction(async (tx) => {
    const letter = await tx.assignmentLetter.findUnique({ where: { id: letterId }, select: { number: true } });
    if (!letter) throw Errors.notFound("Surat tugas");
    try {
      await tx.trainingProjectAssignmentLink.create({ data: { projectId, letterId, linkedById: actor.userId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw Errors.conflict("Surat tugas ini sudah ditautkan ke proyek.");
      throw e;
    }
    await auditProject(tx, actor, projectId, { action: "training.assignment.link", summary: `Surat tugas ${letter.number} ditautkan ke ${access.project.code} (referensi saja)`, after: { letterId } });
  });
}

export async function unlinkAssignment(actor: Actor, projectId: string, linkId: string): Promise<void> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "link_references");
  assertUuid(linkId, "Tautan");
  await transaction(async (tx) => {
    const l = await tx.trainingProjectAssignmentLink.findFirst({ where: { id: linkId, projectId }, include: { letter: { select: { number: true } } } });
    if (!l) throw Errors.notFound("Tautan");
    await tx.trainingProjectAssignmentLink.delete({ where: { id: linkId } });
    await auditProject(tx, actor, projectId, { action: "training.assignment.unlink", summary: `Tautan surat tugas ${l.letter.number} dilepas dari ${access.project.code}`, before: { letterId: l.letterId } });
  });
}

export interface ExternalRefDto { id: string; system: ExternalSystem; externalId: string; label: string | null; createdAt: string }

export async function listExternalRefs(actor: Actor, projectId: string): Promise<ExternalRefDto[]> {
  await loadProjectAccess(actor, projectId);
  const rows = await prisma.trainingExternalRef.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ id: r.id, system: r.system, externalId: r.externalId, label: r.label, createdAt: r.createdAt.toISOString() }));
}

/** Referensi MANUAL ke sistem lain (bukan integrasi, tidak ada sinkronisasi). Unik per (proyek, sistem, ID). */
export async function addExternalRef(actor: Actor, projectId: string, raw: unknown): Promise<void> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "link_references");
  const input = parseInput(externalRefSchema, raw);
  await transaction(async (tx) => {
    try {
      await tx.trainingExternalRef.create({ data: { projectId, ...input, createdById: actor.userId } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw Errors.conflict("Referensi dengan sistem dan ID yang sama sudah tercatat pada proyek ini.");
      throw e;
    }
    await auditProject(tx, actor, projectId, { action: "training.reference.add", summary: `Referensi ${input.system} "${input.externalId}" dicatat pada ${access.project.code} (manual, tidak tersinkron)`, after: { system: input.system, externalId: input.externalId } });
  });
}

export async function removeExternalRef(actor: Actor, projectId: string, refId: string): Promise<void> {
  const access = await loadProjectAccess(actor, projectId);
  requireAbility(access, "link_references");
  assertUuid(refId, "Referensi");
  await transaction(async (tx) => {
    const r = await tx.trainingExternalRef.findFirst({ where: { id: refId, projectId } });
    if (!r) throw Errors.notFound("Referensi");
    await tx.trainingExternalRef.delete({ where: { id: refId } });
    await auditProject(tx, actor, projectId, { action: "training.reference.remove", summary: `Referensi ${r.system} "${r.externalId}" dihapus dari ${access.project.code}`, before: { system: r.system, externalId: r.externalId } });
  });
}
