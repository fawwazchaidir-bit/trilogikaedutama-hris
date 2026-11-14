/**
 * Pembantu tes PDF berbasis `pdftotext -bbox`: setiap kata beserta KOTAK BATAS-nya (pt, dari pojok kiri-atas halaman). Dipakai untuk menguji tata letak yang tidak terlihat dari
 * teks hasil ekstraksi saja: lekukan baris pertama, tepi kanan sel tabel, kata yang keluar kertas, dan teks yang saling menimpa.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface Word { page: number; text: string; x0: number; y0: number; x1: number; y1: number }
export interface PageBox { page: number; width: number; height: number }

const decode = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

export function pdfWords(buf: Buffer): { words: Word[]; pages: PageBox[] } {
  const dir = mkdtempSync(join(tmpdir(), "pdfw-"));
  try {
    const f = join(dir, "a.pdf");
    writeFileSync(f, buf);
    const html = execFileSync("pdftotext", ["-bbox", "-enc", "UTF-8", f, "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const words: Word[] = [], pages: PageBox[] = [];
    let page = 0;
    for (const m of html.matchAll(/<page width="([\d.]+)" height="([\d.]+)">|<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([\s\S]*?)<\/word>/g)) {
      if (m[1]) { page++; pages.push({ page, width: Number(m[1]), height: Number(m[2]) }); continue; }
      words.push({ page, text: decode(m[7]!), x0: Number(m[3]), y0: Number(m[4]), x1: Number(m[5]), y1: Number(m[6]) });
    }
    return { words, pages };
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Kata-kata yang SEBAGIAN/SELURUHNYA di luar kertas (toleransi 0,5 pt). */
export function outsidePage(words: Word[], pages: PageBox[]): Word[] {
  return words.filter((w) => { const p = pages[w.page - 1]!; return w.x0 < -0.5 || w.y0 < -0.5 || w.x1 > p.width + 0.5 || w.y1 > p.height + 0.5; });
}

/** Pasangan kata pada halaman yang sama yang saling menimpa (irisan > 25% luas kata yang lebih kecil). Kata satu baris yang berdampingan tidak beririsan. */
export function overlappingWords(words: Word[]): [Word, Word][] {
  const out: [Word, Word][] = [];
  const byPage = new Map<number, Word[]>();
  for (const w of words) byPage.set(w.page, [...(byPage.get(w.page) ?? []), w]);
  for (const list of byPage.values()) {
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!, b = list[j]!;
      const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ix <= 0 || iy <= 0) continue;
      const small = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
      if (small > 0 && (ix * iy) / small > 0.25) out.push([a, b]);
    }
  }
  return out;
}

/** Baris-baris halaman (kata dengan y0 berdekatan dikelompokkan), tiap baris diurutkan menurut x. */
export function linesOf(words: Word[], page: number, tol = 2): Word[][] {
  const ws = words.filter((w) => w.page === page).sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const lines: Word[][] = [];
  for (const w of ws) { const last = lines[lines.length - 1]; if (last && Math.abs(last[0]!.y0 - w.y0) <= tol) last.push(w); else lines.push([w]); }
  return lines.map((l) => l.sort((a, b) => a.x0 - b.x0));
}

export const fullText = (words: Word[]): string => words.map((w) => w.text).join(" ");
