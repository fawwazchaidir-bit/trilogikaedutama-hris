import "server-only";
import { z } from "zod";
import { prisma } from "../../db";
import { Errors } from "../../errors";
import { actorCan, assertCan, type Actor } from "../../actor";
import { parseInput } from "../../validate";
import { writeAudit } from "../../audit";
import { DEFAULT_LETTER_TYPES } from "@/lib/documents/templates";
import { isEligibleSigner, letterKind, type JobLevel, type LetterKind } from "@/lib/documents/policy";
import { personFacts, requireLetters, isDirector } from "./access";

export interface LetterTypeDto {
  id: string; series: "EKS" | "INT"; code: number; codeText: string; name: string; description: string | null; kind: LetterKind;
  adminCreateOnly: boolean;
  directorOnly: boolean; signerJobLevels: JobLevel[]; signerDivisionIds: string[]; /** Usulan divisi dari kolom "Penanda tangan (usulan)" Register Excel. */ divisionHint: "PEMASARAN" | "OPERASIONAL" | null; internAllowed: boolean; isActive: boolean;
  confidential: boolean; hrCanSign: boolean; hrCanView: boolean; multiSigner: boolean; funnel: boolean;
}
/** Usulan divisi per jenis menurut kolom "Penanda tangan (usulan)" pada Register Excel: "Direktur / Manajer Pemasaran…" → Pemasaran; "Direktur / Manajer Operasional…" → Operasional. Jenis yang tidak tercantum: semua Manajer. */
const DIVISION_HINT = new Map<string, "PEMASARAN" | "OPERASIONAL">([
  ["EKS:1", "PEMASARAN"], ["EKS:2", "PEMASARAN"], ["EKS:3", "PEMASARAN"], ["EKS:4", "PEMASARAN"], ["EKS:5", "PEMASARAN"],
  ["EKS:13", "OPERASIONAL"], ["INT:2", "OPERASIONAL"],
]);
const DIVISION_PATTERN = { PEMASARAN: /market|pemasaran|relasi|relations|kerja\s?sama|kerjasama/i, OPERASIONAL: /operasional|administrasi|kurikulum|keuangan|operations/i } as const;

const dto = (t: { id: string; series: "EKS" | "INT"; code: number; name: string; description: string | null; kind: string; directorOnly: boolean; signerJobLevels: JobLevel[]; signerDivisionIds: string[]; internAllowed: boolean; isActive: boolean; confidential: boolean; hrCanSign: boolean; hrCanView: boolean; multiSigner: boolean; funnel: boolean; adminCreateOnly: boolean }): LetterTypeDto => ({
  id: t.id, series: t.series, code: t.code, codeText: String(t.code).padStart(3, "0"), name: t.name, description: t.description, kind: letterKind(t.kind), adminCreateOnly: t.adminCreateOnly,
  directorOnly: t.directorOnly, signerJobLevels: t.signerJobLevels, signerDivisionIds: t.signerDivisionIds, divisionHint: DIVISION_HINT.get(`${t.series}:${t.code}`) ?? null, internAllowed: t.internAllowed, isActive: t.isActive,
  confidential: t.confidential, hrCanSign: t.hrCanSign, hrCanView: t.hrCanView, multiSigner: t.multiSigner, funnel: t.funnel,
});

/** Semai jenis bawaan yang belum ada (tidak menimpa kebijakan yang sudah diubah Direktur). Idempoten. */
export async function ensureDefaultTypes(): Promise<void> {
  const have = await prisma.letterType.findMany({ select: { id: true, series: true, code: true, name: true, _count: { select: { documents: true } }, confidential: true, hrCanSign: true, hrCanView: true, multiSigner: true, funnel: true, adminCreateOnly: true, kind: true } });
  const key = (s: string, c: number) => `${s}:${c}`;
  const byKey = new Map(have.map((h) => [key(h.series, h.code), h]));
  for (const t of DEFAULT_LETTER_TYPES) {
    const cur = byKey.get(key(t.series, t.code));
    if (cur) {
      // Sifat struktural (rahasia, hak lihat HR, multi-penandatangan, corong) selalu mengikuti katalog master; hak TANDA TANGAN (termasuk HR) adalah kebijakan yang diatur Direktur dan tidak ditimpa.
      if (cur.confidential !== t.confidential || cur.hrCanView !== t.hrCanView || cur.multiSigner !== t.multiSigner || cur.funnel !== t.funnel || cur.adminCreateOnly !== t.adminCreateOnly || cur.kind !== t.kind) {
        // Layout (kind) berubah di katalog master (mis. INT-005 → EDARAN): templat awal + salam/penutup ikut disesuaikan agar isi awal cocok dengan layout.
        // Dokumen yang sudah dibuat memegang salinan isinya sendiri sehingga tidak terpengaruh; surat terbit memakai PDF terkunci.
        await prisma.letterType.update({ where: { id: cur.id }, data: { confidential: t.confidential, hrCanView: t.hrCanView, multiSigner: t.multiSigner, funnel: t.funnel, adminCreateOnly: t.adminCreateOnly, kind: t.kind, ...(cur.kind !== t.kind ? { templateBody: t.template as object, defaultSalutation: t.salutation, defaultClosing: t.closing } : {}) } });
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
        internAllowed: t.internAllowed, confidential: t.confidential, hrCanSign: t.hrCanSign, hrCanView: t.hrCanView, multiSigner: t.multiSigner, funnel: t.funnel, adminCreateOnly: t.adminCreateOnly, templateBody: t.template as object, defaultSalutation: t.salutation, defaultClosing: t.closing,
      },
    }).catch((e: { code?: string }) => { if (e.code !== "P2002") throw e; }); // balapan dua proses: sudah dibuat pihak lain
  }
}

