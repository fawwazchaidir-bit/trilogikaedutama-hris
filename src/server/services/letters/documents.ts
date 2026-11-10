import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, transaction } from "../../db";
import { env } from "../../env";
import { Errors } from "../../errors";
import type { Actor } from "../../actor";
import { parseInput } from "../../validate";
import { writeAudit } from "../../audit";
import { notifyUsers } from "../notifications";
import { hasPlaceholder, normalizeDoc, validateDoc, type PmDoc } from "@/lib/documents/content";
import { canSignOwn, canTakeOver, isEditable, isEligibleSigner, LETTER_STATUS_LABEL, type LetterStatus } from "@/lib/documents/policy";
import { formatDocNumber } from "@/lib/documents/text";
import { requiredText, uuid } from "@/lib/validation/common";
import type { Paged } from "@/lib/types";
import { ensureDefaultTypes } from "./types";
import { isDirector, loadVisible, personFacts, requireLetters, LETTER_INCLUDE } from "./access";
import { getLetterSettings, buildFrame } from "./frame";
import { renderDocumentPdf } from "../../pdf/document-render";

export interface LetterEventDto { id: string; action: string; note: string | null; at: string; actorName: string }
export interface LetterDto {
  id: string; status: LetterStatus; statusLabel: string; typeId: string; typeName: string; series: "EKS" | "INT"; kind: "SURAT" | "SK";
  number: string | null; subject: string; issueDate: string | null; createdAt: string; updatedAt: string; submittedAt: string | null;
  creatorId: string; creatorName: string; signerId: string | null; signerName: string | null; verifyToken: string; hasPdf: boolean;
}
export interface SignatoryDto { id: string; position: number; kind: "INTERNAL" | "EXTERNAL"; userId: string | null; name: string; title: string | null; org: string | null; signedAt: string | null; isMe: boolean }
export interface LetterDetailDto extends LetterDto {
  confidential: boolean; multiSigner: boolean; signatories: SignatoryDto[];
  recipientLines: string[]; recipientPlace: string | null; attachmentCount: number | null; attachmentUnit: string | null; salutation: string | null; closing: string | null;
  cc: string[]; body: PmDoc; variables: Record<string, string>; returnNote: string | null; rejectNote: string | null; cancelNote: string | null;
  events: LetterEventDto[];
  can: { edit: boolean; submit: boolean; withdraw: boolean; review: boolean; takeOver: boolean; cancel: boolean; cosign: boolean };
}

const include = LETTER_INCLUDE;
type Row = Prisma.LetterDocumentGetPayload<{ include: typeof include }>;

async function names(ids: (string | null)[]): Promise<Map<string, string>> {
  const set = [...new Set(ids.filter((x): x is string => !!x))];
  const rows = await prisma.user.findMany({ where: { id: { in: set } }, select: { id: true, name: true, employee: { select: { fullName: true } } } });
  return new Map(rows.map((r) => [r.id, r.employee?.fullName ?? r.name]));
}
const toDto = (r: Row, n: Map<string, string>): LetterDto => ({
  id: r.id, status: r.status, statusLabel: LETTER_STATUS_LABEL[r.status], typeId: r.typeId, typeName: r.type.name, series: r.type.series, kind: r.type.kind === "SK" ? "SK" : "SURAT",
  number: r.number, subject: r.subject, issueDate: r.issueDate ? r.issueDate.toISOString().slice(0, 10) : null, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  submittedAt: r.submittedAt?.toISOString() ?? null, creatorId: r.creatorId, creatorName: n.get(r.creatorId) ?? "—", signerId: r.signerId, signerName: r.signerId ? n.get(r.signerId) ?? "—" : null,
  verifyToken: r.verifyToken, hasPdf: !!r.pdfFileId,
});

