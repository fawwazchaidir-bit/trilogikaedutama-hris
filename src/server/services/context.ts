import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "../db";
import { env } from "../env";
import { dateToIso, isoToDate } from "../json";
import { getSettings } from "./settings";
import { selectComponents, type ComponentInput } from "@/lib/payroll";
import {
  buildEmployeeDays, summarizeDays, type AssignmentLite, type AttendanceLite, type DayResult, type EmployeeLite, type LeaveLite,
  type DutyLite, type RangeContext, type RecapTotals, type ScheduleLite,
} from "@/lib/attendance";

/**
 * Memuat SEMUA data sumber untuk sebuah rentang tanggal (jadwal, penugasan, kalender, pengajuan disetujui, absensi)
 * dalam beberapa query, lalu menyerahkannya ke mesin murni di `@/lib/attendance`. Satu-satunya jalur penghitungan status
 * harian, sehingga layar absensi, rekap, dashboard, dan penggajian SELALU konsisten.
 */
export async function loadRangeContext(from: string, to: string, opts: { employeeIds?: string[]; now?: Date; withDuty?: boolean } = {}): Promise<RangeContext> {
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
  // Penugasan (surat tugas TERBIT) hanya dimuat oleh layar yang menampilkannya; perhitungan rekap/gaji/cuti tidak membutuhkannya.
  const duty: DutyLite[] = opts.withDuty ? await loadDuty(f, t, opts.employeeIds) : [];
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
    duty,
  };
}

async function loadDuty(from: Date, to: Date, employeeIds?: string[]): Promise<DutyLite[]> {
  const rows = await prisma.assignmentAssignee.findMany({
    where: { ...(employeeIds ? { employeeId: { in: employeeIds } } : {}), letter: { status: "ISSUED", startDate: { lte: to }, endDate: { gte: from } } },
    select: { employeeId: true, letter: { select: { id: true, number: true, destination: true, startDate: true, endDate: true } } },
  });
  return rows.map((r) => ({ letterId: r.letter.id, number: r.letter.number, employeeId: r.employeeId, startDate: dateToIso(r.letter.startDate), endDate: dateToIso(r.letter.endDate), destination: r.letter.destination }));
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

/**
 * Hash kanonik komponen gaji yang BERLAKU pada periode penggajian (urutan tidak berpengaruh). Dibekukan di item saat dihitung dan
 * dibandingkan dengan komponen terkini → perubahan nominal, rumus, masa berlaku, atau penambahan/penonaktifan komponen terdeteksi
 * sebagai "data berubah". Komponen di luar periode tidak ikut, jadi mengubahnya tidak menandai periode ini.
 */
export function componentsHash(components: ComponentInput[], period: { start: string; end: string }): string {
  const canon = selectComponents(components, period)
    .map((c) => [c.id, c.kind, c.category, c.name, c.calc, c.amount, c.percentBp ?? "", c.recurrence, c.effectiveFrom, c.effectiveTo ?? "", c.taxable ?? "", c.inBpjsBase ?? "", c.description ?? ""].join("|"))
    .sort()
    .join("\n");
  return createHash("sha256").update(canon).digest("hex");
}
