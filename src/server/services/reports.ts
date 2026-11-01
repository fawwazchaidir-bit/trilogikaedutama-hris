import "server-only";
import { z } from "zod";
import { prisma } from "../db";
import { env } from "../env";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import { actorCan, assertCan, type Actor } from "../actor";
import { writeAudit } from "../audit";
import { dateToIso, isoToDate } from "../json";
import type { ReportTable } from "../export";
import { computeEmployeePeriod, employeeLite, loadRangeContext } from "./context";
import { locationSummary } from "./location";
import type { ItemStatutoryStored } from "./payroll";
import { summarizeDays, type DayResult, type RecapTotals } from "@/lib/attendance";
import {
  arrivalHistogram, averageWorkedMinutes, delta, formatChange, formatPercent, formatPoints, lastMonths, previousMonth, ratesOf, sumTotals,
  tenureDistribution, turnoverRate, weekdayDistribution, type Bucket, type Rates, type WeekdayRow,
} from "@/lib/analytics";
import { formatDateRange, formatDuration, monthLabel } from "@/lib/format";
import { formatRupiah } from "@/lib/money";
import { addDays, diffDays, isValidIsoDate, monthRange, startOfIsoWeek, todayIso } from "@/lib/time";
import { isoDate, uuid } from "@/lib/validation/common";
import { EMPLOYMENT_LABEL, type EmploymentStatus } from "@/lib/labels";
import type { RiskFlag } from "@/lib/location-risk";

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Bulan harus berformat YYYY-MM");
export const reportQuerySchema = z.object({
  month: month.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  year: z.coerce.number().int().min(2000).max(2200).optional(),
  divisionId: uuid.optional(),
});
type ReportQuery = z.infer<typeof reportQuerySchema>;

const tz = () => env().APP_TIMEZONE;
const num = (v: bigint | number | null | undefined) => Number(v ?? 0);
const currentMonth = () => todayIso(tz()).slice(0, 7);

/** Karyawan yang masa kerjanya beririsan dengan [from, to] (aktif maupun yang sudah berhenti di dalam rentang). */
async function employeesIn(from: string, to: string, divisionId?: string) {
  return prisma.employee.findMany({
    where: {
      joinDate: { lte: isoToDate(to) }, OR: [{ isActive: true }, { endDate: { gte: isoToDate(from) } }],
      ...(divisionId ? { divisionId } : {}),
    },
    include: { division: { select: { name: true } } }, orderBy: { fullName: "asc" },
  });
}

type EmpRow = Awaited<ReturnType<typeof employeesIn>>[number];
interface EmpDays { emp: EmpRow; days: DayResult[] }

async function daysFor(emps: EmpRow[], from: string, to: string): Promise<EmpDays[]> {
  if (diffDays(to, from) + 1 > 400) throw Errors.validation("Rentang laporan maksimal 400 hari.");
  const ctx = await loadRangeContext(from, to, { employeeIds: emps.map((e) => e.id) });
  return emps.map((emp) => ({ emp, days: computeEmployeePeriod(employeeLite(emp), ctx).days }));
}

const inMonth = (days: DayResult[], ym: string) => days.filter((d) => d.date.startsWith(ym));

// ─────────────────────────── Ringkasan eksekutif ───────────────────────────

export interface Kpi { label: string; value: string; delta: string | null; tone: "good" | "bad" | "neutral"; hint?: string }
export interface Insight { tone: "info" | "warn" | "good"; text: string; href?: string }
export interface MonthPoint { ym: string; label: string; headcount: number; attendance: number | null; punctuality: number | null; absence: number | null; cost: number | null }

export interface ExecutiveSummary {
  month: string;
  monthLabel: string;
  kpis: Kpi[];
  trend: MonthPoint[];
  insights: Insight[];
  location: { total: number; flagged: number; blocked: number; confirmed: number; topFlags: { code: RiskFlag; label: string; count: number }[] } | null;
  currentRates: Rates;
}

const goodWhenUp = (d: number | null, eps = 0.0005): "good" | "bad" | "neutral" => (d === null || Math.abs(d) < eps ? "neutral" : d > 0 ? "good" : "bad");
const goodWhenDown = (d: number | null, eps = 0.0005): "good" | "bad" | "neutral" => (d === null || Math.abs(d) < eps ? "neutral" : d < 0 ? "good" : "bad");

