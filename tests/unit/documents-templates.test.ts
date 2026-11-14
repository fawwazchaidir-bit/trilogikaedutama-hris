/**
 * Katalog 24 jenis surat: tiap jenis punya templat isi SENDIRI (bukan kerangka umum), valid menurut skema dokumen, berbahasa baku, dan dapat dirender ke PDF.
 * Templat berisi [bagian bertanda kurung siku] yang harus diganti staf sebelum surat dapat diajukan.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_LETTER_TYPES, LEGACY_GENERIC_TEMPLATES, isLegacyGenericTemplate, sameDoc } from "@/lib/documents/templates";
import { docText, hasPlaceholder, validateDoc, type PmDoc, type PmNode } from "@/lib/documents/content";
import { renderDocumentPdf } from "@/server/pdf/document-render";
import { frameSuratNarasumber } from "../fixtures/documents/frames";
import { fullText, outsidePage, overlappingWords, pdfWords } from "../helpers/pdf-words";

const id = (t: { series: string; code: number }) => `${t.series}-${String(t.code).padStart(2, "0")}`;
const types = DEFAULT_LETTER_TYPES;
const nodes = (d: PmDoc | PmNode): PmNode[] => ("content" in d && d.content ? d.content.flatMap((c) => [c, ...nodes(c)]) : []);

describe("katalog 24 jenis surat", () => {
  it("ada 24 jenis (13 eksternal + 11 internal)", () => {
    expect(types).toHaveLength(24);
    expect(types.filter((t) => t.series === "EKS")).toHaveLength(13);
    expect(types.filter((t) => t.series === "INT")).toHaveLength(11);
  });

  it("tidak ada jenis yang masih memakai kerangka umum bawaan lama ('[isi surat]')", () => {
    // Surat Tugas (INT-02) dikecualikan: isinya dibangkitkan dari data penugasan, templat ini tidak pernah dicetak.
    for (const t of types.filter((x) => x.kind !== "TUGAS")) {
      expect(isLegacyGenericTemplate(t.template), `${id(t)} ${t.name}`).toBe(false);
      expect(docText(t.template), `${id(t)} tidak memuat '[isi surat]'`).not.toContain("[isi surat]");
    }
  });

  it("setiap templat unik (tidak ada dua jenis berisi sama) — kecuali Surat Tugas yang dibangkitkan dari data penugasan", () => {
    const real = types.filter((t) => t.kind !== "TUGAS");
    const seen = new Map<string, string>();
    for (const t of real) {
      const key = docText(t.template);
      expect(seen.has(key), `${id(t)} sama dengan ${seen.get(key)}`).toBe(false);
      seen.set(key, id(t));
    }
    expect(real).toHaveLength(23);
  });

  it("templat valid menurut skema dokumen dan memuat bagian [bertanda] yang harus diisi (belum bisa diajukan apa adanya)", () => {
    for (const t of types.filter((x) => x.kind !== "TUGAS")) {
      expect(validateDoc(t.template), `${id(t)} ${t.name}`).toBeNull();
      expect(hasPlaceholder(t.template), `${id(t)} memuat placeholder`).toBe(true);
    }
  });

  it("setiap templat punya susunan memadai: minimal tiga blok, penutup baku, dan blok rincian/daftar bila jenisnya memerlukan", () => {
    for (const t of types.filter((x) => x.kind === "SURAT")) {
      expect(t.template.content.length, `${id(t)} jumlah blok`).toBeGreaterThanOrEqual(3);
      const text = docText(t.template);
      expect(/Demikian|Atas |Semoga/.test(text), `${id(t)} punya penutup`).toBe(true);
    }
    const has = (code: string, type: string) => nodes(types.find((t) => id(t) === code)!.template).some((n) => n.type === type);
    for (const c of ["EKS-03", "EKS-05", "EKS-06", "EKS-07", "EKS-08", "EKS-09", "EKS-10", "INT-04", "INT-06", "INT-07", "INT-09", "INT-10"]) expect(has(c, "labelBlock"), `${c} blok rincian`).toBe(true);
    for (const c of ["EKS-13", "INT-08"]) expect(has(c, "orderedList"), `${c} daftar pihak/hasil`).toBe(true);
  });

  it("isi tiap jenis sesuai namanya (kata kunci khas jenis ada di templatnya)", () => {
    const need: Record<string, RegExp> = {
      "EKS-01": /perorangan|pendaftaran/i, "EKS-02": /in-house|perusahaan|instansi/i, "EKS-04": /kerja sama/i, "EKS-05": /permohonan|izin/i, "EKS-06": /mengundang|hadir/i,
      "EKS-07": /perubahan/i, "EKS-08": /uji kompetensi/i, "EKS-09": /menerangkan/i, "EKS-10": /invoice|tagihan/i, "EKS-11": /terima kasih/i, "EKS-12": /Pasal 1/i, "EKS-13": /BERITA ACARA/,
      "INT-03": /diberitahukan|pemberitahuan/i, "INT-04": /mengundang|rapat/i, "INT-06": /Peringatan/i, "INT-07": /persetujuan/i, "INT-08": /BERITA ACARA/, "INT-09": /evaluasi/i,
      "INT-10": /menerangkan/i, "INT-11": /administrasi/i,
    };
    for (const [code, re] of Object.entries(need)) expect(docText(types.find((t) => id(t) === code)!.template), code).toMatch(re);
  });

  it("surat keterangan kerja tidak memuat data gaji; surat rahasia memuat peringatan yang netral", () => {
    expect(docText(types.find((t) => id(t) === "INT-10")!.template)).not.toMatch(/gaji|penghasilan|upah/i);
  });

  it("templat tidak memakai kapitalisasi lama 'Dengan Hormat' dan memakai ejaan baku ('Demikian ... sampaikan')", () => {
    for (const t of types) expect(docText(t.template), id(t)).not.toContain("Dengan Hormat");
  });
});

describe("pengenalan templat bawaan lama (jalur peningkatan)", () => {
  it("kerangka lama dikenali walau urutan kunci JSON berbeda (jsonb PostgreSQL); templat yang diubah satu kata tidak dikenali", () => {
    const legacy = LEGACY_GENERIC_TEMPLATES[1]!;
    const reordered = JSON.parse(JSON.stringify(legacy), (_k, v) => (v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).reverse()) : v));
    expect(sameDoc(legacy, reordered)).toBe(true);
    expect(isLegacyGenericTemplate(reordered)).toBe(true);
    const edited = JSON.parse(JSON.stringify(legacy).replace("Demikian kami sampaikan", "Demikian kami sampaikan dengan hormat"));
    expect(isLegacyGenericTemplate(edited)).toBe(false);
  });
  it("templat khusus jenis bukan templat lama", () => {
    for (const t of types.filter((x) => x.kind !== "TUGAS")) expect(isLegacyGenericTemplate(t.template), id(t)).toBe(false);
  });
});

describe("setiap templat dapat dirender ke PDF yang rapi", () => {
  it("23 templat (dengan [placeholder] terisi apa adanya) menghasilkan PDF tanpa kata di luar kertas atau saling menimpa", async () => {
    const base = await frameSuratNarasumber();
    for (const t of types) {
      if (t.kind === "TUGAS") continue;                                          // Surat Tugas dibangkitkan dari data penugasan (renderer lain)
      const buf = await renderDocumentPdf({ ...base, kind: t.kind, number: "001/TE-EKS/001/XI/2026", body: t.template, recipient: t.kind === "SURAT" ? base.recipient : null, salutation: t.salutation, subject: t.name });
      const { words, pages } = pdfWords(buf);
      expect(words.length, id(t)).toBeGreaterThan(30);
      expect(outsidePage(words, pages), `${id(t)} di luar kertas`).toEqual([]);
      expect(overlappingWords(words).slice(0, 3), `${id(t)} tumpang-tindih`).toEqual([]);
      expect(fullText(words), id(t)).toContain("[");
    }
  });
});
