import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, transaction, type Tx } from "../db";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import { assertCan, actorCan, type Actor } from "../actor";
import { writeAudit } from "../audit";
import { dateToIso, isoToDate } from "../json";
import { env } from "../env";
import { countScheduledDays } from "@/lib/attendance";
import { diffDays, monthRange, todayIso } from "@/lib/time";
import { formatDateLong, formatDays } from "@/lib/format";
import { formatRupiah, toSafeNumber } from "@/lib/money";
import { isoDate, optionalText, requiredText, rupiah, uuid } from "@/lib/validation/common";
import {
  BASIS_LABEL, LINE_CATEGORIES, LINE_CATEGORY_LABEL, allowanceKey, kindOfCategory, possibleDuplicateCategories, reconcileSuggestions, suggestLeavePayout, suggestProratedLines, totalsOf,
  type DraftLine, type SettlementBasisValue, type SettlementLineCategoryValue, type SettlementLineKind, type SettlementLineSourceValue, type SettlementStatusValue,
} from "@/lib/final-settlement";
import { employeeLite, loadRangeContext } from "./context";
import { balanceOf } from "./leave";
import { assetSignalData } from "./assets";
import { notifyUsers, superAdminUserIds } from "./notifications";

/**
 * PENYELESAIAN AKHIR (final settlement) saat karyawan berhenti. Sistem mengusulkan yang dapat dihitung dari data (gaji prorata bulan terakhir, uang harian
 * yang belum dibayar, uang cuti bila HR mengisi pembagi); pesangon, UPMK, UPH, THR, dan pajak TIDAK dihitung — HR mengisinya sebagai baris manual.
 * Alur: Draf → Menunggu persetujuan → Disetujui → Dibayar (atau Dibatalkan). HR menyiapkan (`payroll:prepare`), pimpinan menyetujui (`payroll:approve`),
 * tidak boleh menyetujui penyelesaian miliknya sendiri. Baris hanya berubah saat Draf; setelah diajukan terkunci (trigger database).
 */
type Db = Tx | typeof prisma;
const today = () => todayIso(env().APP_TIMEZONE);
const MAX_LINES = 60;

export interface SettlementLineDto {
  id: string; kind: SettlementLineKind; category: SettlementLineCategoryValue; categoryLabel: string; name: string; amount: number; formula: string | null;
  source: SettlementLineSourceValue; note: string | null; sortOrder: number;
  /** Identitas sumber usulan sistem (kosong untuk baris manual murni). Baris MANUAL yang berkunci = hasil koreksi usulan sistem. */
  sourceKey: string | null;
  /** Hanya uang harian: id penerima surat tugas (uang ini tidak boleh dibuatkan Bukti Penerimaan terpisah selama penyelesaian berlaku). */
  assigneeId: string | null;
}
/** Usulan sistem yang dihapus HR dan dikecualikan PERMANEN dari penyelesaian ini (tidak muncul lagi saat dihitung ulang). */
export interface SettlementExclusionDto { id: string; sourceKey: string; name: string; categoryLabel: string; amount: number; excludedBy: string; excludedAt: string }
export interface SettlementDto {
  id: string; employeeId: string; employeeName: string; employeeNo: string; position: string; employeeActive: boolean; status: SettlementStatusValue;
  lastWorkDate: string; basis: SettlementBasisValue; basisLabel: string; leaveDivisor: number | null; note: string | null;
  totalEarnings: number; totalDeductions: number; netPayable: number;
  preparedBy: string; createdAt: string; submittedAt: string | null; returnedNote: string | null;
  approvedBy: string | null; approvedAt: string | null; approvalNote: string | null;
  paidBy: string | null; paidOn: string | null; payReference: string | null;
  cancelledBy: string | null; cancelledAt: string | null; cancelReason: string | null;
  lines: SettlementLineDto[]; excluded: SettlementExclusionDto[]; warnings: string[];
}
export interface SettlementRow {
  id: string; employeeId: string; employeeName: string; employeeNo: string; status: SettlementStatusValue; lastWorkDate: string; netPayable: number; updatedAt: string;
}

// ─────────────────────────── Skema ───────────────────────────

const divisor = z.number({ error: "Pembagi uang cuti harus berupa angka" }).int("Pembagi harus bilangan bulat").min(1, "Pembagi 1–31").max(31, "Pembagi 1–31");
const basisEnum = z.enum(["WORKING_DAYS", "CALENDAR_DAYS"], { error: "Dasar prorata tidak valid" });
export const settlementCreateSchema = z.object({
  employeeId: uuid, lastWorkDate: isoDate.optional(), basis: basisEnum.default("WORKING_DAYS"), leaveDivisor: divisor.nullable().optional(), note: optionalText(500, "Catatan"),
});
export const settlementPatchSchema = z.object({
  lastWorkDate: isoDate.optional(), basis: basisEnum.optional(), leaveDivisor: divisor.nullable().optional(), note: optionalText(500, "Catatan").optional(),
});
export const lineSchema = z.object({
  category: z.enum(LINE_CATEGORIES, { error: "Kategori baris wajib dipilih" }),
  name: requiredText(3, 120, "Nama baris"),
  amount: rupiah("Nominal").gt(0, "Nominal harus lebih dari Rp 0"),
  formula: optionalText(300, "Dasar perhitungan"),
  note: optionalText(300, "Catatan"),
});
const noteRequired = z.object({ note: requiredText(5, 500, "Catatan") });
const noteOptional = z.object({ note: optionalText(500, "Catatan") });
const paidSchema = z.object({ paidOn: isoDate.optional(), reference: optionalText(120, "Referensi pembayaran") });
const cancelSchema = z.object({ reason: requiredText(5, 300, "Alasan") });

// ─────────────────────────── Usulan sistem & peringatan ───────────────────────────

interface Suggestions { lines: DraftLine[]; warnings: string[] }

