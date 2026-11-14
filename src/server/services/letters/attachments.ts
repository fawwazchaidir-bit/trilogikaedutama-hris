import "server-only";
import { PDFDocument } from "pdf-lib";
import { z } from "zod";
import { prisma, transaction } from "../../db";
import { Errors } from "../../errors";
import type { Actor } from "../../actor";
import { parseInput } from "../../validate";
import { writeAudit } from "../../audit";
import { normalizeDoc, validateDoc, type PmDoc } from "@/lib/documents/content";
import { isEditable } from "@/lib/documents/policy";
import { doc, p } from "@/lib/documents/builders";
import { requiredText } from "@/lib/validation/common";
import { storeFile } from "../files";
import { loadVisible } from "./access";

export const MAX_ATTACHMENTS = 10;
const MAX_PAGES = 200;

export interface AttachmentDto {
  id: string; position: number; kind: "EDITOR" | "UPLOAD_MERGED" | "UPLOAD_SEPARATE"; title: string;
  body: PmDoc | null; fileId: string | null; fileName: string | null; sha256: string | null; size: number | null; pages: number | null;
}
export const toAttachmentDto = (a: { id: string; position: number; kind: AttachmentDto["kind"]; title: string; body: unknown; fileId: string | null; fileName: string | null; sha256: string | null; size: number | null; pages: number | null }): AttachmentDto => ({
  id: a.id, position: a.position, kind: a.kind, title: a.title, body: (a.body as PmDoc | null) ?? null, fileId: a.fileId, fileName: a.fileName, sha256: a.sha256, size: a.size, pages: a.pages,
});

/** Hanya pembuat, saat Draf/Dikembalikan, bukan surat arsip-saja. */
async function editableDoc(actor: Actor, id: string) {
  const d = await loadVisible(actor, id);
  if (d.creatorId !== actor.userId) throw Errors.forbidden("Hanya pembuat surat yang dapat mengubah lampiran.");
  if (!isEditable(d.status)) throw Errors.conflict("Lampiran hanya dapat diubah saat surat berstatus Draf atau Dikembalikan.");
  if (d.archiveOnly) throw Errors.validation("Surat arsip-saja tidak memiliki lampiran di portal.");
  return d;
}
async function nextPosition(documentId: string): Promise<number> {
  const n = await prisma.letterAttachment.count({ where: { documentId } });
  if (n >= MAX_ATTACHMENTS) throw Errors.validation(`Maksimal ${MAX_ATTACHMENTS} lampiran per surat.`);
  return n;
}

/** Periksa PDF unggahan: dapat dibaca, tidak terenkripsi, jumlah halaman wajar. */
export async function inspectPdf(bytes: Uint8Array): Promise<{ pages: number }> {
  try {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false, updateMetadata: false });
    const pages = pdf.getPageCount();
    if (pages < 1) throw new Error("kosong");
    if (pages > MAX_PAGES) throw Errors.validation(`PDF terlalu panjang (maksimal ${MAX_PAGES} halaman).`);
    return { pages };
  } catch (e) {
    if (e instanceof Error && e.name === "AppError") throw e;
    if ((e as { code?: string }).code === "VALIDATION") throw e;
    throw Errors.validation("PDF tidak dapat dibaca atau dilindungi sandi. Unggah PDF biasa tanpa sandi.");
  }
}

export async function addEditorAttachment(actor: Actor, id: string, raw: unknown): Promise<AttachmentDto> {
  const { title } = parseInput(z.object({ title: requiredText(2, 160, "Judul lampiran") }), raw);
  const d = await editableDoc(actor, id);
  const position = await nextPosition(id);
  const a = await prisma.letterAttachment.create({ data: { documentId: id, position, kind: "EDITOR", title, body: doc(p("")) as object } });
  await writeAudit(prisma, actor, { action: "letter.attachment_add", entityType: "LetterDocument", entityId: d.id, summary: `Lampiran "${title}" ditambahkan` });
  return toAttachmentDto(a);
}

