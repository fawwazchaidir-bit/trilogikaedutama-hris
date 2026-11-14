"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Paper } from "./paper";
import { Loader2, CheckCircle2, Clock } from "lucide-react";
import { api, errorMessage } from "@/lib/api-client";
import { documentExtensions } from "@/lib/documents/editor-extensions";
import { normalizeDoc, type PmDoc } from "@/lib/documents/content";
import { useToast } from "@/components/ui/toast";
import { EditorToolbar } from "./editor-toolbar";
import type { AttachmentDto } from "@/server/services/letters/attachments";

/** Editor satu lampiran (halaman lampiran di PDF). Simpan otomatis ke API lampiran. */
export function AttachmentEditor({ letterId, att, editable, onSaved }: { letterId: string; att: AttachmentDto; editable: boolean; onSaved: (a: AttachmentDto) => void }) {
  const toast = useToast();
  const [state, setState] = useState<"saved" | "dirty" | "saving" | "error">("saved");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);
  const save = useCallback(async () => {
    const ed = editorRef.current; if (!ed) return;
    setState("saving");
    try { onSaved(await api<AttachmentDto>(`/api/letters/${letterId}/attachments/${att.id}`, { method: "PATCH", body: { body: normalizeDoc(ed.getJSON() as PmDoc) } })); setState("saved"); }
    catch (e) { setState("error"); toast.error(errorMessage(e)); }
  }, [letterId, att.id, onSaved, toast]);
  const editor = useEditor({
    extensions: documentExtensions, content: att.body ?? undefined, editable, immediatelyRender: false,
    editorProps: { attributes: { "aria-label": `Isi lampiran ${att.title}`, role: "textbox", "aria-multiline": "true" } },
    onUpdate: ({ editor: e }) => { if (!e.isEditable) return; setState("dirty"); if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => { void save(); }, 1500); },
  });
  useEffect(() => { editorRef.current = editor; }, [editor]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <div>
      {editor && editable && <EditorToolbar editor={editor} />}
      <div className="max-h-[calc(100vh-18rem)] overflow-auto p-4 sm:p-6">
        {editable && <p className="mb-2 flex items-center gap-1.5 text-xs text-muted" role="status">{state === "saving" ? <><Loader2 className="size-3.5 animate-spin" />Menyimpan lampiran…</> : state === "dirty" ? <><Clock className="size-3.5" />Belum tersimpan</> : state === "error" ? "Gagal menyimpan" : <><CheckCircle2 className="size-3.5 text-emerald-600" />Lampiran tersimpan</>}</p>}
        <Paper layout="default">
          <p className="mb-3 text-center font-bold" style={{ fontSize: "13pt" }}>{att.title}</p>
          <EditorContent editor={editor} />
        </Paper>
      </div>
    </div>
  );
}