/** Usulan baris SISTEM dan peringatan untuk satu karyawan pada tanggal terakhir bekerja tertentu. Hanya BACA. */
async function computeSuggestions(employeeId: string, lastWorkDate: string, basis: SettlementBasisValue, leaveDivisor: number | null): Promise<Suggestions> {
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const month = { start: monthRange(lastWorkDate.slice(0, 7)).from, end: monthRange(lastWorkDate.slice(0, 7)).to };
  const join = dateToIso(emp.joinDate);
  const start = join > month.start ? join : month.start;
  const warnings: string[] = [];
  const lines: DraftLine[] = [];

  // 1) Gaji prorata bulan terakhir.
  let worked = 0, total = 0;
  if (basis === "CALENDAR_DAYS") {
    total = diffDays(month.end, month.start) + 1;
    worked = start > lastWorkDate ? 0 : diffDays(lastWorkDate, start) + 1;
  } else {
    const ctx = await loadRangeContext(month.start, month.end, { employeeIds: [employeeId] });
    // Karyawan "diperluas" agar seluruh hari bulan itu dinilai oleh jadwal (bukan dipotong tanggal bergabung/berhenti).
    const lite = { ...employeeLite(emp), joinDate: "1900-01-01", endDate: null };
    const base = { now: ctx.now, timeZone: ctx.timeZone, lateAfterTolerance: ctx.lateAfterTolerance, schedules: ctx.schedules, defaultSchedule: ctx.defaultSchedule, assignments: ctx.assignments, calendar: ctx.calendar };
    total = countScheduledDays(lite, month.start, month.end, base).total;
    worked = start > lastWorkDate ? 0 : countScheduledDays(lite, start, lastWorkDate, base).total;
  }
  const comps = await prisma.salaryComponent.findMany({ where: { employeeId, isActive: true, kind: "EARNING" }, orderBy: [{ category: "asc" }, { createdAt: "asc" }] });
  const pro = suggestProratedLines({
    month, worked, total, basisLabel: BASIS_LABEL[basis],
    components: comps.map((c) => ({ id: c.id, name: c.name, category: c.category, calc: c.calc, amount: c.amount, recurrence: c.recurrence, effectiveFrom: dateToIso(c.effectiveFrom), effectiveTo: c.effectiveTo ? dateToIso(c.effectiveTo) : null })),
  });
  lines.push(...pro.lines); warnings.push(...pro.warnings);

  // 2) Uang cuti sisa — hanya bila HR mengisi pembagi (tidak ada pembagi baku).
  const year = Number(lastWorkDate.slice(0, 4));
  const bal = await balanceOf(prisma, employeeId, year);
  if (bal.balance > 0) {
    if (leaveDivisor === null) warnings.push(`Sisa cuti ${year}: ${formatDays(bal.balance)} hari belum dihitung. Isi pembagi uang cuti (hari kerja per bulan menurut kebijakan perusahaan) bila sisa cuti dibayarkan.`);
    else {
      const base = comps.find((c) => c.category === "BASE_SALARY" && c.calc === "FIXED" && c.recurrence === "RECURRING" && dateToIso(c.effectiveFrom) <= lastWorkDate && (!c.effectiveTo || dateToIso(c.effectiveTo) >= lastWorkDate));
      if (!base) warnings.push("Uang cuti tidak dapat dihitung: tidak ada gaji pokok nominal tetap yang berlaku pada tanggal terakhir bekerja.");
      else { const l = suggestLeavePayout({ baseMonthly: base.amount, days: bal.balance, divisor: leaveDivisor }); if (l) lines.push(l); }
    }
  }

  // 3) Uang harian dinas yang belum diterbitkan bukti penerimaannya.
  const allowances = await prisma.assignmentAssignee.findMany({
    where: { employeeId, letter: { status: "ISSUED" }, receipts: { none: { status: "ACTIVE" } } },
    include: { letter: { select: { number: true, destination: true } } }, orderBy: { createdAt: "asc" },
  });
  for (const a of allowances) {
    if (a.total <= 0n) continue;
    lines.push({ kind: "EARNING", category: "UNPAID_ALLOWANCE", name: `Uang harian: ${a.letter.destination}`, amount: a.total, formula: `${a.days} hari × ${formatRupiah(a.dailyRate, "PLAIN")} — surat tugas ${a.letter.number}; belum ada bukti penerimaan`, source: "SYSTEM", note: null, sourceKey: allowanceKey(a.id), assigneeId: a.id });
  }

  // 4) Peringatan dari data lain (tidak mengubah baris apa pun).
  const [runs, loans, ast] = await Promise.all([
    prisma.payrollItem.findMany({ where: { employeeId, run: { status: { not: "CANCELLED" }, periodEnd: { gte: isoToDate(month.start) }, periodStart: { lte: isoToDate(lastWorkDate) } } }, select: { run: { select: { label: true, status: true } } } }),
    prisma.salaryComponent.findMany({ where: { employeeId, isActive: true, category: "LOAN" }, select: { name: true } }),
    assetSignalData(prisma, employeeId),
  ]);
  if (runs.length) warnings.push(`Periode gaji ${[...new Set(runs.map((r) => `"${r.run.label}"`))].join(", ")} sudah memuat karyawan ini pada bulan terakhir bekerja. Bila gaji bulan itu dibayar lewat periode tersebut, hapus baris gaji prorata agar tidak terhitung ganda.`);
  if (loans.length) warnings.push(`Kasbon/pinjaman aktif: ${loans.map((l) => l.name).join(", ")}. Sistem tidak melacak sisa saldo; isi baris potongan "Kasbon / pinjaman" sebesar yang dilunasi dari hak akhir.`);
  if (ast.holding.length) warnings.push(`Aset belum dikembalikan: ${ast.holding.map((a) => `${a.name} (${a.code})`).join(", ")}.`);
  if (ast.problems) warnings.push(`${ast.problems} aset dikembalikan rusak/hilang. Sistem tidak memotong gaji otomatis (potongan upah dibatasi aturan); bila ada ganti rugi, putuskan terpisah dan catat sebagai baris manual beserta dasarnya.`);
  if (emp.endDate && dateToIso(emp.endDate) !== lastWorkDate) warnings.push(`Tanggal berhenti pada data karyawan ${formatDateLong(dateToIso(emp.endDate))} berbeda dari tanggal terakhir bekerja di sini.`);
  if (emp.isActive && !emp.endDate) warnings.push("Karyawan ini masih aktif. Tanggal berhenti dicatat saat karyawan dinonaktifkan.");
  return { lines, warnings };
}