export async function getExecutiveSummary(actor: Actor, raw: unknown = {}): Promise<ExecutiveSummary> {
  assertCan(actor, "report:view");
  const q = parseInput(reportQuerySchema, raw);
  const ym = q.month ?? currentMonth();
  const prevYm = previousMonth(ym);
  const months = lastMonths(ym, 6);
  const from = `${months[0]}-01`, to = monthRange(ym).to;

  const emps = await employeesIn(from, to);
  const all = await daysFor(emps, from, to);
  const seriesTotals = months.map((m) => {
    const list = all.map((e) => ({ e, t: summarizeDays(inMonth(e.days, m)) }));
    const em = monthRange(m).to;
    const headcount = emps.filter((e) => dateToIso(e.joinDate) <= em && (!e.endDate || dateToIso(e.endDate) > em)).length;
    return { ym: m, totals: sumTotals(list.map((x) => x.t)), headcount, days: all.flatMap((e) => inMonth(e.days, m)) };
  });
  const cur = seriesTotals[seriesTotals.length - 1]!, prev = seriesTotals[seriesTotals.length - 2]!;
  const rc = ratesOf(cur.totals), rp = ratesOf(prev.totals);

  // Biaya SDM per bulan (hanya yang berhak melihat laporan penggajian).
  const canCost = actorCan(actor, "report:payroll");
  const cost = canCost ? await costByMonth(months) : new Map<string, CostMonth>();
  const trend: MonthPoint[] = seriesTotals.map((s) => {
    const r = ratesOf(s.totals);
    return { ym: s.ym, label: monthLabel(s.ym, true), headcount: s.headcount, attendance: r.attendance, punctuality: r.punctuality, absence: r.absence, cost: cost.get(s.ym)?.employerCost ?? null };
  });

  const ot = await prisma.overtimeRequest.aggregate({ where: { status: "APPROVED", date: { gte: isoToDate(`${ym}-01`), lte: isoToDate(monthRange(ym).to) } }, _sum: { approvedMinutes: true }, _count: { _all: true } });
  const otPrev = await prisma.overtimeRequest.aggregate({ where: { status: "APPROVED", date: { gte: isoToDate(`${prevYm}-01`), lte: isoToDate(monthRange(prevYm).to) } }, _sum: { approvedMinutes: true } });
  const dLate = delta(cur.totals.lateCount, prev.totals.lateCount);

  const kpis: Kpi[] = [
    { label: "Karyawan aktif (akhir bulan)", value: String(cur.headcount), delta: formatChange(delta(cur.headcount, prev.headcount)), tone: "neutral" },
    { label: "Tingkat kehadiran", value: formatPercent(rc.attendance), delta: formatPoints(rc.attendance !== null && rp.attendance !== null ? rc.attendance - rp.attendance : null), tone: goodWhenUp(rc.attendance !== null && rp.attendance !== null ? rc.attendance - rp.attendance : null), hint: "Hadir ÷ hari kerja yang sudah dapat dinilai" },
    { label: "Ketepatan waktu", value: formatPercent(rc.punctuality), delta: formatPoints(rc.punctuality !== null && rp.punctuality !== null ? rc.punctuality - rp.punctuality : null), tone: goodWhenUp(rc.punctuality !== null && rp.punctuality !== null ? rc.punctuality - rp.punctuality : null), hint: "Tepat waktu ÷ hadir" },
    { label: "Tidak hadir tanpa keterangan", value: formatPercent(rc.absence), delta: formatPoints(rc.absence !== null && rp.absence !== null ? rc.absence - rp.absence : null), tone: goodWhenDown(rc.absence !== null && rp.absence !== null ? rc.absence - rp.absence : null) },
    { label: "Kejadian terlambat", value: String(cur.totals.lateCount), delta: formatChange(dLate), tone: goodWhenDown(dLate.pct), hint: `${formatDuration(cur.totals.lateMinutes)} total` },
    { label: "Rata-rata jam kerja / hari", value: formatDuration(averageWorkedMinutes(cur.days) ?? 0), delta: null, tone: "neutral", hint: "Dari absensi lengkap" },
    { label: "Lembur disetujui", value: formatDuration(num(ot._sum.approvedMinutes)), delta: formatChange(delta(num(ot._sum.approvedMinutes), num(otPrev._sum.approvedMinutes))), tone: "neutral", hint: `${ot._count._all} pengajuan` },
  ];
  const c = cost.get(ym);
  if (canCost) kpis.push({ label: "Biaya SDM (periode gaji bulan ini)", value: c ? formatRupiah(c.employerCost) : "Belum ada periode disetujui", delta: c && cost.get(prevYm) ? formatChange(delta(c.employerCost, cost.get(prevYm)!.employerCost)) : null, tone: "neutral", hint: "Pendapatan + BPJS porsi perusahaan" });

  // Wawasan: hanya yang melewati ambang (tidak menampilkan angka biasa-biasa saja sebagai "temuan").
  const insights: Insight[] = [];
  if (dLate.pct !== null && dLate.pct >= 0.2 && cur.totals.lateCount >= 5) insights.push({ tone: "warn", text: `Kejadian terlambat naik ${formatChange(dLate)} dibanding ${monthLabel(prevYm)} (${prev.totals.lateCount} → ${cur.totals.lateCount}).`, href: `/laporan?tab=kehadiran&month=${ym}` });
  const perEmp = all.map((e) => ({ e, t: summarizeDays(inMonth(e.days, ym)) }));
  const habitual = perEmp.filter((x) => x.t.lateCount >= 5);
  if (habitual.length) insights.push({ tone: "warn", text: `${habitual.length} karyawan terlambat ≥ 5 kali bulan ini (tertinggi: ${habitual.sort((a, b) => b.t.lateCount - a.t.lateCount)[0]!.e.emp.fullName}, ${habitual[0]!.t.lateCount}×).`, href: `/laporan?tab=kehadiran&month=${ym}` });
  const incomplete = cur.totals.incompleteCount;
  if (incomplete > 0) insights.push({ tone: "warn", text: `${incomplete} absensi belum lengkap (tanpa check-out) bulan ini — memengaruhi jam kerja & lembur.`, href: "/absensi?status=BELUM_CHECKOUT" });
  const divs = new Map<string, RecapTotals[]>();
  for (const x of perEmp) divs.set(x.e.emp.division?.name ?? "Tanpa divisi", [...(divs.get(x.e.emp.division?.name ?? "Tanpa divisi") ?? []), x.t]);
  const worst = [...divs].map(([name, list]) => ({ name, r: ratesOf(sumTotals(list)), n: list.length })).filter((d) => d.r.absence !== null && d.n >= 2).sort((a, b) => b.r.absence! - a.r.absence!)[0];
  if (worst && worst.r.absence! >= 0.05) insights.push({ tone: "warn", text: `Divisi ${worst.name} memiliki tingkat tidak hadir tertinggi: ${formatPercent(worst.r.absence)}.`, href: `/laporan?tab=kehadiran&month=${ym}` });
  if (rc.attendance !== null && rp.attendance !== null && rc.attendance - rp.attendance >= 0.02) insights.push({ tone: "good", text: `Kehadiran membaik ${formatPoints(rc.attendance - rp.attendance)} dibanding ${monthLabel(prevYm)}.` });
  const pendingLeave = await prisma.leaveRequest.count({ where: { status: "PENDING" } });
  const pendingOt = await prisma.overtimeRequest.count({ where: { status: "PENDING" } });
  if (pendingLeave + pendingOt > 0) insights.push({ tone: "info", text: `${pendingLeave} pengajuan izin/cuti dan ${pendingOt} pengajuan lembur menunggu persetujuan.`, href: "/pengajuan?status=PENDING" });

  const location = await locationSummary(`${ym}-01`, monthRange(ym).to);
  if (location.confirmed > 0) insights.push({ tone: "warn", text: `${location.confirmed} absensi lokasi dikonfirmasi sebagai indikasi manipulasi bulan ini.`, href: "/lokasi?status=CONFIRMED" });
  else if (location.flagged + location.blocked > 0) insights.push({ tone: "info", text: `${location.flagged} absensi lokasi ditandai dan ${location.blocked} ditolak oleh penilaian risiko.`, href: "/lokasi" });

  return { month: ym, monthLabel: monthLabel(ym), kpis, trend, insights, location: location.total > 0 ? location : null, currentRates: rc };
}

