/**
 * Kop surat: baris kontak (Email, Telp, Website) di bawah alamat dan garis di bawah kop yang dapat diadakan/ditiadakan.
 * Murni: pembentuk baris kontak; PDF: teks, urutan, posisi di dalam kertas, garis, dan jarak ke isi surat yang TIDAK bergeser saat garis ditiadakan.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { KOP_CONTACT_SEPARATOR, kopContactLine } from "@/lib/documents/kop";
import { renderDocumentPdf } from "@/server/pdf/document-render";
import type { DocFrame } from "@/lib/documents/frame";
import { frameSuratNarasumber, frameEdaran, frameSk } from "../fixtures/documents/frames";
import { pageStreams, runsOfSize, textRuns } from "../helpers/pdf-streams";

const NBSP = "\u00A0";
/** Teks halaman pertama hasil `pdftotext` (urutan baca; NBSP dinormalkan ke spasi biasa). */
function pdfText(buf: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), "kop-"));
  try { const f = join(dir, "a.pdf"); writeFileSync(f, buf); return execFileSync("pdftotext", ["-f", "1", "-l", "1", "-enc", "UTF-8", f, "-"], { encoding: "utf8" }).replaceAll(NBSP, " "); }
  finally { rmSync(dir, { recursive: true, force: true }); }
}
const withKop = (f: DocFrame, patch: Partial<DocFrame["letterhead"]>): DocFrame => ({ ...f, letterhead: { ...f.letterhead, ...patch } });

describe("kopContactLine (murni)", () => {
  it("urutan tetap Email → Telp → Website, dipisah ' | '", () => {
    expect(kopContactLine({ website: "www.a.example", phone: "0274 555 0100", email: "info@a.example" })).toBe(
      ["Email:" + NBSP + "info@a.example", "Telp:" + NBSP + "0274" + NBSP + "555" + NBSP + "0100", "Website:" + NBSP + "www.a.example"].join(KOP_CONTACT_SEPARATOR),
    );
  });
  it("bagian yang kosong/spasi saja dilewati; semuanya kosong → null", () => {
    expect(kopContactLine({ email: "info@a.example", phone: "   ", website: null })).toBe("Email:" + NBSP + "info@a.example");
    expect(kopContactLine({ phone: "0274 1", website: "" })).toBe("Telp:" + NBSP + "0274" + NBSP + "1");
    expect(kopContactLine({})).toBeNull();
    expect(kopContactLine({ email: " ", phone: "\n", website: "\t" })).toBeNull();
  });
  it("spasi di dalam satu bagian = spasi tak-terputus (baris hanya patah di antara bagian); spasi ganda dirapikan", () => {
    const line = kopContactLine({ phone: "  0274   555  0100 " })!;
    expect(line).toBe("Telp:" + NBSP + "0274" + NBSP + "555" + NBSP + "0100");
    expect(line.includes(" ")).toBe(false);
  });
});

describe("kop di PDF: baris kontak", () => {
  it("email, telp, dan website tercetak di bawah alamat, di atas isi surat, di dalam kertas", async () => {
    const f = await frameSuratNarasumber();
    const text = pdfText(await renderDocumentPdf(f));
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const iAddr = lines.findIndex((l) => l.startsWith("Grha Trilogika"));
    const iMail = lines.findIndex((l) => l.includes("Email: info@trilogika.example"));
    expect(iAddr, text).toBeGreaterThanOrEqual(0);
    expect(iMail, text).toBeGreaterThan(iAddr);
    expect(text).toContain("Telp: (0274) 555-0100");
    expect(text).toContain("Website: www.trilogika.example");
    expect(text.indexOf("Website: www.trilogika.example")).toBeLessThan(text.indexOf("Nomor"));   // di atas isi surat
  });

  it("baris kontak memakai gaya alamat (Cambria italic 10 pt) dan menambah satu baris kop dibanding tanpa kontak", async () => {
    const f = await frameSuratNarasumber();
    const on = (await pageStreams(await renderDocumentPdf(f)))[0]!;
    const off = (await pageStreams(await renderDocumentPdf(withKop(f, { contactLine: null }))))[0]!;
    const ys = (st: string) => runsOfSize(st, 10).map((r) => r.y);
    expect(ys(on).length).toBeGreaterThan(ys(off).length);
    // semua teks kop tetap di dalam kertas (dekat tepi atas), tidak keluar halaman
    for (const r of textRuns(on).filter((x) => x.size === 10 || x.size === 12 || x.size === 14).slice(0, 8)) { expect(r.y).toBeGreaterThan(0); expect(r.y).toBeLessThan(200); }
  });

  it("tanpa data kontak: tidak ada baris kontak sama sekali (tidak mencetak 'Email:' kosong)", async () => {
    const text = pdfText(await renderDocumentPdf(withKop(await frameSuratNarasumber(), { contactLine: null })));
    expect(text).not.toMatch(/Email:|Telp:|Website:/);
  });

  it("kontak panjang hanya patah di antara bagian (tidak memutus 'Telp: …' di tengah)", async () => {
    const long = kopContactLine({ email: "kontak.layanan.pelanggan@trilogika-edutama-contoh.example", phone: "(0274) 555-0100 / 0812 3456 7890", website: "www.trilogika-edutama-contoh.example/lembaga" });
    const text = pdfText(await renderDocumentPdf(withKop(await frameSuratNarasumber(), { contactLine: long })));
    const lines = text.split("\n").map((l) => l.trim());
    // setiap label diawali di awal baris atau setelah pemisah, dan nilainya satu baris dengan labelnya
    for (const [label, value] of [["Email:", "kontak.layanan.pelanggan@trilogika-edutama-contoh.example"], ["Telp:", "(0274) 555-0100 / 0812 3456 7890"], ["Website:", "www.trilogika-edutama-contoh.example/lembaga"]] as const) {
      expect(lines.some((l) => l.includes(`${label} ${value}`)), `${label} harus utuh dalam satu baris`).toBe(true);
    }
  });

  it("berlaku pada semua jenis layout: surat, SK, dan edaran", async () => {
    for (const [name, frame] of [["surat", await frameSuratNarasumber()], ["sk", await frameSk()], ["edaran", await frameEdaran()]] as const) {
      expect(pdfText(await renderDocumentPdf(frame)), name).toContain("Website: www.trilogika.example");
    }
  });
});

describe("kop di PDF: garis di bawah kop", () => {
  const strokes = (st: string) => (st.match(/0 0 0 SCN/g) ?? []).length;

  it("garis digambar bila diadakan dan tidak digambar bila ditiadakan", async () => {
    const f = await frameSuratNarasumber();
    const on = (await pageStreams(await renderDocumentPdf(withKop(f, { rule: true }))))[0]!;
    const off = (await pageStreams(await renderDocumentPdf(withKop(f, { rule: false }))))[0]!;
    expect(strokes(on)).toBeGreaterThan(strokes(off));
  });

  it("menghapus garis TIDAK menggeser apa pun: posisi dan ukuran semua teks sama persis (jarak ke isi tetap)", async () => {
    for (const [name, f] of [["surat", await frameSuratNarasumber()], ["sk", await frameSk()], ["edaran", await frameEdaran()]] as const) {
      const on = await pageStreams(await renderDocumentPdf(withKop(f, { rule: true })));
      const off = await pageStreams(await renderDocumentPdf(withKop(f, { rule: false })));
      expect(off.length, name).toBe(on.length);                                 // jumlah halaman sama
      expect(textRuns(off[0]!), name).toEqual(textRuns(on[0]!));                // letak teks halaman pertama sama
    }
  });
});
