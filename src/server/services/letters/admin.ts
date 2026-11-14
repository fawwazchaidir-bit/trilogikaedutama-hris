import "server-only";
import { z } from "zod";
import { prisma, transaction, type Tx } from "../../db";
import { Errors } from "../../errors";
import { assertCan, type Actor } from "../../actor";
import { parseInput } from "../../validate";
import { writeAudit } from "../../audit";
import { buildFooterSampleFrame, getLetterSettings } from "./frame";
import { getSettings } from "../settings";
import { isDirector, personFacts, requireLetters } from "./access";
import { canHoldSignature } from "@/lib/documents/policy";
import { optionalText, uuid } from "@/lib/validation/common";
import { FOOTER_COLOR_RE, FOOTER_FONT_KEYS, FOOTER_SIZE, FOOTER_TEXT_MAX, footerFromRow, footerTextProblems, type DocFooter } from "@/lib/documents/footer";
import { kopContactLine } from "@/lib/documents/kop";
import { renderDocumentPdf } from "../../pdf/document-render";

function assertDirector(actor: Actor): void {
  requireLetters(actor);
  if (!isDirector(actor)) throw Errors.forbidden("Hanya Direktur yang dapat mengubah pengaturan persuratan.");
  assertCan(actor, "settings:manage");
}

export interface LetterSettingsDto {
  place: string; idLine: string | null; /** = kaki halaman zona kiri (nama lama dipertahankan). */ footerText: string | null; footer: DocFooter; escalationDays: number; stampUrl: string | null; annualTarget: number; products: string[];
  /** Garis di bawah kop surat (ada/tiada). */ kopRule: boolean;
  /** Isi kop menurut Pengaturan lembaga (hanya baca di sini; diubah di Pengaturan → Lembaga). */
  kop: { tagline: string | null; name: string; address: string | null; email: string | null; phone: string | null; website: string | null; contactLine: string | null };
  counters: { series: "EKS" | "INT"; year: number; lastSeq: number }[];
}
export async function getLetterSettingsDto(actor: Actor): Promise<LetterSettingsDto> {
  assertDirector(actor);
  const [s, company, counters] = await Promise.all([getLetterSettings(), getSettings(), prisma.letterCounter.findMany({ orderBy: [{ year: "desc" }, { series: "asc" }] })]);
  return {
    place: s.place, idLine: s.idLine, footerText: s.footerText, footer: footerFromRow(s), escalationDays: s.escalationDays, annualTarget: Number(s.annualTarget), products: s.products, stampUrl: s.stampFileId ? `/api/files/${s.stampFileId}` : null,
    kopRule: s.kopRule,
    kop: { tagline: company.tagline, name: company.name, address: company.address, email: company.email, phone: company.phone, website: company.website, contactLine: kopContactLine(company) },
    counters,
  };
}

/** Teks zona kaki halaman: opsional, maks 200 karakter, hanya token yang dikenal (salah ketik seperti {halamn} ditolak, bukan dicetak apa adanya). */
const footerText = optionalText(FOOTER_TEXT_MAX, "Teks kaki").superRefine((v, ctx) => { for (const m of footerTextProblems(v)) ctx.addIssue({ code: "custom", message: m }); });
const footerSchema = z.object({
  enabled: z.boolean(), left: footerText, center: footerText, right: footerText,
  fontKey: z.enum(FOOTER_FONT_KEYS), size: z.number().min(FOOTER_SIZE.min).max(FOOTER_SIZE.max).multipleOf(0.5, "Ukuran kelipatan 0,5 pt"),
  bold: z.boolean(), italic: z.boolean(), underline: z.boolean(), color: z.string().regex(FOOTER_COLOR_RE, "Warna harus berformat #RRGGBB"),
  rule: z.boolean(), firstPage: z.boolean(), attachments: z.boolean(),
}).partial().strict();
type FooterPatch = z.infer<typeof footerSchema>;

