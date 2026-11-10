import "server-only";
import { z } from "zod";
import { prisma } from "../../db";
import { Errors } from "../../errors";
import { assertCan, type Actor } from "../../actor";
import { parseInput } from "../../validate";
import { writeAudit } from "../../audit";
import { DEFAULT_LETTER_TYPES } from "@/lib/documents/templates";
import { isEligibleSigner, type JobLevel } from "@/lib/documents/policy";
import { personFacts, requireLetters, isDirector } from "./access";

export interface LetterTypeDto {
  id: string; series: "EKS" | "INT"; code: number; codeText: string; name: string; description: string | null; kind: "SURAT" | "SK";
  directorOnly: boolean; signerJobLevels: JobLevel[]; internAllowed: boolean; isActive: boolean;
}
const dto = (t: { id: string; series: "EKS" | "INT"; code: number; name: string; description: string | null; kind: string; directorOnly: boolean; signerJobLevels: JobLevel[]; internAllowed: boolean; isActive: boolean }): LetterTypeDto => ({
  id: t.id, series: t.series, code: t.code, codeText: String(t.code).padStart(3, "0"), name: t.name, description: t.description, kind: t.kind === "SK" ? "SK" : "SURAT",
  directorOnly: t.directorOnly, signerJobLevels: t.signerJobLevels, internAllowed: t.internAllowed, isActive: t.isActive,
});

/** Semai jenis bawaan yang belum ada (tidak menimpa kebijakan yang sudah diubah Direktur). Idempoten. */
export async function ensureDefaultTypes(): Promise<void> {
  const have = await prisma.letterType.findMany({ select: { series: true, code: true } });
  const key = (s: string, c: number) => `${s}:${c}`;
  const exists = new Set(have.map((h) => key(h.series, h.code)));
  for (const t of DEFAULT_LETTER_TYPES) {
    if (exists.has(key(t.series, t.code))) continue;
    await prisma.letterType.create({
      data: {
        series: t.series, code: t.code, name: t.name, description: t.description, kind: t.kind, directorOnly: t.directorOnly, signerJobLevels: t.signerJobLevels,
        internAllowed: t.internAllowed, templateBody: t.template as object, defaultSalutation: t.salutation, defaultClosing: t.closing,
      },
    }).catch((e: { code?: string }) => { if (e.code !== "P2002") throw e; }); // balapan dua proses: sudah dibuat pihak lain
  }
}

/** Jenis yang boleh dipakai pelaku untuk membuat surat (Magang hanya yang diizinkan; Direktur melihat juga yang nonaktif). */
export async function listTypes(actor: Actor): Promise<LetterTypeDto[]> {
  requireLetters();
  await ensureDefaultTypes();
  const facts = await personFacts(actor.userId);
  if (!facts) throw Errors.forbidden();
  const rows = await prisma.letterType.findMany({ orderBy: [{ series: "asc" }, { code: "asc" }] });
  return rows.filter((t) => (isDirector(actor) || t.isActive) && (!facts.isIntern || (t.internAllowed && t.series === "EKS"))).map(dto);
}

/** Akun yang boleh dipilih sebagai penandatangan untuk jenis tertentu (bukan diri sendiri kecuali Direktur). */
export async function listSigners(actor: Actor, typeId: string): Promise<{ userId: string; name: string; title: string | null }[]> {
  requireLetters();
  const t = await prisma.letterType.findUnique({ where: { id: typeId } });
  if (!t) throw Errors.notFound("Jenis surat");
  const users = await prisma.user.findMany({ where: { isActive: true, ...(isDirector(actor) ? {} : { id: { not: actor.userId } }) }, select: { id: true } });
  const out: { userId: string; name: string; title: string | null }[] = [];
  for (const u of users) {
    const f = await personFacts(u.id);
    if (f && isEligibleSigner({ directorOnly: t.directorOnly, signerJobLevels: t.signerJobLevels }, f)) out.push({ userId: u.id, name: f.name, title: f.title });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "id"));
}

const policySchema = z.object({
  directorOnly: z.boolean().optional(),
  signerJobLevels: z.array(z.enum(["SUPERVISOR", "MANAGER"])).max(2).optional(),
  internAllowed: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).strict();

/** Direktur mengatur kebijakan jenis surat (siapa boleh menandatangani, Magang, aktif). */
export async function updateTypePolicy(actor: Actor, id: string, raw: unknown): Promise<LetterTypeDto> {
  requireLetters();
  if (!isDirector(actor)) throw Errors.forbidden("Hanya Direktur yang dapat mengatur kebijakan jenis surat.");
  assertCan(actor, "settings:manage");
  const input = parseInput(policySchema, raw);
  const before = await prisma.letterType.findUnique({ where: { id } });
  if (!before) throw Errors.notFound("Jenis surat");
  const after = await prisma.$transaction(async (tx) => {
    const u = await tx.letterType.update({ where: { id }, data: input });
    await writeAudit(tx, actor, { action: "letter.type.policy", entityType: "LetterType", entityId: id, summary: `Kebijakan jenis surat ${u.series}-${String(u.code).padStart(3, "0")} diubah`, before: { directorOnly: before.directorOnly, signerJobLevels: before.signerJobLevels, internAllowed: before.internAllowed, isActive: before.isActive }, after: input });
    return u;
  });
  return dto(after);
}
