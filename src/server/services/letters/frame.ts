import "server-only";
import type { LetterDocument } from "@prisma/client";
import { prisma } from "../../db";
import { env } from "../../env";
import { getSettings } from "../settings";
import { readFileBytes } from "../files";
import { personFacts } from "./access";
import { resolveVariables, type PmDoc } from "@/lib/documents/content";
import { renderDocumentPdf } from "../../pdf/document-render";
import { countPdfPages, mergePdfs } from "./attachments";
import { attachmentText, formatDocNumber, longDate } from "@/lib/documents/text";
import { footerFromRow, type DocFooter } from "@/lib/documents/footer";
import { kopContactLine } from "@/lib/documents/kop";
import { body as pBody, doc as pDoc } from "@/lib/documents/builders";
import { verifyPath } from "@/lib/documents/policy";
import { DEFAULT_SALUTATION } from "@/lib/documents/templates";
import { VERIFY_CAPTION } from "@/lib/documents/frame";
import type { DocFrame, DocImage, DocSignatory } from "@/lib/documents/frame";

const img = async (id: string | null | undefined): Promise<DocImage | null> => { const f = await readFileBytes(id); return f ? { data: f.data, mimeType: f.mimeType } : null; };

export async function getLetterSettings() {
  return (await prisma.letterSettings.findUnique({ where: { id: 1 } })) ?? (await prisma.letterSettings.create({ data: { id: 1 } }));
}

/** Nilai bawaan variabel: {{nomor}}, {{tanggal}}, dan {{perihal}} (perihal surat dalam HURUF BESAR — judul "TENTANG" pada Surat Edaran; kosong bila perihal belum diisi). */
export function builtinVars(number: string | null, date: string, subject?: string | null): Record<string, string> {
  return { nomor: number ?? "[nomor terisi saat terbit]", tanggal: longDate(date), perihal: (subject ?? "").trim().toLocaleUpperCase("id-ID") };
}
export function varsOf(d: Pick<LetterDocument, "variables">): Record<string, string> {
  const v = d.variables;
  return v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === "string")) as Record<string, string> : {};
}

/** Kop surat dari Pengaturan lembaga (tagline, nama, alamat, email/telepon/website + logo) dan pengaturan garis kop — satu sumber untuk surat sungguhan dan pratinjau pengaturan. */
async function companyLetterhead(
  company: { name: string; tagline: string | null; address: string | null; phone: string | null; email: string | null; website: string | null; logoFileId: string | null },
  rule: boolean,
): Promise<DocFrame["letterhead"]> {
  return {
    logo: await img(company.logoFileId), tagline: company.tagline ?? "", name: company.name.toUpperCase(), addressLines: company.address ? [company.address] : [],
    contactLine: kopContactLine(company), rule,
  };
}

/**
 * Bingkai CONTOH (dua halaman: surat + satu lampiran) untuk pratinjau pengaturan kaki halaman: kop asli lembaga, isi fiktif, kaki halaman = `footer` yang sedang disunting
 * (belum tentu tersimpan). Nomor contoh memakai format master; tanpa QR dan tanpa tanda tangan.
 */
export async function buildFooterSampleFrame(footer: DocFooter, opts: { kopRule?: boolean } = {}): Promise<DocFrame> {
  const [company, ls] = await Promise.all([getSettings(), getLetterSettings()]);
  const date = new Date().toISOString().slice(0, 10);
  return {
    kind: "SURAT", number: formatDocNumber({ seq: 1, series: "EKS", typeCode: "001", date }), date, place: ls.place, attachmentText: attachmentText(1, "berkas"), subject: "Contoh pratinjau kaki halaman",
    recipient: { prefix: "Yth.", lines: [{ text: "Bapak/Ibu Penerima Contoh", bold: true }, { text: "Instansi Contoh", bold: true }], cityPrefix: "di", place: "tempat" },
    salutation: DEFAULT_SALUTATION,
    body: pDoc(
      pBody("Ini adalah surat contoh untuk melihat tampilan kaki halaman pada setiap halaman, termasuk halaman lampiran. Isi surat ini fiktif dan tidak tersimpan."),
      pBody("Ubah teks, font, ukuran, dan gaya di Pengaturan Persuratan, lalu tekan Pratinjau PDF untuk melihat hasilnya sebelum disimpan."),
    ),
    closing: null, signatories: [{ orgName: company.name.toUpperCase(), title: "Penandatangan", name: "Nama Penandatangan", signature: null, stamp: null }], cc: [],
    attachments: [{ title: "CONTOH LAMPIRAN", body: pDoc(pBody("Halaman lampiran contoh. Kaki halaman pada halaman ini mengikuti pengaturan \"Tampilkan di halaman lampiran\".")) }],
    letterhead: await companyLetterhead(company, opts.kopRule ?? ls.kopRule), verify: null, footer, draft: false,
  };
}

