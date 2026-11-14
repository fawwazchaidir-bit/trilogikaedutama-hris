/**
 * Kerapian format surat: alamat tujuan ringkas ("Yth. …" / "di tempat"), keterangan QR, dan salam baku. Posisi diuji lewat kotak batas kata (pdftotext -bbox).
 */
import { describe, expect, it } from "vitest";
import { renderDocumentPdf } from "@/server/pdf/document-render";
import { VERIFY_CAPTION } from "@/lib/documents/frame";
import { DEFAULT_LETTER_TYPES, DEFAULT_SALUTATION, LEGACY_SALUTATION } from "@/lib/documents/templates";
import { frameSuratNarasumber, frameSuratPenawaran } from "../fixtures/documents/frames";
import { fullText, linesOf, pdfWords } from "../helpers/pdf-words";

const lineTexts = (buf: Buffer) => { const { words } = pdfWords(buf); return linesOf(words, 1).map((l) => l.map((w) => w.text).join(" ")); };

describe("alamat tujuan ringkas", () => {
  it("'Yth.' sebaris dengan penerima pertama, baris berikutnya apa adanya, lalu 'di tempat' pada satu baris", async () => {
    const lines = lineTexts(await renderDocumentPdf(await frameSuratPenawaran()));
    const i = lines.findIndex((l) => l.startsWith("Yth. Bapak/Ibu Kepala"));
    expect(i, lines.join("\n")).toBeGreaterThanOrEqual(0);
    expect(lines[i + 1]).toBe("SPPG Contoh Fiktif Gamping 2");
    expect(lines[i + 2]).toBe("di tempat");
    expect(lines.some((l) => /^Kepada\b/.test(l) || l === "Di" || l === "Tempat")).toBe(false);          // bentuk lama tidak tersisa
  });
  it("tempat tujuan yang diketik pengguna dipertahankan ('di Yogyakarta'); 'Tempat' bawaan ditulis 'tempat'", async () => {
    const f = await frameSuratNarasumber();
    const custom = lineTexts(await renderDocumentPdf({ ...f, recipient: { ...f.recipient!, place: "Yogyakarta" } }));
    expect(custom).toContain("di Yogyakarta");
    const dflt = lineTexts(await renderDocumentPdf({ ...f, recipient: { ...f.recipient!, place: "Tempat" } }));
    expect(dflt).toContain("di tempat");
  });
  it("penerima banyak baris tidak dipotong dan blok tidak terpecah di tengah", async () => {
    const f = await frameSuratNarasumber();
    const lines = lineTexts(await renderDocumentPdf({ ...f, recipient: { prefix: "Yth.", lines: ["Pimpinan A", "Divisi B", "Gedung C", "Jl. D No. 1", "Kota E", "Provinsi F"].map((text, k) => ({ text, bold: k < 2 })), cityPrefix: "di", place: "tempat" } }));
    const i = lines.findIndex((l) => l.startsWith("Yth. Pimpinan A"));
    expect(lines.slice(i, i + 7)).toEqual(["Yth. Pimpinan A", "Divisi B", "Gedung C", "Jl. D No. 1", "Kota E", "Provinsi F", "di tempat"]);
  });
  it("tanpa penerima (SK/edaran) tidak ada blok alamat", async () => {
    const f = await frameSuratNarasumber();
    expect(fullText(pdfWords(await renderDocumentPdf({ ...f, recipient: null })).words)).not.toMatch(/\bYth\.|\bdi tempat\b/);
  });
});

describe("keterangan QR dan salam baku", () => {
  it("keterangan QR memberi tahu fungsinya: terdaftar di sistem dan memeriksa status", async () => {
    expect(VERIFY_CAPTION).toBe("Dokumen ini terdaftar dalam sistem Trilogika. Pindai kode QR untuk memeriksa statusnya.");
    const text = fullText(pdfWords(await renderDocumentPdf(await frameSuratNarasumber())).words);
    expect(text).toContain("terdaftar dalam sistem Trilogika");
    expect(text).toContain("memeriksa statusnya");
    expect(text).not.toContain("sah secara elektronik");
  });
  it("salam bawaan semua jenis surat eksternal: 'Dengan hormat,' (huruf kapital hanya di awal)", () => {
    expect(DEFAULT_SALUTATION).toBe("Dengan hormat,");
    const ext = DEFAULT_LETTER_TYPES.filter((t) => t.series === "EKS" && t.salutation);
    expect(ext.length).toBeGreaterThan(5);
    for (const t of ext) expect(t.salutation, `${t.series}-${t.code}`).toBe("Dengan hormat,");
    expect(DEFAULT_LETTER_TYPES.some((t) => t.salutation === LEGACY_SALUTATION)).toBe(false);
  });
});
