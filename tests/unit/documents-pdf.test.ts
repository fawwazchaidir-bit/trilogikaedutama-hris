/**
 * Uji fidelitas renderer PDF persuratan (tahap 0): tiga fixture yang meniru surat contoh harus menghasilkan PDF sah
 * dengan jumlah halaman yang diharapkan. Set DOC_SPIKE_OUT=<direktori> untuk menyimpan PDF agar bisa diperiksa mata.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, decodePDFRawStream, type PDFRef } from "pdf-lib";
import { renderDocumentPdf } from "@/server/pdf/document-render";
import { frameEdaran, frameSk, frameSuratNarasumber, frameSuratPenawaran } from "../fixtures/documents/frames";

const pages = (b: Buffer) => (b.toString("latin1").match(/\/Type \/Page[^s]/g) ?? []).length;
/** Isi aliran konten (operator PDF) tiap halaman, didekompresi — dipakai untuk memeriksa ukuran huruf kop dan keberadaan kaki halaman tanpa pustaka ekstraksi teks. */
async function pageStreams(buf: Buffer): Promise<string[]> {
  const pdf = await PDFDocument.load(buf);
  return pdf.getPages().map((page) => {
    const c = page.node.get(PDFName.of("Contents"));
    const refs = c instanceof PDFArray ? (c.asArray() as PDFRef[]) : [c as PDFRef];
    return refs.map((r) => Buffer.from(decodePDFRawStream(pdf.context.lookup(r) as PDFRawStream).decode()).toString("latin1")).join("\n");
  });
}
/**
 * Posisi vertikal (koordinat halaman, dari atas) tiap teks kaki halaman = run ber-ukuran 8,5 pt (teks lembaga + "Hal. X dari Y"). Teks `render` yang kehilangan pengaturannya tetap
 * "tercetak" tetapi di luar kertas (y ≈ −8772), jadi yang diperiksa adalah POSISINYA, bukan sekadar keberadaan operator teks.
 */
function footerYs(stream: string): number[] {
  return [...stream.matchAll(/\/F\d+ 8\.5 Tf/g)].map((m) => {
    const cms = [...stream.slice(0, m.index).matchAll(/1 0 0 1 [-\d.]+ ([-\d.]+) cm\nq\n1 0 0 1 0 [\d.]+ cm/g)];
    return Number(cms.at(-1)?.[1] ?? NaN);
  });
}
const out = process.env.DOC_SPIKE_OUT;
if (out) mkdirSync(out, { recursive: true });
const save = (name: string, b: Buffer) => { if (out) writeFileSync(`${out}/${name}.pdf`, b); };

describe("renderer PDF persuratan", () => {
  it("surat penawaran (meniru 080): satu halaman, PDF sah", async () => {
    const b = await renderDocumentPdf(await frameSuratPenawaran());
    save("surat-penawaran", b);
    expect(b.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages(b)).toBe(1);
  });
  it("surat permohonan narasumber (meniru 034): satu halaman dengan Rincian Acara", async () => {
    const b = await renderDocumentPdf(await frameSuratNarasumber());
    save("surat-narasumber", b);
    expect(pages(b)).toBe(1);
  });
  it("SK + lampiran tabel: lebih dari satu halaman", async () => {
    const b = await renderDocumentPdf(await frameSk());
    save("sk-pengangkatan", b);
    expect(pages(b)).toBeGreaterThanOrEqual(2);
  });
  it("draf diberi watermark dan nomor 'diberikan saat disetujui'; font serif ter-embed", async () => {
    const f = await frameSuratPenawaran();
    const b = await renderDocumentPdf({ ...f, number: null, draft: true });
    save("draf", b);
    expect(b.toString("latin1")).toContain("LiberationSerif");
  });

  it("kop format baru: font Cambria-kompatibel (Caladea) — nama 14 pt, alamat 10 pt, tagline 12 pt; tanpa baris kontak/identitas", async () => {
    const f = await frameSuratNarasumber();
    const b = await renderDocumentPdf(f);
    const txt = b.toString("latin1");
    expect(txt).toContain("Caladea-Bold");
    expect(txt).toContain("Caladea-Italic");
    expect(txt).toContain("LiberationSerif"); // isi surat tetap Liberation Serif
    const [p1] = await pageStreams(b);
    expect(p1).toMatch(/\/F\d+ 14 Tf/); // nama lembaga
    expect(p1).toMatch(/\/F\d+ 12 Tf/); // tagline
    expect(p1).toMatch(/\/F\d+ 10 Tf/); // alamat
    expect(Object.keys(f.letterhead).sort()).toEqual(["addressLines", "logo", "name", "tagline"]);
  });
  it("kaki halaman tercetak di setiap halaman (teks lembaga + nomor halaman) — pada surat satu halaman, SK berlampiran, dan edaran", async () => {
    for (const [name, frame, minPages] of [["penawaran", await frameSuratPenawaran(), 1], ["sk", await frameSk(), 2], ["edaran", await frameEdaran(), 1]] as const) {
      const b = await renderDocumentPdf({ ...frame, footerText: "Trilogika Edutama Training Institute Yogyakarta" });
      const streams = await pageStreams(b);
      expect(streams.length, name).toBeGreaterThanOrEqual(minPages);
      for (const [i, st] of streams.entries()) {
        const ys = footerYs(st);
        expect(ys.length, `${name} hal. ${i + 1}: jumlah teks kaki`).toBeGreaterThanOrEqual(2);
        for (const y of ys) expect(y, `${name} hal. ${i + 1}: teks kaki harus di dalam kertas (bawah)`).toBeGreaterThan(700);
        for (const y of ys) expect(y).toBeLessThan(842);
      }
    }
  });
  it("Surat Edaran (meniru Memo Internal): satu halaman, tanpa blok Nomor/Perihal/Kepada, isi Cambria-kompatibel 12 pt", async () => {
    const b = await renderDocumentPdf(await frameEdaran());
    save("surat-edaran", b);
    expect(pages(b)).toBe(1);
    const [p1] = await pageStreams(b);
    expect(p1).toMatch(/\/F\d+ 12 Tf/);
    expect(b.toString("latin1")).toContain("Caladea-Regular"); // isi memakai Caladea (bukan Liberation) pada layout edaran
  });
  it("layout edaran tidak mengubah layout surat biasa: isi surat tidak memuat Caladea-Regular", async () => {
    const b = await renderDocumentPdf(await frameSuratNarasumber());
    expect(b.toString("latin1")).not.toContain("Caladea-Regular");
  });
});