/** Jenis yang boleh dipakai pelaku untuk membuat surat (Magang hanya yang diizinkan; Direktur melihat juga yang nonaktif). */
export async function listTypes(actor: Actor): Promise<LetterTypeDto[]> {
  requireLetters(actor);
  await ensureDefaultTypes();
  const facts = await personFacts(actor.userId);
  if (!facts) throw Errors.forbidden();
  const rows = await prisma.letterType.findMany({ orderBy: [{ series: "asc" }, { code: "asc" }] });
  const canAssign = actorCan(actor, "assignment:manage");
  return rows.filter((t) => (!t.adminCreateOnly || canAssign) && (isDirector(actor) || t.isActive) && (!facts.isIntern || (t.internAllowed && t.series === "EKS"))).map(dto);
}

/** Akun yang boleh dipilih sebagai penandatangan untuk jenis tertentu (bukan diri sendiri kecuali Direktur). */
export async function listSigners(actor: Actor, typeId: string): Promise<{ userId: string; name: string; title: string | null; division: string | null }[]> {
  requireLetters(actor);
  const t = await prisma.letterType.findUnique({ where: { id: typeId } });
  if (!t) throw Errors.notFound("Jenis surat");
  const users = await prisma.user.findMany({ where: { isActive: true, ...(isDirector(actor) ? {} : { id: { not: actor.userId } }) }, select: { id: true } });
  const out: { userId: string; name: string; title: string | null; division: string | null }[] = [];
  for (const u of users) {
    const f = await personFacts(u.id);
    if (f && isEligibleSigner({ directorOnly: t.directorOnly, signerJobLevels: t.signerJobLevels, hrCanSign: t.hrCanSign, signerDivisionIds: t.signerDivisionIds }, f)) out.push({ userId: u.id, name: f.name, title: f.title, division: f.divisionName });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "id"));
}

const policySchema = z.object({
  directorOnly: z.boolean().optional(),
  signerDivisionIds: z.array(z.string().uuid()).max(30).optional(),
  hrCanSign: z.boolean().optional(),
  signerJobLevels: z.array(z.enum(["SUPERVISOR", "MANAGER"])).max(2).optional(),
  internAllowed: z.boolean().optional(),
  isActive: z.boolean().optional(),
}).strict();

/** Direktur mengatur kebijakan jenis surat (siapa boleh menandatangani, Magang, aktif). */
export async function updateTypePolicy(actor: Actor, id: string, raw: unknown): Promise<LetterTypeDto> {
  requireLetters(actor);
  if (!isDirector(actor)) throw Errors.forbidden("Hanya Direktur yang dapat mengatur kebijakan jenis surat.");
  assertCan(actor, "settings:manage");
  const input = parseInput(policySchema, raw);
  const before = await prisma.letterType.findUnique({ where: { id } });
  if (!before) throw Errors.notFound("Jenis surat");
  if (input.signerDivisionIds?.length) {
    const n = await prisma.division.count({ where: { id: { in: input.signerDivisionIds } } });
    if (n !== new Set(input.signerDivisionIds).size) throw Errors.validation("Ada divisi yang tidak dikenal.", { signerDivisionIds: "Divisi tidak valid" });
  }
  const after = await prisma.$transaction(async (tx) => {
    const u = await tx.letterType.update({ where: { id }, data: input });
    await writeAudit(tx, actor, { action: "letter.type.policy", entityType: "LetterType", entityId: id, summary: `Kebijakan jenis surat ${u.series}-${String(u.code).padStart(3, "0")} diubah`, before: { directorOnly: before.directorOnly, hrCanSign: before.hrCanSign, signerJobLevels: before.signerJobLevels, signerDivisionIds: before.signerDivisionIds, internAllowed: before.internAllowed, isActive: before.isActive }, after: input });
    return u;
  });
  return dto(after);
}

/** Karyawan aktif (bukan magang) bertaut akun — kandidat penandatangan tambahan berita acara. */
export async function listCoSignerCandidates(actor: Actor): Promise<{ userId: string; name: string; title: string | null }[]> {
  requireLetters(actor);
  const rows = await prisma.employee.findMany({ where: { isActive: true, employmentStatus: { not: "INTERN" }, user: { isActive: true } }, select: { userId: true, fullName: true, position: true }, orderBy: { fullName: "asc" } });
  return rows.filter((r): r is typeof r & { userId: string } => !!r.userId && r.userId !== actor.userId).map((r) => ({ userId: r.userId, name: r.fullName, title: r.position }));
}

