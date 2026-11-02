import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, transaction } from "../db";
import { env } from "../env";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import { actorCan, assertCan, requireSelf, type Actor } from "../actor";
import { writeAudit } from "../audit";
import { dateToIso, isoToDate } from "../json";
import { getSettings } from "./settings";
import { notifyUsers } from "./notifications";
import { LETTER_CODE, formatLetterNumber, tripDays } from "@/lib/assignment";
import { todayIso } from "@/lib/time";
import { formatDateRange, formatDateLong } from "@/lib/format";
import { formatRupiah } from "@/lib/money";
import { isoDate, optionalText, requiredText, rupiah, uuid } from "@/lib/validation/common";
import type { Paged } from "@/lib/types";

export type AssignmentStatus = "ISSUED" | "CANCELLED";
export type AllowanceMethod = "CASH" | "TRANSFER";
export type ReceiptStatus = "ACTIVE" | "VOIDED";
export const METHOD_LABEL: Record<AllowanceMethod, string> = { CASH: "Tunai", TRANSFER: "Transfer bank" };
export const ASSIGNMENT_STATUS_LABEL: Record<AssignmentStatus, string> = { ISSUED: "Terbit", CANCELLED: "Dibatalkan" };

// ─────────────────────────── Snapshot (isi dokumen yang dibekukan) ───────────────────────────

interface SnapshotCompany { name: string; legalName: string | null; tagline: string | null; address: string | null; phone: string | null; email: string | null; website: string | null; logoFileId: string | null }
/** Penanda tangan resmi lembaga — pengaturan yang SAMA dengan slip gaji (Pengaturan → Slip gaji). */
interface SnapshotSigner { name: string; title: string | null; place: string | null; signatureFileId: string | null }

/** Isi Surat Tugas saat terbit. PDF selalu dirender dari snapshot ini. */
export interface AssignmentSnapshot {
  version: 1;
  number: string;
  company: SnapshotCompany;
  issueDate: string;
  purpose: string;
  destination: string;
  startDate: string;
  endDate: string;
  tripDays: number;
  details: string | null;
  signer: SnapshotSigner | null;
  assignees: { employeeId: string; employeeNo: string; name: string; position: string; division: string | null; days: number; dailyRate: number; total: number }[];
  footerNote: string | null;
}

/** Isi Bukti Penerimaan Uang Harian saat terbit — berdiri sendiri, TIDAK terkait slip gaji. */
export interface ReceiptSnapshot {
  version: 1;
  number: string;
  company: SnapshotCompany;
  letter: { id: string; number: string; issueDate: string; purpose: string; destination: string; startDate: string; endDate: string; tripDays: number };
  employee: { id: string; employeeNo: string; name: string; position: string; division: string | null; bankName: string | null; bankAccountMasked: string | null };
  days: number;
  dailyRate: number;
  total: number;
  paidDate: string;
  method: AllowanceMethod;
  note: string | null;
  signer: SnapshotSigner | null;
  footerNote: string | null;
}

const companyOf = (s: Awaited<ReturnType<typeof getSettings>>): SnapshotCompany => ({
  name: s.name, legalName: s.legalName, tagline: s.tagline, address: s.address, phone: s.phone, email: s.email, website: s.website, logoFileId: s.logoFileId,
});
const signerOf = (s: Awaited<ReturnType<typeof getSettings>>): SnapshotSigner | null =>
  s.slipSignerName ? { name: s.slipSignerName, title: s.slipSignerTitle, place: s.slipSignerPlace, signatureFileId: s.slipSignatureFileId } : null;

// ─────────────────────────── DTO ───────────────────────────

export interface ReceiptDto {
  id: string;
  number: string;
  status: ReceiptStatus;
  letterId: string;
  letterNumber: string;
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  days: number;
  dailyRate: number;
  total: number;
  paidDate: string;
  method: AllowanceMethod;
  note: string | null;
  issuedBy: string;
  issuedAt: string;
  voidedAt: string | null;
  voidReason: string | null;
}

export interface AssigneeDto {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  position: string;
  days: number;
  dailyRate: number;
  total: number;
  /** Bukti penerimaan AKTIF (null = belum diterbitkan). */
  receipt: ReceiptDto | null;
}

