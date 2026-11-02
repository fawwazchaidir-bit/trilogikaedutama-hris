import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { ReportPdf } from "./ReportPdf";
import { PayslipDocument, type PayslipPdfItem } from "./PayslipPdf";
import { AssignmentDocument, ReceiptDocument } from "./AssignmentPdf";
import type { AssignmentSnapshot, ReceiptSnapshot } from "../services/assignments";
import type { ReportTable } from "../export";
import { env } from "../env";
import { readFileBytes } from "../services/files";
import { formatDateTime } from "@/lib/format";
import type { PayslipSnapshot } from "@/lib/payslip";

/** PDF laporan tabel dari tabel yang sama dengan CSV/Excel. */
export async function renderReportPdf(table: ReportTable, ctx: { companyName: string; printedBy: string }): Promise<Buffer> {
  const printedAt = formatDateTime(new Date(table.generatedAt), env().APP_TIMEZONE);
  return renderToBuffer(<ReportPdf data={{ companyName: ctx.companyName, table, printedBy: ctx.printedBy, printedAt }} />);
}

export interface SlipForRender { snapshot: PayslipSnapshot; voided: boolean; /** Hanya untuk uji: paksa tingkat kepadatan. */ forceTier?: number }

/**
 * Render satu atau banyak slip (satu halaman per slip) DARI SNAPSHOT. Logo & gambar tanda tangan dibaca dari berkas yang dirujuk
 * snapshot (berkas tidak pernah ditimpa, sehingga slip lama tetap sama).
 */
export async function renderPayslipsPdf(slips: SlipForRender[]): Promise<Buffer> {
  const logoCache = new Map<string, Awaited<ReturnType<typeof readFileBytes>>>();
  const printedAt = formatDateTime(new Date(), env().APP_TIMEZONE);
  const items: PayslipPdfItem[] = [];
  for (const sl of slips) {
    const id = sl.snapshot.company.logoFileId;
    let logo: Awaited<ReturnType<typeof readFileBytes>> = null;
    if (id) {
      if (!logoCache.has(id)) logoCache.set(id, await readFileBytes(id));
      logo = logoCache.get(id) ?? null;
    } else {
      logo = await defaultLogo();
    }
    const sigId = sl.snapshot.signer?.signatureFileId ?? null;
    let signature: Awaited<ReturnType<typeof readFileBytes>> = null;
    if (sigId) {
      if (!logoCache.has(sigId)) logoCache.set(sigId, await readFileBytes(sigId));
      signature = logoCache.get(sigId) ?? null;
    }
    items.push({ snapshot: sl.snapshot, logo, signature, voided: sl.voided, printedAt, forceTier: sl.forceTier });
  }
  return renderToBuffer(<PayslipDocument items={items} />);
}

let defaultLogoCache: Awaited<ReturnType<typeof readFileBytes>> | undefined;
async function defaultLogo() {
  if (defaultLogoCache === undefined) {
    try {
      const { readFile } = await import("node:fs/promises");
      const { join } = await import("node:path");
      defaultLogoCache = { data: await readFile(join(process.cwd(), "public", "brand", "logo.png")), mimeType: "image/png" };
    } catch {
      defaultLogoCache = null;
    }
  }
  return defaultLogoCache;
}

type Img = Awaited<ReturnType<typeof readFileBytes>>;
async function brandImages(logoFileId: string | null, signatureFileId: string | null | undefined): Promise<{ logo: Img; signature: Img }> {
  return { logo: logoFileId ? await readFileBytes(logoFileId) : await defaultLogo(), signature: signatureFileId ? await readFileBytes(signatureFileId) : null };
}

/** Surat Tugas (PDF) dari snapshot terbit. */
export async function renderAssignmentPdf(snapshot: AssignmentSnapshot, cancelled: boolean): Promise<Buffer> {
  const { logo, signature } = await brandImages(snapshot.company.logoFileId, snapshot.signer?.signatureFileId);
  return renderToBuffer(<AssignmentDocument item={{ snapshot, logo, signature, cancelled, printedAt: formatDateTime(new Date(), env().APP_TIMEZONE) }} />);
}

/** Bukti Penerimaan Uang Harian (PDF) dari snapshot terbit — penanda tangan resmi sama dengan slip gaji. */
export async function renderReceiptPdf(snapshot: ReceiptSnapshot, voided: boolean): Promise<Buffer> {
  const { logo, signature } = await brandImages(snapshot.company.logoFileId, snapshot.signer?.signatureFileId);
  return renderToBuffer(<ReceiptDocument item={{ snapshot, logo, signature, voided, printedAt: formatDateTime(new Date(), env().APP_TIMEZONE) }} />);
}