async function detail(actor: Actor, r: Row): Promise<LetterDetailDto> {
  const ev = await prisma.letterEvent.findMany({ where: { documentId: r.id }, orderBy: { at: "asc" } });
  const n = await names([r.creatorId, r.signerId, ...ev.map((e) => e.actorId)]);
  const ls = await getLetterSettings();
  const mine = r.creatorId === actor.userId;
  const isSigner = r.signerId === actor.userId;
  const sigRows = await prisma.letterSignatory.findMany({ where: { documentId: r.id }, orderBy: { position: "asc" } });
  const sigFacts = new Map<string, { name: string; title: string | null }>();
  for (const sg of sigRows) if (sg.userId) { const f = await personFacts(sg.userId); if (f) sigFacts.set(sg.userId, { name: f.name, title: f.title }); }
  const signatories: SignatoryDto[] = sigRows.map((sg) => ({
    id: sg.id, position: sg.position, kind: sg.kind, userId: sg.userId, name: sg.userId ? sigFacts.get(sg.userId)?.name ?? "—" : sg.name ?? "", title: sg.userId ? sigFacts.get(sg.userId)?.title ?? null : sg.title,
    org: sg.org, signedAt: sg.signedAt?.toISOString() ?? null, isMe: !!sg.userId && sg.userId === actor.userId,
  }));
  const takeOver = isDirector(actor) && !isSigner && r.status === "IN_REVIEW" && canTakeOver(r.submittedAt, new Date(), ls.escalationDays, env().APP_TIMEZONE);
  return {
    ...toDto(r, n), confidential: r.type.confidential, multiSigner: r.type.multiSigner, signatories, recipientLines: r.recipientLines, recipientPlace: r.recipientPlace, attachmentCount: r.attachmentCount, attachmentUnit: r.attachmentUnit,
    salutation: r.salutation, closing: r.closing, cc: r.cc, body: r.body as unknown as PmDoc, variables: (r.variables as Record<string, string> | null) ?? {},
    returnNote: r.returnNote, rejectNote: r.rejectNote, cancelNote: r.cancelNote,
    events: ev.map((e) => ({ id: e.id, action: e.action, note: e.note, at: e.at.toISOString(), actorName: n.get(e.actorId) ?? "—" })),
    can: {
      edit: mine && isEditable(r.status), submit: mine && isEditable(r.status), withdraw: mine && r.status === "IN_REVIEW",
      review: r.status === "IN_REVIEW" && (isSigner || takeOver), takeOver,
      cancel: r.status === "ISSUED" && (isDirector(actor) || isSigner),
      cosign: r.status === "IN_REVIEW" && signatories.some((x) => x.isMe && x.kind === "INTERNAL" && !x.signedAt),
    },
  };
}

const noteFor = (d: { type: { confidential: boolean; name: string }; subject: string }) => (d.type.confidential ? d.type.name : d.subject ? `${d.type.name} — ${d.subject}` : d.type.name);
const event = (tx: Prisma.TransactionClient, documentId: string, actor: Actor, action: string, note?: string | null) =>
  tx.letterEvent.create({ data: { documentId, actorId: actor.userId, action, note: note ?? null } });

// ───────────────────────── Buat & sunting ─────────────────────────

export async function createLetter(actor: Actor, raw: unknown): Promise<LetterDetailDto> {
  requireLetters();
  const { typeId } = parseInput(z.object({ typeId: uuid }), raw);
  await ensureDefaultTypes();
  const facts = await personFacts(actor.userId);
  if (!facts || (!facts.employeeId && !isDirector(actor))) throw Errors.forbidden("Akun Anda belum tertaut ke data karyawan.");
  const t = await prisma.letterType.findUnique({ where: { id: typeId } });
  if (!t || !t.isActive) throw Errors.notFound("Jenis surat");
  if (facts.isIntern && !(t.internAllowed && t.series === "EKS")) throw Errors.forbidden("Peserta magang tidak dapat membuat jenis surat ini.");
  const row = await transaction(async (tx) => {
    const d = await tx.letterDocument.create({
      data: {
        typeId, series: t.series, creatorId: actor.userId, subject: t.kind === "SK" ? t.name : "", body: t.templateBody as object,
        salutation: t.defaultSalutation, closing: t.defaultClosing, verifyToken: randomBytes(16).toString("hex"),
      },
      include,
    });
    await event(tx, d.id, actor, "CREATED");
    await writeAudit(tx, actor, { action: "letter.create", entityType: "LetterDocument", entityId: d.id, summary: `Draf surat dibuat (${t.name})` });
    return d;
  });
  return detail(actor, row);
}

