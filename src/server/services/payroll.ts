import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, transaction } from "../db";
import { env } from "../env";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import { assertCan, type Actor } from "../actor";
import { writeAudit } from "../audit";
import { dateToIso, isoToDate } from "../json";
import { computeEmployeePeriod, employeeLite, loadRangeContext, sourceHash } from "./context";
import { getSettings, payrollRulesOf } from "./settings";
import { notifyUsers, superAdminUserIds } from "./notifications";
import { computeItem, maskAccount, totalsFromLines, type ComponentInput, type PayrollRules } from "@/lib/payroll";
import type { DayResult, RecapTotals } from "@/lib/attendance";
import type { PayslipSnapshot } from "@/lib/payslip";
import { formatDateRange } from "@/lib/format";
import { formatRupiah } from "@/lib/money";
import { diffDays, todayIso } from "@/lib/time";
import { isoDate, optionalText, requiredText, rupiah } from "@/lib/validation/common";
import { PAYROLL_STATUS_LABEL, type PayrollStatus } from "@/lib/labels";

const MAX_PERIOD_DAYS = 62;

// ─────────────────────────── Skema ───────────────────────────

export const createRunSchema = z.object({
  label: requiredText(3, 120, "Nama periode"),
  periodStart: isoDate,
  periodEnd: isoDate,
  attendanceStart: isoDate.nullable().optional(),
  attendanceEnd: isoDate.nullable().optional(),
  note: optionalText(500, "Catatan"),
}).superRefine((v, ctx) => {
  if (v.periodEnd < v.periodStart) ctx.addIssue({ code: "custom", path: ["periodEnd"], message: "Tanggal akhir periode tidak boleh sebelum tanggal awal" });
  else if (diffDays(v.periodEnd, v.periodStart) + 1 > MAX_PERIOD_DAYS) ctx.addIssue({ code: "custom", path: ["periodEnd"], message: `Periode maksimal ${MAX_PERIOD_DAYS} hari` });
  const as = v.attendanceStart ?? v.periodStart, ae = v.attendanceEnd ?? v.periodEnd;
  if (ae < as) ctx.addIssue({ code: "custom", path: ["attendanceEnd"], message: "Akhir periode absensi tidak boleh sebelum awalnya" });
  else if (diffDays(ae, as) + 1 > MAX_PERIOD_DAYS) ctx.addIssue({ code: "custom", path: ["attendanceEnd"], message: `Periode absensi maksimal ${MAX_PERIOD_DAYS} hari` });
});

// ─────────────────────────── DTO ───────────────────────────

export interface RunDto {
  id: string;
  runNumber: number;
  label: string;
  periodStart: string;
  periodEnd: string;
  attendanceStart: string;
  attendanceEnd: string;
  status: PayrollStatus;
  note: string | null;
  calculatedAt: string | null;
  createdBy: string | null;
  submittedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  approvalNote: string | null;
  returnedNote: string | null;
  issuedBy: string | null;
  issuedAt: string | null;
  issueDate: string | null;
  cancelledBy: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  revisionOfId: string | null;
  revisionOfLabel: string | null;
  itemCount: number;
  totalEarnings: number;
  totalDeductions: number;
  totalNet: number;
}

export interface ItemSummary {
  id: string;
  employeeId: string;
  employeeNo: string;
  name: string;
  position: string;
  division: string | null;
  baseSalary: number;
  totalEarnings: number;
  totalDeductions: number;
  netPay: number;
  warnings: string[];
  /** Data absensi/jadwal/pengajuan berubah sejak dihitung. */
  stale: boolean;
  payslipId: string | null;
  payslipNumber: string | null;
}

export interface LineDto {
  id: string;
  kind: "EARNING" | "DEDUCTION";
  category: string;
  name: string;
  source: string;
  amount: number;
  formula: string | null;
  reason: string | null;
}

type RunRow = Prisma.PayrollRunGetPayload<{ include: { revisionOf: { select: { label: true } } } }>;

async function userNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  if (!uniq.length) return new Map();
  const u = await prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } });
  return new Map(u.map((x) => [x.id, x.name]));
}

async function toRunDtos(rows: RunRow[]): Promise<RunDto[]> {
  const names = await userNames(rows.flatMap((r) => [r.createdById, r.approvedById, r.issuedById, r.cancelledById]));
  const sums = await prisma.payrollItem.groupBy({
    by: ["runId"], where: { runId: { in: rows.map((r) => r.id) } }, _count: { _all: true },
    _sum: { totalEarnings: true, totalDeductions: true, netPay: true },
  });
  const m = new Map(sums.map((s) => [s.runId, s]));
  return rows.map((r) => {
    const s = m.get(r.id);
    return {
      id: r.id, runNumber: r.runNumber, label: r.label, periodStart: dateToIso(r.periodStart), periodEnd: dateToIso(r.periodEnd),
      attendanceStart: dateToIso(r.attendanceStart), attendanceEnd: dateToIso(r.attendanceEnd), status: r.status, note: r.note,
      calculatedAt: r.calculatedAt?.toISOString() ?? null, createdBy: names.get(r.createdById) ?? null, submittedAt: r.submittedAt?.toISOString() ?? null,
      approvedBy: r.approvedById ? names.get(r.approvedById) ?? null : null, approvedAt: r.approvedAt?.toISOString() ?? null, approvalNote: r.approvalNote,
      returnedNote: r.returnedNote, issuedBy: r.issuedById ? names.get(r.issuedById) ?? null : null, issuedAt: r.issuedAt?.toISOString() ?? null,
      issueDate: r.issueDate ? dateToIso(r.issueDate) : null, cancelledBy: r.cancelledById ? names.get(r.cancelledById) ?? null : null,
      cancelledAt: r.cancelledAt?.toISOString() ?? null, cancelReason: r.cancelReason, revisionOfId: r.revisionOfId, revisionOfLabel: r.revisionOf?.label ?? null,
      itemCount: s?._count._all ?? 0, totalEarnings: Number(s?._sum.totalEarnings ?? 0), totalDeductions: Number(s?._sum.totalDeductions ?? 0), totalNet: Number(s?._sum.netPay ?? 0),
    };
  });
}

