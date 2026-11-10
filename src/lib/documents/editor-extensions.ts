import { mergeAttributes, Node, type Extensions } from "@tiptap/core";
import Paragraph from "@tiptap/extension-paragraph";
import Heading from "@tiptap/extension-heading";
import { OrderedList } from "@tiptap/extension-list";
import TextAlign from "@tiptap/extension-text-align";
import { Table, TableKit } from "@tiptap/extension-table";
import StarterKit from "@tiptap/starter-kit";

/**
 * Himpunan ekstensi TipTap untuk editor surat. SATU-SATUNYA sumber skema editor: `getSchema(documentExtensions)` harus
 * menerima persis JSON yang divalidasi `validateDoc` (tes: tests/unit/documents-editor.test.ts). Tidak ada HTML, link,
 * kode, kutipan, atau garis horizontal — hanya yang dapat dirender renderer PDF.
 */
const attr = <T,>(def: T) => ({ default: def });

const cmStyle = (v: unknown) => (typeof v === "number" ? { style: `margin-left:${v}cm` } : {});
const Para = Paragraph.extend({
  addAttributes() {
    return {
      indent: { default: null as number | null, renderHTML: (a: { indent?: number | null }) => cmStyle(a.indent) },
      firstLine: { default: false, renderHTML: (a: { firstLine?: boolean }) => (a.firstLine ? { "data-first-line": "" } : {}), parseHTML: (el: HTMLElement) => el.hasAttribute("data-first-line") },
      spaceAfter: { default: null as number | null, renderHTML: (a: { spaceAfter?: number | null }) => (typeof a.spaceAfter === "number" ? { style: `margin-bottom:${a.spaceAfter}pt` } : {}) },
    };
  },
});
const Head = Heading.extend({ addAttributes() { return { ...this.parent?.() }; } });
const OList = OrderedList.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: { default: "decimal", renderHTML: (a: { style?: string }) => ({ "data-list-style": a.style ?? "decimal" }), parseHTML: (el: HTMLElement) => el.getAttribute("data-list-style") ?? "decimal" },
      indent: { default: null as number | null, renderHTML: (a: { indent?: number | null }) => cmStyle(a.indent) },
    };
  },
});

const Tbl = Table.extend({
  addAttributes() { return { ...this.parent?.(), colWidths: attr<number[] | null>(null), header: attr(false) }; },
});

const LabelBlock = Node.create({
  name: "labelBlock", group: "block", content: "labelRow+", defining: true,
  addAttributes() { return { labelWidth: attr<number | null>(null), indent: { default: null as number | null, renderHTML: (a: { indent?: number | null }) => cmStyle(a.indent) } }; },
  parseHTML() { return [{ tag: "div[data-label-block]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-label-block": "" }), 0]; },
});
const LabelRow = Node.create({
  name: "labelRow", content: "inline*", defining: true,
  addAttributes() { return { label: { default: "", renderHTML: (a: { label?: string }) => ({ "data-label": a.label ?? "" }), parseHTML: (el: HTMLElement) => el.getAttribute("data-label") ?? "" } }; },
  parseHTML() { return [{ tag: "div[data-label-row]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-label-row": "" }), 0]; },
});
const DiktumList = Node.create({
  name: "diktumList", group: "block", content: "diktumItem+", defining: true,
  addAttributes() { return { labelWidth: attr<number | null>(null) }; },
  parseHTML() { return [{ tag: "div[data-diktum-list]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-diktum-list": "" }), 0]; },
});
const DiktumItem = Node.create({
  name: "diktumItem", content: "block+", defining: true,
  addAttributes() { return { label: { default: null as string | null, renderHTML: (a: { label?: string | null }) => (a.label ? { "data-label": a.label } : {}), parseHTML: (el: HTMLElement) => el.getAttribute("data-label") } }; },
  parseHTML() { return [{ tag: "div[data-diktum-item]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-diktum-item": "" }), 0]; },
});
const OptionalBlock = Node.create({
  name: "optionalBlock", group: "block", content: "block+", defining: true,
  addAttributes() { return { id: attr(""), enabled: attr(true) }; },
  parseHTML() { return [{ tag: "div[data-optional-block]" }]; },
  renderHTML({ HTMLAttributes }) { return ["div", mergeAttributes(HTMLAttributes, { "data-optional-block": "" }), 0]; },
});
const PageBreak = Node.create({
  name: "pageBreak", group: "block", atom: true, selectable: true,
  parseHTML() { return [{ tag: "div[data-page-break]" }]; },
  renderHTML() { return ["div", { "data-page-break": "" }]; },
});
/** Penampung data surat, mis. {{penerima.nama}} — diganti nilai saat dokumen diajukan. */
const Variable = Node.create({
  name: "variable", group: "inline", inline: true, atom: true,
  addAttributes() { return { key: attr("") }; },
  parseHTML() { return [{ tag: "span[data-variable]" }]; },
  renderHTML({ node, HTMLAttributes }) { return ["span", mergeAttributes(HTMLAttributes, { "data-variable": node.attrs.key }), `{{${node.attrs.key}}}`]; },
});

export const documentExtensions: Extensions = [
  StarterKit.configure({
    paragraph: false, heading: false, orderedList: false,
    blockquote: false, code: false, codeBlock: false, horizontalRule: false, strike: false, link: false,
    dropcursor: false, gapcursor: false, trailingNode: false,
  }),
  Para, Head, OList,
  TextAlign.configure({ types: ["paragraph", "heading"], alignments: ["left", "center", "right", "justify"] }),
  Tbl.configure({ resizable: false }),
  TableKit.configure({ table: false }),
  LabelBlock, LabelRow, DiktumList, DiktumItem, OptionalBlock, PageBreak, Variable,
];