// ─────────────────────────── DTO ───────────────────────────

const include = { employee: { select: { fullName: true, employeeNo: true, position: true, isActive: true } }, lines: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }, exclusions: { orderBy: { createdAt: "asc" } } } satisfies Prisma.FinalSettlementInclude;
type Row = Prisma.FinalSettlementGetPayload<{ include: typeof include }>;

async function toDto(r: Row, warnings: string[]): Promise<SettlementDto> {
  if (r.status === "DRAFT" || r.status === "PENDING_APPROVAL") warnings = [...warnings, ...allowanceProblems(await allowanceLineStates(prisma, r.id)).map((p) => `Uang harian bermasalah: ${p}.`)];
  const ids = [r.preparedById, r.approvedById, r.paidById, r.cancelledById, ...r.exclusions.map((x) => x.createdById)].filter((x): x is string => !!x);
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name]));
  const n = (id: string | null) => (id ? name.get(id) ?? "—" : null);
  return {
    id: r.id, employeeId: r.employeeId, employeeName: r.employee.fullName, employeeNo: r.employee.employeeNo, position: r.employee.position, employeeActive: r.employee.isActive,
    status: r.status, lastWorkDate: dateToIso(r.lastWorkDate), basis: r.basis, basisLabel: BASIS_LABEL[r.basis], leaveDivisor: r.leaveDivisor, note: r.note,
    totalEarnings: toSafeNumber(r.totalEarnings), totalDeductions: toSafeNumber(r.totalDeductions), netPayable: toSafeNumber(r.netPayable),
    preparedBy: n(r.preparedById) ?? "—", createdAt: r.createdAt.toISOString(), submittedAt: r.submittedAt?.toISOString() ?? null, returnedNote: r.returnedNote,
    approvedBy: n(r.approvedById), approvedAt: r.approvedAt?.toISOString() ?? null, approvalNote: r.approvalNote,
    paidBy: n(r.paidById), paidOn: r.paidOn ? dateToIso(r.paidOn) : null, payReference: r.payReference,
    cancelledBy: n(r.cancelledById), cancelledAt: r.cancelledAt?.toISOString() ?? null, cancelReason: r.cancelReason,
    lines: r.lines.map((l) => ({ id: l.id, kind: l.kind, category: l.category, categoryLabel: LINE_CATEGORY_LABEL[l.category], name: l.name, amount: toSafeNumber(l.amount), formula: l.formula, source: l.source, note: l.note, sortOrder: l.sortOrder, sourceKey: l.sourceKey, assigneeId: l.assigneeId })),
    excluded: r.exclusions.map((x) => ({ id: x.id, sourceKey: x.sourceKey, name: x.name, categoryLabel: LINE_CATEGORY_LABEL[x.category], amount: toSafeNumber(x.amount), excludedBy: n(x.createdById) ?? "—", excludedAt: x.createdAt.toISOString() })),
    warnings,
  };
}

/** Id yang bukan UUID = tidak ditemukan (404), bukan galat database (500). */
const assertUuid = (id: string): void => { if (!uuid.safeParse(id).success) throw Errors.notFound("Penyelesaian akhir"); };

async function load(db: Db, id: string): Promise<Row> {
  assertUuid(id);
  const r = await db.finalSettlement.findUnique({ where: { id }, include });
  if (!r) throw Errors.notFound("Penyelesaian akhir");
  return r;
}
const lockRow = (tx: Tx, id: string) => { assertUuid(id); return tx.$queryRaw`SELECT 1 FROM "final_settlements" WHERE "id" = ${id}::uuid FOR UPDATE`; };

async function refreshTotals(tx: Tx, id: string): Promise<void> {
  const lines = await tx.finalSettlementLine.findMany({ where: { settlementId: id }, select: { kind: true, amount: true } });
  const t = totalsOf(lines);
  await tx.finalSettlement.update({ where: { id }, data: { totalEarnings: t.earnings, totalDeductions: t.deductions, netPayable: t.net } });
}

/**
 * Peringatan dari KEADAAN penyelesaian terhadap usulan terkini (bukan hanya dari data sumber):
 *   · usulan sistem yang tidak dibuat karena sudah digantikan baris manual dan nominalnya BERBEDA → ditampilkan agar penyetuju tahu,
 *   · data lama tanpa identitas sumber: baris manual sekategori dengan baris sistem → mungkin hitungan ganda, perlu diperiksa.
 */
function stateWarnings(r: Row, suggested: DraftLine[], base: string[]): string[] {
  const held = r.lines.filter((l) => l.source === "MANUAL" && l.sourceKey !== null);
  const rec = reconcileSuggestions(suggested, held.map((l) => l.sourceKey!), r.exclusions.map((x) => x.sourceKey));
  const out = [...base];
  for (const sug of rec.replaced) {
    const mine = held.find((l) => l.sourceKey === sug.sourceKey);
    if (mine && mine.amount !== sug.amount) out.push(`Usulan sistem "${sug.name}" ${formatRupiah(sug.amount, "PLAIN")} digantikan baris manual "${mine.name}" ${formatRupiah(mine.amount, "PLAIN")}; hanya baris manual yang dihitung.`);
  }
  for (const c of possibleDuplicateCategories(r.lines)) out.push(`Kemungkinan hitungan ganda pada kategori "${LINE_CATEGORY_LABEL[c]}": ada baris manual tanpa tautan sumber di samping baris usulan sistem (data lama). Bila baris manual itu koreksi dari usulan sistem, hapus salah satunya.`);
  return out;
}

