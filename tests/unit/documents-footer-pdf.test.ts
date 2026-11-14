/**
 * Kaki halaman di PDF (renderer): font, ukuran, gaya, warna, garis pemisah, halaman pertama/lampiran, dimatikan, posisi di dalam kertas, ruang bawah. Diperiksa lewat aliran konten
 * PDF (operator `Tf`/`cm`/warna) dan nama font tertanam — tanpa pustaka ekstraksi teks.
 */
import { describe, expect, it } from "vitest";
import { renderDocumentPdf } from "@/server/pdf/document-render";
import { doc, body } from "@/lib/documents/builders";
import { DEFAULT_FOOTER, footerReserve, type DocFooter } from "@/lib/documents/footer";
import type { DocFrame } from "@/lib/documents/frame";
import { frameSk, frameSuratPenawaran } from "../fixtures/documents/frames";
import { pageStreams, runsOfSize } from "../helpers/pdf-streams";

const streams = pageStreams;
/** y mutlak (dari atas kertas) tiap teks ber-ukuran `size` pt. */
const runsAt = (stream: string, size: number): number[] => runsOfSize(stream, size).map((r) => r.y);
const footer = (patch: Partial<DocFooter>): DocFooter => ({ ...DEFAULT_FOOTER, left: "Teks kiri uji", ...patch });
/** Surat satu halaman + satu halaman lampiran dari editor = tepat dua halaman. */
async function twoPage(f: DocFooter): Promise<DocFrame> {
  return { ...(await frameSuratPenawaran()), attachments: [{ title: "LAMPIRAN UJI", body: doc(body("Isi lampiran uji.")) }], footer: f };
}
const SZ = 9.5; // tidak dipakai bagian lain halaman (kop 12/14/10, isi 11/12, kutipan QR 7,5)

