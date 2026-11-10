"use client";
import { useRef, useState } from "react";
import { FilePlus2, FileUp, Paperclip, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api-client";
import type { AttachmentDto } from "@/server/services/letters/attachments";

const KIND: Record<AttachmentDto["kind"], string> = { EDITOR: "Disusun di editor", UPLOAD_MERGED: "PDF digabung ke surat", UPLOAD_SEPARATE: "PDF terpisah" };
const kb = (n: number | null) => (n == null ? "" : n > 1_048_576 ? `${(n / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Daftar & pengelola lampiran surat: tambah lampiran editor, unggah PDF buatan luar sistem (digabung atau terpisah), ganti mode, hapus. */
export function AttachmentsPanel({ letterId, items, editable, onChange, onOpen }: { letterId: string; items: AttachmentDto[]; editable: boolean; onChange: (l: AttachmentDto[]) => void; onOpen: (id: string) => void }) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(""); const [mode, setMode] = useState<"MERGED" | "SEPARATE">("MERGED"); const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  const addEditor = () => run(async () => { const a = await api<AttachmentDto>(`/api/letters/${letterId}/attachments`, { body: { title: title.trim() || `Lampiran ${items.length + 1}` } }); onChange([...items, a]); setTitle(""); onOpen(a.id); });
  const upload = (f: File | undefined) => { if (!f) return; void run(async () => { const form = new FormData(); form.set("file", f); form.set("title", title.trim() || f.name.replace(/\.pdf$/i, "")); form.set("mode", mode); const a = await api<AttachmentDto>(`/api/letters/${letterId}/attachments`, { method: "POST", form }); onChange([...items, a]); setTitle(""); if (fileRef.current) fileRef.current.value = ""; }); };
  const setKind = (a: AttachmentDto, m: "MERGED" | "SEPARATE") => run(async () => { const n = await api<AttachmentDto>(`/api/letters/${letterId}/attachments/${a.id}`, { method: "PATCH", body: { mode: m } }); onChange(items.map((x) => (x.id === a.id ? n : x))); });
  const remove = (a: AttachmentDto) => run(async () => { await api(`/api/letters/${letterId}/attachments/${a.id}`, { method: "DELETE" }); onChange(items.filter((x) => x.id !== a.id)); });

  return (
    <fieldset className="space-y-2 rounded-lg border border-line p-2.5">
      <legend className="flex items-center gap-1 px-1 text-xs font-semibold text-ink-soft"><Paperclip className="size-3.5" />Lampiran ({items.length})</legend>
      {items.length === 0 && <p className="text-xs text-muted">Belum ada lampiran. Lampiran dapat disusun di editor, atau PDF yang dibuat di luar sistem.</p>}
      {items.map((a) => (
        <div key={a.id} className="rounded-md bg-canvas p-2 text-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-medium text-ink">{a.title}</p>
              <p className="text-xs text-muted">{KIND[a.kind]}{a.pages ? ` · ${a.pages} hlm` : ""}{a.size ? ` · ${kb(a.size)}` : ""}</p>
              {a.sha256 && <p className="mt-0.5 break-all font-mono text-[10px] text-ink-soft" title="SHA-256 berkas lampiran">{a.sha256.slice(0, 24)}…</p>}
            </div>
            {editable && <button type="button" aria-label={`Hapus lampiran ${a.title}`} disabled={busy} onClick={() => void remove(a)} className="rounded-md p-1.5 text-muted hover:bg-black/5"><Trash2 className="size-4" /></button>}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {a.kind === "EDITOR" && <Button size="sm" onClick={() => onOpen(a.id)}>{editable ? "Sunting isi" : "Lihat isi"}</Button>}
            {editable && a.kind !== "EDITOR" && <Button size="sm" disabled={busy} onClick={() => void setKind(a, a.kind === "UPLOAD_MERGED" ? "SEPARATE" : "MERGED")}>{a.kind === "UPLOAD_MERGED" ? "Jadikan terpisah" : "Gabungkan ke surat"}</Button>}
          </div>
        </div>
      ))}
      {editable && items.length < 10 && (
        <div className="space-y-1.5 border-t border-line pt-2">
          <input aria-label="Judul lampiran" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Judul lampiran" className="h-8 w-full rounded-md border border-line bg-white px-2 text-sm" />
          <Button size="sm" disabled={busy} onClick={() => void addEditor()}><FilePlus2 className="size-3.5" />Lampiran dari editor</Button>
          <div className="rounded-md bg-canvas p-2">
            <p className="mb-1 text-xs font-medium text-ink-soft">Atau unggah PDF buatan luar sistem</p>
            <select aria-label="Mode lampiran PDF" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="mb-1.5 h-8 w-full rounded-md border border-line bg-white px-2 text-sm">
              <option value="MERGED">Gabungkan ke PDF surat (hash tunggal)</option>
              <option value="SEPARATE">Simpan terpisah (hash sendiri di halaman verifikasi)</option>
            </select>
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-canvas"><FileUp className="size-3.5" />Pilih PDF
              <input ref={fileRef} type="file" accept="application/pdf" aria-label="Unggah lampiran PDF" className="sr-only" disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
            </label>
          </div>
        </div>
      )}
    </fieldset>
  );
}