export async function uploadAttachment(actor: Actor, id: string, input: { title: string; mode: "MERGED" | "SEPARATE"; name: string; bytes: Uint8Array }): Promise<AttachmentDto> {
  const parsed = parseInput(z.object({ title: requiredText(2, 160, "Judul lampiran"), mode: z.enum(["MERGED", "SEPARATE"]) }), { title: input.title, mode: input.mode });
  const d = await editableDoc(actor, id);
  const position = await nextPosition(id);
  const { pages } = await inspectPdf(input.bytes);
  const a = await transaction(async (tx) => {
    const file = await storeFile(actor, "LETTER_ATTACHMENT", { name: input.name, bytes: input.bytes }, tx);
    const full = await tx.storedFile.findUniqueOrThrow({ where: { id: file.id }, select: { sha256: true, originalName: true } });
    const row = await tx.letterAttachment.create({ data: { documentId: id, position, kind: parsed.mode === "MERGED" ? "UPLOAD_MERGED" : "UPLOAD_SEPARATE", title: parsed.title, fileId: file.id, fileName: full.originalName, sha256: full.sha256, size: file.size, pages } });
    await writeAudit(tx, actor, { action: "letter.attachment_upload", entityType: "LetterDocument", entityId: d.id, summary: `Lampiran PDF "${parsed.title}" diunggah (${parsed.mode === "MERGED" ? "digabung" : "terpisah"})` });
    return row;
  });
  return toAttachmentDto(a);
}

const patchSchema = z.object({ title: requiredText(2, 160, "Judul lampiran").optional(), body: z.unknown().optional(), mode: z.enum(["MERGED", "SEPARATE"]).optional() }).strict();
export async function updateAttachment(actor: Actor, id: string, attId: string, raw: unknown): Promise<AttachmentDto> {
  const input = parseInput(patchSchema, raw);
  await editableDoc(actor, id);
  const cur = await prisma.letterAttachment.findFirst({ where: { id: attId, documentId: id } });
  if (!cur) throw Errors.notFound("Lampiran");
  const data: Record<string, unknown> = {};
  if (input.title !== undefined) data.title = input.title;
  if (input.body !== undefined) {
    if (cur.kind !== "EDITOR") throw Errors.validation("Hanya lampiran editor yang memiliki isi.");
    const e = validateDoc(input.body);
    if (e) throw Errors.validation(e, { body: e });
    data.body = normalizeDoc(input.body as PmDoc) as object;
  }
  if (input.mode !== undefined) {
    if (cur.kind === "EDITOR") throw Errors.validation("Mode gabung/terpisah hanya untuk lampiran PDF unggahan.");
    data.kind = input.mode === "MERGED" ? "UPLOAD_MERGED" : "UPLOAD_SEPARATE";
  }
  return toAttachmentDto(await prisma.letterAttachment.update({ where: { id: attId }, data }));
}

export async function deleteAttachment(actor: Actor, id: string, attId: string): Promise<void> {
  const d = await editableDoc(actor, id);
  const cur = await prisma.letterAttachment.findFirst({ where: { id: attId, documentId: id } });
  if (!cur) throw Errors.notFound("Lampiran");
  await prisma.letterAttachment.delete({ where: { id: attId } });
  await writeAudit(prisma, actor, { action: "letter.attachment_delete", entityType: "LetterDocument", entityId: d.id, summary: `Lampiran "${cur.title}" dihapus` });
}

/** Gabungkan PDF utama dengan lampiran unggahan bermode "digabung" (urut posisi). */
/** Jumlah halaman semua bagian PDF yang akan digabung (sama dengan yang ditambahkan `mergePdfs`). */
export async function countPdfPages(parts: Uint8Array[]): Promise<number> {
  let n = 0;
  for (const part of parts) n += (await PDFDocument.load(part)).getPageCount();
  return n;
}

export async function mergePdfs(main: Buffer, parts: Uint8Array[]): Promise<Buffer> {
  if (parts.length === 0) return main;
  const out = await PDFDocument.load(main);
  for (const part of parts) {
    const src = await PDFDocument.load(part);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((pg) => out.addPage(pg));
  }
  return Buffer.from(await out.save());
}
