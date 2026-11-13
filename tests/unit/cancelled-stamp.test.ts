/**
 * Tanda DIBATALKAN pada salinan status PDF: berkas asli tidak berubah; salinan bertanda pada setiap halaman, jumlah halaman sama, sidik jari berbeda.
 */
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { inflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFRawStream, PDFStream, StandardFonts } from "pdf-lib";
import { CANCELLED_STAMP_TEXT, stampCancelledCopy } from "@/lib/documents/cancelled-stamp";

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
async function sample(pages = 3): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]).drawText(`Isi surat asli halaman ${i + 1}`, { x: 60, y: 700, size: 12, font });
  return Buffer.from(await doc.save());
}
/** Semua teks yang digambar pada halaman (isi aliran konten dibuka), untuk memastikan tanda benar-benar tergambar. */
async function contentOf(bytes: Uint8Array): Promise<string[]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => {
    const c = p.node.Contents();
    const refs = c instanceof PDFStream ? [c] : c ? c.asArray().map((r) => doc.context.lookup(r)) : [];
    return refs.map((s) => {
      const raw = s as PDFRawStream;
      const filter = raw.dict.get(PDFName.of("Filter"));
      const data = raw.getContents();
      try { return (filter ? Buffer.from(inflateSync(data)) : Buffer.from(data)).toString("latin1"); } catch { return Buffer.from(data).toString("latin1"); }
    }).join("\n");
  });
}
const hex = (s: string) => Buffer.from(s, "latin1").toString("hex").toUpperCase();

describe("salinan status DIBATALKAN", () => {
  it("setiap halaman bertanda DIBATALKAN; jumlah halaman sama; isi asli tetap ada; sidik jari berbeda dari asli", async () => {
    const original = await sample(3);
    const before = sha(original);
    const stamped = await stampCancelledCopy(original, { number: "080/INT/XI/2026" });
    expect(sha(original)).toBe(before);                                    // berkas asli tidak disentuh
    expect(sha(stamped)).not.toBe(before);
    const doc = await PDFDocument.load(stamped);
    expect(doc.getPageCount()).toBe(3);
    const pages = await contentOf(stamped);
    expect(pages).toHaveLength(3);
    for (const [i, text] of pages.entries()) {
      expect(text.toUpperCase(), `halaman ${i + 1}`).toContain(hex(CANCELLED_STAMP_TEXT));
      expect(text.toUpperCase(), `isi asli halaman ${i + 1}`).toContain(hex(`Isi surat asli halaman ${i + 1}`));
    }
  });

  it("penanda yang dapat dibaca mesin: subjek & kata kunci memuat DIBATALKAN dan nomor surat", async () => {
    const stamped = await stampCancelledCopy(await sample(1), { number: "034/EKS/XI/2026" });
    const doc = await PDFDocument.load(stamped);
    expect(doc.getSubject()).toContain("DIBATALKAN");
    expect(doc.getSubject()).toContain("034/EKS/XI/2026");
    expect(doc.getKeywords()).toContain("DIBATALKAN");
  });

  it("berkas asli tanpa tanda TIDAK memuat teks DIBATALKAN (pembanding)", async () => {
    const pages = await contentOf(await sample(1));
    expect(pages[0]!.toUpperCase()).not.toContain(hex(CANCELLED_STAMP_TEXT));
  });

  it("dapat ditumpuk pada halaman ukuran berbeda (A4 potret, lanskap, kecil) tanpa gagal", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]); doc.addPage([842, 595]); doc.addPage([300, 400]);
    const stamped = await stampCancelledCopy(Buffer.from(await doc.save()));
    expect((await PDFDocument.load(stamped)).getPageCount()).toBe(3);
  });
});