export interface SignerMatrixRow { typeId: string; holders: { userId: string; name: string; title: string | null; via: "DIREKTUR" | "MANAJER" | "SUPERVISOR" | "HR" }[] }
export interface SignerPerson { userId: string; name: string; title: string | null; division: string | null; via: string; typeCount: number; hasSignature: boolean }

/** Bagan hak tanda tangan: siapa SAAT INI berwenang menandatangani tiap jenis (dihitung dari kebijakan + tingkat jabatan/role akun). Hanya Direktur. */
export async function signerMatrix(actor: Actor): Promise<{ rows: SignerMatrixRow[]; people: SignerPerson[] }> {
  requireLetters(actor);
  if (!isDirector(actor)) throw Errors.forbidden("Hanya Direktur yang dapat melihat bagan penandatangan.");
  await ensureDefaultTypes();
  const [types, users, sigs] = await Promise.all([
    prisma.letterType.findMany({ orderBy: [{ series: "asc" }, { code: "asc" }] }),
    prisma.user.findMany({ where: { isActive: true }, select: { id: true } }),
    prisma.letterSigner.findMany({ where: { signatureFileId: { not: null } }, select: { userId: true } }),
  ]);
  const facts = new Map<string, NonNullable<Awaited<ReturnType<typeof personFacts>>>>();
  for (const u of users) { const f = await personFacts(u.id); if (f) facts.set(u.id, f); }
  const via = (f: { role: string; jobLevel: string | null }) => (f.role === "SUPER_ADMIN" ? "DIREKTUR" : f.role === "HR_ADMIN" ? "HR" : f.jobLevel === "MANAGER" ? "MANAJER" : "SUPERVISOR") as SignerMatrixRow["holders"][number]["via"];
  const counts = new Map<string, number>();
  const rows = types.map((t) => {
    const holders: SignerMatrixRow["holders"] = [];
    for (const [uid, f] of facts) {
      if (!isEligibleSigner({ directorOnly: t.directorOnly, signerJobLevels: t.signerJobLevels, hrCanSign: t.hrCanSign, signerDivisionIds: t.signerDivisionIds }, f)) continue;
      holders.push({ userId: uid, name: f.name, title: f.title, via: via(f) });
      counts.set(uid, (counts.get(uid) ?? 0) + 1);
    }
    holders.sort((a, b) => a.name.localeCompare(b.name, "id"));
    return { typeId: t.id, holders: t.isActive ? holders : [] };
  });
  const hasSig = new Set(sigs.map((s) => s.userId));
  const people = [...counts.entries()].map(([uid, n]) => { const f = facts.get(uid)!; return { userId: uid, name: f.name, title: f.title, division: f.divisionName, via: via(f), typeCount: n, hasSignature: hasSig.has(uid) }; })
    .sort((a, b) => b.typeCount - a.typeCount || a.name.localeCompare(b.name, "id"));
  return { rows, people };
}

/**
 * Terapkan usulan divisi Register Excel: untuk jenis yang BELUM dibatasi divisinya, isi dengan divisi yang namanya cocok (Pemasaran/Operasional).
 * Mengembalikan ringkasan agar Direktur dapat memeriksa; jenis tanpa divisi yang cocok dilewati (tidak diubah).
 */
export async function applyDivisionSuggestions(actor: Actor): Promise<{ applied: { type: string; divisions: string[] }[]; skipped: { type: string; reason: string }[] }> {
  requireLetters(actor);
  if (!isDirector(actor)) throw Errors.forbidden("Hanya Direktur yang dapat mengatur kebijakan jenis surat.");
  assertCan(actor, "settings:manage");
  await ensureDefaultTypes();
  const [types, divisions] = await Promise.all([prisma.letterType.findMany(), prisma.division.findMany({ where: { isActive: true }, select: { id: true, name: true } })]);
  const applied: { type: string; divisions: string[] }[] = []; const skipped: { type: string; reason: string }[] = [];
  for (const t of types) {
    const hint = DIVISION_HINT.get(`${t.series}:${t.code}`);
    const label = `${t.series}-${String(t.code).padStart(3, "0")} ${t.name}`;
    if (!hint) continue;
    if (t.signerDivisionIds.length) { skipped.push({ type: label, reason: "sudah dibatasi divisi" }); continue; }
    const match = divisions.filter((d) => DIVISION_PATTERN[hint].test(d.name));
    if (match.length === 0) { skipped.push({ type: label, reason: `tidak ada divisi bernama mirip "${hint === "PEMASARAN" ? "Pemasaran" : "Operasional"}"` }); continue; }
    await prisma.$transaction(async (tx) => {
      await tx.letterType.update({ where: { id: t.id }, data: { signerDivisionIds: match.map((d) => d.id) } });
      await writeAudit(tx, actor, { action: "letter.type.policy", entityType: "LetterType", entityId: t.id, summary: `Usulan divisi penandatangan diterapkan pada ${label}`, before: { signerDivisionIds: [] }, after: { signerDivisionIds: match.map((d) => d.id) } });
    });
    applied.push({ type: label, divisions: match.map((d) => d.name) });
  }
  return { applied, skipped };
}