/** Baris uang harian beserta keadaan terkini bukti penerimaan & surat tugasnya (untuk peringatan dan pemeriksaan ulang). */
async function allowanceLineStates(db: Db, settlementId: string): Promise<{ lineName: string; receiptNumber: string | null; letterNumber: string; letterIssued: boolean }[]> {
  const rows = await db.finalSettlementLine.findMany({
    where: { settlementId, assigneeId: { not: null } }, orderBy: { sortOrder: "asc" },
    select: { name: true, assignee: { select: { letter: { select: { number: true, status: true } }, receipts: { where: { status: "ACTIVE" }, select: { number: true }, take: 1 } } } },
  });
  return rows.flatMap((r) => r.assignee ? [{ lineName: r.name, receiptNumber: r.assignee.receipts[0]?.number ?? null, letterNumber: r.assignee.letter.number, letterIssued: r.assignee.letter.status === "ISSUED" }] : []);
}
const allowanceProblems = (st: Awaited<ReturnType<typeof allowanceLineStates>>): string[] =>
  st.flatMap((x) => x.receiptNumber ? [`"${x.lineName}" sudah punya Bukti Penerimaan ${x.receiptNumber}`] : !x.letterIssued ? [`"${x.lineName}": surat tugas ${x.letterNumber} sudah dibatalkan`] : []);

/**
 * Pemeriksaan ulang uang harian: tidak ada baris uang harian yang sudah dibayarkan lewat Bukti Penerimaan (akan terbayar dua kali) atau yang surat tugasnya dibatalkan.
 * Dipanggil saat DIAJUKAN, DISETUJUI, dan DICATAT DIBAYAR — keadaan bisa berubah sejak usulan dihitung.
 */
async function assertAllowancesSettleable(tx: Tx, settlementId: string): Promise<void> {
  const problems = allowanceProblems(await allowanceLineStates(tx, settlementId));
  if (problems.length) throw Errors.conflict(`Uang harian tidak boleh dibayar lewat penyelesaian akhir: ${problems.join("; ")}. Hapus barisnya dari penyelesaian (kembalikan ke Draf bila perlu) atau batalkan Bukti Penerimaan yang keliru, agar tidak dibayar dua kali.`, { problems });
}

// ─────────────────────────── Baca ───────────────────────────

export async function listSettlements(actor: Actor, opts: { status?: SettlementStatusValue } = {}): Promise<SettlementRow[]> {
  assertCan(actor, "payroll:view");
  const rows = await prisma.finalSettlement.findMany({ where: opts.status ? { status: opts.status } : {}, include: { employee: { select: { fullName: true, employeeNo: true } } }, orderBy: [{ createdAt: "desc" }], take: 300 });
  return rows.map((r) => ({ id: r.id, employeeId: r.employeeId, employeeName: r.employee.fullName, employeeNo: r.employee.employeeNo, status: r.status, lastWorkDate: dateToIso(r.lastWorkDate), netPayable: toSafeNumber(r.netPayable), updatedAt: r.updatedAt.toISOString() }));
}

/** Penyelesaian yang masih berlaku (bukan batal) untuk satu karyawan, atau null. */
export async function settlementOfEmployee(actor: Actor, employeeId: string): Promise<{ id: string; status: SettlementStatusValue; netPayable: number } | null> {
  assertCan(actor, "payroll:view");
  const r = await prisma.finalSettlement.findFirst({ where: { employeeId, status: { not: "CANCELLED" } }, select: { id: true, status: true, netPayable: true } });
  return r ? { id: r.id, status: r.status, netPayable: toSafeNumber(r.netPayable) } : null;
}

export async function getSettlement(actor: Actor, id: string): Promise<SettlementDto> {
  assertCan(actor, "payroll:view");
  const r = await load(prisma, id);
  // Peringatan dihitung langsung dari data terkini selama masih bisa diubah/ditinjau; yang sudah final tidak menampilkan peringatan lagi.
  if (r.status !== "DRAFT" && r.status !== "PENDING_APPROVAL") return toDto(r, []);
  const sug = await computeSuggestions(r.employeeId, dateToIso(r.lastWorkDate), r.basis, r.leaveDivisor);
  return toDto(r, stateWarnings(r, sug.lines, sug.warnings));
}

export interface DuplicateAuditRow {
  settlementId: string; employeeName: string; employeeNo: string; status: SettlementStatusValue; lastWorkDate: string; netPayable: number;
  categories: { category: SettlementLineCategoryValue; categoryLabel: string; total: number; lines: { name: string; amount: number; source: SettlementLineSourceValue }[] }[];
}
/**
 * AUDIT data lama (hanya BACA, tidak mengubah apa pun): penyelesaian akhir yang belum dibatalkan dengan baris manual tanpa identitas sumber di samping baris sistem
 * pada kategori yang diusulkan sistem (gaji prorata, uang cuti, uang harian) — pola hitungan ganda sebelum ada identitas sumber. Hasilnya TERDUGA, bukan pasti:
 * baris manual murni yang sah juga terdaftar; pimpinan/HR memeriksa nominalnya. Penyelesaian yang sudah Disetujui/Dibayar tidak dapat diubah; koreksinya
 * lewat pembatalan (bila belum dibayar) atau penyesuaian di luar aplikasi sesuai kebijakan.
 */
