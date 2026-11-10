import { z } from "zod";

/**
 * MODEL ISI DOKUMEN (persuratan) — JSON terstruktur bergaya ProseMirror. Tidak pernah menyimpan atau merender HTML.
 * Editor (TipTap) menghasilkan JSON ini; renderer PDF membacanya; validator di bawah menolak node/atribut di luar daftar.
 * Rancangan: dokumen "Rancangan Teknis Modul Persuratan" §9.
 */

export const NODE_TYPES = [
  "paragraph", "heading", "bulletList", "orderedList", "listItem",
  "labelBlock", "labelRow", "diktumList", "diktumItem",
  "table", "tableRow", "tableCell", "tableHeader",
  "optionalBlock", "pageBreak", "hardBreak", "text", "variable",
] as const;
export type NodeType = (typeof NODE_TYPES)[number];

export const MARK_TYPES = ["bold", "italic", "underline"] as const;

export interface PmMark { type: (typeof MARK_TYPES)[number] }
export interface PmNode {
  type: NodeType;
  attrs?: Record<string, unknown>;
  content?: PmNode[];
  marks?: PmMark[];
  text?: string;
}
export interface PmDoc { type: "doc"; content: PmNode[] }

const MAX_NODES = 5000;
const MAX_DEPTH = 12;
const MAX_TEXT = 20_000;

const align = z.enum(["left", "center", "right", "justify"]);
const cm = z.number().min(0).max(10);
const attrSchemas: Partial<Record<NodeType, z.ZodType>> = {
  paragraph: z.object({ textAlign: align.optional(), indent: cm.optional(), firstLine: z.boolean().optional(), spaceAfter: z.number().min(0).max(60).optional() }).strict(),
  heading: z.object({ level: z.number().int().min(1).max(3).optional(), textAlign: align.optional() }).strict(),
  orderedList: z.object({ style: z.enum(["decimal", "lower-alpha", "upper-alpha", "lower-roman"]).optional(), start: z.number().int().min(1).max(99).optional(), indent: cm.optional() }).strict(),
  bulletList: z.object({ indent: cm.optional() }).strict(),
  labelBlock: z.object({ labelWidth: z.number().min(1).max(8).optional(), indent: cm.optional() }).strict(),
  labelRow: z.object({ label: z.string().max(120) }).strict(),
  diktumList: z.object({ labelWidth: z.number().min(1).max(8).optional() }).strict(),
  /** `label` mengganti penomoran otomatis KESATU, KEDUA… (mis. "Menimbang", "Mengingat", "Menetapkan"). */
  diktumItem: z.object({ label: z.string().max(60).optional() }).strict(),
  table: z.object({ colWidths: z.array(z.number().min(1).max(100)).max(12).optional(), header: z.boolean().optional() }).strict(),
  tableCell: z.object({ colspan: z.number().int().min(1).max(12).nullish(), rowspan: z.number().int().min(1).max(50).nullish(), colwidth: z.array(z.number()).nullish() }).strict(),
  tableHeader: z.object({ colspan: z.number().int().min(1).max(12).nullish(), rowspan: z.number().int().min(1).max(50).nullish(), colwidth: z.array(z.number()).nullish() }).strict(),
  optionalBlock: z.object({ id: z.string().max(60), enabled: z.boolean() }).strict(),
  variable: z.object({ key: z.string().regex(/^[a-z][a-zA-Z0-9_.]{0,59}$/) }).strict(),
};