const runInclude = { revisionOf: { select: { label: true } } } satisfies Prisma.PayrollRunInclude;

export async function listRuns(actor: Actor, opts: { includeCancelled?: boolean } = {}): Promise<RunDto[]> {
  assertCan(actor, "payroll:view");
  const rows = await prisma.payrollRun.findMany({
    where: opts.includeCancelled ? {} : { status: { not: "CANCELLED" } },
    include: runInclude, orderBy: [{ periodStart: "desc" }, { runNumber: "desc" }], take: 100,
  });
  return toRunDtos(rows);
}

async function loadRun(id: string): Promise<RunRow> {
  const r = await prisma.payrollRun.findUnique({ where: { id }, include: runInclude });
  if (!r) throw Errors.notFound("Periode penggajian");
  return r;
}

/** Hash sumber terkini per karyawan untuk mendeteksi data yang berubah sejak dihitung. */
async function currentHashes(run: { attendanceStart: Date; attendanceEnd: Date }, employeeIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!employeeIds.length) return out;
  const emps = await prisma.employee.findMany({ where: { id: { in: employeeIds } } });
  const from = dateToIso(run.attendanceStart), to = dateToIso(run.attendanceEnd);
  const ctx = await loadRangeContext(from, to, { employeeIds });
  for (const e of emps) out.set(e.id, sourceHash(computeEmployeePeriod(employeeLite(e), ctx).days));
  return out;
}

export interface RunDetail {
  run: RunDto;
  items: ItemSummary[];
  rules: PayrollRules;
  rulesConfirmedAt: string | null;
  /** Aturan yang dipakai saat dihitung (snapshot) — untuk ditampilkan pada pemeriksaan. */
  rulesSnapshot: PayrollRules | null;
  staleCount: number;
  warningCount: number;
  negativeCount: number;
  /** Periode absensi belum berakhir (data belum final). */
  attendanceOngoing: boolean;
}

export async function getRun(actor: Actor, id: string): Promise<RunDetail> {
  assertCan(actor, "payroll:view");
  const run = await loadRun(id);
  const [items, settings, slips] = await Promise.all([
    prisma.payrollItem.findMany({ where: { runId: id }, orderBy: { employeeName: "asc" } }),
    getSettings(),
    prisma.payslip.findMany({ where: { runId: id }, select: { id: true, itemId: true, number: true } }),
  ]);
  const hashes = run.status === "CANCELLED" ? new Map<string, string>() : await currentHashes(run, items.map((i) => i.employeeId));
  const slipByItem = new Map(slips.map((s) => [s.itemId, s]));
  const summaries: ItemSummary[] = items.map((i) => ({
    id: i.id, employeeId: i.employeeId, employeeNo: i.employeeNo, name: i.employeeName, position: i.position, division: i.divisionName,
    baseSalary: Number(i.baseSalary), totalEarnings: Number(i.totalEarnings), totalDeductions: Number(i.totalDeductions), netPay: Number(i.netPay),
    warnings: (i.warnings as string[] | null) ?? [], stale: hashes.has(i.employeeId) && hashes.get(i.employeeId) !== i.sourceHash,
    payslipId: slipByItem.get(i.id)?.id ?? null, payslipNumber: slipByItem.get(i.id)?.number ?? null,
  }));
  const [dto] = await toRunDtos([run]);
  return {
    run: dto!, items: summaries, rules: payrollRulesOf(settings), rulesConfirmedAt: settings.payrollRulesConfirmedAt?.toISOString() ?? null,
    rulesSnapshot: (run.rulesSnapshot as PayrollRules | null) ?? null,
    staleCount: summaries.filter((s) => s.stale).length, warningCount: summaries.filter((s) => s.warnings.length > 0).length,
    negativeCount: summaries.filter((s) => s.netPay < 0).length,
    attendanceOngoing: dateToIso(run.attendanceEnd) >= todayIso(env().APP_TIMEZONE),
  };
}

export interface ItemDetail {
  run: RunDto;
  item: ItemSummary & { slipNote: string | null; employmentStatus: string; bankName: string | null; bankAccountMasked: string | null };
  lines: LineDto[];
  attendance: { totals: RecapTotals; from: string; to: string };
  /** Hari-hari sumber (kondisi SAAT INI) agar angka dapat ditelusuri; bandingkan dengan ringkasan saat dihitung. */
  days: DayResult[];
  editable: boolean;
}