/** Bingkai PDF dari dokumen. `number`=null → draf (watermark). Isi tersimpan sebagai JSON; gambar dibaca dari berkas privat. */
export async function buildFrame(
  d: LetterDocument & { type: { kind: string } },
  o: { number: string | null; date: string; signerUserId: string; draft: boolean },
): Promise<{ frame: DocFrame; missing: string[]; signer: { name: string; title: string } }> {
  const [company, ls, signerFacts, signerRow] = await Promise.all([
    getSettings(), getLetterSettings(), personFacts(o.signerUserId), prisma.letterSigner.findUnique({ where: { userId: o.signerUserId } }),
  ]);
  const resolved = resolveVariables(d.body as unknown as PmDoc, { ...varsOf(d), ...builtinVars(o.number, o.date, d.subject) });
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
  // Lampiran editor → halaman lampiran di PDF (variabel diganti sama seperti isi surat); lampiran PDF unggahan ditangani saat penggabungan.
  const atts = await prisma.letterAttachment.findMany({ where: { documentId: d.id }, orderBy: { position: "asc" } });
  const vars = { ...varsOf(d), ...builtinVars(o.number, o.date, d.subject) };
  const editorAtts = atts.filter((a) => a.kind === "EDITOR").map((a) => ({ title: a.title, body: resolveVariables(a.body as unknown as PmDoc, vars).doc }));
  const attMissing = atts.filter((a) => a.kind === "EDITOR").flatMap((a) => resolveVariables(a.body as unknown as PmDoc, vars).missing);
  // SK dan Surat Edaran tidak memakai blok Nomor/Perihal/Kepada/salam: judulnya disusun di kertas (lihat templat).
  const isSk = d.type.kind === "SK";
  const bare = isSk || d.type.kind === "EDARAN";
  const frame: DocFrame = {
    kind: isSk ? "SK" : d.type.kind === "EDARAN" ? "EDARAN" : "SURAT", number: o.number, date: o.date, place: ls.place,
    attachmentText: bare ? null : d.attachmentCount ? attachmentText(d.attachmentCount, (d.attachmentUnit as "halaman" | "berkas" | "lembar" | null) ?? "halaman") : atts.length ? attachmentText(atts.length, "berkas") : null,
    subject: bare ? null : d.subject,
    recipient: bare || d.recipientLines.length === 0 ? null : {
      prefix: "Yth.", lines: d.recipientLines.map((text, i) => ({ text, bold: i < 2 })), cityPrefix: "di", place: d.recipientPlace ?? "tempat",
    },
    salutation: bare ? null : d.salutation, body: resolved.doc, closing: bare ? null : d.closing,
    signatories: [sign, ...coSigs], cc: d.cc, attachments: editorAtts,
    letterhead: await companyLetterhead(company, ls.kopRule),
    verify: o.draft ? null : { url: `${env().APP_URL.replace(/\/$/, "")}${verifyPath(d.verifyToken)}`, caption: VERIFY_CAPTION },
    footer: footerFromRow(ls), draft: o.draft,
  };
  return { frame, missing: [...resolved.missing, ...attMissing], signer: { name: signerName, title: signerTitle } };
}

/** Render PDF lengkap: halaman surat + lampiran editor (react-pdf) lalu lampiran PDF "digabung" (pdf-lib). Dipakai pratinjau & penerbitan agar identik. */
export async function renderLetterPdf(
  d: LetterDocument & { type: { kind: string } },
  o: { number: string | null; date: string; signerUserId: string; draft: boolean },
): Promise<{ bytes: Buffer; missing: string[]; signer: { name: string; title: string }; body: PmDoc }> {
  const { frame, missing, signer } = await buildFrame(d, o);
  // Lampiran PDF yang digabung dibaca LEBIH DULU agar total halaman di kaki surat ({total}) mengikuti seluruh halaman berkas gabungan.
  const merged = await prisma.letterAttachment.findMany({ where: { documentId: d.id, kind: "UPLOAD_MERGED" }, orderBy: { position: "asc" } });
  const parts: Uint8Array[] = [];
  for (const m of merged) { const fb = await readFileBytes(m.fileId); if (fb) parts.push(fb.data); }
  const main = await renderDocumentPdf({ ...frame, extraPages: await countPdfPages(parts) });
  return { bytes: await mergePdfs(main, parts), missing, signer, body: frame.body };
}
