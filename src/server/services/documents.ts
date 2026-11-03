import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, transaction, type Tx } from "../db";
import { env } from "../env";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import { actorCan, assertCan, requireSelf, type Actor } from "../actor";
import { writeAudit } from "../audit";
import { dateToIso, isoToDate } from "../json";
import { notifyUsers, reviewerUserIds, superAdminUserIds } from "./notifications";
import { storeFile } from "./files";
import { contractPhase, daysLeft, dueReminder, type ContractPhase } from "@/lib/contract";
import { todayIso } from "@/lib/time";
import { formatDateLong } from "@/lib/format";
import { isoDate, optionalText, requiredText, uuid } from "@/lib/validation/common";
import type { Paged } from "@/lib/types";

export type DocumentKind = "CONTRACT" | "OTHER";
export type RenewalDecision = "PENDING" | "CONTINUE" | "DISCONTINUE";

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = { CONTRACT: "Kontrak kerja", OTHER: "Dokumen lain" };

/** "" / undefined → null, selain itu harus tanggal kalender yang nyata. */
const optIsoDate = z.preprocess((v) => (v === "" || v === undefined ? null : v), isoDate.nullable());

export const documentCreateSchema = z.object({
  employeeId: uuid,
  kind: z.enum(["CONTRACT", "OTHER"], { error: "Jenis dokumen wajib dipilih" }),
  title: requiredText(3, 160, "Judul dokumen"),
  documentNo: optionalText(80, "Nomor dokumen"),
  startDate: optIsoDate,
  endDate: optIsoDate,
  note: optionalText(500, "Catatan"),
  /** Kontrak ini memperpanjang / menggantikan kontrak lain milik karyawan yang sama. */
  renewsDocumentId: z.preprocess((v) => (v === "" || v === undefined ? null : v), uuid.nullable()),
}).superRefine((v, ctx) => {
  if (v.kind === "CONTRACT" && !v.startDate) ctx.addIssue({ code: "custom", path: ["startDate"], message: "Tanggal mulai kontrak wajib diisi" });
  if (v.startDate && v.endDate && v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "Tanggal berakhir tidak boleh sebelum tanggal mulai" });
  if (v.kind !== "CONTRACT" && v.renewsDocumentId) ctx.addIssue({ code: "custom", path: ["renewsDocumentId"], message: "Hanya kontrak kerja yang dapat memperpanjang kontrak lain" });
});