describe("kaki halaman terkonfigurasi", () => {
  it("bawaan: dua teks 8,5 pt di dalam kertas bagian bawah pada setiap halaman", async () => {
    const st = await streams(await renderDocumentPdf(await twoPage(footer({}))));
    expect(st).toHaveLength(2);
    for (const [i, s] of st.entries()) { const ys = runsAt(s, 8.5); expect(ys, `hal ${i + 1}`).toHaveLength(2); for (const y of ys) { expect(y).toBeGreaterThan(700); expect(y).toBeLessThan(842); } }
  });

  it("ukuran font diterapkan (9,5 pt) dan teks tetap di dalam kertas", async () => {
    const st = await streams(await renderDocumentPdf(await twoPage(footer({ size: SZ }))));
    for (const s of st) { const ys = runsAt(s, SZ); expect(ys).toHaveLength(2); for (const y of ys) expect(y).toBeGreaterThan(700); expect(runsAt(s, 8.5)).toHaveLength(0); }
  });

  it("pilihan font: tiap keluarga tertanam dengan variannya (tebal+miring → BoldItalic)", async () => {
    for (const [key, name] of [["LIBERATION_SANS", "LiberationSans"], ["CALADEA", "Caladea"], ["CARLITO", "Carlito"], ["LIBERATION_SERIF", "LiberationSerif"]] as const) {
      const txt = (await renderDocumentPdf(await twoPage(footer({ fontKey: key, bold: true, italic: true })))).toString("latin1");
      expect(txt, key).toContain(`${name}-BoldItalic`);
    }
    // tanpa tebal/miring → varian Regular; Carlito tidak muncul bila tidak dipilih
    const plain = (await renderDocumentPdf(await twoPage(footer({ fontKey: "LIBERATION_SANS", bold: false, italic: false })))).toString("latin1");
    expect(plain).toContain("LiberationSans");
    expect(plain).not.toContain("Carlito");
  });

  it("warna teks (#336699 → 0.2 0.4 0.6) dipakai pada kaki; bawaan abu-abu #444444", async () => {
    const colored = await streams(await renderDocumentPdf(await twoPage(footer({ color: "#336699" }))));
    expect(colored[0]).toMatch(/0\.2 0\.4 0\.6 scn/);
    const dflt = await streams(await renderDocumentPdf(await twoPage(footer({}))));
    expect(dflt[0]).toMatch(/0\.26666666666666666 0\.26666666666666666 0\.26666666666666666 scn/);
  });

  it("garis pemisah: hanya digambar bila dinyalakan (warna garis = warna teks)", async () => {
    const on = await streams(await renderDocumentPdf(await twoPage(footer({ rule: true, color: "#ff0000" }))));
    const off = await streams(await renderDocumentPdf(await twoPage(footer({ rule: false, color: "#ff0000" }))));
    expect(on[0]).toMatch(/1 0 0 SCN/);
    expect(off[0]).not.toMatch(/1 0 0 SCN/);
  });

  it("dimatikan atau semua zona kosong → tidak ada teks kaki sama sekali", async () => {
    for (const f of [footer({ enabled: false }), footer({ left: null, center: null, right: null })]) {
      const st = await streams(await renderDocumentPdf(await twoPage(f)));
      for (const s of st) expect(runsAt(s, 8.5)).toHaveLength(0);
    }
  });

  it("halaman pertama dapat dikosongkan (halaman berikutnya tetap bernomor, garis ikut hilang)", async () => {
    const st = await streams(await renderDocumentPdf(await twoPage(footer({ firstPage: false, rule: true, color: "#ff0000" }))));
    expect(runsAt(st[0]!, 8.5)).toHaveLength(0);
    expect(st[0]).not.toMatch(/1 0 0 SCN/);
    expect(runsAt(st[1]!, 8.5)).toHaveLength(2);
    expect(st[1]).toMatch(/1 0 0 SCN/);
  });

  it("halaman lampiran dapat dikecualikan (halaman surat tetap berkaki)", async () => {
    const st = await streams(await renderDocumentPdf(await twoPage(footer({ attachments: false }))));
    expect(runsAt(st[0]!, 8.5)).toHaveLength(2);
    expect(runsAt(st[1]!, 8.5)).toHaveLength(0);
  });

  it("tiga zona: tiga teks; zona tengah kosong → dua teks", async () => {
    const three = await streams(await renderDocumentPdf(await twoPage(footer({ center: "Tengah uji", right: "Kanan uji" }))));
    expect(runsAt(three[0]!, 8.5)).toHaveLength(3);
    const two = await streams(await renderDocumentPdf(await twoPage(footer({ center: null }))));
    expect(runsAt(two[0]!, 8.5)).toHaveLength(2);
  });

  it("SK berlampiran banyak halaman: setiap halaman berkaki", async () => {
    const st = await streams(await renderDocumentPdf({ ...(await frameSk()), footer: footer({}) }));
    expect(st.length).toBeGreaterThanOrEqual(2);
    for (const s of st) expect(runsAt(s, 8.5).length).toBeGreaterThanOrEqual(2);
  });
});

describe("ruang bawah halaman", () => {
  it("bawaan tidak mengubah pemenggalan (perkiraan < 2,1 cm); konfigurasi besar/panjang menambah ruang", () => {
    expect(footerReserve(DEFAULT_FOOTER)).toBeLessThan(2.1 * 28.3465);
    expect(footerReserve({ ...DEFAULT_FOOTER, enabled: false })).toBe(0);
    expect(footerReserve({ ...DEFAULT_FOOTER, left: null, right: null })).toBe(0);
    const big = footerReserve({ ...DEFAULT_FOOTER, size: 14, left: "x".repeat(200), rule: true });
    expect(big).toBeGreaterThan(2.1 * 28.3465);
    expect(footerReserve({ ...DEFAULT_FOOTER, size: 14, rule: true })).toBeGreaterThan(footerReserve(DEFAULT_FOOTER));
  });
});