export interface AssignmentDto {
  id: string;
  number: string;
  status: AssignmentStatus;
  purpose: string;
  destination: string;
  startDate: string;
  endDate: string;
  tripDays: number;
  details: string | null;
  issueDate: string;
  issuedBy: string;
  issuedAt: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  totalAllowance: number;
  assignees: AssigneeDto[];
}

const include = {
  assignees: { include: { employee: { select: { fullName: true, employeeNo: true, position: true } } }, orderBy: { employee: { fullName: "asc" } } },
  receipts: { orderBy: { issuedAt: "desc" } },
} satisfies Prisma.AssignmentLetterInclude;
type LetterRow = Prisma.AssignmentLetterGetPayload<{ include: typeof include }>;
type ReceiptRow = Prisma.DailyAllowanceReceiptGetPayload<object>;

async function userNames(ids: (string | null)[]): Promise<Map<string, string>> {
  const uniq = [...new Set(ids.filter((x): x is string => !!x))];
  const users = uniq.length ? await prisma.user.findMany({ where: { id: { in: uniq } }, select: { id: true, name: true } }) : [];
  return new Map(users.map((u) => [u.id, u.name]));
}

function receiptDto(r: ReceiptRow, names: Map<string, string>, emp: { fullName: string; employeeNo: string }, letterNumber: string): ReceiptDto {
  return {
    id: r.id, number: r.number, status: r.status, letterId: r.letterId, letterNumber, employeeId: r.employeeId, employeeName: emp.fullName, employeeNo: emp.employeeNo,
    days: r.days, dailyRate: Number(r.dailyRate), total: Number(r.total), paidDate: dateToIso(r.paidDate), method: r.method, note: r.note,
    issuedBy: names.get(r.issuedById) ?? "—", issuedAt: r.issuedAt.toISOString(), voidedAt: r.voidedAt?.toISOString() ?? null, voidReason: r.voidReason,
  };
}

async function toDtos(rows: LetterRow[]): Promise<AssignmentDto[]> {
  const names = await userNames(rows.flatMap((r) => [r.issuedById, ...r.receipts.map((x) => x.issuedById)]));
  return rows.map((r) => ({
    id: r.id, number: r.number, status: r.status, purpose: r.purpose, destination: r.destination, startDate: dateToIso(r.startDate), endDate: dateToIso(r.endDate),
    tripDays: tripDays(dateToIso(r.startDate), dateToIso(r.endDate)), details: r.details, issueDate: dateToIso(r.issueDate), issuedBy: names.get(r.issuedById) ?? "—",
    issuedAt: r.issuedAt.toISOString(), cancelledAt: r.cancelledAt?.toISOString() ?? null, cancelReason: r.cancelReason,
    totalAllowance: r.assignees.reduce((a, x) => a + Number(x.total), 0),
    assignees: r.assignees.map((a) => {
      const active = r.receipts.find((x) => x.assigneeId === a.id && x.status === "ACTIVE");
      return {
        id: a.id, employeeId: a.employeeId, employeeName: a.employee.fullName, employeeNo: a.employee.employeeNo, position: a.employee.position,
        days: a.days, dailyRate: Number(a.dailyRate), total: Number(a.total),
        receipt: active ? receiptDto(active, names, a.employee, r.number) : null,
      };
    }),
  }));
}

// ─────────────────────────── Penomoran ───────────────────────────

