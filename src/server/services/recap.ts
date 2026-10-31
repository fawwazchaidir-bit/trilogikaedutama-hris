import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import { actorCan, requireSelf, type Actor } from "../actor";
import { writeAudit } from "../audit";
import { computeEmployeePeriod, employeeLite, loadRangeContext } from "./context";
import { photosForRange } from "./attendance-photo";
import type { ReportTable } from "../export";
import { emptyTotals, STATUS_LABEL, type DayResult, type DayStatus, type RecapTotals } from "@/lib/attendance";
import { formatDateLong, formatDateRange, formatHours, monthLabel } from "@/lib/format";
import { diffDays, endOfIsoWeek, isValidIsoDate, isValidYearMonth, monthRange, startOfIsoWeek, todayIso } from "@/lib/time";
import { isoDate, uuid } from "@/lib/validation/common";
import type { Paged } from "@/lib/types";

export const RECAP_VIEWS = ["harian", "mingguan", "bulanan", "kustom"] as const;
export type RecapView = (typeof RECAP_VIEWS)[number];

/** Filter status: salah satu status harian, atau "BELUM_CHECKOUT" (ada check-in tanpa check-out). */
export const RECAP_STATUS_FILTERS = ["HADIR", "TERLAMBAT", "IZIN", "SAKIT", "CUTI", "TIDAK_HADIR", "LIBUR", "BELUM_ABSEN", "BELUM_CHECKOUT"] as const;