// ─────────────────────────── Kehadiran ───────────────────────────

export interface DivisionRow { name: string; employees: number; scheduled: number; present: number; late: number; absent: number; leave: number; attendance: number | null; punctuality: number | null; absence: number | null }
export interface PersonRow { employeeId: string; employeeNo: string; name: string; division: string | null; scheduled: number; present: number; late: number; lateMinutes: number; absent: number; incomplete: number; attendance: number | null; punctuality: number | null }
export interface WeekPoint { weekStart: string; label: string; attendance: number | null; late: number }

export interface AttendanceReport {
  from: string; to: string; label: string;
  totals: RecapTotals; rates: Rates;
  byDivision: DivisionRow[];
  byWeekday: WeekdayRow[];
  arrival: Bucket[];
  weekly: WeekPoint[];
  topLate: PersonRow[];
  topAbsent: PersonRow[];
  avgWorkedMinutes: number | null;
  rows: PersonRow[];
}

function resolvePeriod(q: ReportQuery): { from: string; to: string; label: string } {
  if (q.from || q.to) {
    const from = q.from ?? q.to!, to = q.to ?? q.from!;
    if (!isValidIsoDate(from) || !isValidIsoDate(to) || to < from) throw Errors.validation("Rentang tanggal tidak valid.");
    return { from, to, label: formatDateRange(from, to) };
  }
  const ym = q.month ?? currentMonth();
  return { ...monthRange(ym), label: monthLabel(ym) };
}

const personRow = (e: EmpRow, t: RecapTotals): PersonRow => {
  const r = ratesOf(t);
  return { employeeId: e.id, employeeNo: e.employeeNo, name: e.fullName, division: e.division?.name ?? null, scheduled: t.scheduledDays, present: t.presentDays, late: t.lateCount, lateMinutes: t.lateMinutes, absent: t.absentDays, incomplete: t.incompleteCount, attendance: r.attendance, punctuality: r.punctuality };
};

export async function getAttendanceReport(actor: Actor, raw: unknown = {}): Promise<AttendanceReport> {
  assertCan(actor, "report:view");
  const q = parseInput(reportQuerySchema, raw);
  const { from, to, label } = resolvePeriod(q);
  const emps = await employeesIn(from, to, q.divisionId);
  const all = await daysFor(emps, from, to);
  const per = all.map((x) => ({ ...x, t: summarizeDays(x.days) })).filter((x) => x.days.some((d) => d.status !== "DI_LUAR_MASA_KERJA"));
  const totals = sumTotals(per.map((x) => x.t));
  const rows = per.map((x) => personRow(x.emp, x.t));

  const divMap = new Map<string, { t: RecapTotals[] }>();
  for (const x of per) { const k = x.emp.division?.name ?? "Tanpa divisi"; divMap.set(k, { t: [...(divMap.get(k)?.t ?? []), x.t] }); }
  const byDivision: DivisionRow[] = [...divMap].map(([name, { t }]) => {
    const s = sumTotals(t), r = ratesOf(s);
    return { name, employees: t.length, scheduled: s.scheduledDays, present: s.presentDays, late: s.lateCount, absent: s.absentDays, leave: s.izinDays + s.sakitDays + s.cutiDays, attendance: r.attendance, punctuality: r.punctuality, absence: r.absence };
  }).sort((a, b) => a.name.localeCompare(b.name, "id"));

  const allDays = per.flatMap((x) => x.days);
  const weeks = new Map<string, DayResult[]>();
  for (const d of allDays) { const w = startOfIsoWeek(d.date); weeks.set(w, [...(weeks.get(w) ?? []), d]); }
  const weekly: WeekPoint[] = [...weeks].sort(([a], [b]) => a.localeCompare(b)).map(([weekStart, days]) => {
    const t = summarizeDays(days);
    return { weekStart, label: formatDateRange(weekStart, addDays(weekStart, 6)), attendance: ratesOf(t).attendance, late: t.lateCount };
  });

  return {
    from, to, label, totals, rates: ratesOf(totals), byDivision, byWeekday: weekdayDistribution(allDays), arrival: arrivalHistogram(allDays), weekly,
    topLate: [...rows].filter((r) => r.late > 0).sort((a, b) => b.late - a.late || b.lateMinutes - a.lateMinutes).slice(0, 10),
    topAbsent: [...rows].filter((r) => r.absent > 0).sort((a, b) => b.absent - a.absent).slice(0, 10),
    avgWorkedMinutes: averageWorkedMinutes(allDays), rows,
  };
}

