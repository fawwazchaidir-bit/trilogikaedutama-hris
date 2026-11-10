import type { PmDoc, PmNode } from "./content";

/** Pembangun JSON dokumen yang ringkas (dipakai fixture, template bawaan, dan tes). */
export const t = (text: string, ...marks: ("bold" | "italic" | "underline")[]): PmNode => ({ type: "text", text, ...(marks.length ? { marks: marks.map((type) => ({ type })) } : {}) });
export const b = (text: string) => t(text, "bold");
export const i = (text: string) => t(text, "italic");
export const v = (key: string): PmNode => ({ type: "variable", attrs: { key } });
export const p = (content: (PmNode | string)[] | string, attrs: Record<string, unknown> = {}): PmNode => ({
  type: "paragraph", ...(Object.keys(attrs).length ? { attrs } : {}), content: (Array.isArray(content) ? content : [content]).map((c) => (typeof c === "string" ? t(c) : c)),
});
/** Paragraf isi: rata kiri-kanan, baris pertama menjorok (bawaan surat). */
export const body = (content: (PmNode | string)[] | string, extra: Record<string, unknown> = {}) => p(content, { textAlign: "justify", firstLine: true, ...extra });
export const center = (content: (PmNode | string)[] | string, extra: Record<string, unknown> = {}) => p(content, { textAlign: "center", ...extra });
export const li = (...c: (PmNode | string)[]): PmNode => ({ type: "listItem", content: c.map((x) => (typeof x === "string" ? p(x, { textAlign: "justify", spaceAfter: 0 }) : x)) });
export const ol = (items: PmNode[], attrs: Record<string, unknown> = {}): PmNode => ({ type: "orderedList", ...(Object.keys(attrs).length ? { attrs } : {}), content: items });
export const ul = (items: PmNode[], attrs: Record<string, unknown> = {}): PmNode => ({ type: "bulletList", ...(Object.keys(attrs).length ? { attrs } : {}), content: items });
export const row = (label: string, value: (PmNode | string)[] | string): PmNode => ({ type: "labelRow", attrs: { label }, content: (Array.isArray(value) ? value : [value]).map((c) => (typeof c === "string" ? t(c) : c)) });
export const labels = (rows: PmNode[], attrs: Record<string, unknown> = {}): PmNode => ({ type: "labelBlock", ...(Object.keys(attrs).length ? { attrs } : {}), content: rows });
/** Item diktum: tanpa label → KESATU, KEDUA… otomatis; dengan label → label itu (Menimbang, Mengingat, …). */
export const dk = (content: PmNode[], label?: string): PmNode => ({ type: "diktumItem", ...(label ? { attrs: { label } } : {}), content });
export const diktum = (items: PmNode[], attrs: Record<string, unknown> = {}): PmNode => ({ type: "diktumList", ...(Object.keys(attrs).length ? { attrs } : {}), content: items });
export const cell = (c: (PmNode | string)[] | string, attrs: Record<string, unknown> = {}): PmNode => {
  const { align, ...cellAttrs } = attrs;
  return { type: "tableCell", ...(Object.keys(cellAttrs).length ? { attrs: cellAttrs } : {}), content: [p(c, { textAlign: (align as string | undefined) ?? "left" })] };
};
export const th = (c: string): PmNode => ({ type: "tableHeader", content: [p([b(c)], { textAlign: "center" })] });
export const table = (head: string[], rows: (string | (PmNode | string)[])[][], colWidths?: number[]): PmNode => ({
  type: "table", attrs: { header: true, ...(colWidths ? { colWidths } : {}) },
  content: [{ type: "tableRow", content: head.map(th) }, ...rows.map((r) => ({ type: "tableRow", content: r.map((c) => cell(c as never)) } as PmNode))],
});
export const doc = (...content: PmNode[]): PmDoc => ({ type: "doc", content });