export async function auditSettlementDuplicates(actor: Actor): Promise<DuplicateAuditRow[]> {
  assertCan(actor, "payroll:approve");
  const rows = await prisma.finalSettlement.findMany({ where: { status: { not: "CANCELLED" } }, include, orderBy: { createdAt: "desc" }, take: 500 });
  const out: DuplicateAuditRow[] = [];
  for (const r of rows) {
    const cats = possibleDuplicateCategories(r.lines);
    if (!cats.length) continue;
    out.push({
      settlementId: r.id, employeeName: r.employee.fullName, employeeNo: r.employee.employeeNo, status: r.status, lastWorkDate: dateToIso(r.lastWorkDate), netPayable: toSafeNumber(r.netPayable),
      categories: cats.map((c) => { const ls = r.lines.filter((l) => l.category === c); return { category: c, categoryLabel: LINE_CATEGORY_LABEL[c], total: toSafeNumber(ls.reduce((t, l) => t + l.amount, 0n)), lines: ls.map((l) => ({ name: l.name, amount: toSafeNumber(l.amount), source: l.source })) }; }),
    });
  }
  return out;
}

export interface AllowanceOverlapRow {
  settlementId: string; employeeName: string; employeeNo: string; settlementStatus: SettlementStatusValue; lastWorkDate: string;
  lineName: string; lineAmount: number; letterNumber: string; receiptNumber: string; receiptTotal: number;
}
/**
 * AUDIT baca-saja: uang harian yang SEKARANG tercatat dua kali — ada pada penyelesaian akhir yang belum dibatalkan DAN sudah punya Bukti Penerimaan aktif.
 * Hanya mencakup baris yang tertaut ke penerima surat tugas (data lama ditautkan oleh migrasi bila kecocokannya tunggal). Tidak mengubah apa pun; koreksi lewat
 * pembatalan bukti (Super Admin) atau pengembalian/pembatalan penyelesaian akhir.
 */
export async function auditAllowanceOverlaps(actor: Actor): Promise<AllowanceOverlapRow[]> {
  assertCan(actor, "payroll:approve");
  const rows = await prisma.finalSettlementLine.findMany({
    where: { assigneeId: { not: null }, settlement: { status: { not: "CANCELLED" } }, assignee: { receipts: { some: { status: "ACTIVE" } } } },
    include: { settlement: { select: { id: true, status: true, lastWorkDate: true, employee: { select: { fullName: true, employeeNo: true } } } }, assignee: { select: { letter: { select: { number: true } }, receipts: { where: { status: "ACTIVE" }, select: { number: true, total: true }, take: 1 } } } },
    orderBy: { createdAt: "desc" }, take: 500,
  });
  return rows.flatMap((l) => {
    const rc = l.assignee?.receipts[0];
    return rc ? [{ settlementId: l.settlement.id, employeeName: l.settlement.employee.fullName, employeeNo: l.settlement.employee.employeeNo, settlementStatus: l.settlement.status, lastWorkDate: dateToIso(l.settlement.lastWorkDate), lineName: l.name, lineAmount: toSafeNumber(l.amount), letterNumber: l.assignee!.letter.number, receiptNumber: rc.number, receiptTotal: toSafeNumber(rc.total) }] : [];
  });
}

// ─────────────────────────── Tulis ───────────────────────────

/**
 * Ganti baris SISTEM dengan usulan terkini, tetapi SATU SUMBER HANYA SATU BARIS:
 *   · sumber yang dipegang baris MANUAL (usulan sistem yang dikoreksi HR) tidak dibuat lagi — baris manual itulah penggantinya,
 *   · sumber yang dikecualikan (usulan yang dihapus HR) tidak muncul lagi,
 *   · baris manual murni (tanpa kunci) tidak disentuh.
 * Harus dalam transaksi dengan baris induk terkunci & berstatus Draf. Indeks unik database menjaga "satu kunci = satu baris".
 */
async function replaceSystemLines(tx: Tx, id: string, lines: DraftLine[]): Promise<void> {
  await tx.finalSettlementLine.deleteMany({ where: { settlementId: id, source: "SYSTEM" } });
  const [held, excl] = await Promise.all([
    tx.finalSettlementLine.findMany({ where: { settlementId: id, sourceKey: { not: null } }, select: { sourceKey: true } }),
    tx.finalSettlementExclusion.findMany({ where: { settlementId: id }, select: { sourceKey: true } }),
  ]);
  const { create } = reconcileSuggestions(lines, held.map((h) => h.sourceKey!), excl.map((e) => e.sourceKey));
  const max = await tx.finalSettlementLine.aggregate({ where: { settlementId: id }, _max: { sortOrder: true } });
  let order = (max._max.sortOrder ?? 0) + 1;
  if (create.length) await tx.finalSettlementLine.createMany({ data: create.map((l) => ({ settlementId: id, kind: l.kind, category: l.category, name: l.name, amount: l.amount, formula: l.formula, source: "SYSTEM" as const, sourceKey: l.sourceKey ?? null, assigneeId: l.assigneeId ?? null, note: l.note, sortOrder: order++ })) });
  await refreshTotals(tx, id);
}

function assertDraft(r: { status: string }): void {
  if (r.status !== "DRAFT") throw Errors.conflict("Penyelesaian akhir hanya dapat diubah saat berstatus Draf. Minta pimpinan mengembalikannya ke Draf bila perlu.");
}

