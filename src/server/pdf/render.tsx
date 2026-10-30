import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import { ReportPdf } from "./ReportPdf";
import { PayslipDocument, type PayslipPdfItem } from "./PayslipPdf";
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

export interface SlipForRender { snapshot: PayslipSnapshot; voided: boolean }

/**
 * Render satu atau banyak slip (satu halaman per slip) DARI SNAPSHOT. Logo dibaca dari berkas yang dirujuk snapshot
 * (berkas tidak pernah ditimpa, sehingga logo slip lama tetap sama).
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
    items.push({ snapshot: sl.snapshot, logo, voided: sl.voided, printedAt });
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