/** Nomor urut berikutnya pada tahun tsb. Dipanggil di dalam transaksi setelah mengunci (advisory lock) agar tidak ada nomor ganda. */
async function nextSeq(tx: Prisma.TransactionClient, table: "letter" | "receipt", year: number): Promise<number> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`assign:${table}:${year}`}))`;
  const agg = table === "letter"
    ? await tx.assignmentLetter.aggregate({ where: { seqYear: year }, _max: { seqNo: true } })
    : await tx.dailyAllowanceReceipt.aggregate({ where: { seqYear: year }, _max: { seqNo: true } });
  return (agg._max.seqNo ?? 0) + 1;
}

// ─────────────────────────── Surat Tugas ───────────────────────────

export const MAX_TRIP_DAYS = 120;

export const assignmentSchema = z.object({
  purpose: requiredText(5, 300, "Maksud / tujuan penugasan"),
  destination: requiredText(2, 200, "Tujuan / lokasi"),
  startDate: isoDate,
  endDate: isoDate,
  details: optionalText(1000, "Uraian tugas"),
  issueDate: isoDate.optional(),
  assignees: z.array(z.object({
    employeeId: uuid,
    dailyRate: rupiah("Uang harian per hari"),
    /** Jumlah hari yang dibayar; kosong = seluruh lama perjalanan. */
    days: z.number().int("Jumlah hari harus bilangan bulat").min(1, "Jumlah hari minimal 1").max(MAX_TRIP_DAYS).nullish(),
  }), { error: "Pilih karyawan yang ditugaskan" }).min(1, "Pilih minimal satu karyawan yang ditugaskan").max(50, "Maksimal 50 karyawan per surat tugas"),
}).superRefine((v, ctx) => {
  if (v.endDate < v.startDate) { ctx.addIssue({ code: "custom", path: ["endDate"], message: "Tanggal selesai tidak boleh sebelum tanggal mulai" }); return; }
  const n = tripDays(v.startDate, v.endDate);
  if (n > MAX_TRIP_DAYS) ctx.addIssue({ code: "custom", path: ["endDate"], message: `Lama penugasan maksimal ${MAX_TRIP_DAYS} hari` });
  const seen = new Set<string>();
  v.assignees.forEach((a, i) => {
    if (seen.has(a.employeeId)) ctx.addIssue({ code: "custom", path: ["assignees", i, "employeeId"], message: "Karyawan yang sama dipilih dua kali" });
    seen.add(a.employeeId);
    if (a.days && a.days > n) ctx.addIssue({ code: "custom", path: ["assignees", i, "days"], message: `Jumlah hari melebihi lama penugasan (${n} hari)` });
  });
});

/**
 * Terbitkan Surat Tugas dari HR / Pimpinan kepada karyawan yang ditunjuk. Surat ini menjadi DASAR pemberian Uang Harian
 * (hari × tarif per orang). Isinya dibekukan (snapshot + trigger database); koreksi = batalkan lalu terbitkan yang baru.
 * Admin/HR tidak dapat menugaskan dirinya sendiri (hanya Super Admin) — mencegah memberi uang harian untuk diri sendiri.
 */
export async function createAssignment(actor: Actor, raw: unknown): Promise<AssignmentDto> {
  assertCan(actor, "assignment:manage");
  const input = parseInput(assignmentSchema, raw);
  if (actor.role !== "SUPER_ADMIN" && actor.employeeId && input.assignees.some((a) => a.employeeId === actor.employeeId)) {
    throw Errors.forbidden("Anda tidak dapat menerbitkan surat tugas yang menugaskan diri Anda sendiri. Minta Super Admin menerbitkannya.");
  }
  const settings = await getSettings();
  const issueDate = input.issueDate ?? todayIso(env().APP_TIMEZONE);
  const days = tripDays(input.startDate, input.endDate);
  return transaction(async (tx) => {
    const emps = await tx.employee.findMany({
      where: { id: { in: input.assignees.map((a) => a.employeeId) } },
      select: { id: true, employeeNo: true, fullName: true, position: true, isActive: true, userId: true, division: { select: { name: true } } },
    });
    const byId = new Map(emps.map((e) => [e.id, e]));
    input.assignees.forEach((a, i) => {
      const e = byId.get(a.employeeId);
      if (!e) throw Errors.validation("Karyawan tidak ditemukan.", { [`assignees.${i}.employeeId`]: "Karyawan tidak ditemukan" });
      if (!e.isActive) throw Errors.validation(`${e.fullName} sudah nonaktif dan tidak dapat ditugaskan.`, { [`assignees.${i}.employeeId`]: "Karyawan nonaktif" });
    });
    const year = Number(issueDate.slice(0, 4));
    const seqNo = await nextSeq(tx, "letter", year);
    const number = formatLetterNumber(seqNo, LETTER_CODE.ASSIGNMENT, issueDate);
    const rows = input.assignees.map((a) => {
      const e = byId.get(a.employeeId)!;
      const d = a.days ?? days;
      return { e, days: d, dailyRate: a.dailyRate, total: d * a.dailyRate };
    });
    if (rows.some((r) => r.total > 100_000_000_000)) throw Errors.validation("Total uang harian terlalu besar.");
    const snapshot: AssignmentSnapshot = {
      version: 1, number, company: companyOf(settings), issueDate, purpose: input.purpose, destination: input.destination, startDate: input.startDate, endDate: input.endDate,
      tripDays: days, details: input.details, signer: signerOf(settings), footerNote: settings.slipFooterNote,
      assignees: rows.map((r) => ({ employeeId: r.e.id, employeeNo: r.e.employeeNo, name: r.e.fullName, position: r.e.position, division: r.e.division?.name ?? null, days: r.days, dailyRate: r.dailyRate, total: r.total })),
    };
    const letter = await tx.assignmentLetter.create({
      data: {
        seqYear: year, seqNo, number, purpose: input.purpose, destination: input.destination, startDate: isoToDate(input.startDate), endDate: isoToDate(input.endDate),
        details: input.details, issueDate: isoToDate(issueDate), snapshot: snapshot as unknown as Prisma.InputJsonValue, issuedById: actor.userId,
        assignees: { create: rows.map((r) => ({ employeeId: r.e.id, days: r.days, dailyRate: BigInt(r.dailyRate), total: BigInt(r.total) })) },
      },
      include,
    });
    const total = rows.reduce((a, r) => a + r.total, 0);
    await writeAudit(tx, actor, {
      action: "assignment.create", entityType: "AssignmentLetter", entityId: letter.id,
      summary: `Surat Tugas ${number} diterbitkan: ${input.purpose} → ${input.destination}, ${formatDateRange(input.startDate, input.endDate)}; ${rows.length} karyawan, uang harian total ${formatRupiah(total)}`,
      after: { number, startDate: input.startDate, endDate: input.endDate, assignees: rows.map((r) => ({ employeeId: r.e.id, days: r.days, dailyRate: r.dailyRate })) },
    });
    const userIds = rows.map((r) => r.e.userId).filter((x): x is string => !!x);
    await notifyUsers(tx, userIds, {
      type: "assignment.issued", title: `Surat Tugas baru: ${input.destination}`, body: `${input.purpose} · ${formatDateRange(input.startDate, input.endDate)} · No. ${number}`, href: "/surat-tugas-saya",
    });
    return (await toDtos([letter]))[0]!;
  });
}

const cancelSchema = z.object({ reason: requiredText(5, 300, "Alasan pembatalan") });

/** Batalkan surat tugas. Ditolak bila masih ada bukti penerimaan uang harian aktif (Super Admin harus membatalkannya dulu). */
export async function cancelAssignment(actor: Actor, id: string, raw: unknown): Promise<AssignmentDto> {
  assertCan(actor, "assignment:manage");
  const { reason } = parseInput(cancelSchema, raw);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"assign:" + id}))`;
    const letter = await tx.assignmentLetter.findUnique({ where: { id }, include });
    if (!letter) throw Errors.notFound("Surat tugas");
    if (letter.status === "CANCELLED") throw Errors.conflict("Surat tugas sudah dibatalkan.");
    if (letter.receipts.some((r) => r.status === "ACTIVE")) {
      throw Errors.conflict("Masih ada Bukti Penerimaan Uang Harian yang aktif. Batalkan buktinya terlebih dahulu (hanya Super Admin), lalu batalkan surat tugas.");
    }
    await tx.assignmentLetter.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason } });
    await writeAudit(tx, actor, { action: "assignment.cancel", entityType: "AssignmentLetter", entityId: id, summary: `Surat Tugas ${letter.number} dibatalkan`, before: { status: "ISSUED" }, after: { status: "CANCELLED" }, reason });
    const owners = await tx.employee.findMany({ where: { id: { in: letter.assignees.map((a) => a.employeeId) } }, select: { userId: true } });
    await notifyUsers(tx, owners.map((o) => o.userId).filter((x): x is string => !!x), {
      type: "assignment.cancelled", title: `Surat Tugas ${letter.number} dibatalkan`, body: reason, href: "/surat-tugas-saya",
    });
    return (await toDtos([await tx.assignmentLetter.findUniqueOrThrow({ where: { id }, include })]))[0]!;
  });
}

