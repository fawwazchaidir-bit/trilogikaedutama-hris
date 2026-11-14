import { longDate } from "./text";

/**
 * KAKI HALAMAN (footer) persuratan: konfigurasi, token, pilihan font, dan tata letak tiga zona. Murni (tanpa DB/React) — dipakai renderer PDF, validator pengaturan, pratinjau di layar.
 * Satu konfigurasi (Pengaturan Persuratan, Direktur) berlaku untuk SEMUA halaman PDF yang dihasilkan sistem: halaman surat, SK, dan halaman lampiran dari editor.
 * Lampiran PDF unggahan yang "digabung" adalah berkas pihak lain dan tidak diubah (tidak diberi kaki halaman).
 */

/** Keluarga font yang di-embed (SIL OFL, public/fonts). Cambria/Calibri/Arial/Times berlisensi pihak lain, jadi dipakai padanan metrik-kompatibelnya. */
export const FOOTER_FONTS = {
  LIBERATION_SERIF: { label: "Times New Roman (Liberation Serif)", family: "LiberationSerif", css: '"Times New Roman", "Liberation Serif", Times, serif' },
  LIBERATION_SANS: { label: "Arial (Liberation Sans)", family: "LiberationSans", css: 'Arial, "Liberation Sans", Helvetica, sans-serif' },
  CALADEA: { label: "Cambria (Caladea)", family: "Caladea", css: 'Cambria, Caladea, Georgia, serif' },
  CARLITO: { label: "Calibri (Carlito)", family: "Carlito", css: 'Calibri, Carlito, "Segoe UI", sans-serif' },
} as const;
export type FooterFontKey = keyof typeof FOOTER_FONTS;
export const FOOTER_FONT_KEYS = Object.keys(FOOTER_FONTS) as [FooterFontKey, ...FooterFontKey[]];
export const isFooterFontKey = (x: unknown): x is FooterFontKey => typeof x === "string" && x in FOOTER_FONTS;

/** Token yang diganti saat PDF dibuat. Contoh: "Hal. {halaman} dari {total}". */
export const FOOTER_TOKENS = ["halaman", "total", "nomor", "tanggal"] as const;
export type FooterToken = (typeof FOOTER_TOKENS)[number];
export const FOOTER_TOKEN_HELP: Record<FooterToken, string> = {
  halaman: "nomor halaman", total: "jumlah halaman", nomor: "nomor surat (\"draf\" sebelum terbit)", tanggal: "tanggal surat",
};

export type FooterZoneKey = "left" | "center" | "right";
export const FOOTER_ZONE_KEYS: readonly FooterZoneKey[] = ["left", "center", "right"];

export const FOOTER_SIZE = { min: 6, max: 14 } as const;
export const FOOTER_TEXT_MAX = 200;
export const FOOTER_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export interface DocFooter {
  enabled: boolean;
  left: string | null; center: string | null; right: string | null;
  fontKey: FooterFontKey; size: number; bold: boolean; italic: boolean; underline: boolean; color: string;
  /** Garis tipis di atas kaki halaman. */
  rule: boolean;
  /** Tampilkan pada halaman pertama. */
  firstPage: boolean;
  /** Tampilkan pada halaman lampiran (dari editor). */
  attachments: boolean;
}

/** Bawaan = tampilan sebelum fitur ini: teks lembaga di kiri (miring, abu-abu 8,5 pt) dan "Hal. X dari Y" di kanan. */
export const DEFAULT_FOOTER: DocFooter = {
  enabled: true, left: null, center: null, right: "Hal. {halaman} dari {total}",
  fontKey: "LIBERATION_SERIF", size: 8.5, bold: false, italic: true, underline: false, color: "#444444", rule: false, firstPage: true, attachments: true,
};

/** Kurung kurawal yang bukan token dikenal → daftar masalah (kosong = sah). Mencegah salah ketik seperti {halamn} yang akan tercetak apa adanya. */
export function footerTextProblems(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  const known = new Set<string>(FOOTER_TOKENS);
  const rest = text.replace(/\{([^{}]*)\}/g, (_m, inner: string) => { if (!known.has(inner)) out.push(`Token tidak dikenal: {${inner}}`); return ""; });
  if (/[{}]/.test(rest)) out.push("Kurung kurawal tidak berpasangan");
  return out;
}

export interface FooterContext {
  page: number; total: number;
  /** Nomor surat; null = draf. */
  number: string | null;
  /** Tanggal surat (ISO). */
  date: string;
}
export function resolveFooterText(text: string | null | undefined, ctx: FooterContext): string {
  if (!text) return "";
  return text.replace(/\{(halaman|total|nomor|tanggal)\}/g, (_m, k: FooterToken) => {
    switch (k) {
      case "halaman": return String(ctx.page);
      case "total": return String(ctx.total);
      case "nomor": return ctx.number ?? "(draf)";
      case "tanggal": return longDate(ctx.date);
    }
  });
}