export const recapQuerySchema = z.object({
  view: z.enum(RECAP_VIEWS).optional(),
  date: isoDate.optional(),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  employeeId: uuid.optional(),
  divisionId: uuid.optional(),
  q: z.string().trim().max(100).optional(),
  status: z.enum(RECAP_STATUS_FILTERS).optional(),
  includeInactive: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

export interface RecapRow {
  employeeId: string;
  employeeNo: string;
  name: string;
  position: string;
  division: string | null;
  totals: RecapTotals;
  /** Hanya untuk tampilan harian (1 hari) dan detail. */
  days: DayResult[] | null;
}

export interface RecapResult {
  view: RecapView;
  from: string;
  to: string;
  label: string;
  generatedAt: string;
  page: Paged<RecapRow>;
  /** Jumlah seluruh baris terfilter (bukan hanya halaman ini). */
  summary: RecapTotals & { employees: number };
  today: string;
}

export function resolveRange(q: z.infer<typeof recapQuerySchema>, tz: string): { view: RecapView; from: string; to: string; label: string } {
  const today = todayIso(tz);
  const view = q.view ?? "bulanan";
  if (view === "harian") {
    const d = q.date ?? today;
    return { view, from: d, to: d, label: formatDateLong(d) };
  }
  if (view === "mingguan") {
    const d = q.date ?? today;
    const from = startOfIsoWeek(d);
    const to = endOfIsoWeek(d);
    return { view, from, to, label: `Minggu ${formatDateRange(from, to)}` };
  }
  if (view === "bulanan") {
    const m = q.month ?? today.slice(0, 7);
    if (!isValidYearMonth(m)) throw Errors.validation("Bulan tidak valid.");
    const r = monthRange(m);
    return { view, ...r, label: monthLabel(m) };
  }
  const from = q.from ?? monthRange(today.slice(0, 7)).from;
  const to = q.to ?? today;
  if (!isValidIsoDate(from) || !isValidIsoDate(to)) throw Errors.validation("Tanggal tidak valid.");
  if (to < from) throw Errors.validation("Tanggal akhir tidak boleh sebelum tanggal awal.");
  if (diffDays(to, from) + 1 > 366) throw Errors.validation("Rentang maksimal 366 hari.");
  return { view, from, to, label: formatDateRange(from, to) };
}

function matchesStatus(days: DayResult[], status: z.infer<typeof recapQuerySchema>["status"]): boolean {
  if (!status) return true;
  if (status === "BELUM_CHECKOUT") return days.some((d) => d.missingCheckout);
  if (status === "LIBUR") return days.some((d) => d.status === "LIBUR");
  return days.some((d) => d.status === (status as DayStatus));
}

interface BuiltRecap {
  view: RecapView; from: string; to: string; label: string; generatedAt: string; today: string;
  summary: RecapTotals & { employees: number };
  /** Seluruh baris terfilter (lengkap dengan hari) — pemanggil yang mem-paginasi. */
  rows: RecapRow[];
  pageSize: number;
  pageNo: number;
}

async function buildRecap(actor: Actor, raw: unknown): Promise<BuiltRecap> {
  const q = parseInput(recapQuerySchema, raw);
  const tz = env().APP_TIMEZONE;
  const { view, from, to, label } = resolveRange(q, tz);

  // Hak akses: rekap seluruh karyawan hanya untuk admin; karyawan biasa SELALU dikunci ke dirinya sendiri.
  let selfOnly: string | null = null;
  if (!actorCan(actor, "recap:view_all")) selfOnly = requireSelf(actor);

  // Setiap kondisi ditaruh di AND terpisah: dua klausa OR (pencarian nama & status aktif) pada satu objek akan saling menimpa.
  const conditions: Prisma.EmployeeWhereInput[] = [{ joinDate: { lte: new Date(`${to}T00:00:00Z`) } }];
  if (selfOnly) conditions.push({ id: selfOnly });
  else {
    if (q.employeeId) conditions.push({ id: q.employeeId });
    if (q.divisionId) conditions.push({ divisionId: q.divisionId });
    if (q.q) conditions.push({ OR: [{ fullName: { contains: q.q, mode: "insensitive" } }, { employeeNo: { contains: q.q, mode: "insensitive" } }] });
    // Karyawan yang sudah berhenti tetap muncul bila masa kerjanya beririsan dengan rentang.
    if (!q.includeInactive) conditions.push({ OR: [{ isActive: true }, { endDate: { gte: new Date(`${from}T00:00:00Z`) } }] });
  }
  const employees = await prisma.employee.findMany({
    where: { AND: conditions },
    include: { division: { select: { name: true } } },
    orderBy: { fullName: "asc" },
  });

  const ctx = await loadRangeContext(from, to, { employeeIds: employees.map((e) => e.id) });
  let rows: RecapRow[] = employees.map((e) => {
    const { days, totals } = computeEmployeePeriod(employeeLite(e), ctx);
    return { employeeId: e.id, employeeNo: e.employeeNo, name: e.fullName, position: e.position, division: e.division?.name ?? null, totals, days };
  });
  // Karyawan yang seluruh rentangnya di luar masa kerja tidak ditampilkan.
  rows = rows.filter((r) => r.days!.some((d) => d.status !== "DI_LUAR_MASA_KERJA"));
  if (q.status) rows = rows.filter((r) => matchesStatus(r.days!, q.status));

  const summary = rows.reduce<RecapTotals & { employees: number }>((a, r) => {
    for (const k of Object.keys(a) as (keyof RecapTotals)[]) if (k !== ("employees" as never)) a[k] += r.totals[k];
    a.employees++;
    return a;
  }, { ...emptyTotals(), employees: 0 });

  return {
    view, from, to, label, generatedAt: new Date().toISOString(), today: todayIso(tz), summary, rows,
    pageSize: q.pageSize ?? 25, pageNo: q.page ?? 1,
  };
}

export async function getRecap(actor: Actor, raw: unknown = {}): Promise<RecapResult> {
  const r = await buildRecap(actor, raw);
  const total = r.rows.length;
  // Tampilan harian membawa hari (1 baris/karyawan); tampilan periode cukup total agar respons ringan.
  const items = r.rows
    .slice((r.pageNo - 1) * r.pageSize, r.pageNo * r.pageSize)
    .map((x) => ({ ...x, days: r.view === "harian" ? x.days : null }));
  return {
    view: r.view, from: r.from, to: r.to, label: r.label, generatedAt: r.generatedAt, summary: r.summary, today: r.today,
    page: { items, total, page: r.pageNo, pageSize: r.pageSize, pageCount: Math.max(Math.ceil(total / r.pageSize), 1) },
  };
}

/** Rincian harian satu karyawan pada rentang rekap (untuk penelusuran angka). */
export async function getRecapDetail(actor: Actor, employeeId: string, raw: unknown = {}) {
  const q = parseInput(recapQuerySchema, raw);
  if (!actorCan(actor, "recap:view_all") && actor.employeeId !== employeeId) throw Errors.forbidden();
  const { from, to, label } = resolveRange(q, env().APP_TIMEZONE);
  const e = await prisma.employee.findUnique({ where: { id: employeeId }, include: { division: { select: { name: true } } } });
  if (!e) throw Errors.notFound("Karyawan");
  const ctx = await loadRangeContext(from, to, { employeeIds: [employeeId] });
  const { days, totals } = computeEmployeePeriod(employeeLite(e), ctx);
  const photos = await photosForRange(employeeId, from, to);
  return { employee: { id: e.id, employeeNo: e.employeeNo, name: e.fullName, position: e.position, division: e.division?.name ?? null }, from, to, label, days, totals, photos };
}

// ─────────────────────────── Ekspor ───────────────────────────

export const RECAP_EXPLANATION =
  "Cara hitung: hari kerja terjadwal = hari yang sesuai jadwal karyawan, di luar hari libur/akhir pekan dan di luar masa kerja. " +
  "Hadir = tepat waktu + terlambat. Izin/sakit/cuti = pengajuan DISETUJUI pada hari terjadwal tanpa absensi. Tidak hadir = hari terjadwal yang sudah lewat tanpa absensi dan tanpa pengajuan disetujui. " +
  "Belum lengkap = check-in tanpa check-out pada hari yang sudah lewat. Jam kerja = check-out − check-in (hanya absensi lengkap).";

export async function recapTable(actor: Actor, raw: unknown = {}): Promise<ReportTable> {
  if (!actorCan(actor, "recap:export") && !(actor.employeeId && !actorCan(actor, "recap:view_all"))) throw Errors.forbidden();
  const r = await buildRecap(actor, raw);
  await writeAudit(prisma, actor, { action: "recap.export", entityType: "Recap", summary: `Ekspor rekap absensi ${r.label} (${r.rows.length} karyawan)` });

  if (r.view === "harian") {
    return {
      type: "Rekap_Harian", title: "Rekap Absensi Harian", description: "Rekap harian", disclaimer: RECAP_EXPLANATION, periodLabel: r.label,
      generatedAt: r.generatedAt,
      columns: [
        { key: "no", label: "No. Induk", type: "text", width: 13 }, { key: "name", label: "Nama", type: "text", width: 26 },
        { key: "division", label: "Divisi", type: "text", width: 16 }, { key: "status", label: "Status", type: "text", width: 13 },
        { key: "in", label: "Check-in", type: "text", width: 9 }, { key: "out", label: "Check-out", type: "text", width: 9 },
        { key: "late", label: "Terlambat (mnt)", type: "number", width: 12 }, { key: "hours", label: "Jam Kerja", type: "text", width: 10 },
        { key: "note", label: "Keterangan", type: "text", width: 48 },
      ],
      rows: r.rows.map((x) => {
        const d = x.days![0]!;
        return {
          no: x.employeeNo, name: x.name, division: x.division ?? "", status: STATUS_LABEL[d.status] + (d.missingCheckout ? " (belum check-out)" : ""),
          in: d.checkInTime ?? "", out: d.checkOutTime ?? "", late: d.lateMinutes, hours: d.workedMinutes ? formatHours(d.workedMinutes) : "", note: d.explain,
        };
      }),
      totals: null,
    };
  }

  const t = (x: RecapRow) => x.totals;
  return {
    type: `Rekap_${r.view === "mingguan" ? "Mingguan" : r.view === "bulanan" ? "Bulanan" : "Periode"}`,
    title: `Rekap Absensi ${r.view === "mingguan" ? "Mingguan" : r.view === "bulanan" ? "Bulanan" : "Periode"}`,
    description: "Rekap absensi", disclaimer: RECAP_EXPLANATION, periodLabel: r.label, generatedAt: r.generatedAt,
    columns: [
      { key: "no", label: "No. Induk", type: "text", width: 13 }, { key: "name", label: "Nama", type: "text", width: 26 },
      { key: "division", label: "Divisi", type: "text", width: 16 },
      { key: "scheduled", label: "Hari Kerja", type: "number", width: 10 }, { key: "present", label: "Hadir", type: "number", width: 8 },
      { key: "lateCount", label: "Terlambat (x)", type: "number", width: 11 }, { key: "lateMin", label: "Menit Terlambat", type: "number", width: 12 },
      { key: "izin", label: "Izin", type: "number", width: 7 }, { key: "sakit", label: "Sakit", type: "number", width: 7 }, { key: "cuti", label: "Cuti", type: "number", width: 7 },
      { key: "absent", label: "Tidak Hadir", type: "number", width: 10 }, { key: "incomplete", label: "Belum Lengkap", type: "number", width: 11 },
      { key: "hours", label: "Jam Kerja", type: "text", width: 10 },
    ],
    rows: r.rows.map((x) => ({
      no: x.employeeNo, name: x.name, division: x.division ?? "", scheduled: t(x).scheduledDays, present: t(x).presentDays,
      lateCount: t(x).lateCount, lateMin: t(x).lateMinutes, izin: t(x).izinDays, sakit: t(x).sakitDays, cuti: t(x).cutiDays,
      absent: t(x).absentDays, incomplete: t(x).incompleteCount, hours: formatHours(t(x).workedMinutes),
    })),
    totals: {
      no: null, name: null, division: null, scheduled: r.summary.scheduledDays, present: r.summary.presentDays, lateCount: r.summary.lateCount,
      lateMin: r.summary.lateMinutes, izin: r.summary.izinDays, sakit: r.summary.sakitDays, cuti: r.summary.cutiDays, absent: r.summary.absentDays,
      incomplete: r.summary.incompleteCount, hours: formatHours(r.summary.workedMinutes),
    },
  };
}

