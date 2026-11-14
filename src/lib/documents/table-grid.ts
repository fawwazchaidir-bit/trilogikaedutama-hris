/**
 * Grid tabel dokumen (murni): menghitung kolom awal tiap sel dari colspan DAN rowspan.
 * Dasar perbaikan "sel gabungan tidak sampai tepi tabel": lebar sel harus diambil dari indeks KOLOM (bukan indeks sel dalam baris), dan sel yang menempati beberapa baris
 * (rowspan) mengisi kolomnya pada baris-baris berikutnya sehingga sel lain bergeser benar.
 */
import type { PmNode } from "./content";

export interface GridCell {
  /** Sel sebenarnya (node tableCell/tableHeader) — null untuk penampung baris lanjutan rowspan. */
  node: PmNode | null;
  col: number;
  colspan: number;
  /** Sel asal: jumlah baris yang ditempatinya. Penampung: sama dengan asalnya. */
  rowspan: number;
  /** Penampung baris lanjutan (sel asal ada di baris di atasnya). */
  continued: boolean;
  /** Baris terakhir yang ditempati sel ini (garis bawah hanya di sini). */
  endsHere: boolean;
  header: boolean;
}
export interface TableGrid { cols: number; rows: GridCell[][] }

const span = (v: unknown, max: number): number => { const n = Math.floor(Number(v)); return Number.isFinite(n) && n >= 1 ? Math.min(n, max) : 1; };

export function layoutTable(rows: PmNode[]): TableGrid {
  // carry[col] = sisa baris yang masih ditempati sel dari baris di atas (+ sel asalnya)
  const carry = new Map<number, { left: number; origin: { colspan: number; header: boolean; rowspan: number }; startCol: number }>();
  const out: GridCell[][] = [];
  const ends: number[] = [];
  let cols = 0;
  rows.forEach((row, ri) => {
    const cells = row.content ?? [];
    const line: GridCell[] = [];
    let c = 0, k = 0;
    while (k < cells.length || [...carry.keys()].some((col) => col >= c)) {
      const held = carry.get(c);
      if (held && held.startCol === c) {
        const left = held.left - 1;
        line.push({ node: null, col: c, colspan: held.origin.colspan, rowspan: held.origin.rowspan, continued: true, endsHere: left === 0, header: held.origin.header });
        for (let x = c; x < c + held.origin.colspan; x++) { if (left === 0) carry.delete(x); else carry.set(x, { ...held, left }); }
        c += held.origin.colspan;
        continue;
      }
      if (k >= cells.length) break;
      const node = cells[k++]!;
      const colspan = span(node.attrs?.colspan, 12), rowspan = span(node.attrs?.rowspan, Math.max(1, rows.length - ri));
      const header = node.type === "tableHeader";
      line.push({ node, col: c, colspan, rowspan, continued: false, endsHere: rowspan === 1, header });
      if (rowspan > 1) for (let x = c; x < c + colspan; x++) carry.set(x, { left: rowspan - 1, origin: { colspan, header, rowspan }, startCol: c });
      c += colspan;
    }
    cols = Math.max(cols, c);
    ends.push(c);
    out.push(line);
  });
  const total = Math.max(1, cols);
  // Baris yang menutup kolom lebih sedikit dari tabel (tabel "bergerigi") diisi sel kosong agar tetap sampai tepi kanan.
  out.forEach((line, ri) => { if (ends[ri]! < total) line.push({ node: null, col: ends[ri]!, colspan: total - ends[ri]!, rowspan: 1, continued: false, endsHere: true, header: false }); });
  return { cols: total, rows: out };
}

/** Lebar (persen) sel = jumlah lebar kolom yang dicakupnya; `colWidths` (persen) bila ada dan cocok dengan jumlah kolom, selain itu rata. Dijamin: jumlah per baris penuh = 100. */
export function columnPercents(cols: number, colWidths: number[] | undefined): number[] {
  const ok = Array.isArray(colWidths) && colWidths.length === cols && colWidths.every((w) => Number.isFinite(w) && w > 0);
  const raw = ok ? colWidths! : Array.from({ length: cols }, () => 1);
  const total = raw.reduce((a, b) => a + b, 0);
  return raw.map((w) => (w / total) * 100);
}
export const cellPercent = (widths: number[], col: number, colspan: number): number => widths.slice(col, col + colspan).reduce((a, b) => a + b, 0);
