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
  confidential: boolean; hrCanSign: boolean; hrCanView: boolean; multiSigner: boolean; funnel: boolean;
}
const dto = (t: { id: string; series: "EKS" | "INT"; code: number; name: string; description: string | null; kind: string; directorOnly: boolean; signerJobLevels: JobLevel[]; internAllowed: boolean; isActive: boolean; confidential: boolean; hrCanSign: boolean; hrCanView: boolean; multiSigner: boolean; funnel: boolean }): LetterTypeDto => ({
  id: t.id, series: t.series, code: t.code, codeText: String(t.code).padStart(3, "0"), name: t.name, description: t.description, kind: t.kind === "SK" ? "SK" : "SURAT",
  directorOnly: t.directorOnly, signerJobLevels: t.signerJobLevels, internAllowed: t.internAllowed, isActive: t.isActive,
  confidential: t.confidential, hrCanSign: t.hrCanSign, hrCanView: t.hrCanView, multiSigner: t.multiSigner, funnel: t.funnel,
});

/** Semai jenis bawaan yang belum ada (tidak menimpa kebijakan yang sudah diubah Direktur). Idempoten. */
export async function ensureDefaultTypes(): Promise<void> {
  const have = await prisma.letterType.findMany({ select: { id: true, series: true, code: true, name: true, _count: { select: { documents: true } }, confidential: true, hrCanSign: true, hrCanView: true, multiSigner: true, funnel: true } });
  const key = (s: string, c: number) => `${s}:${c}`;
  const byKey = new Map(have.map((h) => [key(h.series, h.code), h]));
  for (const t of DEFAULT_LETTER_TYPES) {
    const cur = byKey.get(key(t.series, t.code));
    if (cur) {
      // Sifat struktural (rahasia/HR/multi-penandatangan) selalu mengikuti katalog master.
      if (cur.confidential !== t.confidential || cur.hrCanSign !== t.hrCanSign || cur.hrCanView !== t.hrCanView || cur.multiSigner !== t.multiSigner || cur.funnel !== t.funnel) {
        await prisma.letterType.update({ where: { id: cur.id }, data: { confidential: t.confidential, hrCanSign: t.hrCanSign, hrCanView: t.hrCanView, multiSigner: t.multiSigner, funnel: t.funnel } });
      }
      // Katalog master berubah (mis. kode lama diganti): selaraskan nama/templat HANYA bila jenis itu belum dipakai satu surat pun. Kebijakan tidak disentuh.
      if (cur.name !== t.name && cur._count.documents === 0) {
        await prisma.letterType.update({ where: { id: cur.id }, data: { name: t.name, description: t.description, kind: t.kind, templateBody: t.template as object, defaultSalutation: t.salutation, defaultClosing: t.closing } });
      }
      continue;
    }
    await prisma.letterType.create({
      data: {
        series: t.series, code: t.code, name: t.name, description: t.description, kind: t.kind, directorOnly: t.directorOnly, signerJobLevels: t.signerJobLevels,
        internAllowed: t.internAllowed, confidential: t.confidential, hrCanSign: t.hrCanSign, hrCanView: t.hrCanView, multiSigner: t.multiSigner, funnel: t.funnel, templateBody: t.template as object, defaultSalutation: t.salutation, defaultClosing: t.closing,
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
    if (f && isEligibleSigner({ directorOnly: t.directorOnly, signerJobLevels: t.signerJobLevels, hrCanSign: t.hrCanSign }, f)) out.push({ userId: u.id, name: f.name, title: f.title });
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

/** Karyawan aktif (bukan magang) bertaut akun — kandidat penandatangan tambahan berita acara. */
export async function listCoSignerCandidates(actor: Actor): Promise<{ userId: string; name: string; title: string | null }[]> {
  requireLetters();
  const rows = await prisma.employee.findMany({ where: { isActive: true, employmentStatus: { not: "INTERN" }, user: { isActive: true } }, select: { userId: true, fullName: true, position: true }, orderBy: { fullName: "asc" } });
  return rows.filter((r): r is typeof r & { userId: string } => !!r.userId && r.userId !== actor.userId).map((r) => ({ userId: r.userId, name: r.fullName, title: r.position }));
}
