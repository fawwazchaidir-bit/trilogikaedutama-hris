import "server-only";
import { z } from "zod";
import { prisma, transaction, type Tx } from "../../db";
import { Errors } from "../../errors";
import { assertCan, type Actor } from "../../actor";
import { parseInput } from "../../validate";
import { writeAudit } from "../../audit";
import { getLetterSettings } from "./frame";
import { isDirector, personFacts, requireLetters } from "./access";
import { canHoldSignature } from "@/lib/documents/policy";
import { optionalText, uuid } from "@/lib/validation/common";

function assertDirector(actor: Actor): void {
  requireLetters();
  if (!isDirector(actor)) throw Errors.forbidden("Hanya Direktur yang dapat mengubah pengaturan persuratan.");
  assertCan(actor, "settings:manage");
}

export interface LetterSettingsDto {
  place: string; idLine: string | null; footerText: string | null; escalationDays: number; stampUrl: string | null;
  counters: { series: "EKS" | "INT"; year: number; lastSeq: number }[];
}
export async function getLetterSettingsDto(actor: Actor): Promise<LetterSettingsDto> {
  assertDirector(actor);
  const [s, counters] = await Promise.all([getLetterSettings(), prisma.letterCounter.findMany({ orderBy: [{ year: "desc" }, { series: "asc" }] })]);
  return { place: s.place, idLine: s.idLine, footerText: s.footerText, escalationDays: s.escalationDays, stampUrl: s.stampFileId ? `/api/files/${s.stampFileId}` : null, counters };
}

const settingsSchema = z.object({
  place: z.string().trim().min(2).max(80), idLine: optionalText(200, "Baris identitas"), footerText: optionalText(200, "Teks kaki"),
  escalationDays: z.number().int().min(1).max(30),
}).strict();
export async function updateLetterSettings(actor: Actor, raw: unknown): Promise<void> {
  assertDirector(actor);
  const input = parseInput(settingsSchema, raw);
  await transaction(async (tx) => {
    await tx.letterSettings.upsert({ where: { id: 1 }, create: { id: 1, ...input }, update: input });
    await writeAudit(tx, actor, { action: "letter.settings", entityType: "LetterSettings", entityId: "1", summary: "Pengaturan persuratan diubah", after: input });
  });
}

/** Atur nomor urut terakhir yang sudah terpakai (mis. melanjutkan register arsip). Hanya boleh naik. */
export async function setCounterOffset(actor: Actor, raw: unknown): Promise<void> {
  assertDirector(actor);
  const input = parseInput(z.object({ series: z.enum(["EKS", "INT"]), year: z.number().int().min(2020).max(2100), lastSeq: z.number().int().min(0).max(99999) }), raw);
  await transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`letters:${input.series}:${input.year}`}))`;
    const cur = await tx.letterCounter.findUnique({ where: { series_year: { series: input.series, year: input.year } } });
    if (cur && input.lastSeq < cur.lastSeq) throw Errors.validation(`Nomor terakhir tidak boleh diturunkan (saat ini ${cur.lastSeq}).`);
    await tx.letterCounter.upsert({ where: { series_year: { series: input.series, year: input.year } }, create: input, update: { lastSeq: input.lastSeq } });
    await writeAudit(tx, actor, { action: "letter.counter", entityType: "LetterCounter", entityId: `${input.series}:${input.year}`, summary: `Nomor urut TE-${input.series} tahun ${input.year} diatur ke ${input.lastSeq}`, before: { lastSeq: cur?.lastSeq ?? 0 }, after: { lastSeq: input.lastSeq } });
  });
}

async function assertSignatureFile(tx: Tx, fileId: string | null, kind: "SIGNATURE" | "LETTER_SIGNATURE" = "SIGNATURE"): Promise<void> {
  if (!fileId) return;
  const f = await tx.storedFile.findUnique({ where: { id: fileId }, select: { kind: true } });
  if (f?.kind !== kind) throw Errors.validation("File gambar tidak valid.");
}

/** Gambar tanda tangan: Direktur untuk siapa saja, atau pemilik akun sendiri bila ia calon penandatangan (Direktur, Supervisor/Manajer, HR). */
export async function assertCanSetSignature(actor: Actor, userId: string): Promise<void> {
  requireLetters();
  if (isDirector(actor)) return;
  if (userId !== actor.userId) throw Errors.forbidden("Hanya Direktur yang dapat mengatur tanda tangan orang lain.");
  const f = await personFacts(actor.userId);
  if (!f || !canHoldSignature(f)) throw Errors.forbidden("Akun Anda tidak termasuk calon penandatangan surat.");
}
export async function setSignerSignature(actor: Actor, userId: string, fileId: string | null, outer?: Tx): Promise<void> {
  await assertCanSetSignature(actor, userId);
  uuid.parse(userId);
  await (outer ? (fn: (t: Tx) => Promise<void>) => fn(outer) : transaction)(async (tx) => {
    if (!(await tx.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw Errors.notFound("Akun");
    await assertSignatureFile(tx, fileId, "LETTER_SIGNATURE");
    await tx.letterSigner.upsert({ where: { userId }, create: { userId, signatureFileId: fileId }, update: { signatureFileId: fileId } });
    await writeAudit(tx, actor, { action: "letter.signer_signature", entityType: "LetterSigner", entityId: userId, summary: fileId ? "Tanda tangan penandatangan surat diganti" : "Tanda tangan penandatangan surat dicabut" });
  });
}
export async function setStamp(actor: Actor, fileId: string | null, outer?: Tx): Promise<void> {
  assertDirector(actor);
  await (outer ? (fn: (t: Tx) => Promise<void>) => fn(outer) : transaction)(async (tx) => {
    await assertSignatureFile(tx, fileId);
    await tx.letterSettings.upsert({ where: { id: 1 }, create: { id: 1, stampFileId: fileId }, update: { stampFileId: fileId } });
    await writeAudit(tx, actor, { action: "letter.stamp", entityType: "LetterSettings", entityId: "1", summary: fileId ? "Cap lembaga untuk surat diganti" : "Cap lembaga untuk surat dicabut" });
  });
}

/** Calon penandatangan (Direktur, Supervisor, Manajer) beserta status gambar tanda tangannya — untuk halaman pengaturan. */
export async function listSignatureHolders(actor: Actor): Promise<{ userId: string; name: string; title: string | null; hasSignature: boolean }[]> {
  assertDirector(actor);
  const users = await prisma.user.findMany({
    where: { isActive: true, OR: [{ role: "SUPER_ADMIN" }, { employee: { jobLevel: { in: ["SUPERVISOR", "MANAGER"] }, isActive: true } }] },
    select: { id: true, name: true, employee: { select: { fullName: true, position: true } } },
  });
  const sigs = await prisma.letterSigner.findMany({ where: { userId: { in: users.map((u) => u.id) }, signatureFileId: { not: null } }, select: { userId: true } });
  const has = new Set(sigs.map((s) => s.userId));
  return users.map((u) => ({ userId: u.id, name: u.employee?.fullName ?? u.name, title: u.employee?.position ?? null, hasSignature: has.has(u.id) })).sort((a, b) => a.name.localeCompare(b.name, "id"));
}