export async function getItem(actor: Actor, itemId: string): Promise<ItemDetail> {
  assertCan(actor, "payroll:view");
  const item = await prisma.payrollItem.findUnique({ where: { id: itemId }, include: { lines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }, payslip: { select: { id: true, number: true } } } });
  if (!item) throw Errors.notFound("Item penggajian");
  const run = await loadRun(item.runId);
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: item.employeeId } });
  const from = dateToIso(run.attendanceStart), to = dateToIso(run.attendanceEnd);
  const ctx = await loadRangeContext(from, to, { employeeIds: [emp.id] });
  const { days } = computeEmployeePeriod(employeeLite(emp), ctx);
  const stale = run.status !== "CANCELLED" && sourceHash(days) !== item.sourceHash;
  const [dto] = await toRunDtos([run]);
  const summary = item.attendanceSummary as unknown as { totals: RecapTotals };
  return {
    run: dto!,
    item: {
      id: item.id, employeeId: item.employeeId, employeeNo: item.employeeNo, name: item.employeeName, position: item.position, division: item.divisionName,
      baseSalary: Number(item.baseSalary), totalEarnings: Number(item.totalEarnings), totalDeductions: Number(item.totalDeductions), netPay: Number(item.netPay),
      warnings: (item.warnings as string[] | null) ?? [], stale, payslipId: item.payslip?.id ?? null, payslipNumber: item.payslip?.number ?? null,
      slipNote: item.slipNote, employmentStatus: item.employmentStatus, bankName: item.bankName, bankAccountMasked: item.bankAccountMasked,
    },
    lines: item.lines.map((l) => ({ id: l.id, kind: l.kind, category: l.category, name: l.name, source: l.source, amount: Number(l.amount), formula: l.formula, reason: l.reason })),
    attendance: { totals: summary.totals, from, to },
    days, editable: run.status === "DRAFT",
  };
}

// ─────────────────────────── Buat & hitung ───────────────────────────

