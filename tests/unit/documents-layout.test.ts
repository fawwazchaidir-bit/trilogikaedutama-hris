/**
 * Tata letak PDF surat (temuan audit): tanda tangan banyak pihak tidak boleh terpotong, isi panjang mengalir antar halaman tanpa tumpang-tindih, lekukan baris pertama,
 * total halaman berkas gabungan, dan lebar sel gabungan tabel. Diuji lewat POSISI KATA di kertas (`pdftotext -bbox`), bukan hanya teks hasil ekstraksi.
 */
import { describe, expect, it } from "vitest";
import { renderDocumentPdf } from "@/server/pdf/document-render";
import { doc, li, ol } from "@/lib/documents/builders";
import type { DocFrame, DocSignatory } from "@/lib/documents/frame";
import type { PmNode } from "@/lib/documents/content";
import { cellPercent, columnPercents, layoutTable } from "@/lib/documents/table-grid";
import { KEEP_MAX, estimateBlock, estimateTableRows, keepsTogether } from "@/lib/documents/layout-estimate";
import { splitTail } from "@/server/pdf/DocumentPdf";
import { frameSuratNarasumber } from "../fixtures/documents/frames";
import { demoSignature, demoStamp } from "../fixtures/documents/assets";
import { fullText, linesOf, outsidePage, overlappingWords, pdfWords } from "../helpers/pdf-words";

const LEFT = 2 * 28.3465; // margin kiri 2 cm
const sentence = (i: number) => `Kalimat contoh ke-${i} untuk menjelaskan ketentuan kerja sama dan lingkup pelaksanaan kegiatan secara terperinci. `;
const longText = (n: number) => Array.from({ length: n }, (_, i) => sentence(i + 1)).join("");
const para = (text: string, attrs: Record<string, unknown> = {}): PmNode => ({ type: "paragraph", attrs, content: [{ type: "text", text }] });
const cellOf = (text: string, attrs: Record<string, unknown> = {}, type: "tableCell" | "tableHeader" = "tableCell"): PmNode => ({ type, attrs, content: [para(text, attrs.align ? { textAlign: attrs.align } : {})] });
const row = (...cells: PmNode[]): PmNode => ({ type: "tableRow", content: cells });
const tbl = (rows: PmNode[], attrs: Record<string, unknown> = {}): PmNode => ({ type: "table", attrs: { header: true, ...attrs }, content: rows });

async function signers(n: number): Promise<DocSignatory[]> {
  const sig = await demoSignature(), st = await demoStamp();
  return Array.from({ length: n }, (_, i) => ({ orgName: "TRILOGIKA EDUTAMA", title: `Jabatan Penandatangan ${i + 1}`, name: `Nama Penandatangan Ke-${i + 1}, S.Psi.`, signature: sig, stamp: i === 0 ? st : null }));
}
const withBody = async (nodes: PmNode[], n = 1): Promise<DocFrame> => ({ ...(await frameSuratNarasumber()), body: doc(...nodes), signatories: await signers(n) });
/** Semua kata ada di dalam kertas dan tidak ada yang saling menimpa. */
function expectClean(buf: Buffer, label: string, ignore: string[] = []) {
  const { words, pages } = pdfWords(buf);
  expect(outsidePage(words, pages).map((w) => w.text), `${label}: kata di luar kertas`).toEqual([]);
  expect(overlappingWords(words.filter((w) => !ignore.includes(w.text))).map(([a, b]) => `${a.text}~${b.text}`), `${label}: teks saling menimpa`).toEqual([]);
  return { words, pages, text: fullText(words) };
}
const count = (text: string, token: string) => text.split(/\s+/).filter((w) => w === token).length;