/** Bentuk kanonik untuk penyimpanan: buang atribut null/false/default yang ditambahkan editor (round-trip stabil, JSON ringkas). */
const DEFAULT_ATTRS: Record<string, unknown> = { header: false, firstLine: false, style: "decimal", start: 1, textAlign: "left", labelWidth: null };
export function normalizeDoc<T extends PmDoc | PmNode>(node: T): T {
  const out: PmNode = { ...(node as PmNode) };
  if (out.attrs) {
    const kept = Object.fromEntries(Object.entries(out.attrs).filter(([k, v]) => {
      if (v === null || v === undefined) return false;
      if (k in DEFAULT_ATTRS && v === DEFAULT_ATTRS[k]) return false;
      if ((k === "colspan" || k === "rowspan") && v === 1) return false;
      if (k === "level" && out.type === "heading" && v === 3) return false;
      return true;
    }));
    if (Object.keys(kept).length) out.attrs = kept; else delete out.attrs;
  }
  if (out.content) out.content = out.content.map((c) => normalizeDoc(c));
  return out as T;
}

/** Validasi bentuk dokumen: hanya node/atribut/mark yang dikenal, kedalaman dan ukuran dibatasi. Mengembalikan galat pertama atau null. */
export function validateDoc(doc: unknown): string | null {
  if (!doc || typeof doc !== "object" || (doc as PmDoc).type !== "doc" || !Array.isArray((doc as PmDoc).content)) return "Dokumen harus berupa {type:'doc', content:[…]}.";
  let count = 0;
  const walk = (n: unknown, depth: number): string | null => {
    if (!n || typeof n !== "object") return "Node tidak valid.";
    const node = n as PmNode;
    if (++count > MAX_NODES) return "Dokumen terlalu besar.";
    if (depth > MAX_DEPTH) return "Dokumen terlalu dalam.";
    if (!(NODE_TYPES as readonly string[]).includes(node.type)) return `Jenis node tidak diizinkan: ${String(node.type)}.`;
    if (node.type === "text") {
      if (typeof node.text !== "string" || node.text.length > MAX_TEXT) return "Teks tidak valid atau terlalu panjang.";
      for (const m of node.marks ?? []) if (!(MARK_TYPES as readonly string[]).includes(m?.type)) return `Mark tidak diizinkan: ${String(m?.type)}.`;
    }
    const schema = attrSchemas[node.type];
    if (schema) { const r = schema.safeParse(node.attrs ?? {}); if (!r.success) return `Atribut ${node.type} tidak valid: ${r.error.issues[0]?.message ?? ""}`; }
    else if (node.attrs && Object.keys(node.attrs).length) return `Node ${node.type} tidak memiliki atribut.`;
    for (const c of node.content ?? []) { const e = walk(c, depth + 1); if (e) return e; }
    return null;
  };
  for (const c of (doc as PmDoc).content) { const e = walk(c, 1); if (e) return e; }
  return null;
}

/** Ganti node `variable` dengan teks dari `values`. `missing` berisi kunci yang tidak terisi (memblokir pengajuan). */
export function resolveVariables(doc: PmDoc, values: Record<string, string>): { doc: PmDoc; missing: string[] } {
  const missing = new Set<string>();
  const walk = (n: PmNode): PmNode => {
    if (n.type === "variable") {
      const key = String(n.attrs?.key ?? "");
      const v = values[key];
      if (v === undefined || v === "") { missing.add(key); return { type: "text", text: `[${key}]` }; }
      return { type: "text", text: v, ...(n.marks ? { marks: n.marks } : {}) };
    }
    return n.content ? { ...n, content: n.content.map(walk) } : n;
  };
  return { doc: { type: "doc", content: doc.content.map(walk) }, missing: [...missing] };
}

/** Seluruh teks dokumen (untuk pemeriksaan isi, mis. sisa teks panduan [..]). */
export function docText(doc: PmDoc | PmNode): string {
  const parts: string[] = [];
  const walk = (n: PmNode) => { if (n.type === "text" && n.text) parts.push(n.text); for (const c of n.content ?? []) walk(c); };
  walk(doc as PmNode);
  return parts.join(" ");
}
/** Penanda teks panduan templat yang belum diganti: [seperti ini]. */
export const hasPlaceholder = (doc: PmDoc): boolean => /\[[^\]]{2,}\]/.test(docText(doc));