export const documentListSchema = z.object({
  q: z.string().trim().max(100).optional(),
  kind: z.enum(["CONTRACT", "OTHER"]).optional(),
  employeeId: uuid.optional(),
  /** aktif (bawaan) · perlu-keputusan · perlu-perpanjangan · segera-berakhir · berakhir · diarsipkan · semua */
  view: z.enum(["aktif", "perlu-keputusan", "perlu-perpanjangan", "segera-berakhir", "berakhir", "diarsipkan", "semua"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export interface DocumentDto {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  employeeActive: boolean;
  division: string | null;
  kind: DocumentKind;
  title: string;
  documentNo: string | null;
  startDate: string | null;
  endDate: string | null;
  note: string | null;
  fileName: string;
  fileSize: number;
  /** Dibuka inline di penampil PDF peramban (iframe / tab baru). */
  viewUrl: string;
  downloadUrl: string;
  phase: ContractPhase | null;
  /** Sisa hari sampai kontrak berakhir (negatif = sudah lewat); null bila bukan kontrak berbatas waktu. */
  daysLeft: number | null;
  decision: RenewalDecision;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  renewsDocumentId: string | null;
  /** Sudah ada kontrak perpanjangan (aktif) yang menggantikannya. */
  renewedById: string | null;
  /** Pimpinan perlu memutuskan lanjut/tidak. */
  needsDecision: boolean;
  /** Diputuskan dilanjutkan, tetapi kontrak perpanjangan belum diunggah. */
  needsRenewalUpload: boolean;
  remindersSent: string[];
  archived: boolean;
  archiveReason: string | null;
  uploadedBy: string;
  createdAt: string;
}

const include = {
  employee: { select: { fullName: true, employeeNo: true, isActive: true, userId: true, division: { select: { name: true } } } },
  file: { select: { originalName: true, size: true } },
  renewedBy: { where: { archivedAt: null }, select: { id: true } },
} satisfies Prisma.EmployeeDocumentInclude;
type Row = Prisma.EmployeeDocumentGetPayload<{ include: typeof include }>;

async function toDtos(rows: Row[], today: string): Promise<DocumentDto[]> {
  const ids = [...new Set(rows.flatMap((r) => [r.uploadedById, r.decidedById]).filter((x): x is string => !!x))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => {
    const end = r.endDate ? dateToIso(r.endDate) : null;
    const isContract = r.kind === "CONTRACT";
    const archived = r.archivedAt !== null;
    const renewedById = r.renewedBy[0]?.id ?? null;
    const phase = isContract ? contractPhase(end, today) : null;
    const live = isContract && !archived && !!end && !renewedById && r.employee.isActive;
    return {
      id: r.id, employeeId: r.employeeId, employeeName: r.employee.fullName, employeeNo: r.employee.employeeNo, employeeActive: r.employee.isActive, division: r.employee.division?.name ?? null,
      kind: r.kind, title: r.title, documentNo: r.documentNo, startDate: r.startDate ? dateToIso(r.startDate) : null, endDate: end, note: r.note,
      fileName: r.file.originalName, fileSize: r.file.size, viewUrl: `/api/documents/${r.id}/file`, downloadUrl: `/api/documents/${r.id}/file?download=1`,
      phase, daysLeft: isContract && end ? daysLeft(end, today) : null,
      decision: r.renewalDecision, decidedBy: r.decidedById ? name.get(r.decidedById) ?? null : null, decidedAt: r.decidedAt?.toISOString() ?? null, decisionNote: r.decisionNote,
      renewsDocumentId: r.renewsDocumentId, renewedById,
      needsDecision: live && r.renewalDecision === "PENDING" && (phase === "EXPIRING" || phase === "EXPIRED"),
      needsRenewalUpload: live && r.renewalDecision === "CONTINUE",
      remindersSent: r.remindersSent, archived, archiveReason: r.archiveReason, uploadedBy: name.get(r.uploadedById) ?? "—", createdAt: r.createdAt.toISOString(),
    };
  });
}

/** Urutan perhatian: perlu keputusan → perlu unggah perpanjangan → segera berakhir → berakhir → berlaku → lainnya. */
function priority(d: DocumentDto): number {
  if (d.archived) return 9;
  if (d.needsDecision) return 0;
  if (d.needsRenewalUpload) return 1;
  if (d.phase === "EXPIRING" && !d.renewedById) return 2;
  if (d.phase === "EXPIRED" && !d.renewedById) return 3;
  if (d.phase === "ACTIVE") return 4;
  return 5;
}

function matchesView(d: DocumentDto, view: z.infer<typeof documentListSchema>["view"]): boolean {
  switch (view ?? "aktif") {
    case "semua": return true;
    case "diarsipkan": return d.archived;
    case "perlu-keputusan": return d.needsDecision;
    case "perlu-perpanjangan": return d.needsRenewalUpload;
    case "segera-berakhir": return !d.archived && !d.renewedById && d.phase === "EXPIRING";
    case "berakhir": return !d.archived && !d.renewedById && d.phase === "EXPIRED";
    default: return !d.archived;
  }
}

/** Daftar dokumen (pengelola). Data dokumen relatif sedikit (puluhan–ratusan), jadi tampilan/urutan/halaman dihitung di memori. */
export async function listDocuments(actor: Actor, raw: unknown = {}, nowDate: Date = new Date()): Promise<Paged<DocumentDto> & { counts: DocumentCounts }> {
  assertCan(actor, "document:view_all");
  const f = parseInput(documentListSchema, raw);
  const today = todayIso(env().APP_TIMEZONE, nowDate);
  const where: Prisma.EmployeeDocumentWhereInput = {
    ...(f.kind ? { kind: f.kind } : {}), ...(f.employeeId ? { employeeId: f.employeeId } : {}),
    ...(f.q ? { OR: [{ title: { contains: f.q, mode: "insensitive" } }, { documentNo: { contains: f.q, mode: "insensitive" } }, { employee: { OR: [{ fullName: { contains: f.q, mode: "insensitive" } }, { employeeNo: { contains: f.q, mode: "insensitive" } }] } }] } : {}),
  };
  const all = await toDtos(await prisma.employeeDocument.findMany({ where, include }), today);
  const counts = countsOf(all);
  const items = all.filter((d) => matchesView(d, f.view)).sort((a, b) =>
    priority(a) - priority(b) || (a.endDate ?? "9999-12-31").localeCompare(b.endDate ?? "9999-12-31") || b.createdAt.localeCompare(a.createdAt));
  const pageSize = f.pageSize ?? 20;
  const page = f.page ?? 1;
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize, pageCount: Math.max(Math.ceil(items.length / pageSize), 1), counts };
}

export interface DocumentCounts { needsDecision: number; needsRenewalUpload: number; expiring: number; expired: number; active: number }
function countsOf(all: DocumentDto[]): DocumentCounts {
  const live = all.filter((d) => !d.archived);
  return {
    needsDecision: live.filter((d) => d.needsDecision).length,
    needsRenewalUpload: live.filter((d) => d.needsRenewalUpload).length,
    expiring: live.filter((d) => d.phase === "EXPIRING" && !d.renewedById).length,
    expired: live.filter((d) => d.phase === "EXPIRED" && !d.renewedById).length,
    active: live.length,
  };
}

/** Dokumen milik pelaku sendiri (yang belum diarsipkan). */
export async function listMyDocuments(actor: Actor, nowDate: Date = new Date()): Promise<DocumentDto[]> {
  const employeeId = requireSelf(actor);
  const rows = await prisma.employeeDocument.findMany({ where: { employeeId, archivedAt: null }, include, orderBy: [{ createdAt: "desc" }] });
  return toDtos(rows, todayIso(env().APP_TIMEZONE, nowDate));
}

export async function getDocument(actor: Actor, id: string): Promise<DocumentDto> {
  const row = await prisma.employeeDocument.findUnique({ where: { id }, include });
  const own = !!row && actor.employeeId === row.employeeId && row.archivedAt === null;
  if (!row || (!own && !actorCan(actor, "document:view_all"))) throw Errors.notFound("Dokumen");
  return (await toDtos([row], todayIso(env().APP_TIMEZONE)))[0]!;
}

/**
 * Berkas PDF dokumen. Pengelola (document:view_all) boleh membuka semua — pembukaan dicatat di audit; karyawan hanya dokumennya
 * sendiri yang belum diarsipkan. Selain itu dijawab "tidak ditemukan" (tidak membocorkan keberadaan dokumen).
 */
export async function readDocumentFile(actor: Actor, id: string) {
  const doc = await prisma.employeeDocument.findUnique({ where: { id }, include: { file: true } });
  const own = !!doc && actor.employeeId === doc.employeeId && doc.archivedAt === null;
  const admin = actorCan(actor, "document:view_all");
  if (!doc || (!own && !admin)) throw Errors.notFound("Dokumen");
  if (!own) await writeAudit(prisma, actor, { action: "document.view", entityType: "EmployeeDocument", entityId: id, summary: `Dokumen "${doc.title}" dibuka` });
  return { name: doc.file.originalName, mimeType: doc.file.mimeType, size: doc.file.size, data: Buffer.from(doc.file.data) };
}

// ─────────────────────────── Unggah / arsip ───────────────────────────

/**
 * Unggah dokumen (PDF) beserta datanya dalam SATU transaksi. Kontrak wajib bertanggal mulai; tanggal berakhir kosong = tanpa batas waktu
 * (tidak ada pengingat). Bila `renewsDocumentId` diisi, kontrak lama dianggap sudah diperpanjang (pengingatnya berhenti).
 */
export async function createDocument(actor: Actor, raw: unknown, file: { name: string; bytes: Uint8Array }, nowDate: Date = new Date()): Promise<DocumentDto> {
  assertCan(actor, "document:manage");
  const input = parseInput(documentCreateSchema, raw);
  const today = todayIso(env().APP_TIMEZONE, nowDate);
  return transaction(async (tx) => {
    const emp = await tx.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, fullName: true, userId: true } });
    if (!emp) throw Errors.notFound("Karyawan");
    if (input.renewsDocumentId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"doc:" + input.renewsDocumentId}))`;
      const old = await tx.employeeDocument.findUnique({ where: { id: input.renewsDocumentId }, include: { renewedBy: { where: { archivedAt: null }, select: { id: true } } } });
      if (!old || old.employeeId !== input.employeeId || old.kind !== "CONTRACT" || old.archivedAt) {
        throw Errors.validation("Kontrak yang diperpanjang tidak valid (harus kontrak aktif milik karyawan yang sama).", { renewsDocumentId: "Kontrak tidak valid" });
      }
      if (old.renewedBy.length > 0) throw Errors.conflict("Kontrak tersebut sudah memiliki kontrak perpanjangan.");
      if (input.startDate && old.startDate && input.startDate <= dateToIso(old.startDate)) {
        throw Errors.validation("Tanggal mulai kontrak baru harus setelah tanggal mulai kontrak yang diperpanjang.", { startDate: "Harus setelah kontrak lama" });
      }
    }
    const stored = await storeFile(actor, "DOCUMENT", file, tx);
    const doc = await tx.employeeDocument.create({
      data: {
        employeeId: input.employeeId, kind: input.kind, title: input.title, documentNo: input.documentNo, note: input.note,
        startDate: input.startDate ? isoToDate(input.startDate) : null, endDate: input.endDate ? isoToDate(input.endDate) : null,
        fileId: stored.id, renewsDocumentId: input.renewsDocumentId, uploadedById: actor.userId,
      },
      include,
    });
    await writeAudit(tx, actor, {
      action: "document.create", entityType: "EmployeeDocument", entityId: doc.id,
      summary: `${input.kind === "CONTRACT" ? "Kontrak" : "Dokumen"} "${input.title}" ${emp.fullName} diunggah${input.endDate ? ` (berakhir ${formatDateLong(input.endDate)})` : input.kind === "CONTRACT" ? " (tanpa batas waktu)" : ""}${input.renewsDocumentId ? " — memperpanjang kontrak sebelumnya" : ""}`,
      after: { employeeId: input.employeeId, kind: input.kind, startDate: input.startDate, endDate: input.endDate, fileId: stored.id, renewsDocumentId: input.renewsDocumentId },
    });
    if (emp.userId) await notifyUsers(tx, [emp.userId], { type: "document.added", title: `Dokumen baru: ${input.title}`, body: input.endDate ? `Berlaku s.d. ${formatDateLong(input.endDate)}` : null, href: "/dokumen-saya" });
    // Kontrak yang diunggah saat sudah memasuki jendela pengingat langsung memicu pengingat yang jatuh tempo.
    await remindIfDue(tx, doc.id, today);
    return (await toDtos([await tx.employeeDocument.findUniqueOrThrow({ where: { id: doc.id }, include })], today))[0]!;
  });
}

const archiveSchema = z.object({ reason: requiredText(5, 300, "Alasan pengarsipan") });

/** Arsipkan (bukan hapus) — mis. salah unggah. Berkas tetap tersimpan; pengingatnya berhenti. */
export async function archiveDocument(actor: Actor, id: string, raw: unknown): Promise<void> {
  assertCan(actor, "document:manage");
  const { reason } = parseInput(archiveSchema, raw);
  await transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"doc:" + id}))`;
    const doc = await tx.employeeDocument.findUnique({ where: { id }, include: { employee: { select: { fullName: true } } } });
    if (!doc) throw Errors.notFound("Dokumen");
    if (doc.archivedAt) throw Errors.conflict("Dokumen sudah diarsipkan.");
    await tx.employeeDocument.update({ where: { id }, data: { archivedAt: new Date(), archivedById: actor.userId, archiveReason: reason } });
    await writeAudit(tx, actor, { action: "document.archive", entityType: "EmployeeDocument", entityId: id, summary: `Dokumen "${doc.title}" ${doc.employee.fullName} diarsipkan`, before: { archived: false }, after: { archived: true }, reason });
  });
}

