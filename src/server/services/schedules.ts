import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, transaction } from "../db";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import { assertCan, type Actor } from "../actor";
import { writeAudit } from "../audit";
import { env } from "../env";
import { dateToIso, isoToDate } from "../json";
import { hhmm, isoDate, optionalText, requiredText, uuid } from "@/lib/validation/common";
import { rangesOverlap, timeToMinutes, todayIso } from "@/lib/time";
import type { ScheduleLite } from "@/lib/attendance";
import { CALENDAR_KIND_LABEL } from "@/lib/labels";

// ─────────────────────────── Jadwal kerja ───────────────────────────

export const scheduleSchema = z.object({
  name: requiredText(2, 80, "Nama jadwal"),
  description: optionalText(300, "Keterangan"),
  workDays: z.array(z.number().int().min(1).max(7)).min(1, "Pilih minimal satu hari kerja").transform((a) => [...new Set(a)].sort((x, y) => x - y)),
  startTime: hhmm,
  endTime: hhmm,
  lateToleranceMinutes: z.number({ error: "Toleransi harus berupa angka" }).int().min(0, "Toleransi minimal 0").max(240, "Toleransi maksimal 240 menit"),
  absentCutoffTime: hhmm,
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).superRefine((v, ctx) => {
  if (v.endTime <= v.startTime) ctx.addIssue({ code: "custom", path: ["endTime"], message: "Jam pulang harus setelah jam masuk" });
  if (v.absentCutoffTime <= v.startTime) ctx.addIssue({ code: "custom", path: ["absentCutoffTime"], message: "Batas tidak hadir harus setelah jam masuk" });
  if (timeToMinutes(v.absentCutoffTime) < timeToMinutes(v.startTime) + v.lateToleranceMinutes) {
    ctx.addIssue({ code: "custom", path: ["absentCutoffTime"], message: "Batas tidak hadir tidak boleh lebih awal dari batas toleransi keterlambatan" });
  }
});

export interface ScheduleDto extends ScheduleLite {
  description: string | null;
  isDefault: boolean;
  isActive: boolean;
}

const toLite = (s: Prisma.WorkScheduleGetPayload<object>): ScheduleDto => ({
  id: s.id, name: s.name, description: s.description, workDays: s.workDays, startTime: s.startTime, endTime: s.endTime,
  lateToleranceMinutes: s.lateToleranceMinutes, absentCutoffTime: s.absentCutoffTime, isDefault: s.isDefault, isActive: s.isActive,
});

export async function listSchedules(actor: Actor): Promise<ScheduleDto[]> {
  assertCan(actor, "schedule:manage");
  const rows = await prisma.workSchedule.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  return rows.map(toLite);
}

async function assertScheduleName(tx: Prisma.TransactionClient, name: string, exceptId?: string) {
  const dup = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM work_schedules WHERE lower(name) = lower(${name}) LIMIT 2`;
  if (dup.some((d) => d.id !== exceptId)) throw Errors.validation("Nama jadwal sudah dipakai.", { name: "Nama jadwal sudah dipakai" });
}

export async function createSchedule(actor: Actor, raw: unknown): Promise<ScheduleDto> {
  assertCan(actor, "schedule:manage");
  const input = parseInput(scheduleSchema, raw);
  return transaction(async (tx) => {
    await assertScheduleName(tx, input.name);
    const hasDefault = (await tx.workSchedule.count({ where: { isDefault: true } })) > 0;
    const makeDefault = input.isDefault === true || !hasDefault;
    if (makeDefault) await tx.workSchedule.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    const s = await tx.workSchedule.create({
      data: {
        name: input.name, description: input.description, workDays: input.workDays, startTime: input.startTime, endTime: input.endTime,
        lateToleranceMinutes: input.lateToleranceMinutes, absentCutoffTime: input.absentCutoffTime, isDefault: makeDefault, isActive: true,
      },
    });
    await writeAudit(tx, actor, { action: "schedule.create", entityType: "WorkSchedule", entityId: s.id, summary: `Jadwal "${s.name}" dibuat`, after: toLite(s) });
    return toLite(s);
  });
}

export async function updateSchedule(actor: Actor, id: string, raw: unknown): Promise<ScheduleDto> {
  assertCan(actor, "schedule:manage");
  const input = parseInput(scheduleSchema, raw);
  return transaction(async (tx) => {
    const before = await tx.workSchedule.findUnique({ where: { id } });
    if (!before) throw Errors.notFound("Jadwal");
    await assertScheduleName(tx, input.name, id);
    if (before.isDefault && input.isDefault === false) throw Errors.validation("Jadwal default tidak dapat dilepas; jadikan jadwal lain sebagai default.");
    if (before.isDefault && input.isActive === false) throw Errors.validation("Jadwal default tidak dapat dinonaktifkan.");
    if (input.isActive === false) {
      const used = await tx.scheduleAssignment.count({ where: { scheduleId: id, OR: [{ endDate: null }, { endDate: { gte: isoToDate(todayIso(env().APP_TIMEZONE)) } }] } });
      if (used > 0) throw Errors.conflict("Jadwal masih dipakai penugasan yang berlaku. Hapus/akhiri penugasan terlebih dulu.");
    }
    if (input.isDefault === true && !before.isDefault) await tx.workSchedule.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    const s = await tx.workSchedule.update({
      where: { id },
      data: {
        name: input.name, description: input.description, workDays: input.workDays, startTime: input.startTime, endTime: input.endTime,
        lateToleranceMinutes: input.lateToleranceMinutes, absentCutoffTime: input.absentCutoffTime,
        ...(input.isDefault === true ? { isDefault: true } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await writeAudit(tx, actor, { action: "schedule.update", entityType: "WorkSchedule", entityId: id, summary: `Jadwal "${s.name}" diperbarui`, before: toLite(before), after: toLite(s) });
    return toLite(s);
  });
}

// ─────────────────────────── Penugasan jadwal ───────────────────────────

export const assignmentSchema = z.object({
  scheduleId: uuid,
  scope: z.enum(["ALL", "DIVISION", "EMPLOYEE"]),
  divisionId: uuid.nullable().optional(),
  employeeId: uuid.nullable().optional(),
  startDate: isoDate,
  endDate: isoDate.nullable().optional(),
  note: optionalText(200, "Catatan"),
}).superRefine((v, ctx) => {
  if (v.scope === "DIVISION" && !v.divisionId) ctx.addIssue({ code: "custom", path: ["divisionId"], message: "Pilih divisi" });
  if (v.scope === "EMPLOYEE" && !v.employeeId) ctx.addIssue({ code: "custom", path: ["employeeId"], message: "Pilih karyawan" });
  if (v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "Tanggal selesai tidak boleh sebelum tanggal mulai" });
});

export interface AssignmentDto {
  id: string;
  scheduleId: string;
  scheduleName: string;
  scope: "ALL" | "DIVISION" | "EMPLOYEE";
  targetName: string | null;
  divisionId: string | null;
  employeeId: string | null;
  startDate: string;
  endDate: string | null;
  note: string | null;
}

export async function listAssignments(actor: Actor): Promise<AssignmentDto[]> {
  assertCan(actor, "schedule:manage");
  const rows = await prisma.scheduleAssignment.findMany({
    include: { schedule: { select: { name: true } }, division: { select: { name: true } }, employee: { select: { fullName: true, employeeNo: true } } },
    orderBy: [{ startDate: "desc" }],
  });
  return rows.map((a) => ({
    id: a.id, scheduleId: a.scheduleId, scheduleName: a.schedule.name, scope: a.scope,
    targetName: a.scope === "ALL" ? "Seluruh karyawan" : a.scope === "DIVISION" ? a.division?.name ?? null : a.employee ? `${a.employee.fullName} (${a.employee.employeeNo})` : null,
    divisionId: a.divisionId, employeeId: a.employeeId, startDate: dateToIso(a.startDate), endDate: a.endDate ? dateToIso(a.endDate) : null, note: a.note,
  }));
}

/**
 * Penugasan pada target & level yang sama tidak boleh beririsan tanggal — agar jadwal yang berlaku selalu tak ambigu.
 * (Untuk jadwal sementara seperti Ramadan, gunakan penugasan berperiode pada level yang sama dengan tanggal terpisah dari
 * penugasan dasar, atau pasang penugasan dasar berakhir sebelum periode khusus.)
 */
export async function createAssignment(actor: Actor, raw: unknown): Promise<void> {
  assertCan(actor, "schedule:manage");
  const input = parseInput(assignmentSchema, raw);
  await transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('schedule_assignments'))`;
    const schedule = await tx.workSchedule.findUnique({ where: { id: input.scheduleId } });
    if (!schedule || !schedule.isActive) throw Errors.validation("Jadwal tidak ditemukan atau nonaktif.", { scheduleId: "Jadwal tidak valid" });
    if (input.scope === "DIVISION" && !(await tx.division.findUnique({ where: { id: input.divisionId! } }))) throw Errors.validation("Divisi tidak ditemukan.", { divisionId: "Divisi tidak ditemukan" });
    if (input.scope === "EMPLOYEE" && !(await tx.employee.findUnique({ where: { id: input.employeeId! } }))) throw Errors.validation("Karyawan tidak ditemukan.", { employeeId: "Karyawan tidak ditemukan" });

    const sameTarget = await tx.scheduleAssignment.findMany({
      where: {
        scope: input.scope,
        ...(input.scope === "DIVISION" ? { divisionId: input.divisionId } : {}),
        ...(input.scope === "EMPLOYEE" ? { employeeId: input.employeeId } : {}),
      },
    });
    const clash = sameTarget.find((a) => rangesOverlap(dateToIso(a.startDate), a.endDate ? dateToIso(a.endDate) : null, input.startDate, input.endDate ?? null));
    if (clash) {
      throw Errors.conflict(`Rentang tanggal bertabrakan dengan penugasan lain pada target yang sama (${dateToIso(clash.startDate)} s.d. ${clash.endDate ? dateToIso(clash.endDate) : "seterusnya"}). Akhiri atau ubah penugasan itu terlebih dulu.`);
    }
    const a = await tx.scheduleAssignment.create({
      data: {
        scheduleId: input.scheduleId, scope: input.scope,
        divisionId: input.scope === "DIVISION" ? input.divisionId : null, employeeId: input.scope === "EMPLOYEE" ? input.employeeId : null,
        startDate: isoToDate(input.startDate), endDate: input.endDate ? isoToDate(input.endDate) : null, note: input.note, createdById: actor.userId,
      },
    });
    await writeAudit(tx, actor, {
      action: "schedule.assign", entityType: "ScheduleAssignment", entityId: a.id,
      summary: `Jadwal "${schedule.name}" ditugaskan (${input.scope}) mulai ${input.startDate}${input.endDate ? ` s.d. ${input.endDate}` : ""}`, after: input,
    });
  });
}