// ─────────────────────────── Cuti & lembur ───────────────────────────

export interface LeaveOvertimeReport {
  from: string; to: string; label: string;
  leaveByType: { type: "IZIN" | "SAKIT" | "CUTI"; requests: number; days: number }[];
  leaveByDivision: { name: string; izin: number; sakit: number; cuti: number }[];
  /** Saldo cuti tahun berjalan (kewajiban yang belum terpakai) per karyawan aktif. */
  balance: { year: number; totalDays: number; employees: number; highest: { employeeId: string; name: string; balance: number }[] };
  overtime: {
    requests: { pending: number; approved: number; rejected: number; cancelled: number };
    approvedMinutes: number;
    byEmployee: { employeeId: string; name: string; division: string | null; minutes: number; days: number }[];
    byDivision: { name: string; minutes: number }[];
  };
}

export async function getLeaveOvertimeReport(actor: Actor, raw: unknown = {}): Promise<LeaveOvertimeReport> {
  assertCan(actor, "report:view");
  const q = parseInput(reportQuerySchema, raw);
  const { from, to, label } = resolvePeriod(q);
  const f = isoToDate(from), t = isoToDate(to);

  const leaves = await prisma.leaveRequest.findMany({ where: { status: "APPROVED", startDate: { gte: f, lte: t } }, include: { employee: { select: { division: { select: { name: true } } } } } });
  const types = ["IZIN", "SAKIT", "CUTI"] as const;
  const leaveByType = types.map((type) => ({ type, requests: leaves.filter((l) => l.type === type).length, days: leaves.filter((l) => l.type === type).reduce((a, l) => a + (l.workingDays ?? 0), 0) }));
  const divLeave = new Map<string, { izin: number; sakit: number; cuti: number }>();
  for (const l of leaves) {
    const k = l.employee.division?.name ?? "Tanpa divisi";
    const r = divLeave.get(k) ?? { izin: 0, sakit: 0, cuti: 0 };
    r[l.type === "IZIN" ? "izin" : l.type === "SAKIT" ? "sakit" : "cuti"] += l.workingDays ?? 0;
    divLeave.set(k, r);
  }

  const year = Number(to.slice(0, 4));
  const bal = await prisma.leaveBalanceEntry.groupBy({ by: ["employeeId"], where: { year, employee: { isActive: true } }, _sum: { days: true } });
  const names = await prisma.employee.findMany({ where: { id: { in: bal.map((b) => b.employeeId) } }, select: { id: true, fullName: true } });
  const nameOf = new Map(names.map((n) => [n.id, n.fullName]));
  const balances = bal.map((b) => ({ employeeId: b.employeeId, name: nameOf.get(b.employeeId) ?? "—", balance: b._sum.days ?? 0 }));

  const ots = await prisma.overtimeRequest.findMany({ where: { date: { gte: f, lte: t } }, include: { employee: { select: { fullName: true, division: { select: { name: true } } } } } });
  const approved = ots.filter((o) => o.status === "APPROVED");
  const byEmp = new Map<string, { name: string; division: string | null; minutes: number; days: number }>();
  const byDiv = new Map<string, number>();
  for (const o of approved) {
    const e = byEmp.get(o.employeeId) ?? { name: o.employee.fullName, division: o.employee.division?.name ?? null, minutes: 0, days: 0 };
    e.minutes += o.approvedMinutes ?? 0; e.days += 1;
    byEmp.set(o.employeeId, e);
    const dn = o.employee.division?.name ?? "Tanpa divisi";
    byDiv.set(dn, (byDiv.get(dn) ?? 0) + (o.approvedMinutes ?? 0));
  }
  return {
    from, to, label, leaveByType,
    leaveByDivision: [...divLeave].map(([name, v]) => ({ name, ...v })).sort((a, b) => a.name.localeCompare(b.name, "id")),
    balance: { year, totalDays: balances.reduce((a, b) => a + b.balance, 0), employees: balances.length, highest: [...balances].sort((a, b) => b.balance - a.balance).slice(0, 8) },
    overtime: {
      requests: { pending: ots.filter((o) => o.status === "PENDING").length, approved: approved.length, rejected: ots.filter((o) => o.status === "REJECTED").length, cancelled: ots.filter((o) => o.status === "CANCELLED").length },
      approvedMinutes: approved.reduce((a, o) => a + (o.approvedMinutes ?? 0), 0),
      byEmployee: [...byEmp].map(([employeeId, v]) => ({ employeeId, ...v })).sort((a, b) => b.minutes - a.minutes).slice(0, 15),
      byDivision: [...byDiv].map(([name, minutes]) => ({ name, minutes })).sort((a, b) => b.minutes - a.minutes),
    },
  };
}

