/**
 * Pembantu tes PDF: aliran konten tiap halaman (didekompresi) dan daftar teks beserta ukuran huruf dan POSISI MUTLAK (pt, dari tepi atas kertas) tanpa pustaka ekstraksi teks.
 * Posisi dihitung dengan menumpuk terjemahan `1 0 0 1 x y cm` mengikuti tumpukan `q`/`Q` hingga operator `Tf` (matriks balik `1 0 0 -1 0 H cm` sebelum `BT` diabaikan).
 * Teks yang gagal tercetak dengan benar tampak sebagai y di luar kertas (mis. ≈ −8000).
 */
import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, type PDFRef } from "pdf-lib";

export async function pageStreams(buf: Buffer): Promise<string[]> {
  const pdf = await PDFDocument.load(buf);
  return pdf.getPages().map((page) => {
    const c = page.node.get(PDFName.of("Contents"));
    const refs = c instanceof PDFArray ? (c.asArray() as PDFRef[]) : [c as PDFRef];
    return refs.map((r) => Buffer.from(decodePDFRawStream(pdf.context.lookup(r) as PDFRawStream).decode()).toString("latin1")).join("\n");
  });
}

export interface TextRun { size: number; x: number; y: number }
export function textRuns(stream: string): TextRun[] {
  const out: TextRun[] = [];
  const stack: [number, number][] = [[0, 0]];
  for (const raw of stream.split("\n")) {
    const line = raw.trim();
    if (line === "q") { stack.push([...stack[stack.length - 1]!] as [number, number]); continue; }
    if (line === "Q") { if (stack.length > 1) stack.pop(); continue; }
    const t = /^1 0 0 1 (-?[\d.]+) (-?[\d.]+) cm$/.exec(line);
    if (t) { const top = stack[stack.length - 1]!; top[0] += Number(t[1]); top[1] += Number(t[2]); continue; }
    const f = /^\/F\d+ ([\d.]+) Tf$/.exec(line);
    if (f) { const top = stack[stack.length - 1]!; out.push({ size: Number(f[1]), x: top[0], y: top[1] }); }
  }
  return out;
}
/** Teks ber-ukuran `size` pt (hanya yang di bagian bawah kertas bila `bottomOnly`). */
export const runsOfSize = (stream: string, size: number): TextRun[] => textRuns(stream).filter((r) => r.size === size);