export async function deleteAssignment(actor: Actor, id: string): Promise<void> {
  assertCan(actor, "schedule:manage");
  await transaction(async (tx) => {
    const a = await tx.scheduleAssignment.findUnique({ where: { id }, include: { schedule: { select: { name: true } } } });
    if (!a) throw Errors.notFound("Penugasan");
    await tx.scheduleAssignment.delete({ where: { id } });
    await writeAudit(tx, actor, {
      action: "schedule.unassign", entityType: "ScheduleAssignment", entityId: id,
      summary: `Penugasan jadwal "${a.schedule.name}" (${a.scope}) dihapus`, before: { startDate: dateToIso(a.startDate), endDate: a.endDate ? dateToIso(a.endDate) : null },
    });
  });
}

// ─────────────────────────── Kalender: hari libur & hari kerja khusus ───────────────────────────

export const calendarSchema = z.object({
  date: isoDate,
  kind: z.enum(["HOLIDAY", "SPECIAL_WORKDAY"]),
  name: requiredText(2, 120, "Nama"),
});

export interface CalendarDayDto { id: string; date: string; kind: "HOLIDAY" | "SPECIAL_WORKDAY"; name: string }

export async function listCalendar(actor: Actor, year: number): Promise<CalendarDayDto[]> {
  assertCan(actor, "schedule:manage");
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw Errors.validation("Tahun tidak valid.");
  const rows = await prisma.calendarDay.findMany({
    where: { date: { gte: isoToDate(`${year}-01-01`), lte: isoToDate(`${year}-12-31`) } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({ id: r.id, date: dateToIso(r.date), kind: r.kind, name: r.name }));
}

export async function addCalendarDay(actor: Actor, raw: unknown): Promise<void> {
  assertCan(actor, "schedule:manage");
  const input = parseInput(calendarSchema, raw);
  await transaction(async (tx) => {
    if (await tx.calendarDay.findUnique({ where: { date: isoToDate(input.date) } })) {
      throw Errors.validation("Tanggal ini sudah ada di kalender. Hapus entri lama untuk menggantinya.", { date: "Tanggal sudah ada" });
    }
    const c = await tx.calendarDay.create({ data: { date: isoToDate(input.date), kind: input.kind, name: input.name, createdById: actor.userId } });
    await writeAudit(tx, actor, { action: "calendar.add", entityType: "CalendarDay", entityId: c.id, summary: `${CALENDAR_KIND_LABEL[input.kind]} ${input.date}: ${input.name}`, after: input });
  });
}

export async function deleteCalendarDay(actor: Actor, id: string): Promise<void> {
  assertCan(actor, "schedule:manage");
  await transaction(async (tx) => {
    const c = await tx.calendarDay.findUnique({ where: { id } });
    if (!c) throw Errors.notFound("Entri kalender");
    await tx.calendarDay.delete({ where: { id } });
    await writeAudit(tx, actor, { action: "calendar.remove", entityType: "CalendarDay", entityId: id, summary: `${CALENDAR_KIND_LABEL[c.kind]} ${dateToIso(c.date)} (${c.name}) dihapus`, before: { date: dateToIso(c.date), kind: c.kind, name: c.name } });
  });
}
