/**
 * Kaki halaman (footer): token, validasi teks, tata letak zona, pemetaan dari baris pengaturan. Murni.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_FOOTER, FOOTER_FONTS, FOOTER_FONT_KEYS, FOOTER_SIZE, FOOTER_TOKENS, footerFromRow, footerTextProblems, footerZones, isFooterFontKey, resolveFooterText, type FooterRow,
} from "@/lib/documents/footer";

const ctx = { page: 2, total: 5, number: "001/TE-EKS/003/XI/2026", date: "2026-11-09" };

describe("token kaki halaman", () => {
  it("mengganti {halaman}, {total}, {nomor}, {tanggal}; draf → \"(draf)\"", () => {
    expect(resolveFooterText("Hal. {halaman} dari {total}", ctx)).toBe("Hal. 2 dari 5");
    expect(resolveFooterText("{nomor} — {tanggal}", ctx)).toBe("001/TE-EKS/003/XI/2026 — 9 November 2026");
    expect(resolveFooterText("{nomor}", { ...ctx, number: null })).toBe("(draf)");
    expect(resolveFooterText("{halaman}/{halaman}", ctx)).toBe("2/2"); // token boleh berulang
    expect(resolveFooterText(null, ctx)).toBe("");
    expect(resolveFooterText("Teks biasa tanpa token", ctx)).toBe("Teks biasa tanpa token");
  });
  it("semua token yang dikenal terdaftar", () => {
    expect([...FOOTER_TOKENS]).toEqual(["halaman", "total", "nomor", "tanggal"]);
  });
  it("footerTextProblems: token salah ketik dan kurung tak berpasangan dilaporkan; teks sah/kosong → tanpa masalah", () => {
    expect(footerTextProblems("Hal. {halaman} dari {total}")).toEqual([]);
    expect(footerTextProblems("")).toEqual([]);
    expect(footerTextProblems(null)).toEqual([]);
    expect(footerTextProblems("Hal. {halamn}")).toEqual(["Token tidak dikenal: {halamn}"]);
    expect(footerTextProblems("{x} dan {y}")).toEqual(["Token tidak dikenal: {x}", "Token tidak dikenal: {y}"]);
    expect(footerTextProblems("Hal. {halaman")).toEqual(["Kurung kurawal tidak berpasangan"]);
    expect(footerTextProblems("tutup} saja")).toEqual(["Kurung kurawal tidak berpasangan"]);
    expect(footerTextProblems("{}")).toEqual(["Token tidak dikenal: {}"]);
  });
});

describe("tata letak zona", () => {
  it("zona kosong tidak dimuat; satu zona memakai seluruh lebar dengan perataan sesuai posisinya", () => {
    expect(footerZones({ left: null, center: null, right: null })).toEqual([]);
    expect(footerZones({ left: "  ", center: "", right: null })).toEqual([]);
    expect(footerZones({ left: null, center: "Tengah", right: null })).toEqual([{ key: "center", text: "Tengah", flex: 1, align: "center" }]);
    expect(footerZones({ left: "Kiri", center: null, right: null })[0]).toMatchObject({ key: "left", flex: 1, align: "left" });
  });
  it("beberapa zona: lebar sebanding panjang teks (teks pendek tidak memenuhi 1/3 lebar); urutan kiri → tengah → kanan", () => {
    const z = footerZones({ left: "Trilogika Edutama Training Institute Yogyakarta", center: null, right: "Hal. {halaman} dari {total}" });
    expect(z.map((x) => x.key)).toEqual(["left", "right"]);
    expect(z[0]!.flex).toBeGreaterThan(z[1]!.flex * 2);
    const all = footerZones({ left: "Kiri sekali", center: "Tengah sekali", right: "Kanan sekali" });
    expect(all.map((x) => x.align)).toEqual(["left", "center", "right"]);
  });
  it("teks pendek (mis. nomor halaman) tidak dipersempit oleh teks panjang di sebelahnya: tetap selebar teks alaminya; yang panjang menerima sisanya", () => {
    const z = footerZones({ left: "x".repeat(100), center: null, right: "Hal. {halaman} dari {total}", size: 14 });
    const right = z.find((x) => x.key === "right")!, left = z.find((x) => x.key === "left")!;
    expect(right.flex).toBeCloseTo("Hal. 99 dari 99".length * 14 * 0.55, 0); // 115,5 pt — cukup untuk satu baris
    expect(left.flex + right.flex).toBeCloseTo(595.28 - 2 * 56.69, 0); // seluruh lebar halaman terpakai
    // muat semua → lebar sebanding teks (tidak memenuhi 1/3 lebar)
    const fits = footerZones({ left: "Kiri", center: null, right: "Kanan lebih panjang", size: 8.5 });
    expect(fits[1]!.flex).toBeGreaterThan(fits[0]!.flex);
  });
  it("lebar dihitung dari teks CONTOH sehingga tidak bergantung pada halaman (zona tidak bergeser antar halaman)", () => {
    const a = footerZones({ left: "A", center: null, right: "Hal. {halaman} dari {total}" });
    const b = footerZones({ left: "A", center: null, right: "Hal. {halaman} dari {total}" });
    expect(a).toEqual(b);
  });
});

describe("pemetaan baris pengaturan → konfigurasi", () => {
  const row: FooterRow = {
    footerEnabled: true, footerText: "Kiri", footerCenter: "Tengah", footerRight: "Kanan", footerFont: "CALADEA", footerSize: 9, footerBold: true, footerItalic: false, footerUnderline: true,
    footerColor: "#112233", footerRule: true, footerFirstPage: false, footerAttachments: false,
  };
  it("menyalin nilai sah apa adanya", () => {
    expect(footerFromRow(row)).toEqual({ enabled: true, left: "Kiri", center: "Tengah", right: "Kanan", fontKey: "CALADEA", size: 9, bold: true, italic: false, underline: true, color: "#112233", rule: true, firstPage: false, attachments: false });
  });
  it("nilai tak sah jatuh ke bawaan / dibatasi, bukan melempar galat (PDF tidak boleh gagal karena kaki halaman)", () => {
    const f = footerFromRow({ ...row, footerFont: "COMIC_SANS", footerColor: "merah", footerSize: 99 });
    expect(f.fontKey).toBe(DEFAULT_FOOTER.fontKey);
    expect(f.color).toBe(DEFAULT_FOOTER.color);
    expect(f.size).toBe(FOOTER_SIZE.max);
    expect(footerFromRow({ ...row, footerSize: 1 }).size).toBe(FOOTER_SIZE.min);
    expect(footerFromRow({ ...row, footerSize: Number.NaN }).size).toBe(DEFAULT_FOOTER.size);
  });
  it("bawaan = tampilan lama: kanan \"Hal. X dari Y\", miring, 8,5 pt, abu-abu, Liberation Serif", () => {
    expect(DEFAULT_FOOTER).toMatchObject({ enabled: true, right: "Hal. {halaman} dari {total}", italic: true, bold: false, size: 8.5, color: "#444444", fontKey: "LIBERATION_SERIF", firstPage: true, attachments: true });
  });
});

describe("pilihan font", () => {
  it("empat keluarga tertanam; kunci dikenali; tiap keluarga punya label dan tumpukan CSS untuk pratinjau", () => {
    expect(FOOTER_FONT_KEYS).toEqual(["LIBERATION_SERIF", "LIBERATION_SANS", "CALADEA", "CARLITO"]);
    for (const k of FOOTER_FONT_KEYS) { expect(isFooterFontKey(k)).toBe(true); expect(FOOTER_FONTS[k].label.length).toBeGreaterThan(5); expect(FOOTER_FONTS[k].css).toContain(","); }
    expect(isFooterFontKey("COMIC_SANS")).toBe(false);
    expect(isFooterFontKey(undefined)).toBe(false);
  });
});