export interface FooterZone { key: FooterZoneKey; text: string; flex: number; align: "left" | "center" | "right" }
const SAMPLE: FooterContext = { page: 99, total: 99, number: "000/TE-EKS/000/XII/0000", date: "2026-09-30" };
/** Lebar area teks halaman A4 (pt) dan perkiraan lebar rata-rata satu karakter (em) — konservatif agar teks pendek tidak sampai membungkus. */
const TEXT_WIDTH_PT = 595.28 - 2 * 56.69;
const CHAR_EM = 0.55;

/**
 * Zona yang berisi teks beserta lebar relatifnya dan perataannya. Satu zona = seluruh lebar. Beberapa zona: lebar sebanding lebar alami teks contoh (tidak bergantung pada halaman);
 * bila jumlahnya melebihi lebar halaman, zona yang muat dalam "bagian adil" tetap utuh (mis. "Hal. 1 dari 3" tidak dipersempit) dan zona yang lebih panjang berbagi sisanya (membungkus).
 * `flex` = lebar dalam pt (dipakai sebagai pembobot flex).
 */
export function footerZones(f: Pick<DocFooter, "left" | "center" | "right"> & { size?: number }): FooterZone[] {
  const size = f.size ?? DEFAULT_FOOTER.size;
  const zones = FOOTER_ZONE_KEYS.map((key) => ({ key, text: (f[key] ?? "").trim() })).filter((z) => z.text !== "");
  if (zones.length <= 1) return zones.map((z) => ({ ...z, flex: 1, align: z.key }));
  const natural = zones.map((z) => Math.max(size * 3, resolveFooterText(z.text, SAMPLE).length * size * CHAR_EM));
  let widths = natural;
  if (natural.reduce((a, b) => a + b, 0) > TEXT_WIDTH_PT) {
    widths = natural.map(() => 0);
    let remaining = TEXT_WIDTH_PT;
    let open = zones.map((_, i) => i);
    while (open.length > 0) {
      const fair = remaining / open.length;
      const fit = open.filter((i) => natural[i]! <= fair);
      if (fit.length === 0) { for (const i of open) widths[i] = fair; break; }
      for (const i of fit) { widths[i] = natural[i]!; remaining -= natural[i]!; }
      open = open.filter((i) => !fit.includes(i));
    }
  }
  return zones.map((z, i) => ({ ...z, flex: Math.round(widths[i]! * 100) / 100, align: z.key }));
}

/** Baris pengaturan (kolom basis data) → konfigurasi; nilai tak sah jatuh ke bawaan agar PDF tidak pernah gagal karena data kaki halaman. */
export interface FooterRow {
  footerEnabled: boolean; footerText: string | null; footerCenter: string | null; footerRight: string | null;
  footerFont: string; footerSize: number; footerBold: boolean; footerItalic: boolean; footerUnderline: boolean; footerColor: string;
  footerRule: boolean; footerFirstPage: boolean; footerAttachments: boolean;
}
export function footerFromRow(r: FooterRow): DocFooter {
  const size = Number.isFinite(r.footerSize) ? Math.min(FOOTER_SIZE.max, Math.max(FOOTER_SIZE.min, r.footerSize)) : DEFAULT_FOOTER.size;
  return {
    enabled: r.footerEnabled, left: r.footerText, center: r.footerCenter, right: r.footerRight,
    fontKey: isFooterFontKey(r.footerFont) ? r.footerFont : DEFAULT_FOOTER.fontKey, size, bold: r.footerBold, italic: r.footerItalic, underline: r.footerUnderline,
    color: FOOTER_COLOR_RE.test(r.footerColor) ? r.footerColor : DEFAULT_FOOTER.color, rule: r.footerRule, firstPage: r.footerFirstPage, attachments: r.footerAttachments,
  };
}

/** Jarak kaki halaman dari tepi bawah (1,2 cm) — dipakai memperkirakan ruang yang harus disisakan di bawah isi. */
const FOOTER_BOTTOM_PT = 34.02;
/**
 * Perkiraan tinggi yang dimakan kaki halaman dari tepi bawah kertas (pt): jarak bawah + baris (teks panjang/ukuran besar dapat membungkus) + garis + sela.
 * Bawaan (satu baris 8,5 pt) ≈ 53 pt < 2,1 cm (59,5 pt) sehingga pemenggalan halaman tidak berubah; konfigurasi besar menambah padding bawah halaman agar isi tidak tertimpa.
 */
export function footerReserve(f: DocFooter): number {
  const zones = footerZones(f);
  if (!f.enabled || zones.length === 0) return 0;
  const sum = zones.reduce((a, z) => a + z.flex, 0);
  const lines = Math.max(...zones.map((z) => {
    const perLine = Math.max(1, Math.floor((TEXT_WIDTH_PT * (z.flex / sum)) / (f.size * CHAR_EM)));
    return Math.ceil(resolveFooterText(z.text, SAMPLE).length / perLine);
  }));
  return FOOTER_BOTTOM_PT + lines * f.size * 1.25 + (f.rule ? 6 : 0) + 8;
}