// ─────────────────────────── Keputusan pimpinan: lanjut / tidak ───────────────────────────

const decideSchema = z.object({
  decision: z.enum(["CONTINUE", "DISCONTINUE"], { error: "Keputusan wajib dipilih" }),
  note: optionalText(500, "Catatan"),
}).superRefine((v, ctx) => {
  if (v.decision === "DISCONTINUE" && (!v.note || v.note.length < 5)) ctx.addIssue({ code: "custom", path: ["note"], message: "Alasan tidak melanjutkan kontrak wajib diisi (minimal 5 karakter)" });
});

/**
 * Keputusan pimpinan atas kontrak: LANJUTKAN (HR diminta mengunggah kontrak perpanjangan) atau TIDAK LANJUTKAN (HR menindaklanjuti
 * administrasi). Hanya Super Admin. Boleh diubah selama kontrak belum diperpanjang; setiap perubahan tercatat di audit.
 * Keputusan menghentikan pengingat. Karyawan TIDAK diberi tahu otomatis — HR yang menyampaikan.
 */
export async function decideRenewal(actor: Actor, id: string, raw: unknown): Promise<DocumentDto> {
  assertCan(actor, "document:decide");
  const input = parseInput(decideSchema, raw);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"doc:" + id}))`;
    const doc = await tx.employeeDocument.findUnique({ where: { id }, include });
    if (!doc) throw Errors.notFound("Dokumen");
    if (doc.kind !== "CONTRACT" || !doc.endDate) throw Errors.validation("Keputusan hanya untuk kontrak kerja yang memiliki tanggal berakhir.");
    if (doc.archivedAt) throw Errors.conflict("Dokumen sudah diarsipkan.");
    if (doc.renewedBy.length > 0) throw Errors.conflict("Kontrak ini sudah diperpanjang dengan kontrak baru.");
    if (doc.renewalDecision === input.decision && (doc.decisionNote ?? null) === (input.note ?? null)) throw Errors.validation("Keputusan sudah sama.");
    await tx.employeeDocument.update({
      where: { id }, data: { renewalDecision: input.decision, decidedById: actor.userId, decidedAt: new Date(), decisionNote: input.note },
    });
    const who = doc.employee.fullName;
    const end = dateToIso(doc.endDate);
    await writeAudit(tx, actor, {
      action: "document.decide", entityType: "EmployeeDocument", entityId: id,
      summary: `Kontrak "${doc.title}" ${who} (berakhir ${formatDateLong(end)}): ${input.decision === "CONTINUE" ? "DILANJUTKAN" : "TIDAK dilanjutkan"}`,
      before: { decision: doc.renewalDecision }, after: { decision: input.decision }, reason: input.note,
    });
    await notifyUsers(tx, await reviewerUserIds(tx, actor.userId), {
      type: "document.decision",
      title: input.decision === "CONTINUE" ? `Kontrak ${who} akan dilanjutkan` : `Kontrak ${who} TIDAK dilanjutkan`,
      body: input.decision === "CONTINUE"
        ? `Pimpinan memutuskan melanjutkan. Mohon unggah kontrak perpanjangan sebelum ${formatDateLong(end)}.${input.note ? ` Catatan: ${input.note}` : ""}`
        : `Kontrak berakhir ${formatDateLong(end)}. Alasan: ${input.note}. Mohon tindak lanjuti administrasinya.`,
      href: `/dokumen?employeeId=${doc.employeeId}`,
    });
    return (await toDtos([await tx.employeeDocument.findUniqueOrThrow({ where: { id }, include })], todayIso(env().APP_TIMEZONE)))[0]!;
  });
}

// ─────────────────────────── Pengingat kontrak ───────────────────────────

const MILESTONE_TEXT: Record<string, string> = { M3: "3 bulan", M1: "1 bulan", D14: "14 hari" };

/** Kirim pengingat yang jatuh tempo untuk SATU kontrak (dalam transaksi pemanggil). Idempoten: tonggak yang sudah terkirim tidak dikirim lagi. */
async function remindIfDue(tx: Tx, id: string, today: string): Promise<boolean> {
  const doc = await tx.employeeDocument.findUnique({
    where: { id },
    include: { employee: { select: { fullName: true, isActive: true } }, renewedBy: { where: { archivedAt: null }, select: { id: true } } },
  });
  if (!doc || doc.kind !== "CONTRACT" || doc.archivedAt || !doc.endDate || !doc.employee.isActive) return false;
  const end = dateToIso(doc.endDate);
  const due = dueReminder({ endDate: end, today, sent: doc.remindersSent, decided: doc.renewalDecision !== "PENDING", renewed: doc.renewedBy.length > 0 });
  if (!due) return false;
  const sent = [...new Set([...doc.remindersSent, ...due.markSent])];
  // `NOT has` + baris terkunci oleh UPDATE → dua pekerja bersamaan tidak mengirim ganda.
  const upd = await tx.employeeDocument.updateMany({
    where: { id, archivedAt: null, renewalDecision: "PENDING", NOT: { remindersSent: { has: due.milestone.key } } },
    data: { remindersSent: { set: sent } },
  });
  if (upd.count === 0) return false;
  const left = daysLeft(end, today);
  await notifyUsers(tx, await superAdminUserIds(tx), {
    type: "document.contract_expiring",
    title: `Kontrak ${doc.employee.fullName} berakhir ${left <= 0 ? "hari ini" : `${left} hari lagi`} — lanjut atau tidak?`,
    body: `"${doc.title}" berakhir ${formatDateLong(end)} (pengingat H-${MILESTONE_TEXT[due.milestone.key] ?? due.milestone.label}). Mohon putuskan: lanjutkan atau tidak.`,
    href: `/dokumen?view=perlu-keputusan`,
  });
  await writeAudit(tx, null, {
    action: "document.reminder", entityType: "EmployeeDocument", entityId: id,
    summary: `Pengingat kontrak ${doc.employee.fullName} (H-${MILESTONE_TEXT[due.milestone.key]}) dikirim ke pimpinan`, after: { milestone: due.milestone.key, endDate: end },
  });
  return true;
}

export interface ReminderRunResult { checked: number; sent: number; today: string }

/**
 * Pekerja harian: periksa semua kontrak aktif berbatas waktu dan kirim pengingat yang jatuh tempo ke pimpinan (Super Admin).
 * Aman dijalankan berulang & dari banyak instance. `nowDate` untuk pengujian.
 */
export async function runContractReminders(nowDate: Date = new Date()): Promise<ReminderRunResult> {
  const today = todayIso(env().APP_TIMEZONE, nowDate);
  const candidates = await prisma.employeeDocument.findMany({
    where: {
      kind: "CONTRACT", archivedAt: null, renewalDecision: "PENDING", endDate: { gte: isoToDate(today) },
      employee: { isActive: true }, renewedBy: { none: { archivedAt: null } },
    },
    select: { id: true },
  });
  let sent = 0;
  for (const c of candidates) {
    const did = await transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"doc:" + c.id}))`;
      return remindIfDue(tx, c.id, today);
    });
    if (did) sent++;
  }
  return { checked: candidates.length, sent, today };
}