describe("grid tabel (murni)", () => {
  it("colspan: kolom awal sel dihitung dari indeks KOLOM; lebar sel = jumlah lebar kolom yang dicakup, tiap baris penuh 100%", () => {
    const g = layoutTable([
      row(...["A", "B", "C", "D"].map((x) => cellOf(x, {}, "tableHeader"))),
      row(cellOf("AB", { colspan: 2 }), cellOf("CD", { colspan: 2 })),
      row(cellOf("A"), cellOf("B"), cellOf("C"), cellOf("D")),
    ]);
    expect(g.cols).toBe(4);
    expect(g.rows[1]!.map((c) => [c.col, c.colspan])).toEqual([[0, 2], [2, 2]]);
    const w = columnPercents(4, [10, 20, 30, 40]);
    expect(w).toEqual([10, 20, 30, 40]);
    expect(g.rows[1]!.map((c) => cellPercent(w, c.col, c.colspan))).toEqual([30, 70]);           // sel kedua = kolom 3+4 (bukan kolom 2+3 = 50)
    for (const r of g.rows) expect(r.reduce((s, c) => s + cellPercent(w, c.col, c.colspan), 0)).toBeCloseTo(100, 6);
  });

  it("rowspan: sel asal di baris pertama, penampung kosong di baris berikutnya; sel lain bergeser benar; garis bawah hanya di baris terakhir", () => {
    const g = layoutTable([
      row(cellOf("R", { rowspan: 2 }), cellOf("B2"), cellOf("C2")),
      row(cellOf("B3"), cellOf("C3")),
      row(cellOf("A4"), cellOf("B4"), cellOf("C4")),
    ]);
    expect(g.cols).toBe(3);
    expect(g.rows[0]![0]).toMatchObject({ col: 0, rowspan: 2, continued: false, endsHere: false });
    expect(g.rows[1]!.map((c) => [c.col, c.continued, c.node?.content?.[0]?.content?.[0]?.text ?? null])).toEqual([[0, true, null], [1, false, "B3"], [2, false, "C3"]]);
    expect(g.rows[1]![0]).toMatchObject({ continued: true, endsHere: true });
    expect(g.rows[2]!.every((c) => !c.continued)).toBe(true);
  });

  it("rowspan + colspan bersama: lebar penampung = colspan asalnya", () => {
    const g = layoutTable([row(cellOf("X", { rowspan: 2, colspan: 2 }), cellOf("C")), row(cellOf("C2"))]);
    expect(g.cols).toBe(3);
    expect(g.rows[1]![0]).toMatchObject({ col: 0, colspan: 2, continued: true });
    expect(g.rows[1]![1]).toMatchObject({ col: 2, colspan: 1, continued: false });
  });

  it("tabel bergerigi (baris kekurangan sel) diisi sel kosong sampai tepi; jumlah lebar tetap 100%", () => {
    const g = layoutTable([row(cellOf("A"), cellOf("B"), cellOf("C"), cellOf("D")), row(cellOf("A"), cellOf("B"))]);
    expect(g.rows[1]!.map((c) => [c.col, c.colspan, c.node === null])).toEqual([[0, 1, false], [1, 1, false], [2, 2, true]]);
    const w = columnPercents(4, undefined);
    expect(g.rows[1]!.reduce((s, c) => s + cellPercent(w, c.col, c.colspan), 0)).toBeCloseTo(100, 6);
  });

  it("colWidths yang tidak cocok dengan jumlah kolom (mis. kolom ditambah di editor) → lebar rata; angka tidak sah ditolak", () => {
    columnPercents(3, [50, 50]).forEach((x) => expect(x).toBeCloseTo(100 / 3, 6));
    expect(columnPercents(2, [30, 0])).toEqual([50, 50]);
    expect(columnPercents(2, [1, 3])).toEqual([25, 75]);
  });

  it("rowspan melebihi sisa baris dipotong; colspan/rowspan tak sah dianggap 1", () => {
    const g = layoutTable([row(cellOf("A", { rowspan: 50 }), cellOf("B")), row(cellOf("B2"))]);
    expect(g.rows[1]![0]).toMatchObject({ continued: true, endsHere: true });
    const bad = layoutTable([row(cellOf("A", { colspan: "x" as never, rowspan: -2 }), cellOf("B"))]);
    expect(bad.cols).toBe(2);
  });
});

