/**
 * Surat Edaran (INT-005): jenis dengan layout sendiri (EDARAN) — judul "MEMO INTERNAL", Nomor, TENTANG + perihal disusun di kertas; tanpa blok Nomor/Perihal/Kepada,
 * salam, penutup, dan tanggal. Katalog master, templat awal, dan pembantu kind.
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_LETTER_TYPES } from "@/lib/documents/templates";
import { docText, hasPlaceholder, normalizeDoc, validateDoc, resolveVariables, type PmNode } from "@/lib/documents/content";
import { hasRecipientBlock, letterKind } from "@/lib/documents/policy";

const edaran = DEFAULT_LETTER_TYPES.find((t) => t.series === "INT" && t.code === 5)!;
const walk = (n: PmNode, f: (x: PmNode) => void) => { f(n); for (const c of n.content ?? []) walk(c, f); };

describe("katalog: Surat Edaran", () => {
  it("INT-005 berjenis EDARAN tanpa salam/penutup; tidak ada jenis lain yang berlayout EDARAN", () => {
    expect(edaran.name).toBe("Surat edaran (internal)");
    expect(edaran.kind).toBe("EDARAN");
    expect(edaran.salutation).toBeNull();
    expect(edaran.closing).toBeNull();
    expect(DEFAULT_LETTER_TYPES.filter((t) => t.kind === "EDARAN").map((t) => `${t.series}-${t.code}`)).toEqual(["INT-5"]);
  });
  it("templat awal valid dan menyusun judul seperti contoh: MEMO INTERNAL (tebal bergaris bawah) → Nomor → TENTANG → {{perihal}} tebal", () => {
    expect(validateDoc(edaran.template)).toBeNull();
    expect(normalizeDoc(edaran.template)).toEqual(edaran.template); // round-trip editor stabil
    const [title, nomor, tentang, perihal] = edaran.template.content;
    expect(docText(title!)).toBe("MEMO INTERNAL");
    const t0 = title!.content![0]!;
    expect(t0.marks?.map((m) => m.type).sort()).toEqual(["bold", "underline"]);
    expect(title!.attrs).toMatchObject({ textAlign: "center" });
    expect(nomor!.content!.map((c) => (c.type === "variable" ? `{{${c.attrs!.key}}}` : c.text)).join("")).toBe("Nomor : {{nomor}}");
    expect(docText(tentang!)).toBe("TENTANG");
    expect(perihal!.content).toEqual([{ type: "variable", attrs: { key: "perihal" }, marks: [{ type: "bold" }] }]);
  });
  it("templat berisi dua daftar bernomor (indent kecil seperti contoh), paragraf rata kiri-kanan tanpa menjorok, dan petunjuk [..] yang wajib diganti sebelum diajukan", () => {
    const lists: PmNode[] = [], paras: PmNode[] = [];
    for (const n of edaran.template.content) { if (n.type === "orderedList") lists.push(n); if (n.type === "paragraph" && n.attrs?.textAlign === "justify") paras.push(n); }
    expect(lists).toHaveLength(2);
    for (const l of lists) expect(l.attrs).toMatchObject({ indent: 0.4 });
    expect(paras.length).toBeGreaterThanOrEqual(3);
    for (const p of paras) expect(p.attrs?.firstLine).toBeUndefined();
    expect(hasPlaceholder(edaran.template)).toBe(true);
  });
  it("variabel templat HANYA nomor dan perihal (keduanya bawaan: tidak ada isian yang tertinggal)", () => {
    const keys = new Set<string>();
    for (const n of edaran.template.content) walk(n, (x) => { if (x.type === "variable") keys.add(String(x.attrs?.key)); });
    expect([...keys].sort()).toEqual(["nomor", "perihal"]);
    const r = resolveVariables(edaran.template, { nomor: "001/TE-INT/005/II/2026", perihal: "PENYESUAIAN JAM KERJA" });
    expect(r.missing).toEqual([]);
    expect(docText(r.doc)).toMatch(/Nomor :\s+001\/TE-INT\/005\/II\/2026/);
    expect(docText(r.doc)).toContain("PENYESUAIAN JAM KERJA");
    expect(resolveVariables(edaran.template, { nomor: "x" }).missing).toEqual(["perihal"]); // perihal kosong → memblokir pengajuan
  });
});

describe("pembantu kind", () => {
  it("letterKind: nilai tak dikenal jatuh ke SURAT; blok penerima hanya untuk SURAT", () => {
    expect(letterKind("EDARAN")).toBe("EDARAN");
    expect(letterKind("SK")).toBe("SK");
    expect(letterKind("TUGAS")).toBe("TUGAS");
    expect(letterKind("SURAT")).toBe("SURAT");
    expect(letterKind("apa-saja")).toBe("SURAT");
    expect(hasRecipientBlock("SURAT")).toBe(true);
    for (const k of ["SK", "TUGAS", "EDARAN"] as const) expect(hasRecipientBlock(k), k).toBe(false);
  });
});
