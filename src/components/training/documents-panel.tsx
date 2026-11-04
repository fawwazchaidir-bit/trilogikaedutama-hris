"use client";
import { useRef, useState } from "react";
import { Download, EyeOff, Trash2, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { EmptyState, Notice } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/field";
import { api } from "@/lib/api-client";
import { formatDateShort } from "@/lib/format";
import { DOC_CATEGORIES, DOC_CATEGORY_LABEL, type DocCategory } from "@/lib/training/types";
import type { DocumentDto } from "@/server/services/training/operations";
import { formatBytes } from "./ui";
import { useRunner } from "./use-runner";

/**
 * Dokumen proyek. Berkas privat: diunduh lewat /api/files/:id yang memeriksa lingkup proyek pada SETIAP unduhan
 * (tidak ada URL publik). Format: PDF, PNG, JPEG (diverifikasi dari isi berkas).
 */
export function DocumentsPanel({ projectId, items, hiddenSensitive, canUpload, canManageParticipants, maxMb, editable }: {
  projectId: string; items: DocumentDto[]; hiddenSensitive: number; canUpload: boolean; canManageParticipants: boolean; maxMb: number; editable: boolean;
}) {
  const { busy, error, run, reset } = useRunner();
  const fileRef = useRef<HTMLInputElement>(null);
  const [meta, setMeta] = useState<{ category: DocCategory; title: string; note: string }>({ category: "OTHER", title: "", note: "" });
  const [remove, setRemove] = useState<DocumentDto | null>(null);
  const live = canUpload && editable;
  const categories = DOC_CATEGORIES.filter((c) => c !== "PARTICIPANT_DOC" || canManageParticipants);

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.set("file", file); form.set("category", meta.category); form.set("title", meta.title || file.name.replace(/\.[^.]+$/, "")); form.set("note", meta.note);
    await run(() => api(`/api/training/projects/${projectId}/documents`, { form }), "Dokumen diunggah.", () => { setMeta({ category: "OTHER", title: "", note: "" }); if (fileRef.current) fileRef.current.value = ""; });
  }

  return (
    <div className="space-y-4">
      {live && (
        <form onSubmit={(e) => void upload(e)} aria-label="Unggah dokumen" className="grid gap-3 rounded-lg border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
            <label htmlFor="doc-file" className="block text-sm font-medium text-ink-soft">Berkas <span className="text-brand-600" aria-hidden>*</span></label>
            <input id="doc-file" ref={fileRef} type="file" required accept="application/pdf,image/png,image/jpeg" className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-2 file:text-sm" />
            <p className="text-xs text-muted">PDF/PNG/JPEG, maks. {maxMb} MB.</p>
          </div>
          <SelectField label="Kategori" value={meta.category} onChange={(e) => setMeta({ ...meta, category: e.target.value as DocCategory })}>{categories.map((c) => <option key={c} value={c}>{DOC_CATEGORY_LABEL[c]}</option>)}</SelectField>
          <TextField label="Judul" maxLength={160} value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} hint="Kosong = nama berkas." />
          <div className="flex items-end"><Button type="submit" variant="primary" loading={busy}><Upload className="size-4" />Unggah</Button></div>
        </form>
      )}
      {error && <Notice tone="danger">{error}</Notice>}
      {hiddenSensitive > 0 && <Notice tone="info"><span className="inline-flex items-center gap-1.5"><EyeOff className="size-4" />{hiddenSensitive} dokumen peserta disembunyikan; hanya pengelola peserta yang dapat melihatnya.</span></Notice>}
      {items.length === 0 ? <EmptyState title="Belum ada dokumen" description={live ? "Unggah proposal, surat undangan, materi, daftar hadir, dokumentasi, atau laporan akhir." : "Belum ada dokumen pada proyek ini."} /> : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {items.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0"><p className="font-medium text-ink">{d.title} <Badge>{DOC_CATEGORY_LABEL[d.category]}</Badge></p>
                <p className="text-xs text-muted">{d.fileName} · {formatBytes(d.size)} · {d.uploadedByName ?? "—"} · {formatDateShort(d.createdAt)}{d.note ? ` · ${d.note}` : ""}</p></div>
              <div className="flex gap-2">
                <a href={`/api/files/${d.fileId}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-sm shadow-sm hover:bg-canvas" aria-label={`Unduh ${d.title}`}><Download className="size-3.5" />Unduh</a>
                {d.canDelete && editable && <Button size="sm" variant="danger" aria-label={`Hapus ${d.title}`} onClick={() => { reset(); setRemove(d); }}><Trash2 className="size-3.5" /></Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={remove !== null} onClose={() => setRemove(null)} loading={busy} tone="danger" title="Hapus dokumen?" confirmLabel="Ya, hapus"
        description="Dokumen disembunyikan dan tidak dapat diunduh lagi. Berkas dan jejaknya tetap tersimpan di sistem sesuai kebijakan retensi."
        onConfirm={() => remove && void run(() => api(`/api/training/documents/${remove.id}`, { method: "DELETE" }), "Dokumen dihapus.", () => setRemove(null))}><p className="text-sm font-medium">{remove?.title}</p></ConfirmDialog>
    </div>
  );
}