describe("perkiraan tinggi blok (murni)", () => {
  it("paragraf pendek dijaga utuh; ±5.000 karakter tidak", () => {
    expect(keepsTogether(estimateBlock(para("Paragraf pendek."), 480))).toBe(true);
    expect(longText(45).length).toBeGreaterThan(4900);
    expect(keepsTogether(estimateBlock(para(longText(45)), 480))).toBe(false);
  });
  it("baris tabel dengan sel sangat panjang diperkirakan tinggi; baris biasa pendek", () => {
    const t = tbl([row(cellOf("a"), cellOf("b")), row(cellOf(longText(30)), cellOf("c"))]);
    const [h1, h2] = estimateTableRows(t, 480);
    expect(keepsTogether(h1!)).toBe(true);
    expect(keepsTogether(h2!)).toBe(false);
    expect(KEEP_MAX).toBeGreaterThan(300);
  });
  it("sel gabungan memakai lebar semua kolom yang dicakup (lebih sedikit baris = lebih pendek)", () => {
    const text = "kata ".repeat(120);
    const narrow = estimateTableRows(tbl([row(cellOf(text), cellOf("x"), cellOf("y"), cellOf("z"))]), 480)[0]!;
    const wide = estimateTableRows(tbl([row(cellOf(text, { colspan: 4 }))]), 480)[0]!;
    expect(wide).toBeLessThan(narrow);
  });
});

describe("splitTail (satuan terakhir yang dijaga bersama tanda tangan)", () => {
  it("daftar berbutir: hanya butir terakhir; nomor lanjutan dipertahankan lewat `start`", () => {
    const list = ol([li("a"), li("b"), li("c")]);
    const { head, tail } = splitTail([para("p"), list]);
    expect(head[1]!.content).toHaveLength(2);
    expect(tail[0]!.content).toHaveLength(1);
    expect(tail[0]!.attrs?.start).toBe(3);
  });
  it("paragraf: paragraf terakhir; daftar satu butir dan tabel: seluruhnya", () => {
    expect(splitTail([para("a"), para("b")]).tail).toEqual([para("b")]);
    expect(splitTail([ol([li("a")])]).tail[0]!.content).toHaveLength(1);
    expect(splitTail([tbl([row(cellOf("a"))])]).tail[0]!.type).toBe("table");
  });
});

describe("lekukan baris pertama (editor ↔ PDF)", () => {
  it("paragraf menjorok: hanya baris pertamanya bergeser 1,25 cm; paragraf tanpa lekukan dan baris lanjutan mulai di margin", async () => {
    const f = await withBody([para("AKTIF " + longText(4), { firstLine: true, textAlign: "justify" }), para("NONAKTIF " + longText(4), { textAlign: "justify" })]);
    const { words } = pdfWords(await renderDocumentPdf(f));
    const find = (t: string) => words.find((w) => w.text === t)!;
    const lineStartX = (marker: string, nth: number) => { const m = find(marker); const lines = linesOf(words, m.page).filter((l) => l[0]!.y0 >= m.y0 - 2); return lines[nth]![0]!.x0; };
    expect(find("AKTIF").x0 - LEFT).toBeCloseTo(1.25 * 28.3465, 0);        // 35,4 pt
    expect(find("NONAKTIF").x0).toBeCloseTo(LEFT, 0);
    expect(lineStartX("AKTIF", 1)).toBeCloseTo(LEFT, 0);                  // baris ke-2 paragraf menjorok
    expect(lineStartX("NONAKTIF", 1)).toBeCloseTo(LEFT, 0);
  });
  it("lekukan tetap bekerja pada paragraf yang diawali tebal/miring (run pertama bukan teks polos) dan di dalam butir daftar", async () => {
    const boldFirst: PmNode = { type: "paragraph", attrs: { firstLine: true }, content: [{ type: "text", text: "TEBAL", marks: [{ type: "bold" }] }, { type: "text", text: " " + longText(3) }] };
    const f = await withBody([boldFirst, para("PLAIN " + longText(1))]);
    const { words } = pdfWords(await renderDocumentPdf(f));
    expect(words.find((w) => w.text === "TEBAL")!.x0 - LEFT).toBeCloseTo(1.25 * 28.3465, 0);
    expect(words.find((w) => w.text === "PLAIN")!.x0).toBeCloseTo(LEFT, 0);
  });
});

