import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type Metadata, type OutputInfo } from "sharp";
import opentype from "opentype.js";
import { Errors } from "../errors";

/**
 * Cap foto absensi — DILAKUKAN DI SERVER. Waktu dan koordinat dicetak ke piksel foto oleh server (bukan oleh perangkat),
 * sehingga waktu pada foto selalu waktu server saat absen. Teks digambar sebagai PATH VEKTOR dari font yang ikut dibundel
 * (public/fonts), bukan teks SVG, agar hasilnya sama di server mana pun tanpa bergantung pada font sistem.
 *
 * Yang DIJAMIN: cap ditulis server, foto dinormalisasi (JPEG, diputar sesuai EXIF, dikecilkan, metadata EXIF/GPS dibuang).
 * Yang TIDAK dijamin: bahwa isi foto adalah momen & tempat yang sebenarnya — itu ditinjau manusia.
 */

const FONT_FILE = "DejaVuSansMono-Bold.ttf";
const MAX_SIDE = 1280;
const MIN_SIDE = 240;
const MAX_INPUT_PIXELS = 40_000_000;
const ACCEPTED = new Set(["jpeg", "png", "webp"]);

type Font = ReturnType<typeof opentype.parse>;
let fontPromise: Promise<Font> | null = null;

function loadFont(): Promise<Font> {
  fontPromise ??= readFile(path.join(process.cwd(), "public", "fonts", FONT_FILE)).then((b) => {
    return opentype.parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer);
  });
  fontPromise.catch(() => { fontPromise = null; });
  return fontPromise;
}

/** Karakter yang tidak ada di font diganti "?" agar tidak muncul kotak kosong. */
export function printable(font: Pick<Font, "charToGlyphIndex">, text: string): string {
  return [...text.normalize("NFC")].map((ch) => (ch === " " || font.charToGlyphIndex(ch) > 0 ? ch : "?")).join("");
}

export interface StampedPhoto { jpeg: Buffer; width: number; height: number }

export async function stampPhoto(raw: Uint8Array, lines: string[]): Promise<StampedPhoto> {
  if (raw.byteLength === 0) throw Errors.validation("Foto kosong.", { photo: "Foto kosong" });
  const font = await loadFont();

  let meta: Metadata;
  try { meta = await sharp(raw, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" }).metadata(); }
  catch { throw Errors.validation("Foto tidak dapat dibaca. Ambil foto ulang.", { photo: "Foto tidak valid" }); }
  if (!meta.format || !ACCEPTED.has(meta.format)) throw Errors.validation("Format foto tidak didukung. Gunakan foto dari kamera (JPEG/PNG/WebP).", { photo: "Format tidak didukung" });
  if (Math.min(meta.width ?? 0, meta.height ?? 0) < MIN_SIDE) throw Errors.validation("Foto terlalu kecil/buram. Ambil foto ulang dengan kamera.", { photo: "Resolusi terlalu rendah" });

  let base: { data: Buffer; info: OutputInfo };
  try {
    base = await sharp(raw, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
      .rotate() // putar sesuai EXIF; EXIF (termasuk GPS bawaan perangkat) tidak ikut disimpan
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 88 })
      .toBuffer({ resolveWithObject: true });
  } catch { throw Errors.validation("Foto tidak dapat diproses. Ambil foto ulang.", { photo: "Foto tidak valid" }); }

  const { width, height } = base.info;
  const pad = Math.max(8, Math.round(width / 70));
  let size = Math.max(13, Math.min(34, Math.round(width / 30)));
  const clean = lines.map((l) => printable(font, l));
  // Kecilkan font bila baris terpanjang melebihi lebar foto.
  const widest = Math.max(...clean.map((l) => font.getAdvanceWidth(l, size)));
  const room = width - pad * 2;
  if (widest > room) size = Math.max(10, Math.floor(size * (room / widest)));
  const lineH = Math.round(size * 1.4);
  const bandH = pad * 2 + lineH * clean.length - Math.round((lineH - size) / 2);

  const paths = clean.map((l, i) => {
    const y = pad + Math.round(size * 1.05) + i * lineH;
    return `<path d="${font.getPath(l, pad, y, size).toPathData(2)}" fill="#ffffff"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${bandH}" viewBox="0 0 ${width} ${bandH}"><rect width="${width}" height="${bandH}" fill="#000000" fill-opacity="0.62"/>${paths}</svg>`;

  const out = await sharp(base.data)
    .composite([{ input: Buffer.from(svg), top: Math.max(0, height - bandH), left: 0 }])
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  return { jpeg: out, width, height };
}