/** Jumlah yang perlu tindakan pelaku (lencana menu): pimpinan → perlu keputusan; HR → perlu unggah kontrak perpanjangan. */
export async function documentAttentionCount(actor: Actor): Promise<number> {
  const decide = actorCan(actor, "document:decide");
  const manage = actorCan(actor, "document:manage");
  if (!decide && !manage) return 0;
  const today = todayIso(env().APP_TIMEZONE);
  const rows = await prisma.employeeDocument.findMany({
    where: { kind: "CONTRACT", archivedAt: null, endDate: { not: null }, employee: { isActive: true }, renewedBy: { none: { archivedAt: null } } },
    select: { endDate: true, renewalDecision: true },
  });
  let n = 0;
  for (const r of rows) {
    const phase = contractPhase(dateToIso(r.endDate!), today);
    if (decide && r.renewalDecision === "PENDING" && (phase === "EXPIRING" || phase === "EXPIRED")) n++;
    else if (manage && r.renewalDecision === "CONTINUE") n++;
  }
  return n;
}

export interface RenewableContract { id: string; employeeId: string; title: string; startDate: string | null; endDate: string | null }

/** Kontrak aktif yang belum diperpanjang (untuk pilihan "memperpanjang kontrak" saat mengunggah). */
export async function listRenewableContracts(actor: Actor): Promise<RenewableContract[]> {
  assertCan(actor, "document:manage");
  const rows = await prisma.employeeDocument.findMany({
    where: { kind: "CONTRACT", archivedAt: null, renewedBy: { none: { archivedAt: null } }, employee: { isActive: true } },
    select: { id: true, employeeId: true, title: true, startDate: true, endDate: true }, orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({ id: r.id, employeeId: r.employeeId, title: r.title, startDate: r.startDate ? dateToIso(r.startDate) : null, endDate: r.endDate ? dateToIso(r.endDate) : null }));
}
