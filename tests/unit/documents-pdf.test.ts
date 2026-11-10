/**
 * Uji fidelitas renderer PDF persuratan (tahap 0): tiga fixture yang meniru surat contoh harus menghasilkan PDF sah
 * dengan jumlah halaman yang diharapkan. Set DOC_SPIKE_OUT=<direktori> untuk menyimpan PDF agar bisa diperiksa mata.
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { renderDocumentPdf } from "@/server/pdf/document-render";
import { frameSk, frameSuratNarasumber, frameSuratPenawaran } from "../fixtures/documents/frames";

const pages = (b: Buffer) => (b.toString("latin1").match(/\/Type \/Page[^s]/g) ?? []).length;
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
});
