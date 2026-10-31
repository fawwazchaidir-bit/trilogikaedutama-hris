import "server-only";
import { prisma } from "../db";
import { env } from "../env";
import { actorCan, assertCan, requireSelf, type Actor } from "../actor";
import { isoToDate } from "../json";
import { computeEmployeePeriod, employeeLite, loadRangeContext } from "./context";
import { currentPayrollSummary, type RunDto } from "./payroll";
import { getTodayState, type TodayState } from "./attendance";
import { listLeaves, listMyLeaves, pendingLeaveCount, type LeaveDto } from "./leave";
import { listMyPayslips, type PayslipDto } from "./payslips";
import { openLocationReviewCount } from "./location";
import { currentDayRow, summarizeDays, type RecapTotals } from "@/lib/attendance";
import { addDays, todayIso } from "@/lib/time";

export interface AdminDashboard {
  today: string;
  activeEmployees: number;
  /** Hari ini: hadir (termasuk terlambat), terlambat, belum absen, tidak hadir (lewat batas), izin/sakit/cuti, libur. */
  present: number;
  late: number;
  notYet: number;
  absent: number;
  onLeave: number;
  noSchedule: number;
  /** Check-in hari ini yang belum check-out (informasi). */
  openCheckouts: number;
  pendingRequests: number;
  /** Absensi lokasi yang ditandai/ditolak dan belum ditinjau (hanya bila berhak meninjau). */
  openLocationReviews: number | null;
  /** Absensi belum lengkap (check-in tanpa check-out) dalam 31 hari terakhir, tidak termasuk hari ini. */
  incomplete: number;
  incompleteList: { employeeId: string; name: string; date: string }[];
  pendingList: LeaveDto[];
  payroll: { run: RunDto | null; latestIssued: RunDto | null } | null;
  missingDefaultSchedule: boolean;
  setup: { attendanceConfirmed: boolean; payrollRulesConfirmed: boolean };
}

export async function getAdminDashboard(actor: Actor, now: Date = new Date()): Promise<AdminDashboard> {
  assertCan(actor, "dashboard:admin");
  const tz = env().APP_TIMEZONE;
  const today = todayIso(tz, now);
  const from = addDays(today, -31);
  const employees = await prisma.employee.findMany({ where: { isActive: true, joinDate: { lte: isoToDate(today) } }, select: { id: true, fullName: true, divisionId: true, joinDate: true, endDate: true } });
  const ctx = await loadRangeContext(from, today, { employeeIds: employees.map((e) => e.id), now });

  let present = 0, late = 0, notYet = 0, absent = 0, onLeave = 0, noSchedule = 0, openCheckouts = 0;
  const incompleteList: AdminDashboard["incompleteList"] = [];
  let incomplete = 0;
  for (const e of employees) {
    const { days } = computeEmployeePeriod(employeeLite(e), ctx);
    // Shift malam kemarin yang masih berjalan lebih relevan daripada baris hari ini yang shift-nya belum mulai.
    const t = currentDayRow(days, now, tz);
    if (t) {
      if (t.status === "HADIR") present++;
      else if (t.status === "TERLAMBAT") { present++; late++; }
      else if (t.status === "BELUM_ABSEN") notYet++;
      else if (t.status === "TIDAK_HADIR") absent++;
      else if (t.status === "IZIN" || t.status === "SAKIT" || t.status === "CUTI") onLeave++;
      else if (t.status === "LIBUR" && !t.scheduled && t.offReason === "Tidak ada jadwal kerja") noSchedule++;
      if (t.missingCheckout) openCheckouts++;
    }
    for (const d of days) {
      if (d.incomplete) {
        incomplete++;
        if (incompleteList.length < 8) incompleteList.push({ employeeId: e.id, name: e.fullName, date: d.date });
      }
    }
  }
  incompleteList.sort((a, b) => b.date.localeCompare(a.date));

  const [pendingRequests, openLocationReviews, pendingRows, payroll, settings, def] = await Promise.all([
    pendingLeaveCount(),
    actorCan(actor, "location:review") ? openLocationReviewCount() : Promise.resolve(null),
    actorCan(actor, "leave:view_all") ? listLeaves(actor, { status: "PENDING", pageSize: 5 }) : Promise.resolve(null),
    actorCan(actor, "payroll:view") ? currentPayrollSummary() : Promise.resolve(null),
    prisma.companySettings.findUnique({ where: { id: 1 } }),
    prisma.workSchedule.count({ where: { isDefault: true } }),
  ]);
  return {
    today, activeEmployees: employees.length, present, late, notYet, absent, onLeave, noSchedule, openCheckouts, pendingRequests, openLocationReviews,
    incomplete, incompleteList, pendingList: pendingRows?.items ?? [], payroll, missingDefaultSchedule: def === 0,
    setup: { attendanceConfirmed: !!settings?.attendancePolicyConfirmedAt, payrollRulesConfirmed: !!settings?.payrollRulesConfirmedAt },
  };
}

export interface EmployeeDashboard {
  today: TodayState;
  month: { label: string; from: string; to: string; totals: RecapTotals };
  leaves: LeaveDto[];
  latestPayslip: PayslipDto | null;
}

export async function getEmployeeDashboard(actor: Actor, now: Date = new Date()): Promise<EmployeeDashboard> {
  const employeeId = requireSelf(actor);
  const tz = env().APP_TIMEZONE;
  const today = todayIso(tz, now);
  const ym = today.slice(0, 7);
  const from = `${ym}-01`;
  const last = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5)), 0)).getUTCDate();
  const to = `${ym}-${String(last).padStart(2, "0")}`;
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const [state, ctx, leaves, slips] = await Promise.all([
    getTodayState(actor, now),
    loadRangeContext(from, to, { employeeIds: [employeeId], now }),
    listMyLeaves(actor),
    listMyPayslips(actor),
  ]);
  const days = computeEmployeePeriod(employeeLite(emp), ctx).days;
  return { today: state, month: { label: ym, from, to, totals: summarizeDays(days) }, leaves: leaves.slice(0, 4), latestPayslip: slips[0] ?? null };
}