// ─────────────────────────── Biaya SDM & kepatuhan ───────────────────────────

interface CostMonth { ym: string; runs: number; employees: number; earnings: number; deductions: number; net: number; employerBpjs: number; pph21: number; employerCost: number }

/** Periode gaji DISETUJUI/DITERBITKAN yang berakhir pada bulan-bulan tsb. (periode yang masih draf/dibatalkan tidak dihitung). */
async function costByMonth(months: string[]): Promise<Map<string, CostMonth>> {
  const out = new Map<string, CostMonth>();
  if (!months.length) return out;
  const runs = await prisma.payrollRun.findMany({
    where: { status: { in: ["APPROVED", "ISSUED"] }, periodEnd: { gte: isoToDate(`${months[0]}-01`), lte: isoToDate(monthRange(months[months.length - 1]!).to) } },
    select: { id: true, periodEnd: true },
  });
  if (!runs.length) return out;
  const items = await prisma.payrollItem.findMany({ where: { runId: { in: runs.map((r) => r.id) } }, select: { runId: true, totalEarnings: true, totalDeductions: true, netPay: true, statutory: true } });
  const ymOf = new Map(runs.map((r) => [r.id, dateToIso(r.periodEnd).slice(0, 7)]));
  const runsPer = new Map<string, number>();
  for (const r of runs) runsPer.set(ymOf.get(r.id)!, (runsPer.get(ymOf.get(r.id)!) ?? 0) + 1);
  for (const it of items) {
    const ym = ymOf.get(it.runId)!;
    const m = out.get(ym) ?? { ym, runs: runsPer.get(ym) ?? 1, employees: 0, earnings: 0, deductions: 0, net: 0, employerBpjs: 0, pph21: 0, employerCost: 0 };
    const st = it.statutory as unknown as ItemStatutoryStored | null;
    m.employees += 1; m.earnings += num(it.totalEarnings); m.deductions += num(it.totalDeductions); m.net += num(it.netPay);
    m.employerBpjs += st?.bpjs?.employerTotal ?? 0; m.pph21 += st?.pph21?.amount ?? 0;
    m.employerCost = m.earnings + m.employerBpjs;
    out.set(ym, m);
  }
  return out;
}

export interface CostReport {
  year: number;
  months: CostMonth[];
  totals: { earnings: number; deductions: number; net: number; employerBpjs: number; pph21: number; employerCost: number };
  byDivision: { name: string; employees: number; earnings: number; net: number; avgEarnings: number }[];
  byCategory: { category: string; kind: "EARNING" | "DEDUCTION"; amount: number }[];
  runsIncluded: number;
}

export async function getCostReport(actor: Actor, raw: unknown = {}): Promise<CostReport> {
  assertCan(actor, "report:payroll");
  const q = parseInput(reportQuerySchema, raw);
  const year = q.year ?? Number(todayIso(tz()).slice(0, 4));
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
  const cost = await costByMonth(months);
  const rows = months.map((m) => cost.get(m)).filter((x): x is CostMonth => !!x);
  const runs = await prisma.payrollRun.findMany({ where: { status: { in: ["APPROVED", "ISSUED"] }, periodEnd: { gte: isoToDate(`${year}-01-01`), lte: isoToDate(`${year}-12-31`) } }, select: { id: true } });
  const runIds = runs.map((r) => r.id);
  const [divs, cats] = runIds.length
    ? await Promise.all([
      prisma.payrollItem.groupBy({ by: ["divisionName"], where: { runId: { in: runIds } }, _sum: { totalEarnings: true, netPay: true }, _count: { _all: true } }),
      prisma.payrollItemLine.groupBy({ by: ["category", "kind"], where: { item: { runId: { in: runIds } } }, _sum: { amount: true } }),
    ])
    : [[], []];
  const sum = (k: keyof Omit<CostMonth, "ym" | "runs" | "employees">) => rows.reduce((a, r) => a + r[k], 0);
  return {
    year, months: rows, runsIncluded: runIds.length,
    totals: { earnings: sum("earnings"), deductions: sum("deductions"), net: sum("net"), employerBpjs: sum("employerBpjs"), pph21: sum("pph21"), employerCost: sum("employerCost") },
    byDivision: divs.map((d) => ({ name: d.divisionName ?? "Tanpa divisi", employees: d._count._all, earnings: num(d._sum.totalEarnings), net: num(d._sum.netPay), avgEarnings: d._count._all ? Math.round(num(d._sum.totalEarnings) / d._count._all) : 0 })).sort((a, b) => b.earnings - a.earnings),
    byCategory: cats.map((c) => ({ category: c.category, kind: c.kind, amount: num(c._sum.amount) })).sort((a, b) => b.amount - a.amount),
  };
}

export interface ComplianceRow {
  employeeNo: string; name: string; division: string | null; taxStatus: string; hasNpwp: boolean;
  bpjsWage: number; kesEmp: number; kesEr: number; jhtEmp: number; jhtEr: number; jpEmp: number; jpEr: number; jkk: number; jkm: number;
  taxableGross: number; pph21: number; pph21Method: string;
}
export interface ComplianceReport {
  month: string; monthLabel: string; runs: string[];
  rows: ComplianceRow[];
  totals: Omit<ComplianceRow, "employeeNo" | "name" | "division" | "taxStatus" | "hasNpwp" | "pph21Method">;
  issues: { text: string; count: number }[];
  automatic: boolean;
}