export async function createRun(actor: Actor, raw: unknown): Promise<{ id: string; skipped: SkippedEmployee[] }> {
  assertCan(actor, "payroll:prepare");
  const input = parseInput(createRunSchema, raw);
  const attendanceStart = input.attendanceStart ?? input.periodStart;
  const attendanceEnd = input.attendanceEnd ?? input.periodEnd;
  const id = await transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('payroll_runs'))`;
    // Periode penggajian aktif tidak boleh beririsan (satu karyawan tidak boleh digaji dua kali untuk hari yang sama).
    const clash = await tx.payrollRun.findFirst({
      where: { status: { not: "CANCELLED" }, periodStart: { lte: isoToDate(input.periodEnd) }, periodEnd: { gte: isoToDate(input.periodStart) } },
    });
    if (clash) {
      throw Errors.conflict(`Periode bertabrakan dengan "${clash.label}" (${formatDateRange(dateToIso(clash.periodStart), dateToIso(clash.periodEnd))}, ${PAYROLL_STATUS_LABEL[clash.status].toLowerCase()}). Batalkan periode itu terlebih dulu bila ingin menggantinya.`);
    }
    const run = await tx.payrollRun.create({
      data: {
        label: input.label, periodStart: isoToDate(input.periodStart), periodEnd: isoToDate(input.periodEnd),
        attendanceStart: isoToDate(attendanceStart), attendanceEnd: isoToDate(attendanceEnd), note: input.note, createdById: actor.userId,
      },
    });
    await writeAudit(tx, actor, {
      action: "payroll.create", entityType: "PayrollRun", entityId: run.id, summary: `Periode penggajian "${run.label}" dibuat`,
      after: { period: [input.periodStart, input.periodEnd], attendance: [attendanceStart, attendanceEnd] },
    });
    return run.id;
  });
  const { skipped } = await calculateRun(actor, id);
  return { id, skipped };
}

export interface SkippedEmployee { employeeId: string; name: string; employeeNo: string; reason: string }

/**
 * Hitung (ulang) seluruh item periode DRAFT dari data TERKINI: rekap absensi pada periode absensi + komponen gaji berlaku
 * + aturan penggajian saat ini (dibekukan di `rulesSnapshot`). Penyesuaian manual dipertahankan.
 */
export async function calculateRun(actor: Actor, runId: string): Promise<{ itemCount: number; skipped: SkippedEmployee[] }> {
  assertCan(actor, "payroll:prepare");
  const run = await loadRun(runId);
  if (run.status !== "DRAFT") throw Errors.conflict("Hanya periode berstatus Draf yang dapat dihitung ulang.");
  const settings = await getSettings();
  const rules = payrollRulesOf(settings);
  const period = { start: dateToIso(run.periodStart), end: dateToIso(run.periodEnd) };
  const attFrom = dateToIso(run.attendanceStart), attTo = dateToIso(run.attendanceEnd);

  const employees = await prisma.employee.findMany({
    where: {
      joinDate: { lte: run.periodEnd },
      OR: [{ isActive: true, endDate: null }, { endDate: { gte: run.periodStart } }],
    },
    include: { division: { select: { name: true } } },
    orderBy: { fullName: "asc" },
  });
  const ids = employees.map((e) => e.id);
  const [ctx, comps, oldAdj, oldItems] = await Promise.all([
    loadRangeContext(attFrom, attTo, { employeeIds: ids }),
    prisma.salaryComponent.findMany({ where: { employeeId: { in: ids }, isActive: true } }),
    prisma.payrollItemLine.findMany({ where: { source: "ADJUSTMENT", item: { runId } }, include: { item: { select: { employeeId: true } } } }),
    prisma.payrollItem.findMany({ where: { runId }, select: { employeeId: true, slipNote: true } }),
  ]);
  const compsBy = new Map<string, ComponentInput[]>();
  for (const c of comps) {
    const arr = compsBy.get(c.employeeId) ?? [];
    arr.push({
      id: c.id, kind: c.kind, category: c.category, name: c.name, calc: c.calc, amount: Number(c.amount), percentBp: c.percentBp, recurrence: c.recurrence,
      effectiveFrom: dateToIso(c.effectiveFrom), effectiveTo: c.effectiveTo ? dateToIso(c.effectiveTo) : null, description: c.description, isActive: c.isActive,
    });
    compsBy.set(c.employeeId, arr);
  }
  const adjBy = new Map<string, typeof oldAdj>();
  for (const a of oldAdj) adjBy.set(a.item.employeeId, [...(adjBy.get(a.item.employeeId) ?? []), a]);
  const noteBy = new Map(oldItems.map((i) => [i.employeeId, i.slipNote]));

  const skipped: SkippedEmployee[] = [];
  const itemRows: Prisma.PayrollItemCreateManyInput[] = [];
  const lineRows: Prisma.PayrollItemLineCreateManyInput[] = [];
  for (const e of employees) {
    const { days, totals } = computeEmployeePeriod(employeeLite(e), ctx);
    const calc = computeItem({ components: compsBy.get(e.id) ?? [], rules, totals, days, period });
    const adj = adjBy.get(e.id) ?? [];
    // Dilewati bila tidak ada komponen gaji sama sekali: baris dari aturan (potongan/lembur otomatis) saja tidak cukup
    // untuk memasukkan karyawan ke penggajian — kalau tidak, karyawan tanpa gaji akan bergaji bersih negatif.
    const hasComponents = calc.lines.some((l) => l.source === "COMPONENT");
    if (!hasComponents && adj.length === 0) {
      skipped.push({ employeeId: e.id, name: e.fullName, employeeNo: e.employeeNo, reason: "Tidak ada komponen gaji yang berlaku pada periode ini" });
      continue;
    }
    const lines = [
      ...calc.lines.map((l) => ({ ...l, createdById: null as string | null })),
      ...adj.map((a) => ({ kind: a.kind, category: a.category, name: a.name, source: "ADJUSTMENT" as const, amount: Number(a.amount), formula: a.formula, reason: a.reason, componentId: null, createdById: a.createdById })),
    ];
    const t = totalsFromLines(lines);
    const itemId = randomUUID();
    itemRows.push({
      id: itemId, runId, employeeId: e.id, employeeNo: e.employeeNo, employeeName: e.fullName, position: e.position, divisionName: e.division?.name ?? null,
      employmentStatus: e.employmentStatus, bankName: e.bankName, bankAccountMasked: maskAccount(e.bankAccountLast4),
      baseSalary: BigInt(calc.baseSalary), totalEarnings: BigInt(t.totalEarnings), totalDeductions: BigInt(t.totalDeductions), netPay: BigInt(t.netPay),
      attendanceSummary: { totals, from: attFrom, to: attTo } as unknown as Prisma.InputJsonValue, sourceHash: sourceHash(days),
      warnings: (t.netPay < 0 && !calc.warnings.some((w) => w.includes("negatif")) ? [...calc.warnings, "Gaji bersih negatif — sesuaikan sebelum diajukan."] : calc.warnings) as unknown as Prisma.InputJsonValue,
      slipNote: noteBy.get(e.id) ?? null,
    });
    lines.forEach((l, idx) => lineRows.push({
      itemId, kind: l.kind, category: l.category, name: l.name, source: l.source, amount: BigInt(l.amount), formula: l.formula, reason: l.reason,
      componentId: l.componentId, sortOrder: idx, createdById: l.createdById,
    }));
  }

  await transaction(async (tx) => {
    const fresh = await tx.payrollRun.findUniqueOrThrow({ where: { id: runId }, select: { status: true } });
    if (fresh.status !== "DRAFT") throw Errors.conflict("Status periode berubah. Muat ulang halaman.");
    await tx.payrollItemLine.deleteMany({ where: { item: { runId } } });
    await tx.payrollItem.deleteMany({ where: { runId } });
    if (itemRows.length) await tx.payrollItem.createMany({ data: itemRows });
    if (lineRows.length) await tx.payrollItemLine.createMany({ data: lineRows });
    await tx.payrollRun.update({ where: { id: runId }, data: { rulesSnapshot: rules as unknown as Prisma.InputJsonValue, calculatedAt: new Date() } });
    await writeAudit(tx, actor, {
      action: "payroll.calculate", entityType: "PayrollRun", entityId: runId,
      summary: `Gaji "${run.label}" dihitung: ${itemRows.length} karyawan${skipped.length ? `, ${skipped.length} dilewati` : ""}`,
      after: { items: itemRows.length, skipped: skipped.map((s) => s.employeeNo), rules },
    });
  });
  return { itemCount: itemRows.length, skipped };
}

// ─────────────────────────── Penyesuaian (hanya Draf) ───────────────────────────

const adjustmentSchema = z.object({
  kind: z.enum(["EARNING", "DEDUCTION"]),
  name: requiredText(2, 100, "Nama penyesuaian"),
  amount: rupiah("Nominal").refine((n) => n > 0, "Nominal harus lebih dari 0"),
  reason: requiredText(5, 300, "Alasan penyesuaian"),
});

async function refreshItemTotals(tx: Prisma.TransactionClient, itemId: string) {
  const lines = await tx.payrollItemLine.findMany({ where: { itemId } });
  const t = totalsFromLines(lines.map((l) => ({ kind: l.kind, amount: Number(l.amount) })));
  await tx.payrollItem.update({ where: { id: itemId }, data: { totalEarnings: BigInt(t.totalEarnings), totalDeductions: BigInt(t.totalDeductions), netPay: BigInt(t.netPay) } });
  return t;
}

async function draftItem(tx: Prisma.TransactionClient, itemId: string) {
  const item = await tx.payrollItem.findUnique({ where: { id: itemId }, include: { run: { select: { id: true, status: true, label: true } } } });
  if (!item) throw Errors.notFound("Item penggajian");
  if (item.run.status !== "DRAFT") throw Errors.conflict("Penyesuaian hanya dapat dilakukan pada periode berstatus Draf.");
  return item;
}

export async function addAdjustment(actor: Actor, itemId: string, raw: unknown): Promise<void> {
  assertCan(actor, "payroll:prepare");
  const input = parseInput(adjustmentSchema, raw);
  await transaction(async (tx) => {
    const item = await draftItem(tx, itemId);
    const max = await tx.payrollItemLine.aggregate({ where: { itemId }, _max: { sortOrder: true } });
    await tx.payrollItemLine.create({
      data: {
        itemId, kind: input.kind, category: input.kind === "EARNING" ? "OTHER_EARNING" : "OTHER_DEDUCTION", name: input.name, source: "ADJUSTMENT",
        amount: BigInt(input.amount), formula: "Penyesuaian manual", reason: input.reason, sortOrder: (max._max.sortOrder ?? 0) + 1, createdById: actor.userId,
      },
    });
    const t = await refreshItemTotals(tx, itemId);
    await writeAudit(tx, actor, {
      action: "payroll.adjust", entityType: "PayrollItem", entityId: itemId,
      summary: `Penyesuaian ${input.kind === "EARNING" ? "pendapatan" : "potongan"} "${input.name}" ${formatRupiah(input.amount)} pada ${item.employeeName} (${item.run.label})`,
      after: { ...input, netPay: t.netPay }, reason: input.reason,
    });
  });
}

export async function removeAdjustment(actor: Actor, lineId: string): Promise<void> {
  assertCan(actor, "payroll:prepare");
  await transaction(async (tx) => {
    const line = await tx.payrollItemLine.findUnique({ where: { id: lineId } });
    if (!line) throw Errors.notFound("Rincian");
    if (line.source !== "ADJUSTMENT") throw Errors.validation("Hanya penyesuaian manual yang dapat dihapus. Ubah komponen gaji lalu hitung ulang.");
    const item = await draftItem(tx, line.itemId);
    await tx.payrollItemLine.delete({ where: { id: lineId } });
    const t = await refreshItemTotals(tx, item.id);
    await writeAudit(tx, actor, {
      action: "payroll.adjust_remove", entityType: "PayrollItem", entityId: item.id,
      summary: `Penyesuaian "${line.name}" dihapus dari ${item.employeeName} (${item.run.label})`, before: { name: line.name, amount: Number(line.amount), reason: line.reason }, after: { netPay: t.netPay },
    });
  });
}

export async function setSlipNote(actor: Actor, itemId: string, raw: unknown): Promise<void> {
  assertCan(actor, "payroll:prepare");
  const { note } = parseInput(z.object({ note: optionalText(400, "Catatan slip") }), raw);
  await transaction(async (tx) => {
    const item = await draftItem(tx, itemId);
    await tx.payrollItem.update({ where: { id: itemId }, data: { slipNote: note } });
    await writeAudit(tx, actor, { action: "payroll.slip_note", entityType: "PayrollItem", entityId: itemId, summary: `Catatan slip ${item.employeeName} diubah`, after: { note } });
  });
}

// ─────────────────────────── Alur status ───────────────────────────

async function assertFresh(run: RunRow): Promise<void> {
  const items = await prisma.payrollItem.findMany({ where: { runId: run.id }, select: { employeeId: true, sourceHash: true, employeeName: true } });
  const now = await currentHashes(run, items.map((i) => i.employeeId));
  const stale = items.filter((i) => now.get(i.employeeId) !== i.sourceHash);
  if (stale.length) {
    throw Errors.conflict(`Data absensi/jadwal/pengajuan berubah sejak penghitungan untuk ${stale.length} karyawan (${stale.slice(0, 3).map((s) => s.employeeName).join(", ")}${stale.length > 3 ? ", …" : ""}). Kembalikan ke Draf dan hitung ulang.`);
  }
}

async function transition(
  actor: Actor, runId: string, from: PayrollStatus[], to: PayrollStatus, data: Prisma.PayrollRunUncheckedUpdateManyInput,
  audit: { action: string; summary: string; reason?: string | null; extra?: (tx: Prisma.TransactionClient) => Promise<void> },
): Promise<void> {
  await transaction(async (tx) => {
    const r = await tx.payrollRun.updateMany({ where: { id: runId, status: { in: from } }, data: { ...data, status: to } });
    if (r.count === 0) {
      const cur = await tx.payrollRun.findUnique({ where: { id: runId }, select: { status: true } });
      if (!cur) throw Errors.notFound("Periode penggajian");
      throw Errors.conflict(`Tindakan tidak dapat dilakukan pada status "${PAYROLL_STATUS_LABEL[cur.status]}".`);
    }
    await writeAudit(tx, actor, { action: audit.action, entityType: "PayrollRun", entityId: runId, summary: audit.summary, before: { status: from }, after: { status: to }, reason: audit.reason });
    await audit.extra?.(tx);
  });
}

export async function submitRun(actor: Actor, runId: string): Promise<void> {
  assertCan(actor, "payroll:prepare");
  const run = await loadRun(runId);
  if (run.status !== "DRAFT") throw Errors.conflict("Hanya periode berstatus Draf yang dapat diajukan.");
  if (!run.calculatedAt) throw Errors.validation("Hitung gaji terlebih dulu.");
  const items = await prisma.payrollItem.findMany({ where: { runId }, select: { employeeName: true, netPay: true } });
  if (items.length === 0) throw Errors.validation("Tidak ada karyawan pada periode ini. Periksa komponen gaji karyawan, lalu hitung ulang.");
  const neg = items.filter((i) => i.netPay < 0n);
  if (neg.length) throw Errors.validation(`Gaji bersih negatif untuk ${neg.map((n) => n.employeeName).join(", ")}. Lakukan penyesuaian atau perbaiki komponen sebelum mengajukan.`);
  if (dateToIso(run.attendanceEnd) >= todayIso(env().APP_TIMEZONE)) {
    throw Errors.validation(`Periode absensi (s.d. ${dateToIso(run.attendanceEnd)}) belum berakhir sehingga data kehadiran belum final. Ajukan setelah periode berakhir, atau buat periode dengan batas absensi lebih awal (cut-off).`);
  }
  await assertFresh(run);
  await transition(actor, runId, ["DRAFT"], "PENDING_APPROVAL", { submittedById: actor.userId, submittedAt: new Date(), returnedNote: null }, {
    action: "payroll.submit", summary: `Gaji "${run.label}" diajukan untuk persetujuan`,
    extra: async (tx) => notifyUsers(tx, await superAdminUserIds(tx, actor.userId), { type: "payroll.submitted", title: "Penggajian menunggu persetujuan", body: `${run.label} · ${items.length} karyawan`, href: `/penggajian/${runId}` }),
  });
}

const noteSchema = z.object({ note: optionalText(500, "Catatan") });
const requiredNoteSchema = z.object({ note: requiredText(5, 500, "Catatan") });

/** Pimpinan mengembalikan periode ke Draf (dari Menunggu Persetujuan atau Disetujui) dengan catatan wajib. */
export async function returnRun(actor: Actor, runId: string, raw: unknown): Promise<void> {
  assertCan(actor, "payroll:approve");
  const { note } = parseInput(requiredNoteSchema, raw);
  const run = await loadRun(runId);
  await transition(actor, runId, ["PENDING_APPROVAL", "APPROVED"], "DRAFT", { returnedNote: note, approvedById: null, approvedAt: null, approvalNote: null, submittedAt: null, submittedById: null }, {
    action: "payroll.return", summary: `Gaji "${run.label}" dikembalikan ke Draf`, reason: note,
    extra: async (tx) => notifyUsers(tx, [run.createdById], { type: "payroll.returned", title: "Penggajian dikembalikan ke Draf", body: `${run.label} · ${note}`, href: `/penggajian/${runId}` }),
  });
}

export async function approveRun(actor: Actor, runId: string, raw: unknown = {}): Promise<void> {
  assertCan(actor, "payroll:approve");
  const { note } = parseInput(noteSchema, raw ?? {});
  const run = await loadRun(runId);
  if (run.status !== "PENDING_APPROVAL") throw Errors.conflict("Hanya periode berstatus Menunggu Persetujuan yang dapat disetujui.");
  const settings = await getSettings();
  if (!settings.payrollRulesConfirmedAt) {
    throw Errors.validation("Aturan penggajian belum dikonfirmasi. Buka Pengaturan → Aturan Penggajian, periksa kesesuaiannya dengan kebijakan perusahaan dan ketentuan yang berlaku, lalu konfirmasi.");
  }
  await assertFresh(run);
  await transition(actor, runId, ["PENDING_APPROVAL"], "APPROVED", { approvedById: actor.userId, approvedAt: new Date(), approvalNote: note }, {
    action: "payroll.approve", summary: `Gaji "${run.label}" disetujui`, reason: note,
    extra: async (tx) => notifyUsers(tx, [run.createdById], { type: "payroll.approved", title: "Penggajian disetujui", body: `${run.label} siap diterbitkan`, href: `/penggajian/${runId}` }),
  });
}

const issueSchema = z.object({ issueDate: isoDate.optional() });

/** Terbitkan slip: salin item → `payslips` (snapshot terkunci), nomor slip unik, periode menjadi DITERBITKAN. */
export async function issueRun(actor: Actor, runId: string, raw: unknown = {}): Promise<{ slips: number }> {
  assertCan(actor, "payroll:prepare");
  const input = parseInput(issueSchema, raw ?? {});
  const run = await loadRun(runId);
  if (run.status !== "APPROVED") throw Errors.conflict("Slip hanya dapat diterbitkan untuk periode berstatus Disetujui.");
  await assertFresh(run);
  const tz = env().APP_TIMEZONE;
  const issueDate = input.issueDate ?? todayIso(tz);
  const settings = await getSettings();

  return transaction(async (tx) => {
    const lock = await tx.payrollRun.updateMany({ where: { id: runId, status: "APPROVED" }, data: { status: "ISSUED", issuedAt: new Date(), issuedById: actor.userId, issueDate: isoToDate(issueDate) } });
    if (lock.count === 0) throw Errors.conflict("Periode sudah diterbitkan atau berubah status.");
    const items = await tx.payrollItem.findMany({ where: { runId }, include: { lines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] } }, orderBy: { employeeNo: "asc" } });
    if (items.length === 0) throw Errors.validation("Tidak ada item untuk diterbitkan.");
    const prior = run.revisionOfId ? await tx.payslip.findMany({ where: { runId: run.revisionOfId }, select: { employeeId: true, number: true } }) : [];
    const priorNo = new Map(prior.map((p) => [p.employeeId, p.number]));
    const ym = dateToIso(run.periodEnd).slice(0, 7).replace("-", "");
    const period = { start: dateToIso(run.periodStart), end: dateToIso(run.periodEnd), label: run.label };
    const basis = { start: dateToIso(run.attendanceStart), end: dateToIso(run.attendanceEnd) };

    const empIds = items.map((i) => i.employeeId);
    const employees = await tx.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, userId: true } });
    const userByEmp = new Map(employees.map((e) => [e.id, e.userId]));

    let seq = 0;
    for (const it of items) {
      seq++;
      const number = `${settings.slipNumberPrefix}-${ym}-R${String(run.runNumber).padStart(2, "0")}-${String(seq).padStart(3, "0")}`;
      const toLine = (l: (typeof it.lines)[number]) => ({
        name: l.name, category: l.category, amount: Number(l.amount), formula: l.formula, note: l.source === "ADJUSTMENT" ? l.reason : l.source === "COMPONENT" ? l.reason : null, manual: l.source === "ADJUSTMENT",
      });
      const snapshot: PayslipSnapshot = {
        version: 1, number,
        company: { name: settings.name, legalName: settings.legalName, tagline: settings.tagline, address: settings.address, phone: settings.phone, email: settings.email, website: settings.website, logoFileId: settings.logoFileId },
        employee: {
          id: it.employeeId, employeeNo: it.employeeNo, name: it.employeeName, position: it.position, division: it.divisionName,
          employmentStatus: it.employmentStatus, bankName: it.bankName, bankAccountMasked: it.bankAccountMasked,
        },
        period, attendanceBasis: basis, issueDate,
        earnings: it.lines.filter((l) => l.kind === "EARNING").map(toLine), deductions: it.lines.filter((l) => l.kind === "DEDUCTION").map(toLine),
        totalEarnings: Number(it.totalEarnings), totalDeductions: Number(it.totalDeductions), netPay: Number(it.netPay),
        attendance: settings.slipShowAttendance ? (it.attendanceSummary as unknown as { totals: RecapTotals }).totals : null,
        note: it.slipNote, footerNote: settings.slipFooterNote,
        revisionNote: run.revisionOfId ? `Slip ini merupakan revisi dari periode "${run.revisionOf?.label ?? "sebelumnya"}"${priorNo.get(it.employeeId) ? ` (menggantikan slip ${priorNo.get(it.employeeId)})` : ""}.` : null,
      };
      await tx.payslip.create({
        data: { runId, itemId: it.id, employeeId: it.employeeId, number, issueDate: isoToDate(issueDate), netPay: it.netPay, snapshot: snapshot as unknown as Prisma.InputJsonValue },
      });
      const uid = userByEmp.get(it.employeeId);
      if (uid) await notifyUsers(tx, [uid], { type: "payslip.issued", title: "Slip gaji baru tersedia", body: `${run.label} · No. ${number}`, href: "/slip-saya" });
    }
    await writeAudit(tx, actor, {
      action: "payroll.issue", entityType: "PayrollRun", entityId: runId, summary: `Slip gaji "${run.label}" diterbitkan (${items.length} slip, tanggal ${issueDate})`,
      before: { status: "APPROVED" }, after: { status: "ISSUED", slips: items.length, issueDate },
    });
    return { slips: items.length };
  });
}

const cancelSchema = z.object({ reason: requiredText(5, 500, "Alasan pembatalan") });

/**
 * Batalkan periode. Draf/Menunggu persetujuan: Admin/HR atau pimpinan. Disetujui/Diterbitkan: HANYA pimpinan (payroll:revoke).
 * Pembatalan periode terbit membatalkan seluruh slip (status VOID, tetap tersimpan) — karyawan tidak lagi melihatnya.
 */
export async function cancelRun(actor: Actor, runId: string, raw: unknown): Promise<void> {
  const { reason } = parseInput(cancelSchema, raw);
  const run = await loadRun(runId);
  if (run.status === "CANCELLED") throw Errors.conflict("Periode sudah dibatalkan.");
  if (run.status === "APPROVED" || run.status === "ISSUED") assertCan(actor, "payroll:revoke");
  else assertCan(actor, "payroll:prepare");
  const wasIssued = run.status === "ISSUED";
  await transition(actor, runId, ["DRAFT", "PENDING_APPROVAL", "APPROVED", "ISSUED"], "CANCELLED", { cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason }, {
    action: wasIssued ? "payroll.revoke" : "payroll.cancel", summary: `Gaji "${run.label}" dibatalkan${wasIssued ? " (slip dibatalkan)" : ""}`, reason,
    extra: async (tx) => {
      if (!wasIssued) return;
      const slips = await tx.payslip.findMany({ where: { runId, status: "ACTIVE" }, select: { id: true, employeeId: true } });
      await tx.payslip.updateMany({ where: { runId, status: "ACTIVE" }, data: { status: "VOIDED", voidedAt: new Date(), voidReason: reason, voidedById: actor.userId } });
      const emps = await tx.employee.findMany({ where: { id: { in: slips.map((s) => s.employeeId) } }, select: { userId: true } });
      await notifyUsers(tx, emps.map((e) => e.userId).filter((x): x is string => !!x), { type: "payslip.voided", title: "Slip gaji dibatalkan", body: `${run.label} — slip akan diterbitkan ulang setelah revisi.`, href: "/slip-saya" });
    },
  });
}

const revisionSchema = z.object({ label: optionalText(120, "Nama periode") });

/** Buat periode revisi (Draf baru) dari periode yang dibatalkan: rentang sama, `revisionOf` menjaga jejak. */
export async function createRevision(actor: Actor, runId: string, raw: unknown = {}): Promise<{ id: string }> {
  assertCan(actor, "payroll:prepare");
  const input = parseInput(revisionSchema, raw ?? {});
  const src = await loadRun(runId);
  if (src.status !== "CANCELLED") throw Errors.conflict("Revisi hanya dapat dibuat dari periode yang sudah dibatalkan.");
  const id = await transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('payroll_runs'))`;
    const clash = await tx.payrollRun.findFirst({ where: { status: { not: "CANCELLED" }, periodStart: { lte: src.periodEnd }, periodEnd: { gte: src.periodStart } } });
    if (clash) throw Errors.conflict(`Sudah ada periode aktif pada rentang ini ("${clash.label}"). Batalkan atau selesaikan terlebih dulu.`);
    const run = await tx.payrollRun.create({
      data: {
        label: input.label ?? `${src.label.replace(/ \(Revisi.*\)$/, "")} (Revisi)`, periodStart: src.periodStart, periodEnd: src.periodEnd,
        attendanceStart: src.attendanceStart, attendanceEnd: src.attendanceEnd, note: `Revisi dari "${src.label}". Alasan pembatalan: ${src.cancelReason ?? "-"}`,
        createdById: actor.userId, revisionOfId: src.id,
      },
    });
    await writeAudit(tx, actor, { action: "payroll.revision", entityType: "PayrollRun", entityId: run.id, summary: `Revisi dari "${src.label}" dibuat`, after: { revisionOfId: src.id } });
    return run.id;
  });
  await calculateRun(actor, id);
  return { id };
}

export async function currentPayrollSummary(): Promise<{ run: RunDto | null; latestIssued: RunDto | null }> {
  const today = todayIso(env().APP_TIMEZONE);
  const active = await prisma.payrollRun.findFirst({
    where: { status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED"] } }, include: runInclude, orderBy: { periodStart: "desc" },
  });
  const latestIssued = await prisma.payrollRun.findFirst({ where: { status: "ISSUED" }, include: runInclude, orderBy: { periodEnd: "desc" } });
  const ongoing = await prisma.payrollRun.findFirst({
    where: { status: { not: "CANCELLED" }, periodStart: { lte: isoToDate(today) }, periodEnd: { gte: isoToDate(today) } }, include: runInclude,
  });
  const pick = active ?? ongoing;
  const dtos = await toRunDtos([pick, latestIssued].filter((x): x is RunRow => !!x));
  return { run: pick ? dtos[0]! : null, latestIssued: latestIssued ? dtos[pick ? 1 : 0]! : null };
}
