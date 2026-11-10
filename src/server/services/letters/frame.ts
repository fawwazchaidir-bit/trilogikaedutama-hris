import "server-only";
import type { LetterDocument } from "@prisma/client";
import { prisma } from "../../db";
import { env } from "../../env";
import { getSettings } from "../settings";
import { readFileBytes } from "../files";
import { personFacts } from "./access";
import { resolveVariables, type PmDoc } from "@/lib/documents/content";
import { attachmentText, longDate } from "@/lib/documents/text";
import { verifyPath } from "@/lib/documents/policy";
import type { DocFrame, DocImage, DocSignatory } from "@/lib/documents/frame";

const img = async (id: string | null | undefined): Promise<DocImage | null> => { const f = await readFileBytes(id); return f ? { data: f.data, mimeType: f.mimeType } : null; };

export async function getLetterSettings() {
  return (await prisma.letterSettings.findUnique({ where: { id: 1 } })) ?? (await prisma.letterSettings.create({ data: { id: 1 } }));
}

/** Nilai bawaan variabel: {{nomor}} dan {{tanggal}}. */
export function builtinVars(number: string | null, date: string): Record<string, string> {
  return { nomor: number ?? "[nomor terisi saat terbit]", tanggal: longDate(date) };
}
export function varsOf(d: Pick<LetterDocument, "variables">): Record<string, string> {
  const v = d.variables;
  return v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "string")) as Record<string, string> : {};
}

/** Bingkai PDF dari dokumen. `number`=null → draf (watermark). Isi tersimpan sebagai JSON; gambar dibaca dari berkas privat. */
export async function buildFrame(
  d: LetterDocument & { type: { kind: string } },
  o: { number: string | null; date: string; signerUserId: string; draft: boolean },
): Promise<{ frame: DocFrame; missing: string[]; signer: { name: string; title: string } }> {
  const [company, ls, signerFacts, signerRow] = await Promise.all([
    getSettings(), getLetterSettings(), personFacts(o.signerUserId), prisma.letterSigner.findUnique({ where: { userId: o.signerUserId } }),
  ]);
  const resolved = resolveVariables(d.body as unknown as PmDoc, { ...varsOf(d), ...builtinVars(o.number, o.date) });
  const signerName = signerFacts?.name ?? "—";
  const signerTitle = signerFacts?.title ?? (signerFacts?.role === "SUPER_ADMIN" ? "Direktur" : "");
  const sign: DocSignatory = {
    orgName: company.name.toUpperCase(), title: signerTitle, name: signerName,
    signature: await img(signerRow?.signatureFileId), stamp: await img(ls.stampFileId),
  };
  const co = await prisma.letterSignatory.findMany({ where: { documentId: d.id }, orderBy: { position: "asc" } });
  const coSigs: DocSignatory[] = [];
  for (const c of co) {
    if (c.kind === "EXTERNAL") { coSigs.push({ orgName: c.org ?? "", title: c.title ?? "", name: c.name ?? "", signature: null, stamp: null, external: true }); continue; }
    const cf = c.userId ? await personFacts(c.userId) : null;
    const row = c.userId ? await prisma.letterSigner.findUnique({ where: { userId: c.userId } }) : null;
    coSigs.push({ orgName: company.name.toUpperCase(), title: cf?.title ?? "", name: cf?.name ?? "—", signature: c.signedAt || !o.draft ? await img(row?.signatureFileId) : null, stamp: null });
  }
  const isSk = d.type.kind === "SK";
  const contact = [company.email ? `Email: ${company.email}` : null, company.phone ? `${company.phone} (Hotline)` : null, company.website].filter(Boolean).join(" | ");
  const frame: DocFrame = {
    kind: isSk ? "SK" : "SURAT", number: o.number, date: o.date, place: ls.place,
    attachmentText: !isSk && d.attachmentCount ? attachmentText(d.attachmentCount, (d.attachmentUnit as "halaman" | "berkas" | "lembar" | null) ?? "halaman") : null,
    subject: isSk ? null : d.subject,
    recipient: isSk || d.recipientLines.length === 0 ? null : {
      prefix: "Kepada Yth.", lines: d.recipientLines.map((text, i) => ({ text, bold: i < 2 })), cityPrefix: "Di", place: d.recipientPlace ?? "Tempat",
    },
    salutation: isSk ? null : d.salutation, body: resolved.doc, closing: isSk ? null : d.closing,
    signatories: [sign, ...coSigs], cc: d.cc, attachments: [],
    letterhead: {
      logo: await img(company.logoFileId), tagline: company.tagline ?? "", name: company.name.toUpperCase(),
      addressLines: company.address ? [company.address] : [], contactLine: contact, idLine: ls.idLine,
    },
    verify: o.draft ? null : { url: `${env().APP_URL.replace(/\/$/, "")}${verifyPath(d.verifyToken)}`, caption: "Dokumen ini sah secara elektronik. Pindai kode QR untuk verifikasi." },
    footerText: ls.footerText, draft: o.draft,
  };
  return { frame, missing: resolved.missing, signer: { name: signerName, title: signerTitle } };
}
