"use client";
import { useState } from "react";
import { Pencil, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/card";
import { TextAreaField, TextField } from "@/components/ui/field";
import { api } from "@/lib/api-client";
import { formatDateShort, formatDateTime } from "@/lib/format";
import { BANNER_BODY_MAX, BANNER_TITLE_MAX } from "@/lib/validation/portal";
import { useRunner } from "@/components/training/use-runner";
import type { BannerDto, BannerHistoryDto } from "@/server/services/announcement";

/** Ubah pesan banner beranda — hanya dirender untuk Direktur (Super Admin); server tetap menegakkan izin. */
export function AnnouncementEditor({ banner, history }: { banner: BannerDto; history: BannerHistoryDto[] }) {
  const { busy, error, fieldErrors, run, reset } = useRunner();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState(banner.title);
  const [body, setBody] = useState(banner.body ?? "");
  const [expiresAt, setExpiresAt] = useState(banner.expiresAt ?? "");
  const [notify, setNotify] = useState(false);

  const openDialog = () => { reset(); setTitle(banner.title); setBody(banner.body ?? ""); setExpiresAt(banner.expiresAt ?? ""); setNotify(false); setOpen(true); };
  const save = () => void run(
    () => api<{ notified: number }>("/api/portal/announcement", { method: "PUT", body: { title, body, expiresAt: expiresAt || null, notify } }),
    "Pesan banner diperbarui.", () => setOpen(false),
  );

  return (
    <>
      <button type="button" onClick={openDialog} className="inline-flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium text-white ring-1 ring-white/30 transition-colors hover:bg-white/25">
        <Pencil className="size-4" aria-hidden />Ubah pesan banner
      </button>
      <Dialog
        open={open} onClose={() => !busy && setOpen(false)} size="lg" title="Pesan banner beranda"
        description="Tampil di beranda seluruh karyawan sebagai teks biasa. Hanya Direktur yang dapat mengubahnya."
        footer={<>
          <Button onClick={() => setOpen(false)} disabled={busy}>Batal</Button>
          <Button variant="danger" disabled={busy || banner.isDefault} onClick={() => void run(() => api("/api/portal/announcement", { method: "DELETE" }), "Banner dikembalikan ke teks bawaan.", () => setOpen(false))}><RotateCcw className="size-4" />Kembalikan ke bawaan</Button>
          <Button variant="primary" loading={busy} disabled={title.trim().length < 3} onClick={save}>{notify ? "Simpan & kirim notifikasi" : "Simpan"}</Button>
        </>}
      >
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <TextField label="Judul pesan" required maxLength={BANNER_TITLE_MAX} value={title} onChange={(e) => setTitle(e.target.value)} error={fieldErrors.title} hint={`${title.length}/${BANNER_TITLE_MAX} karakter`} />
          <TextAreaField label="Isi pesan (opsional)" rows={4} maxLength={BANNER_BODY_MAX} value={body} onChange={(e) => setBody(e.target.value)} error={fieldErrors.body} hint={`${body.length}/${BANNER_BODY_MAX} karakter. Baris baru dipertahankan.`} />
          <TextField label="Tampil sampai (opsional)" type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} error={fieldErrors.expiresAt} hint="Setelah tanggal ini banner kembali ke teks bawaan. Kosong = sampai diganti." />
          <label className="flex items-start gap-2 rounded-lg border border-line bg-canvas p-3 text-sm">
            <input type="checkbox" className="mt-0.5 size-4 rounded border-line" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            <span><span className="font-medium text-ink">Kirim juga sebagai notifikasi ke seluruh karyawan</span>
              <span className="block text-xs text-muted">Masuk ke lonceng notifikasi semua akun aktif. Email/WhatsApp hanya terkirim bagi yang sudah memilih saluran itu dan bila dikonfigurasi. Tidak dapat ditarik kembali; jeda minimal 10 menit antar pesan broadcast.</span></span>
          </label>
          {history.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium text-ink">Riwayat pesan</p>
              <ul className="max-h-40 divide-y divide-line overflow-y-auto rounded-lg border border-line text-sm">
                {history.map((h) => (
                  <li key={h.id} className="px-3 py-2">
                    <p className="font-medium text-ink">{h.active ? h.title : "Dikembalikan ke teks bawaan"}</p>
                    <p className="text-xs text-muted">{h.byName ?? "—"} · {formatDateTime(h.at)}{h.active && h.expiresAt ? ` · sampai ${formatDateShort(h.expiresAt)}` : ""}{h.notifiedCount ? ` · notifikasi ke ${h.notifiedCount} akun` : ""}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Dialog>
    </>
  );
}
