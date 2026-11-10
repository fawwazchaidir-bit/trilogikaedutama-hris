import { describe, expect, it } from "vitest";
import { attachmentText, dayDate, diktumLabel, formatDocNumber, listMarker, longDate, parseDocNumber, smallWords, timeRange } from "@/lib/documents/text";
import { resolveVariables, validateDoc } from "@/lib/documents/content";
import { body, doc, p, t, v } from "@/lib/documents/builders";

describe("nomor surat (format master Excel)", () => {
  it("001/TE-EKS/003/I/2026: urut/seri-jenis/kode/bulan romawi/tahun dari tanggal surat", () => {
    expect(formatDocNumber({ seq: 1, series: "EKS", typeCode: "003", date: "2026-01-15" })).toBe("001/TE-EKS/003/I/2026");
    expect(formatDocNumber({ seq: 47, series: "EKS", typeCode: "002", date: "2026-11-10" })).toBe("047/TE-EKS/002/XI/2026");
    expect(formatDocNumber({ seq: 1234, series: "INT", typeCode: "001", date: "2026-12-31" })).toBe("1234/TE-INT/001/XII/2026");
  });
  it("urai balik, dan tolak yang tidak sesuai format", () => {
    expect(parseDocNumber("001/TE-EKS/003/I/2026")).toEqual({ seq: 1, series: "EKS", typeCode: "003", month: 1, year: 2026 });
    expect(parseDocNumber("02/TE-SK-PGT/X/2026")).toBeNull(); // seri SK lama dihentikan
    expect(parseDocNumber("001/TE-EKS/03/I/2026")).toBeNull();
    expect(() => formatDocNumber({ seq: 0, series: "EKS", typeCode: "003", date: "2026-01-01" })).toThrow();
    expect(() => formatDocNumber({ seq: 1, series: "EKS", typeCode: "3", date: "2026-01-01" })).toThrow();
  });
});

describe("teks Indonesia", () => {
  it("lampiran terbilang, tanggal dengan hari dihitung, rentang waktu", () => {
    expect(smallWords(1)).toBe("satu"); expect(smallWords(11)).toBe("sebelas"); expect(smallWords(25)).toBe("dua puluh lima"); expect(smallWords(100)).toBe("seratus"); expect(smallWords(215)).toBe("dua ratus lima belas");
    expect(attachmentText(1)).toBe("1 (satu) halaman"); expect(attachmentText(3, "berkas")).toBe("3 (tiga) berkas");
    expect(dayDate("2026-11-11")).toBe("Rabu, 11 November 2026"); expect(dayDate("2026-07-17")).toBe("Jumat, 17 Juli 2026");
    expect(longDate("2026-11-09", true)).toBe("09 November 2026"); expect(longDate("2026-11-09")).toBe("9 November 2026");
    expect(timeRange("09:00", "16:00")).toBe("09.00 – 16.00 WIB"); expect(timeRange("13:30", null, "WITA")).toBe("13.30 WITA");
  });
  it("label diktum dan penanda daftar", () => {
    expect([0, 1, 6].map(diktumLabel)).toEqual(["KESATU", "KEDUA", "KETUJUH"]);
    expect(listMarker("lower-alpha", 1)).toBe("a."); expect(listMarker("decimal", 12)).toBe("12."); expect(listMarker("lower-roman", 4)).toBe("iv."); expect(listMarker("upper-alpha", 2)).toBe("B.");
  });
});

describe("model isi dokumen", () => {
  it("menerima node yang dikenal dan menolak HTML/atribut/mark di luar daftar", () => {
    expect(validateDoc(doc(body(["Halo ", t("tebal", "bold")])))).toBeNull();
    expect(validateDoc({ type: "doc", content: [{ type: "script", content: [] }] })).toMatch(/tidak diizinkan/);
    expect(validateDoc({ type: "doc", content: [{ type: "paragraph", attrs: { onclick: "x" }, content: [] }] })).toMatch(/tidak valid/);
    expect(validateDoc({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "x", marks: [{ type: "link" }] }] }] })).toMatch(/Mark/);
    expect(validateDoc({ type: "doc", content: [{ type: "paragraph", attrs: { indent: 99 }, content: [] }] })).toMatch(/tidak valid/);
    expect(validateDoc("<p>html</p>")).toMatch(/harus berupa/);
  });
  it("membatasi kedalaman dan ukuran", () => {
    let n: unknown = { type: "text", text: "x" };
    for (let k = 0; k < 15; k++) n = { type: "optionalBlock", attrs: { id: "a", enabled: true }, content: [n] };
    expect(validateDoc({ type: "doc", content: [n] })).toMatch(/dalam/);
  });
  it("variabel diganti; yang kosong dilaporkan (memblokir pengajuan)", () => {
    const r = resolveVariables(doc(p(["Kepada ", v("klien.nama"), " di ", v("kota")])), { "klien.nama": "SPPG Contoh" });
    expect(r.missing).toEqual(["kota"]);
    expect(JSON.stringify(r.doc)).toContain("SPPG Contoh");
  });
});