export async function createSettlement(actor: Actor, raw: unknown): Promise<SettlementDto> {
  assertCan(actor, "payroll:prepare");
  const input = parseInput(settlementCreateSchema, raw);
  const emp = await prisma.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, fullName: true, joinDate: true, endDate: true } });
  if (!emp) throw Errors.notFound("Karyawan");
  const last = input.lastWorkDate ?? (emp.endDate ? dateToIso(emp.endDate) : today());
  if (last < dateToIso(emp.joinDate)) throw Errors.validation("Tanggal terakhir bekerja tidak boleh sebelum tanggal mulai bekerja.", { lastWorkDate: "Sebelum tanggal mulai bekerja" });
  if (diffDays(last, today()) > 90) throw Errors.validation("Tanggal terakhir bekerja terlalu jauh di masa depan (maksimal 90 hari dari hari ini).", { lastWorkDate: "Terlalu jauh di masa depan" });
  const live = await prisma.finalSettlement.findFirst({ where: { employeeId: emp.id, status: { not: "CANCELLED" } }, select: { id: true } });
  if (live) throw Errors.conflict("Karyawan ini sudah punya penyelesaian akhir yang berlaku. Buka atau batalkan yang lama terlebih dulu.", { settlementId: live.id });
  const sug = await computeSuggestions(emp.id, last, input.basis, input.leaveDivisor ?? null);
  try {
    const id = await transaction(async (tx) => {
      const s = await tx.finalSettlement.create({ data: { employeeId: emp.id, lastWorkDate: isoToDate(last), basis: input.basis, leaveDivisor: input.leaveDivisor ?? null, note: input.note, preparedById: actor.userId } });
      await replaceSystemLines(tx, s.id, sug.lines);
      await writeAudit(tx, actor, { action: "settlement.create", entityType: "FinalSettlement", entityId: s.id, summary: `Penyelesaian akhir ${emp.fullName} dibuat (terakhir bekerja ${last}, ${sug.lines.length} usulan sistem)`, after: { lastWorkDate: last, basis: input.basis, leaveDivisor: input.leaveDivisor ?? null } });
      return s.id;
    });
    const row = await load(prisma, id);
    return toDto(row, stateWarnings(row, sug.lines, sug.warnings));
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw Errors.conflict("Karyawan ini sudah punya penyelesaian akhir yang berlaku.");
    throw e;
  }
}

/** Ubah tanggal/dasar/pembagi/catatan; usulan SISTEM dihitung ulang (baris manual tetap; sumber yang sudah dikoreksi/dihapus tidak dibuat lagi). */
export async function updateSettlement(actor: Actor, id: string, raw: unknown): Promise<SettlementDto> {
  assertCan(actor, "payroll:prepare");
  const input = parseInput(settlementPatchSchema, raw);
  const cur = await load(prisma, id);
  assertDraft(cur);
  const last = input.lastWorkDate ?? dateToIso(cur.lastWorkDate);
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: cur.employeeId }, select: { joinDate: true } });
  if (last < dateToIso(emp.joinDate)) throw Errors.validation("Tanggal terakhir bekerja tidak boleh sebelum tanggal mulai bekerja.", { lastWorkDate: "Sebelum tanggal mulai bekerja" });
  if (diffDays(last, today()) > 90) throw Errors.validation("Tanggal terakhir bekerja terlalu jauh di masa depan (maksimal 90 hari dari hari ini).", { lastWorkDate: "Terlalu jauh di masa depan" });
  const basis = input.basis ?? cur.basis;
  const leaveDivisor = input.leaveDivisor === undefined ? cur.leaveDivisor : input.leaveDivisor;
  const sug = await computeSuggestions(cur.employeeId, last, basis, leaveDivisor);
  await transaction(async (tx) => {
    await lockRow(tx, id);
    assertDraft(await load(tx, id));
    await tx.finalSettlement.update({ where: { id }, data: { lastWorkDate: isoToDate(last), basis, leaveDivisor, ...(input.note !== undefined ? { note: input.note } : {}) } });
    await replaceSystemLines(tx, id, sug.lines);
    await writeAudit(tx, actor, { action: "settlement.update", entityType: "FinalSettlement", entityId: id, summary: `Penyelesaian akhir ${cur.employee.fullName} diubah; usulan sistem dihitung ulang`, before: { lastWorkDate: dateToIso(cur.lastWorkDate), basis: cur.basis, leaveDivisor: cur.leaveDivisor }, after: { lastWorkDate: last, basis, leaveDivisor } });
  });
  const row = await load(prisma, id);
  return toDto(row, stateWarnings(row, sug.lines, sug.warnings));
}

/** Hitung ulang usulan sistem dengan data terkini. Baris manual tidak berubah; usulan yang sudah dikoreksi HR tidak dibuat lagi; usulan yang dihapus HR tetap dikecualikan. */
export async function recomputeSettlement(actor: Actor, id: string): Promise<SettlementDto> {
  assertCan(actor, "payroll:prepare");
  const cur = await load(prisma, id);
  assertDraft(cur);
  const sug = await computeSuggestions(cur.employeeId, dateToIso(cur.lastWorkDate), cur.basis, cur.leaveDivisor);
  await transaction(async (tx) => {
    await lockRow(tx, id);
    assertDraft(await load(tx, id));
    await replaceSystemLines(tx, id, sug.lines);
    await writeAudit(tx, actor, { action: "settlement.recompute", entityType: "FinalSettlement", entityId: id, summary: `Usulan sistem penyelesaian akhir ${cur.employee.fullName} dihitung ulang` });
  });
  const row = await load(prisma, id);
  return toDto(row, stateWarnings(row, sug.lines, sug.warnings));
}

export async function addLine(actor: Actor, id: string, raw: unknown): Promise<SettlementDto> {
  assertCan(actor, "payroll:prepare");
  const input = parseInput(lineSchema, raw);
  await transaction(async (tx) => {
    await lockRow(tx, id);
    const cur = await load(tx, id);
    assertDraft(cur);
    if (cur.lines.length >= MAX_LINES) throw Errors.validation(`Baris maksimal ${MAX_LINES} per penyelesaian akhir.`);
    const order = (cur.lines.reduce((m, l) => Math.max(m, l.sortOrder), 0)) + 1;
    const l = await tx.finalSettlementLine.create({ data: { settlementId: id, kind: kindOfCategory(input.category), category: input.category, name: input.name, amount: BigInt(input.amount), formula: input.formula, source: "MANUAL", note: input.note, sortOrder: order } });
    await refreshTotals(tx, id);
    await writeAudit(tx, actor, { action: "settlement.line.add", entityType: "FinalSettlement", entityId: id, summary: `Baris "${input.name}" (${LINE_CATEGORY_LABEL[input.category]}) ${formatRupiah(input.amount, "PLAIN")} ditambahkan untuk ${cur.employee.fullName}`, after: { lineId: l.id, category: input.category, amount: input.amount, formula: input.formula } });
  });
  return toDto(await load(prisma, id), []);
}