describe("tanda tangan banyak pihak tidak terpotong", () => {
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    it(`${n} penandatangan: semua nama tercetak tepat satu kali, di dalam kertas, tanpa saling menimpa`, async () => {
      const buf = await renderDocumentPdf(await withBody([para(longText(3))], n));
      const { text } = expectClean(buf, `${n} pihak`);
      for (let i = 1; i <= n; i++) expect(count(text, `Ke-${i},`), `nama ke-${i}`).toBe(1);
      expect(count(text, `Ke-${n + 1},`)).toBe(0);
    });
  }
  it("7 penandatangan melanjutkan ke halaman berikutnya antar BARIS (tidak ada kotak tanda tangan terbelah)", async () => {
    const { words, pages } = pdfWords(await renderDocumentPdf(await withBody([para(longText(3))], 7)));
    expect(pages.length).toBeGreaterThanOrEqual(2);
    // tiap pasangan (org, jabatan, nama) satu halaman: halaman "Jabatan Penandatangan i" == halaman "Ke-i,"
    for (let i = 1; i <= 7; i++) {
      const jab = words.find((w, k) => w.text === "Penandatangan" && words[k + 1]?.text === String(i) && words[k - 1]?.text === "Jabatan");
      const nama = words.find((w) => w.text === `Ke-${i},`);
      expect(jab?.page, `jabatan ${i}`).toBeDefined();
      expect(jab!.page, `nama ${i} satu halaman dengan jabatannya`).toBe(nama!.page);
    }
  });
  it("draf/penandatangan eksternal (ruang kosong tanpa gambar) juga tidak keluar halaman", async () => {
    const f = await withBody([para(longText(3))], 6);
    const buf = await renderDocumentPdf({ ...f, draft: true, signatories: f.signatories.map((s, i) => ({ ...s, external: i % 2 === 0 })) });
    expectClean(buf, "draf", ["D", "R", "A", "F"]);                              // huruf watermark "DRAF" memang menimpa isi
  });
});

describe("isi panjang mengalir antar halaman (tidak terpotong / bertumpuk dengan QR dan tanda tangan)", () => {
  const allPresent = (text: string, n: number) => { for (let i = 1; i <= n; i++) expect(count(text, `ke-${i}`), `kalimat ke-${i}`).toBe(1); };

  it("satu paragraf ±5.000 karakter: tidak ada kalimat hilang, tidak ada yang menimpa, QR dan tanda tangan tetap ada", async () => {
    expect(longText(45).length).toBeGreaterThan(4900);
    const { text, pages } = expectClean(await renderDocumentPdf(await withBody([para("Pembuka."), para(longText(45))], 2)), "5.000 karakter");
    allPresent(text, 45);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    expect(count(text, "Ke-1,")).toBe(1);
    expect(count(text, "Ke-2,")).toBe(1);
    expect(text).toContain("Dokumen ini");                                      // keterangan QR
  });
  it("paragraf ±12.000 karakter (tiga halaman) tetap utuh", async () => {
    const { text, pages } = expectClean(await renderDocumentPdf(await withBody([para(longText(110))], 1)), "12.000 karakter");
    allPresent(text, 110);
    expect(pages.length).toBeGreaterThanOrEqual(3);
  });
  it("butir daftar yang sangat panjang (lebih tinggi dari satu halaman; butir terakhir) tidak hilang dan tidak menimpa tanda tangan", async () => {
    const { text, pages } = expectClean(await renderDocumentPdf(await withBody([para("Pembuka."), ol([li("Butir pendek."), li(longText(75))])], 2)), "butir panjang");
    allPresent(text, 75);
    expect(pages.length).toBeGreaterThanOrEqual(2);
  });
  it("butir daftar panjang bukan yang terakhir (diikuti paragraf) juga mengalir", async () => {
    const { text } = expectClean(await renderDocumentPdf(await withBody([ol([li(longText(75)), li("Butir kedua.")]), para("Penutup singkat.")], 1)), "butir tengah");
    allPresent(text, 75);
  });
  it("baris tabel dengan sel sangat panjang mengalir (tidak terpotong)", async () => {
    const t = tbl([row(cellOf("Judul", {}, "tableHeader"), cellOf("Uraian", {}, "tableHeader")), row(cellOf("1"), cellOf(longText(75)))]);
    const { text } = expectClean(await renderDocumentPdf(await withBody([para("Pembuka."), t], 1)), "baris tabel panjang");
    allPresent(text, 75);
  });
  it("daftar diktum dengan butir terakhir panjang (SK) mengalir", async () => {
    const f = await frameSuratNarasumber();
    const dk: PmNode = { type: "diktumList", attrs: { autoStart: 0 }, content: [{ type: "diktumItem", content: [para("Singkat.")] }, { type: "diktumItem", content: [para(longText(75))] }] };
    const { text } = expectClean(await renderDocumentPdf({ ...f, body: doc(dk), signatories: await signers(1) }), "diktum panjang");
    allPresent(text, 75);
  });
  it("isi pendek tetap satu halaman: surat biasa dan tanda tangan tidak dipecah tanpa perlu", async () => {
    const { pages } = expectClean(await renderDocumentPdf(await withBody([para("Isi singkat."), para("Penutup singkat.")], 1)), "pendek");
    expect(pages).toHaveLength(1);
  });
  it("keterangan QR dan tanda tangan terakhir selalu satu halaman dengan paragraf terakhir bila ekor pendek (tanda tangan tidak sendirian)", async () => {
    // isi mengisi hampir satu halaman penuh; paragraf terakhir pendek + tanda tangan harus pindah BERSAMA
    const { words } = pdfWords(await renderDocumentPdf(await withBody([para(longText(21)), para("PARAGRAFAKHIR pendek.")], 1)));
    const last = words.find((w) => w.text === "PARAGRAFAKHIR")!;
    const name = words.find((w) => w.text === "Ke-1,")!;
    expect(name.page).toBe(last.page);
  });
});

