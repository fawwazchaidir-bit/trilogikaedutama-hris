"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api-client";
import type { LetterSettingsDto } from "@/server/services/letters/admin";

/**
 * Kop surat (halaman pertama setiap surat): isi diambil dari Pengaturan → Lembaga (tagline, nama, alamat, email, telepon, website, logo) dan hanya dipratinjau di sini.
 * Yang dapat diatur di sini: garis di bawah kop — diadakan atau ditiadakan (jarak ke isi surat tetap sama).
 */
export function KopSettings({ kop, kopRule }: { kop: LetterSettingsDto["kop"]; kopRule: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [rule, setRule] = useState(kopRule);
  const [busy, setBusy] = useState<"save" | "preview" | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  async function save() {
    setBusy("save");
    try { await api("/api/letters/settings", { method: "PATCH", body: { kopRule: rule } }); toast.success("Pengaturan kop disimpan."); router.refresh(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  }
  async function preview() {
    setBusy("preview");
    try {
      const res = await fetch("/api/letters/settings/footer-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kopRule: rule }), credentials: "same-origin" });
      if (!res.ok) {
        let msg = "Pratinjau gagal dibuat.";
        try { msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg; } catch { /* bukan JSON */ }
        throw new Error(msg);
      }
      const url = URL.createObjectURL(await res.blob());
      setPdfUrl((old) => { if (old) URL.revokeObjectURL(old); return url; });
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); }
  }

  return (
    <Card>
      <CardHeader title="Kop surat" description="Dicetak di halaman pertama setiap surat. Isinya diambil dari Pengaturan → Lembaga: tagline, nama, alamat, lalu email, telepon, dan website di bawah alamat." />
      <div className="space-y-4 p-4">
        <div>
          <p className="mb-1 text-xs font-semibold text-ink-soft">Pratinjau cepat (perkiraan)</p>
          <div role="img" aria-label="Pratinjau kop surat" data-testid="kop-live-preview" className="rounded-md border border-line bg-white px-5 py-4" style={{ fontFamily: "Cambria, Caladea, Georgia, serif" }}>
            <div className="min-w-0" style={{ ...(rule ? { borderBottom: "2px solid #000", paddingBottom: 8 } : { paddingBottom: 9.5 }) }}>
              {kop.tagline ? <p className="text-[12pt] font-bold leading-tight">{kop.tagline}</p> : null}
              <p className="text-[14pt] font-bold leading-tight">{kop.name.toUpperCase()}</p>
              {kop.address ? <p className="text-[10pt] italic leading-tight">{kop.address}</p> : null}
              {kop.contactLine ? <p data-testid="kop-contact-line" className="text-[10pt] italic leading-tight">{kop.contactLine}</p> : null}
            </div>
          </div>
          {!kop.contactLine && (
            <p role="status" className="mt-2 text-xs text-amber-800">Email, telepon, dan website belum diisi, jadi baris kontak tidak tercetak. Lengkapi di <Link href="/pengaturan" className="font-medium underline">Pengaturan → Lembaga</Link>.</p>
          )}
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5 size-4" checked={rule} onChange={(e) => setRule(e.target.checked)} />
          <span><span className="font-medium text-ink">Tampilkan garis di bawah kop</span><span className="block text-xs text-muted">Bila dimatikan, garis hilang tetapi jarak ke isi surat tetap sama.</span></span>
        </label>

        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" loading={busy === "save"} disabled={rule === kopRule} onClick={() => void save()}>Simpan kop</Button>
          <Button loading={busy === "preview"} onClick={() => void preview()}>Pratinjau PDF</Button>
        </div>
        {pdfUrl && <iframe title="Pratinjau PDF kop surat" src={pdfUrl} className="h-[34rem] w-full max-w-2xl rounded-md border border-line bg-white" />}
      </div>
    </Card>
  );
}