async function lineOwner(lineId: string): Promise<{ settlementId: string }> {
  if (!uuid.safeParse(lineId).success) throw Errors.notFound("Baris");
  const l = await prisma.finalSettlementLine.findUnique({ where: { id: lineId }, select: { settlementId: true } });
  if (!l) throw Errors.notFound("Baris");
  return l;
}

/** Ubah baris. Baris usulan SISTEM yang diubah menjadi MANUAL tetapi TETAP membawa identitas sumbernya, sehingga hitung ulang tidak membuat usulan yang sama lagi. */
export async function updateLine(actor: Actor, lineId: string, raw: unknown): Promise<SettlementDto> {
  assertCan(actor, "payroll:prepare");
  const input = parseInput(lineSchema, raw);
  const { settlementId } = await lineOwner(lineId);
  await transaction(async (tx) => {
    await lockRow(tx, settlementId);
    const cur = await load(tx, settlementId);
    assertDraft(cur);
    const before = cur.lines.find((l) => l.id === lineId);
    if (!before) throw Errors.notFound("Baris");
    await tx.finalSettlementLine.update({ where: { id: lineId }, data: { kind: kindOfCategory(input.category), category: input.category, name: input.name, amount: BigInt(input.amount), formula: input.formula, note: input.note, source: "MANUAL" } });
    await refreshTotals(tx, settlementId);
    await writeAudit(tx, actor, { action: "settlement.line.update", entityType: "FinalSettlement", entityId: settlementId, summary: `Baris "${before.name}" untuk ${cur.employee.fullName} diubah`, before: { name: before.name, category: before.category, amount: toSafeNumber(before.amount), source: before.source }, after: { name: input.name, category: input.category, amount: input.amount } });
  });
  return toDto(await load(prisma, settlementId), []);
}

export async function deleteLine(actor: Actor, lineId: string): Promise<SettlementDto> {
  assertCan(actor, "payroll:prepare");
  const { settlementId } = await lineOwner(lineId);
  await transaction(async (tx) => {
    await lockRow(tx, settlementId);
    const cur = await load(tx, settlementId);
    assertDraft(cur);
    const before = cur.lines.find((l) => l.id === lineId);
    if (!before) throw Errors.notFound("Baris");
    await tx.finalSettlementLine.delete({ where: { id: lineId } });
    // Baris yang berasal dari usulan sistem (masih SISTEM, atau sudah dikoreksi jadi MANUAL) dikecualikan PERMANEN agar tidak muncul lagi saat dihitung ulang.
    if (before.sourceKey) await tx.finalSettlementExclusion.createMany({ data: [{ settlementId, sourceKey: before.sourceKey, name: before.name, category: before.category, amount: before.amount, createdById: actor.userId }], skipDuplicates: true });
    await refreshTotals(tx, settlementId);
    await writeAudit(tx, actor, { action: "settlement.line.delete", entityType: "FinalSettlement", entityId: settlementId, summary: `Baris "${before.name}" (${formatRupiah(before.amount, "PLAIN")}) dihapus dari penyelesaian ${cur.employee.fullName}${before.sourceKey ? "; usulan sistem ini dikecualikan permanen" : ""}`, before: { name: before.name, category: before.category, amount: toSafeNumber(before.amount), source: before.source, sourceKey: before.sourceKey } });
  });
  return toDto(await load(prisma, settlementId), []);
}

// ─────────────────────────── Alur persetujuan ───────────────────────────

export async function submitSettlement(actor: Actor, id: string): Promise<SettlementDto> {
  assertCan(actor, "payroll:prepare");
  await transaction(async (tx) => {
    await lockRow(tx, id);
    const cur = await load(tx, id);
    assertDraft(cur);
    if (cur.lines.length === 0) throw Errors.validation("Belum ada baris. Tambahkan minimal satu baris (atau hitung usulan sistem) sebelum mengajukan.");
    await assertAllowancesSettleable(tx, id);
    const t = totalsOf(cur.lines);
    if (t.net < 0n) throw Errors.validation(`Total potongan (${formatRupiah(t.deductions, "PLAIN")}) melebihi total pendapatan (${formatRupiah(t.earnings, "PLAIN")}). Periksa kembali — potongan upah dibatasi aturan dan tidak boleh membuat hak akhir menjadi negatif.`);
    const r = await tx.finalSettlement.updateMany({ where: { id, status: "DRAFT" }, data: { status: "PENDING_APPROVAL", submittedAt: new Date(), submittedById: actor.userId, returnedNote: null } });
    if (r.count !== 1) throw Errors.conflict("Status penyelesaian akhir baru saja berubah. Muat ulang.");
    await writeAudit(tx, actor, { action: "settlement.submit", entityType: "FinalSettlement", entityId: id, summary: `Penyelesaian akhir ${cur.employee.fullName} diajukan (bersih ${formatRupiah(t.net, "PLAIN")})` });
    await notifyUsers(tx, await superAdminUserIds(tx, actor.userId), { type: "settlement.submitted", title: "Penyelesaian akhir menunggu persetujuan", body: `${cur.employee.fullName} · bersih ${formatRupiah(t.net, "PLAIN")}`, href: `/penyelesaian-akhir/${id}` });
  });
  return toDto(await load(prisma, id), []);
}

