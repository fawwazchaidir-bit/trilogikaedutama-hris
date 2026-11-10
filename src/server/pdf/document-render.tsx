import "server-only";
import { renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import type { DocFrame } from "@/lib/documents/frame";
import { DocumentPdf } from "./DocumentPdf";

/** Render PDF dokumen dari bingkai + isi. QR dibuat dari `frame.verify.url` (tautan verifikasi publik). */
export async function renderDocumentPdf(frame: DocFrame): Promise<Buffer> {
  const qr = frame.verify ? await QRCode.toDataURL(frame.verify.url, { margin: 0, width: 300, errorCorrectionLevel: "M" }) : null;
  return renderToBuffer(<DocumentPdf frame={frame} qrDataUrl={qr} />);
}