const editSchema = z.object({
  subject: requiredText(0, 300, "Perihal").optional(),
  recipientLines: z.array(z.string().trim().max(200)).max(6).optional(),
  recipientPlace: z.string().trim().max(100).nullable().optional(),
  attachmentCount: z.number().int().min(0).max(99).nullable().optional(),
  attachmentUnit: z.enum(["halaman", "berkas", "lembar"]).nullable().optional(),
  salutation: z.string().trim().max(120).nullable().optional(),
  closing: z.string().trim().max(120).nullable().optional(),
  cc: z.array(z.string().trim().min(1).max(160)).max(10).optional(),
  signerId: uuid.nullable().optional(),
  signatories: z.array(z.object({
    kind: z.enum(["INTERNAL", "EXTERNAL"]), userId: uuid.nullish(), name: z.string().trim().max(120).nullish(), title: z.string().trim().max(120).nullish(), org: z.string().trim().max(160).nullish(),
  })).max(6).optional(),
  variables: z.record(z.string().regex(/^[a-z][a-zA-Z0-9_.]{0,59}$/), z.string().max(500)).optional(),
  body: z.unknown().optional(),
}).strict();

async function assertSignerOk(actor: Actor, typeId: string, signerId: string, creatorId: string): Promise<void> {
  const [t, f, cf] = await Promise.all([prisma.letterType.findUnique({ where: { id: typeId } }), personFacts(signerId), personFacts(creatorId)]);
  if (!t || !f || !isEligibleSigner({ directorOnly: t.directorOnly, signerJobLevels: t.signerJobLevels, hrCanSign: t.hrCanSign }, f)) throw Errors.validation("Penandatangan tidak berwenang untuk jenis surat ini.", { signerId: "Pilih penandatangan yang berwenang" });
  if (signerId === creatorId && !(cf && canSignOwn(cf))) throw Errors.validation("Anda tidak dapat menandatangani surat yang Anda buat sendiri.", { signerId: "Pilih penandatangan lain" });
}

export async function updateLetter(actor: Actor, id: string, raw: unknown): Promise<LetterDetailDto> {
  const d = await loadVisible(actor, id);
  if (d.creatorId !== actor.userId) throw Errors.forbidden("Hanya pembuat surat yang dapat menyuntingnya.");
  if (!isEditable(d.status)) throw Errors.conflict("Surat hanya dapat disunting saat berstatus Draf atau Dikembalikan.");
  const input = parseInput(editSchema, raw);
  const data: Prisma.LetterDocumentUncheckedUpdateInput = {};
  if (input.body !== undefined) {
    const e = validateDoc(input.body);
    if (e) throw Errors.validation(e, { body: e });
    data.body = normalizeDoc(input.body as PmDoc) as object;
  }
  if (input.signerId) await assertSignerOk(actor, d.typeId, input.signerId, d.creatorId);
  for (const k of ["subject", "recipientLines", "recipientPlace", "attachmentCount", "attachmentUnit", "salutation", "closing", "cc", "signerId"] as const) {
    if (input[k] !== undefined) (data as Record<string, unknown>)[k] = input[k];
  }
  if (input.variables !== undefined) data.variables = input.variables;
  if (input.signatories !== undefined) {
    if (!d.type.multiSigner) throw Errors.validation("Jenis surat ini hanya memiliki satu penandatangan.", { signatories: "Tidak didukung" });
    const seen = new Set<string>();
    for (const [i, sg] of input.signatories.entries()) {
      if (sg.kind === "INTERNAL") {
        if (!sg.userId) throw Errors.validation("Pilih akun penandatangan internal.", { signatories: `Baris ${i + 1}: pilih akun` });
        if (sg.userId === d.signerId || seen.has(sg.userId)) throw Errors.validation("Penandatangan yang sama dipilih dua kali.", { signatories: `Baris ${i + 1}: duplikat` });
        seen.add(sg.userId);
        const f = await personFacts(sg.userId);
        if (!f || !f.isActive || f.isIntern) throw Errors.validation("Penandatangan internal harus karyawan aktif (bukan magang).", { signatories: `Baris ${i + 1}: tidak valid` });
      } else if (!sg.name?.trim()) throw Errors.validation("Isi nama penandatangan mitra.", { signatories: `Baris ${i + 1}: nama wajib` });
    }
    const sigs = input.signatories;
    const row = await transaction(async (tx) => {
      await tx.letterSignatory.deleteMany({ where: { documentId: id } });
      await tx.letterSignatory.createMany({ data: sigs.map((sg, i) => ({ documentId: id, position: i, kind: sg.kind, userId: sg.kind === "INTERNAL" ? sg.userId! : null, name: sg.kind === "EXTERNAL" ? sg.name!.trim() : null, title: sg.title?.trim() || null, org: sg.org?.trim() || null })) });
      return tx.letterDocument.update({ where: { id }, data, include });
    });
    return detail(actor, row);
  }
  const row = await prisma.letterDocument.update({ where: { id }, data, include });
  return detail(actor, row);
}

