import "server-only";
import { Font, renderToBuffer } from "@react-pdf/renderer";
import QRCode from "qrcode";
import type { DocFrame } from "@/lib/documents/frame";
import { FOOTER_FONTS } from "@/lib/documents/footer";
import { DocumentPdf } from "./DocumentPdf";

/** Render PDF dokumen dari bingkai + isi. QR dibuat dari `frame.verify.url` (tautan verifikasi publik). */
export async function renderDocumentPdf(frame: DocFrame): Promise<Buffer> {
  // Teks kaki halaman dibuat saat pemenggalan halaman (prop `render`), setelah fase pemuatan font: tanpa pramuat, font terdaftar diabaikan dan teksnya jatuh ke Helvetica bawaan.
  const ft = frame.footer;
  await Font.load({ fontFamily: FOOTER_FONTS[ft.fontKey].family, fontWeight: ft.bold ? 700 : 400, fontStyle: ft.italic ? "italic" : "normal" });
  const qr = frame.verify ? await QRCode.toDataURL(frame.verify.url, { margin: 0, width: 300, errorCorrectionLevel: "M" }) : null;
  return renderToBuffer(<DocumentPdf frame={frame} qrDataUrl={qr} />);
}