describe("tabel dengan sel gabungan sampai tepi", () => {
  const rightEdges = (words: ReturnType<typeof pdfWords>["words"], token: string) => words.filter((w) => w.text === token).map((w) => w.x1);

  it("colspan pada kolom tak sama lebar: sel gabungan terakhir berakhir tepat di tepi kanan tabel (sama dengan sel kolom terakhir baris lain)", async () => {
    const t = tbl([
      row(cellOf("A", {}, "tableHeader"), cellOf("B", {}, "tableHeader"), cellOf("C", {}, "tableHeader"), cellOf("X", { align: "right" }, "tableHeader")),
      row(cellOf("Sel A dan B", { colspan: 2 }), cellOf("X", { colspan: 2, align: "right" })),
      row(cellOf("a"), cellOf("b"), cellOf("c"), cellOf("X", { align: "right" })),
    ], { colWidths: [10, 20, 30, 40] });
    const { words } = pdfWords(await renderDocumentPdf(await withBody([para("Contoh tabel dengan sel gabungan:"), t], 1)));
    const xs = rightEdges(words, "X");
    expect(xs).toHaveLength(3);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.6);               // ketiganya rata kanan di tepi yang sama
  });
  it("rowspan: sel di bawahnya bergeser benar (kolom B/C/D sejajar di semua baris)", async () => {
    const t = tbl([
      row(cellOf("Kolom1", {}, "tableHeader"), cellOf("KolomB", {}, "tableHeader"), cellOf("KolomC", {}, "tableHeader")),
      row(cellOf("Gabung", { rowspan: 2 }), cellOf("B2"), cellOf("C2")),
      row(cellOf("B3"), cellOf("C3")),
    ]);
    const { words } = pdfWords(await renderDocumentPdf(await withBody([t], 1)));
    const x = (tk: string) => words.find((w) => w.text === tk)!.x0;
    expect(x("B2")).toBeCloseTo(x("B3"), 0);
    expect(x("B2")).toBeCloseTo(x("KolomB"), 0);
    expect(x("C3")).toBeCloseTo(x("KolomC"), 0);
  });
  it("tabel bergerigi dan tabel dengan banyak kolom tidak keluar halaman", async () => {
    const wide = tbl([row(...Array.from({ length: 8 }, (_, i) => cellOf(`H${i}`, {}, "tableHeader"))), row(cellOf("a"), cellOf("b"))]);
    expectClean(await renderDocumentPdf(await withBody([wide], 1)), "tabel lebar");
  });
});

describe("total halaman pada berkas gabungan", () => {
  it("{total} menambahkan halaman lampiran PDF yang digabung (extraPages); tanpa lampiran tetap jumlah halaman surat", async () => {
    const f = await frameSuratNarasumber();
    expect(fullText(pdfWords(await renderDocumentPdf(f)).words)).toContain("Hal. 1 dari 1");
    expect(fullText(pdfWords(await renderDocumentPdf({ ...f, extraPages: 3 })).words)).toContain("Hal. 1 dari 4");
  });
  it("extraPages negatif/tidak sah tidak mengurangi total", async () => {
    const f = await frameSuratNarasumber();
    expect(fullText(pdfWords(await renderDocumentPdf({ ...f, extraPages: -5 })).words)).toContain("Hal. 1 dari 1");
  });
});