export async function getComplianceReport(actor: Actor, raw: unknown = {}): Promise<ComplianceReport> {
  assertCan(actor, "report:payroll");
  const q = parseInput(reportQuerySchema, raw);
  const ym = q.month ?? previousMonth(currentMonth());
  const { from, to } = monthRange(ym);
  const runs = await prisma.payrollRun.findMany({ where: { status: { in: ["APPROVED", "ISSUED"] }, periodEnd: { gte: isoToDate(from), lte: isoToDate(to) } }, select: { id: true, label: true, rulesSnapshot: true } });
  const items = runs.length ? await prisma.payrollItem.findMany({ where: { runId: { in: runs.map((r) => r.id) } }, include: { employee: { select: { taxStatus: true, hasNpwp: true, bpjsHealthEnrolled: true, bpjsEmploymentEnrolled: true, employmentStatus: true } } }, orderBy: { employeeName: "asc" } }) : [];
  const zero = { bpjsWage: 0, kesEmp: 0, kesEr: 0, jhtEmp: 0, jhtEr: 0, jpEmp: 0, jpEr: 0, jkk: 0, jkm: 0, taxableGross: 0, pph21: 0 };
  const totals = { ...zero };
  const rows: ComplianceRow[] = items.map((it) => {
    const st = it.statutory as unknown as ItemStatutoryStored | null;
    const r: ComplianceRow = {
      employeeNo: it.employeeNo, name: it.employeeName, division: it.divisionName, taxStatus: it.employee.taxStatus, hasNpwp: it.employee.hasNpwp,
      bpjsWage: st?.bpjs?.wage ?? 0, kesEmp: st?.bpjs?.employee.health ?? 0, kesEr: st?.bpjs?.employer.health ?? 0, jhtEmp: st?.bpjs?.employee.jht ?? 0, jhtEr: st?.bpjs?.employer.jht ?? 0,
      jpEmp: st?.bpjs?.employee.jp ?? 0, jpEr: st?.bpjs?.employer.jp ?? 0, jkk: st?.bpjs?.employer.jkk ?? 0, jkm: st?.bpjs?.employer.jkm ?? 0,
      taxableGross: st?.pph21?.gross ?? 0, pph21: st?.pph21?.amount ?? 0, pph21Method: st?.pph21 ? (st.pph21.method === "TER" ? `TER ${st.pph21.category}` : "Tahunan") : "—",
    };
    for (const k of Object.keys(zero) as (keyof typeof zero)[]) totals[k] += r[k];
    return r;
  });
  const automatic = runs.some((r) => { const s = (r.rulesSnapshot as { statutory?: { bpjs?: { enabled?: boolean }; pph21?: { enabled?: boolean } } | null } | null)?.statutory; return !!s?.bpjs?.enabled || !!s?.pph21?.enabled; });
  const issues: ComplianceReport["issues"] = [];
  const noNpwp = items.filter((i) => !i.employee.hasNpwp).length;
  if (noNpwp) issues.push({ text: "Karyawan tanpa NPWP/NIK terdaftar (PPh 21 dikenai tarif lebih tinggi)", count: noNpwp });
  const noBpjs = items.filter((i) => i.employee.employmentStatus !== "INTERN" && (!i.employee.bpjsHealthEnrolled || !i.employee.bpjsEmploymentEnrolled)).length;
  if (noBpjs) issues.push({ text: "Karyawan tetap/kontrak yang belum ditandai sebagai peserta BPJS Kesehatan/Ketenagakerjaan", count: noBpjs });
  if (automatic) {
    const noCalc = items.filter((i) => !i.statutory).length;
    if (noCalc) issues.push({ text: "Item gaji tanpa perhitungan BPJS/PPh 21 otomatis (komponen manual / bukan peserta)", count: noCalc });
    const zeroWage = rows.filter((r) => r.bpjsWage === 0 && r.kesEmp + r.jhtEmp === 0 && r.pph21 === 0).length;
    if (zeroWage) issues.push({ text: "Karyawan dengan dasar upah BPJS 0 — periksa penandaan komponen gaji pokok/tunjangan tetap", count: zeroWage });
  }
  return { month: ym, monthLabel: monthLabel(ym), runs: runs.map((r) => r.label), rows, totals, issues, automatic };
}

// ─────────────────────────── Karyawan (headcount & turnover) ───────────────────────────

export interface WorkforceReport {
  year: number;
  headcount: number;
  byStatus: { status: EmploymentStatus; label: string; count: number }[];
  byDivision: { name: string; count: number }[];
  movement: { ym: string; label: string; joiners: number; leavers: number; headcountEnd: number }[];
  turnover: number | null;
  tenure: { label: string; count: number }[];
  averageTenureYears: number | null;
}

