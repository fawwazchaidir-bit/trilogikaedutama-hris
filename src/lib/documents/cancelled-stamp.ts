/**
 * Tanda DIBATALKAN pada SALINAN STATUS sebuah PDF. Berkas asli (yang diterbitkan & dihash) TIDAK diubah dan tetap tersimpan sebagai arsip; unduhan untuk pengguna
 * biasa dari dokumen yang sudah dibatalkan adalah salinan yang diberi tanda ini, supaya PDF "asli" tanpa tanda tidak beredar lagi lewat unduhan baru.
 * Catatan: PDF yang SUDAH terlanjur dikirim tidak berubah — pembatalan tetap perlu diberitahukan kepada penerima sesuai prosedur.
 */
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

export const CANCELLED_STAMP_TEXT = "DIBATALKAN";
const BANNER = "SALINAN STATUS - DOKUMEN INI TELAH DIBATALKAN dan tidak berlaku. Berkas asli tersimpan sebagai arsip; salinan ini bukan berkas asli.";

/** Hasilkan salinan PDF bertanda DIBATALKAN pada setiap halaman (watermark diagonal + pita keterangan). Jumlah halaman & isi asli tidak berubah. */
export async function stampCancelledCopy(original: Uint8Array | Buffer, opts: { number?: string | null } = {}): Promise<Buffer> {
  const doc = await PDFDocument.load(original, { ignoreEncryption: true });
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const plain = await doc.embedFont(StandardFonts.Helvetica);
  const red = rgb(0.75, 0.08, 0.08);
  for (const page of doc.getPages()) {
    const { width, height } = page.getSize();
    // Watermark diagonal, dipusatkan pada halaman.
    const size = Math.min(width, height) * 0.2;
    const tw = bold.widthOfTextAtSize(CANCELLED_STAMP_TEXT, size);
    const a = (45 * Math.PI) / 180;
    const cx = width / 2, cy = height / 2;
    page.drawText(CANCELLED_STAMP_TEXT, {
      x: cx - (tw / 2) * Math.cos(a) + (size * 0.35) * Math.sin(a), y: cy - (tw / 2) * Math.sin(a) - (size * 0.35) * Math.cos(a),
      size, font: bold, color: red, opacity: 0.3, rotate: degrees(45),
    });
    // Pita keterangan di tepi atas (kecil, tidak menutupi isi).
    const bs = Math.max(6, Math.min(8, width / 90));
    page.drawRectangle({ x: 0, y: height - bs - 8, width, height: bs + 8, color: rgb(1, 0.93, 0.93), opacity: 0.92 });
    page.drawText(BANNER, { x: 12, y: height - bs - 3, size: bs, font: plain, color: red, maxWidth: width - 24 });
  }
  // Penanda yang dapat dibaca mesin (tidak terkompresi) — membedakan salinan status dari berkas asli.
  doc.setSubject(`${CANCELLED_STAMP_TEXT} - salinan status${opts.number ? ` (${opts.number})` : ""}`);
  doc.setKeywords([CANCELLED_STAMP_TEXT, "salinan-status"]);
  return Buffer.from(await doc.save());
}
