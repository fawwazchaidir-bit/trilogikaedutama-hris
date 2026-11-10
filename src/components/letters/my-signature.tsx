"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api-client";

/** Unggah/cabut gambar tanda tangan pribadi (hanya calon penandatangan). Gambar hanya dapat dibuka pemilik & Direktur; dipakai pada PDF saat Anda menyetujui. */
export function MySignature({ has }: { has: boolean }) {
  const router = useRouter(); const toast = useToast();
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<unknown>, ok: string) { setBusy(true); try { await fn(); toast.success(ok); router.refresh(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } }
  return (
    <>
      <Button onClick={() => setOpen(true)}><PenLine className="size-4" />Tanda tangan saya{has ? "" : " (belum ada)"}</Button>
      <Dialog open={open} onClose={() => setOpen(false)} size="sm" title="Tanda tangan saya" description="Unggah gambar tanda tangan (PNG/JPG, latar putih atau transparan). Gambar hanya dapat Anda dan Direktur buka, dan muncul di PDF surat yang Anda tandatangani.">
        <div className="space-y-3 text-sm">
          <p>Status: {has ? <b className="text-emerald-700">Terpasang</b> : <b className="text-muted">Belum ada</b>}</p>
          <input type="file" accept="image/png,image/jpeg" aria-label="Unggah tanda tangan saya" disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; const form = new FormData(); form.set("file", f); void run(() => api("/api/letters/signers/me/signature", { method: "POST", form }), "Tanda tangan tersimpan."); }} />
          {has && <Button variant="danger" loading={busy} onClick={() => void run(() => api("/api/letters/signers/me/signature", { method: "DELETE" }), "Tanda tangan dicabut.")}>Cabut tanda tangan</Button>}
        </div>
      </Dialog>
    </>
  );
}