export async function getWorkforceReport(actor: Actor, raw: unknown = {}): Promise<WorkforceReport> {
  assertCan(actor, "report:view");
  const q = parseInput(reportQuerySchema, raw);
  const now = todayIso(tz());
  const year = q.year ?? Number(now.slice(0, 4));
  const yearEnd = `${year}-12-31`;
  const asOf = now < yearEnd && year === Number(now.slice(0, 4)) ? now : yearEnd;
  const emps = await prisma.employee.findMany({ where: { joinDate: { lte: isoToDate(yearEnd) } }, include: { division: { select: { name: true } } } });
  const activeAt = (d: string) => emps.filter((e) => dateToIso(e.joinDate) <= d && (!e.endDate || dateToIso(e.endDate) > d));
  const current = activeAt(asOf);
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`).filter((m) => `${m}-01` <= asOf);
  const movement = months.map((m) => {
    const { from, to } = monthRange(m);
    return {
      ym: m, label: monthLabel(m, true),
      joiners: emps.filter((e) => { const j = dateToIso(e.joinDate); return j >= from && j <= to; }).length,
      leavers: emps.filter((e) => e.endDate && dateToIso(e.endDate) >= from && dateToIso(e.endDate) <= to).length,
      headcountEnd: activeAt(to > asOf ? asOf : to).length,
    };
  });
  const startCount = activeAt(addDays(`${year}-01-01`, -1)).length;
  const leavers = movement.reduce((a, m) => a + m.leavers, 0);
  const byStatus = (["PERMANENT", "CONTRACT", "INTERN"] as const).map((status) => ({ status, label: EMPLOYMENT_LABEL[status], count: current.filter((e) => e.employmentStatus === status).length }));
  const divMap = new Map<string, number>();
  for (const e of current) divMap.set(e.division?.name ?? "Tanpa divisi", (divMap.get(e.division?.name ?? "Tanpa divisi") ?? 0) + 1);
  const years = current.map((e) => diffDays(asOf, dateToIso(e.joinDate)) / 365.25);
  return {
    year, headcount: current.length, byStatus, byDivision: [...divMap].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count), movement,
    turnover: turnoverRate(leavers, startCount, current.length), tenure: tenureDistribution(current.map((e) => dateToIso(e.joinDate)), asOf),
    averageTenureYears: years.length ? years.reduce((a, b) => a + b, 0) / years.length : null,
  };
}

// ─────────────────────────── Ekspor ───────────────────────────

export const REPORT_KINDS = ["kehadiran", "cuti-lembur", "biaya", "kepatuhan", "karyawan"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
const pctOrBlank = (v: number | null) => (v === null ? null : Math.round(v * 1000) / 10);

export async function reportTable(actor: Actor, kind: ReportKind, raw: unknown = {}): Promise<ReportTable> {
  const generatedAt = new Date().toISOString();
  const disclaimer = "Angka dihitung dari data absensi, pengajuan, dan penggajian yang sama dengan rekap & slip. Rasio memakai hari kerja yang sudah dapat dinilai; hari yang belum berlalu tidak dihitung.";
  let table: ReportTable;
  if (kind === "kehadiran") {
    const r = await getAttendanceReport(actor, raw);
    table = {
      type: "Analisis_Kehadiran", title: "Analisis Kehadiran per Karyawan", description: "Kehadiran", disclaimer, periodLabel: r.label, generatedAt,
      columns: [
        { key: "no", label: "No. Induk", type: "text", width: 13 }, { key: "name", label: "Nama", type: "text", width: 26 }, { key: "division", label: "Divisi", type: "text", width: 16 },
        { key: "scheduled", label: "Hari Kerja", type: "number", width: 10 }, { key: "present", label: "Hadir", type: "number", width: 9 }, { key: "late", label: "Terlambat (x)", type: "number", width: 11 },
        { key: "lateMin", label: "Menit Terlambat", type: "number", width: 12 }, { key: "absent", label: "Tidak Hadir", type: "number", width: 10 }, { key: "incomplete", label: "Belum Lengkap", type: "number", width: 11 },
        { key: "att", label: "Kehadiran (%)", type: "number", width: 11 }, { key: "punct", label: "Tepat Waktu (%)", type: "number", width: 12 },
      ],
      rows: r.rows.map((x) => ({ no: x.employeeNo, name: x.name, division: x.division ?? "", scheduled: x.scheduled, present: x.present, late: x.late, lateMin: x.lateMinutes, absent: x.absent, incomplete: x.incomplete, att: pctOrBlank(x.attendance), punct: pctOrBlank(x.punctuality) })),
      totals: { no: null, name: null, division: null, scheduled: r.totals.scheduledDays, present: r.totals.presentDays, late: r.totals.lateCount, lateMin: r.totals.lateMinutes, absent: r.totals.absentDays, incomplete: r.totals.incompleteCount, att: pctOrBlank(r.rates.attendance), punct: pctOrBlank(r.rates.punctuality) },
    };
  } else if (kind === "cuti-lembur") {
    const r = await getLeaveOvertimeReport(actor, raw);
    table = {
      type: "Cuti_dan_Lembur", title: "Lembur Disetujui per Karyawan", description: "Lembur", disclaimer, periodLabel: r.label, generatedAt,
      columns: [{ key: "name", label: "Nama", type: "text", width: 28 }, { key: "division", label: "Divisi", type: "text", width: 18 }, { key: "days", label: "Hari Lembur", type: "number", width: 12 }, { key: "hours", label: "Jam Disetujui", type: "number", width: 14 }],
      rows: r.overtime.byEmployee.map((x) => ({ name: x.name, division: x.division ?? "", days: x.days, hours: Math.round((x.minutes / 60) * 100) / 100 })),
      totals: { name: null, division: null, days: r.overtime.byEmployee.reduce((a, x) => a + x.days, 0), hours: Math.round((r.overtime.approvedMinutes / 60) * 100) / 100 },
    };
  } else if (kind === "biaya") {
    const r = await getCostReport(actor, raw);
    table = {
      type: "Biaya_SDM", title: "Biaya SDM per Bulan", description: "Biaya", disclaimer: "Hanya periode penggajian berstatus Disetujui/Diterbitkan. Biaya SDM = total pendapatan + BPJS porsi perusahaan (bila perhitungan otomatis aktif).", periodLabel: `Tahun ${r.year}`, generatedAt,
      columns: [{ key: "m", label: "Bulan", type: "text", width: 16 }, { key: "n", label: "Karyawan", type: "number", width: 10 }, { key: "earn", label: "Total Pendapatan", type: "money", width: 18 }, { key: "ded", label: "Total Potongan", type: "money", width: 16 }, { key: "net", label: "Gaji Bersih", type: "money", width: 16 }, { key: "er", label: "BPJS Perusahaan", type: "money", width: 16 }, { key: "pph", label: "PPh 21 Dipotong", type: "money", width: 16 }, { key: "cost", label: "Biaya SDM", type: "money", width: 18 }],
      rows: r.months.map((m) => ({ m: monthLabel(m.ym), n: m.employees, earn: m.earnings, ded: m.deductions, net: m.net, er: m.employerBpjs, pph: m.pph21, cost: m.employerCost })),
      totals: { m: null, n: null, earn: r.totals.earnings, ded: r.totals.deductions, net: r.totals.net, er: r.totals.employerBpjs, pph: r.totals.pph21, cost: r.totals.employerCost },
    };
  } else if (kind === "kepatuhan") {
    const r = await getComplianceReport(actor, raw);
    table = {
      type: "BPJS_PPh21", title: "Rekap BPJS & PPh 21", description: "Kepatuhan", disclaimer: "Dihitung dari penggajian Disetujui/Diterbitkan. Verifikasi dengan konsultan pajak/BPJS sebelum pelaporan atau pembayaran iuran.", periodLabel: r.monthLabel, generatedAt,
      columns: [
        { key: "no", label: "No. Induk", type: "text", width: 12 }, { key: "name", label: "Nama", type: "text", width: 24 }, { key: "ptkp", label: "PTKP", type: "text", width: 7 }, { key: "wage", label: "Dasar Upah BPJS", type: "money", width: 16 },
        { key: "kesEmp", label: "Kes. Karyawan", type: "money", width: 14 }, { key: "kesEr", label: "Kes. Perusahaan", type: "money", width: 14 }, { key: "jhtEmp", label: "JHT Karyawan", type: "money", width: 14 }, { key: "jhtEr", label: "JHT Perusahaan", type: "money", width: 14 },
        { key: "jpEmp", label: "JP Karyawan", type: "money", width: 14 }, { key: "jpEr", label: "JP Perusahaan", type: "money", width: 14 }, { key: "jkk", label: "JKK", type: "money", width: 12 }, { key: "jkm", label: "JKM", type: "money", width: 12 },
        { key: "gross", label: "Bruto Kena Pajak", type: "money", width: 16 }, { key: "pph", label: "PPh 21", type: "money", width: 14 }, { key: "method", label: "Metode", type: "text", width: 11 },
      ],
      rows: r.rows.map((x) => ({ no: x.employeeNo, name: x.name, ptkp: x.taxStatus, wage: x.bpjsWage, kesEmp: x.kesEmp, kesEr: x.kesEr, jhtEmp: x.jhtEmp, jhtEr: x.jhtEr, jpEmp: x.jpEmp, jpEr: x.jpEr, jkk: x.jkk, jkm: x.jkm, gross: x.taxableGross, pph: x.pph21, method: x.pph21Method })),
      totals: { no: null, name: null, ptkp: null, wage: r.totals.bpjsWage, kesEmp: r.totals.kesEmp, kesEr: r.totals.kesEr, jhtEmp: r.totals.jhtEmp, jhtEr: r.totals.jhtEr, jpEmp: r.totals.jpEmp, jpEr: r.totals.jpEr, jkk: r.totals.jkk, jkm: r.totals.jkm, gross: r.totals.taxableGross, pph: r.totals.pph21, method: null },
    };
  } else {
    const r = await getWorkforceReport(actor, raw);
    table = {
      type: "Karyawan_Mutasi", title: "Mutasi Karyawan per Bulan", description: "Headcount", disclaimer: "Headcount akhir bulan = karyawan yang sudah masuk dan belum berhenti pada akhir bulan itu.", periodLabel: `Tahun ${r.year}`, generatedAt,
      columns: [{ key: "m", label: "Bulan", type: "text", width: 16 }, { key: "in", label: "Masuk", type: "number", width: 10 }, { key: "out", label: "Keluar", type: "number", width: 10 }, { key: "hc", label: "Headcount Akhir Bulan", type: "number", width: 20 }],
      rows: r.movement.map((m) => ({ m: monthLabel(m.ym), in: m.joiners, out: m.leavers, hc: m.headcountEnd })),
      totals: { m: null, in: r.movement.reduce((a, m) => a + m.joiners, 0), out: r.movement.reduce((a, m) => a + m.leavers, 0), hc: r.headcount },
    };
  }
  await writeAudit(prisma, actor, { action: "report.export", entityType: "Report", summary: `Ekspor laporan ${table.title} (${table.periodLabel})` });
  return table;
}