export async function returnSettlement(actor: Actor, id: string, raw: unknown): Promise<SettlementDto> {
  assertCan(actor, "payroll:approve");
  const { note } = parseInput(noteRequired, raw);
  await transaction(async (tx) => {
    await lockRow(tx, id);
    const cur = await load(tx, id);
    const r = await tx.finalSettlement.updateMany({ where: { id, status: "PENDING_APPROVAL" }, data: { status: "DRAFT", returnedNote: note, submittedAt: null, submittedById: null } });
    if (r.count !== 1) throw Errors.conflict("Hanya penyelesaian akhir berstatus Menunggu persetujuan yang dapat dikembalikan.");
    await writeAudit(tx, actor, { action: "settlement.return", entityType: "FinalSettlement", entityId: id, summary: `Penyelesaian akhir ${cur.employee.fullName} dikembalikan ke Draf`, reason: note });
    await notifyUsers(tx, [cur.preparedById], { type: "settlement.returned", title: "Penyelesaian akhir dikembalikan ke Draf", body: `${cur.employee.fullName} · ${note}`, href: `/penyelesaian-akhir/${id}` });
  });
  return toDto(await load(prisma, id), []);
}

export async function approveSettlement(actor: Actor, id: string, raw: unknown = {}): Promise<SettlementDto> {
  assertCan(actor, "payroll:approve");
  const { note } = parseInput(noteOptional, raw ?? {});
  await transaction(async (tx) => {
    await lockRow(tx, id);
    const cur = await load(tx, id);
    if (cur.employeeId === actor.employeeId) throw Errors.forbidden("Anda tidak dapat menyetujui penyelesaian akhir milik Anda sendiri.");
    if (cur.status === "PENDING_APPROVAL") await assertAllowancesSettleable(tx, id);
    const r = await tx.finalSettlement.updateMany({ where: { id, status: "PENDING_APPROVAL" }, data: { status: "APPROVED", approvedAt: new Date(), approvedById: actor.userId, approvalNote: note } });
    if (r.count !== 1) throw Errors.conflict("Hanya penyelesaian akhir berstatus Menunggu persetujuan yang dapat disetujui.");
    await writeAudit(tx, actor, { action: "settlement.approve", entityType: "FinalSettlement", entityId: id, summary: `Penyelesaian akhir ${cur.employee.fullName} disetujui (bersih ${formatRupiah(cur.netPayable, "PLAIN")})`, reason: note });
    await notifyUsers(tx, [cur.preparedById], { type: "settlement.approved", title: "Penyelesaian akhir disetujui", body: `${cur.employee.fullName} siap dibayarkan`, href: `/penyelesaian-akhir/${id}` });
  });
  return toDto(await load(prisma, id), []);
}

/** Catat bahwa pembayaran sudah dilakukan (di luar aplikasi — sistem tidak mentransfer uang). Terkunci setelahnya. */
export async function markSettlementPaid(actor: Actor, id: string, raw: unknown = {}): Promise<SettlementDto> {
  assertCan(actor, "payroll:prepare");
  const input = parseInput(paidSchema, raw ?? {});
  const on = input.paidOn ?? today();
  if (on > today()) throw Errors.validation("Tanggal pembayaran tidak boleh di masa depan.", { paidOn: "Tidak boleh di masa depan" });
  await transaction(async (tx) => {
    await lockRow(tx, id);
    const cur = await load(tx, id);
    if (cur.status === "APPROVED") await assertAllowancesSettleable(tx, id);
    const r = await tx.finalSettlement.updateMany({ where: { id, status: "APPROVED" }, data: { status: "PAID", paidAt: new Date(), paidById: actor.userId, paidOn: isoToDate(on), payReference: input.reference } });
    if (r.count !== 1) throw Errors.conflict("Hanya penyelesaian akhir berstatus Disetujui yang dapat dicatat sebagai dibayar.");
    await writeAudit(tx, actor, { action: "settlement.paid", entityType: "FinalSettlement", entityId: id, summary: `Penyelesaian akhir ${cur.employee.fullName} dibayar ${formatDateLong(on)} (${formatRupiah(cur.netPayable, "PLAIN")})`, after: { paidOn: on, reference: input.reference } });
  });
  return toDto(await load(prisma, id), []);
}

export async function cancelSettlement(actor: Actor, id: string, raw: unknown): Promise<SettlementDto> {
  assertCan(actor, "payroll:prepare");
  const { reason } = parseInput(cancelSchema, raw);
  await transaction(async (tx) => {
    await lockRow(tx, id);
    const cur = await load(tx, id);
    if (cur.status === "PAID") throw Errors.conflict("Penyelesaian akhir yang sudah dibayar tidak dapat dibatalkan.");
    if (cur.status === "CANCELLED") throw Errors.conflict("Penyelesaian akhir ini sudah dibatalkan.");
    if (cur.status === "APPROVED" && !actorCan(actor, "payroll:revoke")) throw Errors.forbidden("Hanya pimpinan yang dapat membatalkan penyelesaian akhir yang sudah disetujui.");
    const r = await tx.finalSettlement.updateMany({ where: { id, status: { in: ["DRAFT", "PENDING_APPROVAL", "APPROVED"] } }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason } });
    if (r.count !== 1) throw Errors.conflict("Status penyelesaian akhir baru saja berubah. Muat ulang.");
    await writeAudit(tx, actor, { action: "settlement.cancel", entityType: "FinalSettlement", entityId: id, summary: `Penyelesaian akhir ${cur.employee.fullName} dibatalkan`, reason });
  });
  return toDto(await load(prisma, id), []);
}

/** Ringkasan status untuk sinyal checklist berhenti (tanpa pemeriksaan izin — dipanggil dari service yang sudah memeriksanya). */
export async function settlementSignalData(db: Db, employeeId: string): Promise<SettlementStatusValue | null> {
  const r = await db.finalSettlement.findFirst({ where: { employeeId, status: { not: "CANCELLED" } }, select: { status: true } });
  return r?.status ?? null;
}
