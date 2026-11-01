import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "../db";
import { env } from "../env";
import { dateToIso, isoToDate } from "../json";
import { getSettings } from "./settings";
import {
  buildEmployeeDays, summarizeDays, type AssignmentLite, type AttendanceLite, type DayResult, type EmployeeLite, type LeaveLite,
  type RangeContext, type RecapTotals, type ScheduleLite,
} from "@/lib/attendance";

/**
 * Memuat SEMUA data sumber untuk sebuah rentang tanggal (jadwal, penugasan, kalender, pengajuan disetujui, absensi)
 * dalam beberapa query, lalu menyerahkannya ke mesin murni di `@/lib/attendance`. Satu-satunya jalur penghitungan status
 * harian, sehingga layar absensi, rekap, dashboard, dan penggajian SELALU konsisten.
 */
export async function loadRangeContext(from: string, to: string, opts: { employeeIds?: string[]; now?: Date } = {}): Promise<RangeContext> {
  const f = isoToDate(from);
  const t = isoToDate(to);
  const empFilter = opts.employeeIds ? { employeeId: { in: opts.employeeIds } } : {};
  const [settings, schedules, assignments, calendar, leaves, attendance] = await Promise.all([
    getSettings(),
    prisma.workSchedule.findMany(),
    prisma.scheduleAssignment.findMany({ where: { startDate: { lte: t }, OR: [{ endDate: null }, { endDate: { gte: f } }] } }),
    prisma.calendarDay.findMany({ where: { date: { gte: f, lte: t } } }),
    prisma.leaveRequest.findMany({ where: { ...empFilter, status: "APPROVED", startDate: { lte: t }, endDate: { gte: f } } }),
    prisma.attendance.findMany({ where: { ...empFilter, date: { gte: f, lte: t } } }),
  ]);
  const lite = (s: (typeof schedules)[number]): ScheduleLite => ({
    id: s.id, name: s.name, workDays: s.workDays, startTime: s.startTime, endTime: s.endTime,
    lateToleranceMinutes: s.lateToleranceMinutes, absentCutoffTime: s.absentCutoffTime,
  });
  const map = new Map(schedules.map((s) => [s.id, lite(s)]));
  const def = schedules.find((s) => s.isDefault);
  return {
    from, to, now: opts.now ?? new Date(), timeZone: env().APP_TIMEZONE, lateAfterTolerance: settings.lateMinutesAfterTolerance,
    schedules: map, defaultSchedule: def ? lite(def) : null,
    assignments: assignments.map((a): AssignmentLite => ({
      scheduleId: a.scheduleId, scope: a.scope, divisionId: a.divisionId, employeeId: a.employeeId,
      startDate: dateToIso(a.startDate), endDate: a.endDate ? dateToIso(a.endDate) : null,
    })),
    calendar: new Map(calendar.map((c) => [dateToIso(c.date), { kind: c.kind, name: c.name }])),
    leaves: leaves.map((l): LeaveLite => ({ id: l.id, employeeId: l.employeeId, type: l.type, startDate: dateToIso(l.startDate), endDate: dateToIso(l.endDate), status: l.status, dayPart: l.dayPart })),
    attendance: attendance.map((a): AttendanceLite => ({ employeeId: a.employeeId, date: dateToIso(a.date), checkInAt: a.checkInAt, checkOutAt: a.checkOutAt })),
  };
}

export function employeeLite(e: { id: string; divisionId: string | null; joinDate: Date; endDate: Date | null }): EmployeeLite {
  return { id: e.id, divisionId: e.divisionId, joinDate: dateToIso(e.joinDate), endDate: e.endDate ? dateToIso(e.endDate) : null };
}

export interface EmployeePeriod { days: DayResult[]; totals: RecapTotals }

/** Hari + total untuk satu karyawan pada konteks yang sudah dimuat. */
export function computeEmployeePeriod(emp: EmployeeLite, ctx: RangeContext): EmployeePeriod {
  const days = buildEmployeeDays(emp, ctx);
  return { days, totals: summarizeDays(days) };
}

/**
 * Hash kanonik data harian sumber → mendeteksi bahwa absensi/jadwal/pengajuan berubah sejak penghitungan gaji.
 * `extra` (mis. lembur disetujui) hanya ditambahkan bila ada, sehingga hash periode lama tetap sama.
 * Hari tanpa pengajuan setengah hari menghasilkan string yang identik dengan versi sebelumnya.
 */
export function sourceHash(days: DayResult[], extra = ""): string {
  const canon = days
    .filter((d) => d.status !== "DI_LUAR_MASA_KERJA")
    .map((d) => {
      const core = [d.date, d.status, d.scheduled ? 1 : 0, d.lateMinutes, d.workedMinutes, d.afterEndMinutes, d.incomplete ? 1 : 0].join("|");
      if (!d.dayPart || d.dayPart === "FULL") return core;
      const f = d.fractions;
      return `${core}|${d.dayPart}|${f.present}|${f.izin}|${f.sakit}|${f.cuti}|${f.absent}|${f.pending}`;
    })
    .join("\n");
  return createHash("sha256").update(extra ? `${canon}\n#${extra}` : canon).digest("hex");
}