export const assignmentListSchema = z.object({
  status: z.enum(["ISSUED", "CANCELLED"]).optional(),
  employeeId: uuid.optional(),
  q: z.string().trim().max(100).optional(),
  /** Hanya yang masih ada penerima tanpa bukti penerimaan. */
  pending: z.enum(["1"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export async function listAssignments(actor: Actor, raw: unknown = {}): Promise<Paged<AssignmentDto>> {
  assertCan(actor, "assignment:view_all");
  const f = parseInput(assignmentListSchema, raw);
  const pageSize = f.pageSize ?? 20;
  const page = f.page ?? 1;
  const where: Prisma.AssignmentLetterWhereInput = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.employeeId ? { assignees: { some: { employeeId: f.employeeId } } } : {}),
    ...(f.pending ? { status: "ISSUED", assignees: { some: { receipts: { none: { status: "ACTIVE" } } } } } : {}),
    ...(f.q ? { OR: [
      { number: { contains: f.q, mode: "insensitive" } }, { purpose: { contains: f.q, mode: "insensitive" } }, { destination: { contains: f.q, mode: "insensitive" } },
      { assignees: { some: { employee: { OR: [{ fullName: { contains: f.q, mode: "insensitive" } }, { employeeNo: { contains: f.q, mode: "insensitive" } }] } } } },
    ] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.assignmentLetter.count({ where }),
    prisma.assignmentLetter.findMany({ where, include, orderBy: [{ issueDate: "desc" }, { seqNo: "desc" }], skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { items: await toDtos(rows), total, page, pageSize, pageCount: Math.max(Math.ceil(total / pageSize), 1) };
}

export interface MyAssignmentDto {
  id: string;
  number: string;
  purpose: string;
  destination: string;
  startDate: string;
  endDate: string;
  tripDays: number;
  details: string | null;
  issueDate: string;
  status: AssignmentStatus;
  /** Uang harian milik pelaku sendiri (rekan setugas tidak ditampilkan di layar ini). */
  mine: { days: number; dailyRate: number; total: number };
  receipt: ReceiptDto | null;
  colleagues: string[];
}

/** Surat tugas yang menugaskan pelaku sendiri (terbit atau dibatalkan, yang dibatalkan tetap terlihat sebagai riwayat). */
export async function listMyAssignments(actor: Actor): Promise<MyAssignmentDto[]> {
  const employeeId = requireSelf(actor);
  const rows = await prisma.assignmentLetter.findMany({ where: { assignees: { some: { employeeId } } }, include, orderBy: [{ startDate: "desc" }], take: 100 });
  const dtos = await toDtos(rows);
  return dtos.map((d) => {
    const mine = d.assignees.find((a) => a.employeeId === employeeId)!;
    return {
      id: d.id, number: d.number, purpose: d.purpose, destination: d.destination, startDate: d.startDate, endDate: d.endDate, tripDays: d.tripDays, details: d.details,
      issueDate: d.issueDate, status: d.status, mine: { days: mine.days, dailyRate: mine.dailyRate, total: mine.total }, receipt: mine.receipt,
      colleagues: d.assignees.filter((a) => a.employeeId !== employeeId).map((a) => a.employeeName),
    };
  });
}

/**
 * Surat tugas + snapshot untuk PDF. Pengelola (assignment:view_all): semua. Karyawan: hanya surat yang menugaskan dirinya;
 * yang lain dijawab "tidak ditemukan".
 */
export async function getAssignmentForPdf(actor: Actor, id: string): Promise<{ number: string; status: AssignmentStatus; snapshot: AssignmentSnapshot }> {
  const row = await prisma.assignmentLetter.findUnique({ where: { id }, include: { assignees: { select: { employeeId: true } } } });
  const admin = actorCan(actor, "assignment:view_all");
  if (!row || (!admin && !(actor.employeeId && row.assignees.some((a) => a.employeeId === actor.employeeId)))) throw Errors.notFound("Surat tugas");
  await writeAudit(prisma, actor, { action: "assignment.download", entityType: "AssignmentLetter", entityId: id, summary: `Surat Tugas ${row.number} diunduh` });
  return { number: row.number, status: row.status, snapshot: row.snapshot as unknown as AssignmentSnapshot };
}

// ─────────────────────────── Bukti Penerimaan Uang Harian ───────────────────────────

export const receiptSchema = z.object({
  assigneeId: uuid,
  /** Tanggal uang diserahkan; kosong = hari ini. */
  paidDate: isoDate.optional(),
  method: z.enum(["CASH", "TRANSFER"], { error: "Cara pembayaran wajib dipilih" }),
  note: optionalText(300, "Catatan"),
});

/**
 * Terbitkan Bukti Penerimaan Uang Harian untuk SATU penerima tugas (per perjalanan). Dokumen berdiri sendiri — tidak masuk slip gaji.
 * Memakai penanda tangan resmi yang sama dengan slip gaji. Jumlah = hari × tarif pada surat tugas (tidak dapat diubah di sini).
 */
export async function issueReceipt(actor: Actor, raw: unknown): Promise<ReceiptDto> {
  assertCan(actor, "assignment:manage");
  const input = parseInput(receiptSchema, raw);
  const settings = await getSettings();
  const today = todayIso(env().APP_TIMEZONE);
  const paidDate = input.paidDate ?? today;
  return transaction(async (tx) => {
    const a = await tx.assignmentAssignee.findUnique({
      where: { id: input.assigneeId },
      include: { letter: true, employee: { select: { id: true, employeeNo: true, fullName: true, position: true, userId: true, bankName: true, bankAccountLast4: true, division: { select: { name: true } } } } },
    });
    if (!a) throw Errors.notFound("Penerima tugas");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"assign:" + a.letterId})) `;
    if (actor.role !== "SUPER_ADMIN" && actor.employeeId && a.employeeId === actor.employeeId) {
      throw Errors.forbidden("Anda tidak dapat menerbitkan bukti penerimaan uang harian untuk diri Anda sendiri. Minta Super Admin menerbitkannya.");
    }
    const letter = await tx.assignmentLetter.findUniqueOrThrow({ where: { id: a.letterId } });
    if (letter.status !== "ISSUED") throw Errors.conflict("Surat tugas sudah dibatalkan; bukti penerimaan tidak dapat diterbitkan.");
    const issueDate = dateToIso(letter.issueDate);
    if (paidDate < issueDate) throw Errors.validation(`Tanggal penyerahan tidak boleh sebelum tanggal surat tugas (${formatDateLong(issueDate)}).`, { paidDate: "Sebelum tanggal surat tugas" });
    if (paidDate > today) throw Errors.validation("Tanggal penyerahan tidak boleh di masa depan — bukti penerimaan dibuat setelah uang diserahkan.", { paidDate: "Tanggal di masa depan" });
    const existing = await tx.dailyAllowanceReceipt.findFirst({ where: { assigneeId: a.id, status: "ACTIVE" }, select: { number: true } });
    if (existing) throw Errors.conflict(`Bukti penerimaan untuk ${a.employee.fullName} sudah diterbitkan (${existing.number}). Batalkan dulu bila perlu menerbitkan ulang.`);

    const year = Number(paidDate.slice(0, 4));
    const seqNo = await nextSeq(tx, "receipt", year);
    const number = formatLetterNumber(seqNo, LETTER_CODE.RECEIPT, paidDate);
    const days = tripDays(dateToIso(letter.startDate), dateToIso(letter.endDate));
    const snapshot: ReceiptSnapshot = {
      version: 1, number, company: companyOf(settings),
      letter: { id: letter.id, number: letter.number, issueDate, purpose: letter.purpose, destination: letter.destination, startDate: dateToIso(letter.startDate), endDate: dateToIso(letter.endDate), tripDays: days },
      employee: { id: a.employee.id, employeeNo: a.employee.employeeNo, name: a.employee.fullName, position: a.employee.position, division: a.employee.division?.name ?? null, bankName: a.employee.bankName, bankAccountMasked: a.employee.bankAccountLast4 ? `••••${a.employee.bankAccountLast4}` : null },
      days: a.days, dailyRate: Number(a.dailyRate), total: Number(a.total), paidDate, method: input.method, note: input.note, signer: signerOf(settings), footerNote: settings.slipFooterNote,
    };
    const r = await tx.dailyAllowanceReceipt.create({
      data: {
        seqYear: year, seqNo, number, letterId: a.letterId, assigneeId: a.id, employeeId: a.employeeId, days: a.days, dailyRate: a.dailyRate, total: a.total,
        paidDate: isoToDate(paidDate), method: input.method, note: input.note, snapshot: snapshot as unknown as Prisma.InputJsonValue, issuedById: actor.userId,
      },
    });
    await writeAudit(tx, actor, {
      action: "allowance.issue", entityType: "DailyAllowanceReceipt", entityId: r.id,
      summary: `Bukti Penerimaan Uang Harian ${number} untuk ${a.employee.fullName} (${a.days} hari × ${formatRupiah(Number(a.dailyRate))} = ${formatRupiah(Number(a.total))}, ${METHOD_LABEL[input.method].toLowerCase()}) berdasarkan Surat Tugas ${letter.number}`,
      after: { number, letterNumber: letter.number, employeeId: a.employeeId, days: a.days, dailyRate: Number(a.dailyRate), total: Number(a.total), paidDate, method: input.method },
    });
    if (a.employee.userId) {
      await notifyUsers(tx, [a.employee.userId], { type: "allowance.issued", title: "Bukti Penerimaan Uang Harian tersedia", body: `${letter.destination} · No. ${number} · ${formatRupiah(Number(a.total))}`, href: "/surat-tugas-saya" });
    }
    const names = await userNames([actor.userId]);
    return receiptDto(r, names, a.employee, letter.number);
  });
}

const voidSchema = z.object({ reason: requiredText(5, 300, "Alasan pembatalan") });

/** Batalkan bukti penerimaan yang sudah terbit (mis. salah nominal/penerima) — hanya Super Admin. Penerbitan ulang diperbolehkan setelahnya. */
export async function voidReceipt(actor: Actor, id: string, raw: unknown): Promise<void> {
  assertCan(actor, "assignment:revoke");
  const { reason } = parseInput(voidSchema, raw);
  await transaction(async (tx) => {
    const r = await tx.dailyAllowanceReceipt.findUnique({ where: { id }, include: { employee: { select: { fullName: true, userId: true } } } });
    if (!r) throw Errors.notFound("Bukti penerimaan");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"assign:" + r.letterId}))`;
    if (r.status === "VOIDED") throw Errors.conflict("Bukti penerimaan sudah dibatalkan.");
    await tx.dailyAllowanceReceipt.update({ where: { id }, data: { status: "VOIDED", voidedAt: new Date(), voidedById: actor.userId, voidReason: reason } });
    await writeAudit(tx, actor, { action: "allowance.void", entityType: "DailyAllowanceReceipt", entityId: id, summary: `Bukti Penerimaan ${r.number} (${r.employee.fullName}) dibatalkan`, before: { status: "ACTIVE" }, after: { status: "VOIDED" }, reason });
    if (r.employee.userId) await notifyUsers(tx, [r.employee.userId], { type: "allowance.voided", title: `Bukti Penerimaan ${r.number} dibatalkan`, body: reason, href: "/surat-tugas-saya" });
  });
}

/**
 * Bukti penerimaan + snapshot untuk PDF. Pengelola: semua (termasuk yang dibatalkan, berwatermark). Karyawan: hanya miliknya yang AKTIF;
 * yang lain dijawab "tidak ditemukan".
 */
export async function getReceiptForPdf(actor: Actor, id: string): Promise<{ number: string; status: ReceiptStatus; snapshot: ReceiptSnapshot }> {
  const row = await prisma.dailyAllowanceReceipt.findUnique({ where: { id } });
  const admin = actorCan(actor, "assignment:view_all");
  if (!row || (!admin && !(actor.employeeId === row.employeeId && row.status === "ACTIVE"))) throw Errors.notFound("Bukti penerimaan");
  await writeAudit(prisma, actor, { action: "allowance.download", entityType: "DailyAllowanceReceipt", entityId: id, summary: `Bukti Penerimaan ${row.number} diunduh` });
  return { number: row.number, status: row.status, snapshot: row.snapshot as unknown as ReceiptSnapshot };
}

/** Jumlah surat tugas terbit yang masih punya penerima tanpa bukti penerimaan (lencana menu). */
export async function pendingAllowanceCount(): Promise<number> {
  return prisma.assignmentLetter.count({ where: { status: "ISSUED", assignees: { some: { receipts: { none: { status: "ACTIVE" } } } } } });
}