const settingsSchema = z.object({
  // Tambalan: bidang yang dihilangkan tidak diubah (kartu kaki halaman hanya mengirim `footer`).
  place: z.string().trim().min(2).max(80).optional(), idLine: optionalText(200, "Baris identitas").optional(),
  /** Nama lama zona kiri kaki halaman; `footer.left` didahulukan bila keduanya dikirim. Dihilangkan = tidak diubah. */
  footerText: footerText.optional(),
  footer: footerSchema.optional(),
  /** Garis di bawah kop surat. */
  kopRule: z.boolean().optional(),
  escalationDays: z.number().int().min(0).max(30).optional(),
  annualTarget: z.number().int().min(0).max(1_000_000_000_000).optional(),
  products: z.array(z.string().trim().min(1).max(120)).min(1).max(40).optional(),
}).strict();

/** Tambalan kaki halaman → kolom basis data (hanya yang dikirim). */
function footerColumns(f: FooterPatch, legacyLeft: string | null | undefined) {
  const left = f.left !== undefined ? f.left : legacyLeft;
  return {
    ...(f.enabled !== undefined ? { footerEnabled: f.enabled } : {}), ...(left !== undefined ? { footerText: left } : {}),
    ...(f.center !== undefined ? { footerCenter: f.center } : {}), ...(f.right !== undefined ? { footerRight: f.right } : {}),
    ...(f.fontKey !== undefined ? { footerFont: f.fontKey } : {}), ...(f.size !== undefined ? { footerSize: f.size } : {}),
    ...(f.bold !== undefined ? { footerBold: f.bold } : {}), ...(f.italic !== undefined ? { footerItalic: f.italic } : {}), ...(f.underline !== undefined ? { footerUnderline: f.underline } : {}),
    ...(f.color !== undefined ? { footerColor: f.color } : {}), ...(f.rule !== undefined ? { footerRule: f.rule } : {}),
    ...(f.firstPage !== undefined ? { footerFirstPage: f.firstPage } : {}), ...(f.attachments !== undefined ? { footerAttachments: f.attachments } : {}),
  };
}

export async function updateLetterSettings(actor: Actor, raw: unknown): Promise<void> {
  assertDirector(actor);
  const input = parseInput(settingsSchema, raw);
  await transaction(async (tx) => {
    const { annualTarget, footer, footerText: legacyLeft, ...rest } = input;
    const data = { ...rest, ...(annualTarget !== undefined ? { annualTarget: BigInt(annualTarget) } : {}), ...footerColumns(footer ?? {}, legacyLeft) };
    await tx.letterSettings.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await writeAudit(tx, actor, { action: "letter.settings", entityType: "LetterSettings", entityId: "1", summary: footer || legacyLeft !== undefined ? "Pengaturan persuratan diubah (termasuk kaki halaman)" : rest.kopRule !== undefined ? `Pengaturan persuratan diubah (garis kop ${rest.kopRule ? "diadakan" : "ditiadakan"})` : "Pengaturan persuratan diubah", after: { ...input } });
  });
}

/** Pratinjau PDF kop + kaki halaman dengan konfigurasi yang SEDANG disunting (belum tersimpan): bagian yang tidak dikirim memakai nilai tersimpan. Hanya Direktur. */
export async function previewFooterPdf(actor: Actor, raw: unknown): Promise<Buffer> {
  assertDirector(actor);
  const { footer = {}, kopRule } = parseInput(z.object({ footer: footerSchema.optional(), kopRule: z.boolean().optional() }).strict(), raw ?? {});
  const saved = footerFromRow(await getLetterSettings());
  const merged: DocFooter = { ...saved, ...Object.fromEntries(Object.entries(footer).filter(([, v]) => v !== undefined)) } as DocFooter;
  return renderDocumentPdf(await buildFooterSampleFrame(merged, { kopRule }));
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
  requireLetters(actor);
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
