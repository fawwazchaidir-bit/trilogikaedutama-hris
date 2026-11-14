/**
 * Perkiraan tinggi blok isi surat (murni) untuk satu keputusan: apakah sebuah butir daftar / baris tabel / paragraf terakhir cukup PENDEK untuk dijaga utuh di satu halaman,
 * atau terlalu PANJANG sehingga harus boleh berlanjut ke halaman berikutnya.
 *
 * Latar belakang: react-pdf meletakkan elemen `wrap={false}` yang lebih tinggi dari halaman secara utuh dan membiarkannya meluber (teks terpotong, bertumpuk dengan QR dan tanda tangan).
 * Elemen pendek tetap dijaga utuh (rapi), elemen panjang dibiarkan terpecah. Perkiraan sengaja kasar dan condong ke "lebih tinggi" (lebar rata-rata huruf 0,5 em).
 */
import type { PmNode } from "./content";
import { cellPercent, columnPercents, layoutTable } from "./table-grid";

export const CM = 28.3465;
export const PAGE_W = 595.28, PAGE_H = 841.89;
/** Lebar area isi (margin kiri/kanan 2 cm) dan tinggi area isi halaman lanjutan (atas 1,5 cm, bawah 2,1 cm). */
export const CONTENT_W = PAGE_W - 4 * CM;
export const CONTENT_H = PAGE_H - 1.5 * CM - 2.1 * CM;
/** Blok yang diperkirakan lebih tinggi dari ini TIDAK dijaga utuh (boleh terpecah antar halaman). */
export const KEEP_MAX = 0.6 * CONTENT_H;

export interface MeasureLayout { fontPt: number; linePt: number; gapPt: number }
/** Layout biasa (11 pt, 1,3) dan Surat Edaran (12 pt, 1,5). */
export const MEASURE_DEFAULT: MeasureLayout = { fontPt: 11, linePt: 11 * 1.3, gapPt: 6 };
export const MEASURE_EDARAN: MeasureLayout = { fontPt: 12, linePt: 12 * 1.5, gapPt: 6 };

const CHAR_EM = 0.5;

function textChars(n: PmNode | undefined): string[] {
  // satu elemen per segmen (dipisah hardBreak)
  const segs: string[] = [""];
  const walk = (x: PmNode) => {
    if (x.type === "hardBreak") { segs.push(""); return; }
    if (x.type === "text") { segs[segs.length - 1] += x.text ?? ""; return; }
    for (const c of x.content ?? []) walk(c);
  };
  if (n) walk(n);
  return segs;
}

export function estimateTextHeight(segments: string[], widthPt: number, lay: MeasureLayout): number {
  const perLine = Math.max(1, Math.floor(widthPt / (lay.fontPt * CHAR_EM)));
  const lines = segments.reduce((sum, s) => sum + Math.max(1, Math.ceil(s.length / perLine)), 0);
  return lines * lay.linePt;
}

export function estimateBlocks(nodes: PmNode[] | undefined, widthPt: number, lay: MeasureLayout = MEASURE_DEFAULT): number {
  return (nodes ?? []).reduce((sum, n) => sum + estimateBlock(n, widthPt, lay), 0);
}

export function estimateBlock(n: PmNode, widthPt: number, lay: MeasureLayout = MEASURE_DEFAULT): number {
  switch (n.type) {
    case "paragraph":
    case "heading": {
      const indent = typeof n.attrs?.indent === "number" ? n.attrs.indent * CM : 0;
      const after = typeof n.attrs?.spaceAfter === "number" ? n.attrs.spaceAfter : lay.gapPt;
      return estimateTextHeight(textChars(n), Math.max(40, widthPt - indent), lay) + after;
    }
    case "optionalBlock":
      return n.attrs?.enabled === false ? 0 : estimateBlocks(n.content, widthPt, lay);
    case "bulletList":
    case "orderedList": {
      const left = typeof n.attrs?.indent === "number" ? n.attrs.indent * CM : 0;
      return (n.content ?? []).reduce((sum, it) => sum + estimateBlocks(it.content, Math.max(40, widthPt - left - 0.9 * CM), lay) + 2, 0);
    }
    case "labelBlock": {
      const lw = Number(n.attrs?.labelWidth ?? 3.2) * CM + 10;
      return (n.content ?? []).reduce((sum, r) => sum + estimateTextHeight(textChars(r), Math.max(40, widthPt - lw), lay) + 1, 0) + 6;
    }
    case "diktumList": {
      const lw = Number(n.attrs?.labelWidth ?? 2.6) * CM + 10;
      return (n.content ?? []).reduce((sum, it) => sum + estimateBlocks(it.content, Math.max(40, widthPt - lw), lay) + 6, 0);
    }
    case "table": return estimateTable(n, widthPt, lay);
    case "pageBreak": return 0;
    default: return 0;
  }
}

/** Tinggi satu baris tabel = sel tertinggi (sel gabungan memakai lebar semua kolom yang dicakupnya). */
export function estimateTableRows(n: PmNode, widthPt: number, lay: MeasureLayout = MEASURE_DEFAULT): number[] {
  const grid = layoutTable(n.content ?? []);
  const pct = columnPercents(grid.cols, n.attrs?.colWidths as number[] | undefined);
  return grid.rows.map((row) => Math.max(0, ...row.filter((c) => !c.continued && c.node).map((c) => estimateBlocks(c.node!.content, Math.max(30, (widthPt * cellPercent(pct, c.col, c.colspan)) / 100 - 6), lay) + 6)));
}
const estimateTable = (n: PmNode, widthPt: number, lay: MeasureLayout) => estimateTableRows(n, widthPt, lay).reduce((a, b) => a + b, 0) + 8;

/** Cukup pendek untuk dijaga utuh di satu halaman? */
export const keepsTogether = (heightPt: number): boolean => heightPt <= KEEP_MAX;
