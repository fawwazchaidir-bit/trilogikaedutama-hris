import "server-only";
import sharp, { type Metadata } from "sharp";
import { Errors } from "../errors";

/**
 * Normalisasi gambar tanda tangan slip: hanya PNG/JPEG/WebP, ukuran piksel dibatasi (anti bom dekompresi), diputar sesuai EXIF,
 * dikecilkan ke maks. 600×240 px, EXIF dibuang, disimpan sebagai PNG (transparansi dipertahankan). Hasilnya dicetak pada slip.
 */
export async function normalizeSignature(raw: Uint8Array): Promise<Buffer> {
  const opts = { limitInputPixels: 25_000_000, failOn: "error" } as const;
  let meta: Metadata;
  try { meta = await sharp(raw, opts).metadata(); } catch { throw Errors.validation("Gambar tanda tangan tidak dapat dibaca.", { file: "Gambar tidak valid" }); }
  if (!meta.format || !["png", "jpeg", "webp"].includes(meta.format)) throw Errors.validation("Gunakan gambar PNG atau JPG.", { file: "Format tidak didukung" });
  if (Math.min(meta.width ?? 0, meta.height ?? 0) < 40) throw Errors.validation("Gambar tanda tangan terlalu kecil (minimal 40 px).", { file: "Resolusi terlalu rendah" });
  try {
    return await sharp(raw, opts).rotate().resize({ width: 600, height: 240, fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9 }).toBuffer();
  } catch { throw Errors.validation("Gambar tanda tangan tidak dapat diproses.", { file: "Gambar tidak valid" }); }
}
