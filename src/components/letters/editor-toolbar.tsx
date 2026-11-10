"use client";
import type { Editor } from "@tiptap/react";
import { useEditorState } from "@tiptap/react";
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Indent, Italic, List, ListOrdered, Redo2, Rows3, SeparatorHorizontal, Table2, Underline, Undo2, Columns3, Trash2, ListTree } from "lucide-react";
import { cn } from "@/lib/cn";

function Btn({ on, active, disabled, label, children }: { on: () => void; active?: boolean; disabled?: boolean; label: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={on} disabled={disabled} aria-label={label} title={label} aria-pressed={active}
      className={cn("inline-flex size-8 items-center justify-center rounded-md text-ink-soft transition-colors hover:bg-black/5 disabled:opacity-35", active && "bg-brand-100 text-brand-700")}>
      {children}
    </button>
  );
}
const Sep = () => <span className="mx-1 h-5 w-px bg-line" aria-hidden />;

/** Bilah alat editor. Hanya perintah yang dipahami skema dokumen (lihat lib/documents/editor-extensions). */
export function EditorToolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive("bold"), italic: e.isActive("italic"), underline: e.isActive("underline"),
      left: e.isActive({ textAlign: "left" }), center: e.isActive({ textAlign: "center" }), right: e.isActive({ textAlign: "right" }), justify: e.isActive({ textAlign: "justify" }),
      ul: e.isActive("bulletList"), ol: e.isActive("orderedList"), inTable: e.isActive("table"), firstLine: !!e.getAttributes("paragraph").firstLine,
      canUndo: e.can().undo(), canRedo: e.can().redo(), inLabel: e.isActive("labelRow"),
    }),
  });
  const c = () => editor.chain().focus();
  return (
    <div role="toolbar" aria-label="Pemformatan teks" className="flex flex-wrap items-center gap-0.5 border-b border-line bg-white px-2 py-1.5">
      <Btn label="Urungkan" on={() => c().undo().run()} disabled={!s.canUndo}><Undo2 className="size-4" /></Btn>
      <Btn label="Ulangi" on={() => c().redo().run()} disabled={!s.canRedo}><Redo2 className="size-4" /></Btn>
      <Sep />
      <Btn label="Tebal" active={s.bold} on={() => c().toggleBold().run()}><Bold className="size-4" /></Btn>
      <Btn label="Miring" active={s.italic} on={() => c().toggleItalic().run()}><Italic className="size-4" /></Btn>
      <Btn label="Garis bawah" active={s.underline} on={() => c().toggleUnderline().run()}><Underline className="size-4" /></Btn>
      <Sep />
      <Btn label="Rata kiri" active={s.left} on={() => c().setTextAlign("left").run()}><AlignLeft className="size-4" /></Btn>
      <Btn label="Rata tengah" active={s.center} on={() => c().setTextAlign("center").run()}><AlignCenter className="size-4" /></Btn>
      <Btn label="Rata kanan" active={s.right} on={() => c().setTextAlign("right").run()}><AlignRight className="size-4" /></Btn>
      <Btn label="Rata kiri-kanan" active={s.justify} on={() => c().setTextAlign("justify").run()}><AlignJustify className="size-4" /></Btn>
      <Btn label="Baris pertama menjorok" active={s.firstLine} on={() => c().updateAttributes("paragraph", { firstLine: !s.firstLine }).run()}><Indent className="size-4" /></Btn>
      <Sep />
      <Btn label="Daftar butir" active={s.ul} on={() => c().toggleBulletList().run()}><List className="size-4" /></Btn>
      <Btn label="Daftar bernomor" active={s.ol} on={() => c().toggleOrderedList().run()}><ListOrdered className="size-4" /></Btn>
      <Btn label="Blok rincian (Hari, tanggal / Waktu / Tempat)" on={() => c().insertContent({ type: "labelBlock", attrs: { indent: 1.25 }, content: [{ type: "labelRow", attrs: { label: "Hari, tanggal" } }, { type: "labelRow", attrs: { label: "Waktu" } }, { type: "labelRow", attrs: { label: "Tempat" } }] }).run()}><ListTree className="size-4" /></Btn>
      <Sep />
      <Btn label="Sisipkan tabel" on={() => c().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}><Table2 className="size-4" /></Btn>
      <Btn label="Tambah baris" disabled={!s.inTable} on={() => c().addRowAfter().run()}><Rows3 className="size-4" /></Btn>
      <Btn label="Tambah kolom" disabled={!s.inTable} on={() => c().addColumnAfter().run()}><Columns3 className="size-4" /></Btn>
      <Btn label="Hapus tabel" disabled={!s.inTable} on={() => c().deleteTable().run()}><Trash2 className="size-4" /></Btn>
      <Sep />
      <Btn label="Pemisah halaman" on={() => c().insertContent({ type: "pageBreak" }).run()}><SeparatorHorizontal className="size-4" /></Btn>
    </div>
  );
}