// ───────────────────────── Daftar & baca ─────────────────────────

export async function listLetters(actor: Actor, q: { scope?: "mine" | "review" | "all"; status?: string; q?: string; page?: number; pageSize?: number }): Promise<Paged<LetterDto>> {
  requireLetters();
  const pageSize = Math.min(Math.max(q.pageSize ?? 20, 1), 100); const page = Math.max(q.page ?? 1, 1);
  const scope = q.scope === "all" && (isDirector(actor) || actor.role === "HR_ADMIN") ? "all" : q.scope === "review" ? "review" : "mine";
  const where: Prisma.LetterDocumentWhereInput = {
    ...(scope === "mine" ? { creatorId: actor.userId }
      : scope === "review" ? { OR: [{ signerId: actor.userId, status: { not: "DRAFT" as const } }, { status: "IN_REVIEW" as const, signatories: { some: { userId: actor.userId } } }] }
      : isDirector(actor) ? {} : { type: { hrCanView: true } }),
    ...(q.status && ["DRAFT", "IN_REVIEW", "RETURNED", "ISSUED", "REJECTED", "CANCELLED"].includes(q.status) ? { status: q.status as LetterStatus } : {}),
    ...(q.q?.trim() ? { AND: [{ OR: [{ subject: { contains: q.q.trim(), mode: "insensitive" } }, { number: { contains: q.q.trim(), mode: "insensitive" } }] }] } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.letterDocument.count({ where }),
    prisma.letterDocument.findMany({ where, include, orderBy: { updatedAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  const n = await names(rows.flatMap((r) => [r.creatorId, r.signerId]));
  return { items: rows.map((r) => toDto(r, n)), total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

export async function getLetter(actor: Actor, id: string): Promise<LetterDetailDto> {
  const d = await loadVisible(actor, id);
  // Surat Rahasia: pembukaan oleh pihak di luar pembuat/penandatangan (Direktur, HR) dicatat di Audit Log.
  if (d.type.confidential && d.creatorId !== actor.userId && d.signerId !== actor.userId && !d.signatories.some((s) => s.userId === actor.userId)) {
    await writeAudit(prisma, actor, { action: "letter.view_confidential", entityType: "LetterDocument", entityId: id, summary: `Surat Rahasia (${d.type.name}) dibuka` });
  }
  return detail(actor, d as Row);
}

/** Jumlah surat yang menunggu tinjauan pelaku sebagai penandatangan (lencana menu). */
export async function pendingReviewCount(actor: Actor): Promise<number> {
  return prisma.letterDocument.count({ where: { status: "IN_REVIEW", OR: [{ signerId: actor.userId }, { signatories: { some: { userId: actor.userId, signedAt: null } } }] } });
}

/** PDF pratinjau (draf berwatermark) atau PDF terbit tersimpan. */
export async function letterPdf(actor: Actor, id: string): Promise<{ bytes: Buffer; name: string }> {
  const d = await loadVisible(actor, id);
  if (d.status === "ISSUED" || d.status === "CANCELLED") {
    if (d.pdfFileId) {
      const f = await prisma.storedFile.findUnique({ where: { id: d.pdfFileId }, select: { data: true } });
      if (f) return { bytes: Buffer.from(f.data), name: `${(d.number ?? "surat").replace(/\//g, "-")}.pdf` };
    }
  }
  const signerUserId = d.signerId ?? actor.userId;
  const today = new Date().toISOString().slice(0, 10);
  const { frame } = await buildFrame(d, { number: null, date: today, signerUserId, draft: true });
  return { bytes: await renderDocumentPdf(frame), name: "pratinjau-draf.pdf" };
}

// ───────────────────────── Siklus ─────────────────────────

const noteSchema = z.object({ note: requiredText(3, 500, "Catatan") });

export async function submitLetter(actor: Actor, id: string): Promise<LetterDetailDto> {
  const d = await loadVisible(actor, id);
  if (d.creatorId !== actor.userId) throw Errors.forbidden();
  if (!isEditable(d.status)) throw Errors.conflict("Surat sudah diajukan.");
  const fe: Record<string, string> = {};
  if (d.type.kind !== "SK" && d.subject.trim().length < 3) fe.subject = "Perihal wajib diisi";
  if (d.type.kind !== "SK" && d.recipientLines.filter((l) => l.trim()).length === 0) fe.recipientLines = "Penerima wajib diisi";
  if (!d.signerId) fe.signerId = "Pilih penandatangan";
  else await assertSignerOk(actor, d.typeId, d.signerId, d.creatorId).catch((e) => { fe.signerId = e.message; });
  const { missing } = await buildFrame(d, { number: null, date: new Date().toISOString().slice(0, 10), signerUserId: d.signerId ?? actor.userId, draft: true });
  if (missing.length) fe.body = `Data belum terisi: ${missing.join(", ")}`;
  if (hasPlaceholder(d.body as unknown as PmDoc)) fe.body ??= "Masih ada teks panduan dalam [kurung siku] yang belum diganti";
  if (Object.keys(fe).length) throw Errors.validation("Surat belum lengkap: " + Object.values(fe).join("; "), fe);
  const row = await transaction(async (tx) => {
    const u = await tx.letterDocument.update({ where: { id }, data: { status: "IN_REVIEW", submittedAt: new Date(), returnNote: null }, include });
    await event(tx, id, actor, "SUBMITTED");
    await writeAudit(tx, actor, { action: "letter.submit", entityType: "LetterDocument", entityId: id, summary: `Surat (${d.type.name}) diajukan ke penandatangan` });
    await notifyUsers(tx, [d.signerId!, ...d.signatories.map((s) => s.userId).filter((x): x is string => !!x)], { type: "letter.review", title: "Surat menunggu tanda tangan Anda", body: noteFor(d), href: `/persuratan/${id}` });
    return u;
  });
  return detail(actor, row);
}

export async function withdrawLetter(actor: Actor, id: string): Promise<LetterDetailDto> {
  const d = await loadVisible(actor, id);
  if (d.creatorId !== actor.userId) throw Errors.forbidden();
  if (d.status !== "IN_REVIEW") throw Errors.conflict("Hanya surat yang menunggu penandatangan yang dapat ditarik.");
  const row = await transaction(async (tx) => {
    const u = await tx.letterDocument.update({ where: { id }, data: { status: "DRAFT", submittedAt: null }, include });
    await event(tx, id, actor, "WITHDRAWN");
    return u;
  });
  return detail(actor, row);
}

async function assertReviewer(actor: Actor, d: Awaited<ReturnType<typeof loadVisible>>): Promise<boolean> {
  if (d.status !== "IN_REVIEW") throw Errors.conflict("Surat tidak sedang menunggu penandatangan.");
  if (d.signerId === actor.userId) return false;
  if (isDirector(actor)) {
    const ls = await getLetterSettings();
    if (canTakeOver(d.submittedAt, new Date(), ls.escalationDays, env().APP_TIMEZONE)) return true;
    throw Errors.forbidden(`Direktur dapat mengambil alih setelah ${ls.escalationDays} hari kerja sejak diajukan.`);
  }
  throw Errors.forbidden();
}

export async function returnLetter(actor: Actor, id: string, raw: unknown): Promise<LetterDetailDto> {
  const { note } = parseInput(noteSchema, raw);
  const d = await loadVisible(actor, id);
  const takeover = await assertReviewer(actor, d);
  const row = await transaction(async (tx) => {
    const u = await tx.letterDocument.update({ where: { id }, data: { status: "RETURNED", returnNote: note }, include });
    await event(tx, id, actor, takeover ? "TAKEOVER_RETURNED" : "RETURNED", note);
    await writeAudit(tx, actor, { action: "letter.return", entityType: "LetterDocument", entityId: id, summary: `Surat dikembalikan untuk revisi`, reason: note });
    await notifyUsers(tx, [d.creatorId], { type: "letter.returned", title: "Surat dikembalikan untuk revisi", body: note, href: `/persuratan/${id}` });
    return u;
  });
  return detail(actor, row);
}

export async function rejectLetter(actor: Actor, id: string, raw: unknown): Promise<LetterDetailDto> {
  const { note } = parseInput(noteSchema, raw);
  const d = await loadVisible(actor, id);
  const takeover = await assertReviewer(actor, d);
  const row = await transaction(async (tx) => {
    const u = await tx.letterDocument.update({ where: { id }, data: { status: "REJECTED", rejectNote: note }, include });
    await event(tx, id, actor, takeover ? "TAKEOVER_REJECTED" : "REJECTED", note);
    await writeAudit(tx, actor, { action: "letter.reject", entityType: "LetterDocument", entityId: id, summary: `Surat ditolak`, reason: note });
    await notifyUsers(tx, [d.creatorId], { type: "letter.rejected", title: "Surat ditolak penandatangan", body: note, href: `/persuratan/${id}` });
    return u;
  });
  return detail(actor, row);
}

export async function cancelLetter(actor: Actor, id: string, raw: unknown): Promise<LetterDetailDto> {
  const { note } = parseInput(noteSchema, raw);
  const d = await loadVisible(actor, id);
  if (d.status !== "ISSUED") throw Errors.conflict("Hanya surat terbit yang dapat dibatalkan.");
  if (!(isDirector(actor) || d.signerId === actor.userId)) throw Errors.forbidden();
  const row = await transaction(async (tx) => {
    const u = await tx.letterDocument.update({ where: { id }, data: { status: "CANCELLED", cancelNote: note }, include });
    await event(tx, id, actor, "CANCELLED", note);
    await writeAudit(tx, actor, { action: "letter.cancel", entityType: "LetterDocument", entityId: id, summary: `Surat ${d.number} dibatalkan`, reason: note });
    await notifyUsers(tx, [d.creatorId], { type: "letter.cancelled", title: `Surat ${d.number} dibatalkan`, body: note, href: `/persuratan/${id}` });
    return u;
  });
  return detail(actor, row);
}

/** Penandatangan tambahan internal menandatangani bagiannya; penandatangan utama baru dapat menerbitkan setelah semuanya selesai. */
export async function cosignLetter(actor: Actor, id: string): Promise<LetterDetailDto> {
  const d = await loadVisible(actor, id);
  if (d.status !== "IN_REVIEW") throw Errors.conflict("Surat tidak sedang menunggu tanda tangan.");
  const mine = d.signatories.find((s) => s.userId === actor.userId);
  if (!mine) throw Errors.forbidden();
  const row = await transaction(async (tx) => {
    const r = await tx.letterSignatory.updateMany({ where: { id: mine.id, signedAt: null }, data: { signedAt: new Date() } });
    if (r.count === 0) throw Errors.conflict("Anda sudah menandatangani surat ini.");
    await event(tx, id, actor, "COSIGNED");
    await writeAudit(tx, actor, { action: "letter.cosign", entityType: "LetterDocument", entityId: id, summary: `Penandatangan tambahan menandatangani (${d.type.name})` });
    const left = await tx.letterSignatory.count({ where: { documentId: id, kind: "INTERNAL", signedAt: null } });
    await notifyUsers(tx, [d.creatorId, ...(left === 0 && d.signerId ? [d.signerId] : [])], { type: "letter.cosigned", title: left === 0 ? "Semua penandatangan tambahan sudah menandatangani" : "Penandatangan tambahan menandatangani", body: noteFor(d), href: `/persuratan/${id}` });
    return tx.letterDocument.findUniqueOrThrow({ where: { id }, include });
  });
  return detail(actor, row);
}

// ───────────────────────── Persetujuan = penomoran + PDF terkunci ─────────────────────────

/**
 * Penandatangan menyetujui: dalam SATU transaksi — kunci penghitung (advisory lock) → nomor urut berikutnya → render PDF ber-QR →
 * simpan berkas + hash → status Terbit. Bila apa pun gagal, seluruhnya dibatalkan dan nomor TIDAK terpakai (tanpa lubang nomor).
 */
export async function approveLetter(actor: Actor, id: string): Promise<LetterDetailDto> {
  const pre = await loadVisible(actor, id);
  const takeover = await assertReviewer(actor, pre);
  const typeFacts = await prisma.letterType.findUniqueOrThrow({ where: { id: pre.typeId } });
  const me = await personFacts(actor.userId);
  if (!me || !isEligibleSigner({ directorOnly: typeFacts.directorOnly, signerJobLevels: typeFacts.signerJobLevels, hrCanSign: typeFacts.hrCanSign }, me)) throw Errors.forbidden("Anda tidak lagi berwenang menandatangani jenis surat ini.");
  if (pre.creatorId === actor.userId && !isDirector(actor)) throw Errors.forbidden("Tidak dapat menyetujui surat yang Anda buat sendiri.");
  const issueDate = new Date().toLocaleDateString("en-CA", { timeZone: env().APP_TIMEZONE });
  const year = Number(issueDate.slice(0, 4));
  const row = await transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`letters:${pre.series}:${year}`}))`;
    const cur = await tx.letterDocument.findUniqueOrThrow({ where: { id }, include });
    if (cur.status !== "IN_REVIEW") throw Errors.conflict("Surat sudah diproses pihak lain.");
    const unsigned = await tx.letterSignatory.count({ where: { documentId: id, kind: "INTERNAL", signedAt: null } });
    if (unsigned > 0) throw Errors.conflict(`Masih ada ${unsigned} penandatangan internal yang belum menandatangani.`);
    const counter = await tx.letterCounter.upsert({ where: { series_year: { series: pre.series, year } }, create: { series: pre.series, year, lastSeq: 1 }, update: { lastSeq: { increment: 1 } } });
    const seq = counter.lastSeq;
    const number = formatDocNumber({ seq, series: pre.series, typeCode: String(typeFacts.code).padStart(3, "0"), date: issueDate });
    const { frame, missing, signer } = await buildFrame(cur, { number, date: issueDate, signerUserId: actor.userId, draft: false });
    if (missing.length) throw Errors.validation(`Data belum terisi: ${missing.join(", ")}`);
    const pdf = await renderDocumentPdf(frame);
    const sha = createHash("sha256").update(pdf).digest("hex");
    const file = await tx.storedFile.create({ data: { kind: "LETTER_PDF", originalName: `${number.replace(/\//g, "-")}.pdf`, mimeType: "application/pdf", size: pdf.byteLength, sha256: sha, data: new Uint8Array(pdf), uploadedById: actor.userId }, select: { id: true } });
    const u = await tx.letterDocument.update({
      where: { id },
      data: {
        status: "ISSUED", signerId: actor.userId, issuedById: actor.userId, issuedAt: new Date(), issueDate: new Date(`${issueDate}T00:00:00Z`), seqYear: year, seqNo: seq, number,
        pdfFileId: file.id, pdfSha256: sha,
        snapshot: { version: 1, number, issueDate, subject: cur.subject, signer, recipientLines: cur.recipientLines, cc: cur.cc, typeName: cur.type.name, body: frame.body } as unknown as object,
      },
      include,
    });
    await event(tx, id, actor, takeover ? "TAKEOVER_ISSUED" : "ISSUED", number);
    await writeAudit(tx, actor, { action: "letter.issue", entityType: "LetterDocument", entityId: id, summary: `Surat ${number} diterbitkan (${cur.type.name})`, after: { number, sha256: sha, takeover } });
    await notifyUsers(tx, [cur.creatorId], { type: "letter.issued", title: `Surat terbit: ${number}`, body: cur.type.confidential ? cur.type.name : cur.subject || cur.type.name, href: `/persuratan/${id}` });
    return u;
  });
  return detail(actor, row);
}
