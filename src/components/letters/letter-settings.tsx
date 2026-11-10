"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api-client";
import type { LetterSettingsDto } from "@/server/services/letters/admin";
import type { LetterTypeDto } from "@/server/services/letters/types";

type Holder = { userId: string; name: string; title: string | null; hasSignature: boolean };

export function LetterSettings({ settings, types, holders }: { settings: LetterSettingsDto; types: LetterTypeDto[]; holders: Holder[] }) {
  const router = useRouter(); const toast = useToast();
  const [s, setS] = useState({ place: settings.place, idLine: settings.idLine ?? "", footerText: settings.footerText ?? "", escalationDays: String(settings.escalationDays) });
  const [counter, setCounter] = useState({ series: "EKS", year: String(new Date().getFullYear()), lastSeq: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => { setBusy(key); try { await fn(); toast.success(ok); router.refresh(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); } };
  const upload = (url: string, f: File | undefined, key: string) => { if (!f) return; const form = new FormData(); form.set("file", f); void run(key, () => api(url, { method: "POST", form }), "Gambar tersimpan."); };
  const policy = (t: LetterTypeDto, patch: Record<string, unknown>) => run(`t${t.id}`, () => api(`/api/letters/types/${t.id}`, { method: "PATCH", body: patch }), "Kebijakan jenis surat diperbarui.");

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Kebijakan jenis surat" description="Menentukan siapa yang boleh menandatangani tiap jenis. Direktur selalu berwenang." />
        <ul className="divide-y divide-line">
          {types.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
              <div className="min-w-48 flex-1"><p className="font-medium text-ink">{t.name} <span className="font-mono text-xs text-muted">{t.series}-{t.codeText}</span></p><p className="text-xs text-muted">{t.description}</p></div>
              <label className="flex items-center gap-2"><input type="checkbox" checked={t.directorOnly} onChange={(e) => void policy(t, { directorOnly: e.target.checked })} />Hanya Direktur</label>
              <label className="flex items-center gap-2"><input type="checkbox" disabled={t.directorOnly} checked={t.signerJobLevels.includes("MANAGER")} onChange={(e) => void policy(t, { signerJobLevels: e.target.checked ? [...new Set([...t.signerJobLevels, "MANAGER"])] : t.signerJobLevels.filter((x) => x !== "MANAGER") })} />Manajer</label>
              <label className="flex items-center gap-2"><input type="checkbox" disabled={t.directorOnly} checked={t.signerJobLevels.includes("SUPERVISOR")} onChange={(e) => void policy(t, { signerJobLevels: e.target.checked ? [...new Set([...t.signerJobLevels, "SUPERVISOR"])] : t.signerJobLevels.filter((x) => x !== "SUPERVISOR") })} />Supervisor</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={t.internAllowed} onChange={(e) => void policy(t, { internAllowed: e.target.checked })} />Magang boleh membuat</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={t.isActive} onChange={(e) => void policy(t, { isActive: e.target.checked })} />Aktif</label>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Kop & eskalasi" description="Alamat, telepon, dan logo kop diambil dari Pengaturan lembaga." />
        <form className="grid gap-3 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void run("settings", () => api("/api/letters/settings", { method: "PATCH", body: { place: s.place, idLine: s.idLine || null, footerText: s.footerText || null, escalationDays: Number(s.escalationDays) } }), "Pengaturan disimpan."); }}>
          <TextField label="Kota penerbitan" value={s.place} onChange={(e) => setS({ ...s, place: e.target.value })} />
          <TextField label="Batas eskalasi (hari kerja)" type="number" min={1} max={30} value={s.escalationDays} onChange={(e) => setS({ ...s, escalationDays: e.target.value })} hint="Setelah ini Direktur boleh mengambil alih surat yang belum ditandatangani." />
          <TextField label="Baris identitas kop" value={s.idLine} onChange={(e) => setS({ ...s, idLine: e.target.value })} className="sm:col-span-2" placeholder="Vocational Identity Number: …" />
          <TextField label="Teks kaki halaman" value={s.footerText} onChange={(e) => setS({ ...s, footerText: e.target.value })} className="sm:col-span-2" />
          <div className="sm:col-span-2"><Button type="submit" variant="primary" loading={busy === "settings"}>Simpan</Button></div>
        </form>
      </Card>

      <Card>
        <CardHeader title="Cap & tanda tangan" description="PNG berlatar transparan disarankan. Gambar dipakai di PDF surat dan tidak tampil di halaman verifikasi." />
        <div className="space-y-3 p-4 text-sm">
          <div className="flex flex-wrap items-center gap-3"><span className="w-56 font-medium">Cap lembaga</span>{settings.stampUrl ? <span className="text-emerald-700">Terpasang</span> : <span className="text-muted">Belum ada</span>}
            <input type="file" accept="image/png,image/jpeg" aria-label="Unggah cap lembaga" onChange={(e) => upload("/api/letters/settings/stamp", e.target.files?.[0], "stamp")} />
            {settings.stampUrl && <Button size="sm" variant="danger" onClick={() => void run("stampdel", () => api("/api/letters/settings/stamp", { method: "DELETE" }), "Cap dicabut.")}>Cabut</Button>}</div>
          {holders.map((h) => (
            <div key={h.userId} className="flex flex-wrap items-center gap-3"><span className="w-56 font-medium">{h.name}<span className="block text-xs font-normal text-muted">{h.title}</span></span>
              {h.hasSignature ? <span className="text-emerald-700">Terpasang</span> : <span className="text-muted">Belum ada</span>}
              <input type="file" accept="image/png,image/jpeg" aria-label={`Unggah tanda tangan ${h.name}`} onChange={(e) => upload(`/api/letters/signers/${h.userId}/signature`, e.target.files?.[0], h.userId)} />
              {h.hasSignature && <Button size="sm" variant="danger" onClick={() => void run(`d${h.userId}`, () => api(`/api/letters/signers/${h.userId}/signature`, { method: "DELETE" }), "Tanda tangan dicabut.")}>Cabut</Button>}</div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title="Nomor urut" description="Nomor berikutnya = nomor terakhir + 1. Gunakan untuk melanjutkan register yang sudah berjalan; nomor tidak dapat diturunkan." />
        <div className="space-y-3 p-4">
          <ul className="flex flex-wrap gap-2 text-sm">{settings.counters.length === 0 ? <li className="text-muted">Belum ada nomor terbit.</li> : settings.counters.map((c) => <li key={`${c.series}${c.year}`} className="rounded-md border border-line bg-canvas px-3 py-1.5">TE-{c.series} {c.year}: terakhir <b>{String(c.lastSeq).padStart(3, "0")}</b></li>)}</ul>
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void run("counter", () => api("/api/letters/settings/counter", { body: { series: counter.series, year: Number(counter.year), lastSeq: Number(counter.lastSeq) } }), "Nomor urut diatur."); }}>
            <label className="text-sm">Seri<select className="mt-1 block h-10 rounded-md border border-line px-2" value={counter.series} onChange={(e) => setCounter({ ...counter, series: e.target.value })}><option value="EKS">TE-EKS</option><option value="INT">TE-INT</option></select></label>
            <TextField label="Tahun" type="number" value={counter.year} onChange={(e) => setCounter({ ...counter, year: e.target.value })} className="w-28" />
            <TextField label="Nomor terakhir terpakai" type="number" min={0} value={counter.lastSeq} onChange={(e) => setCounter({ ...counter, lastSeq: e.target.value })} className="w-44" required />
            <Button type="submit" variant="primary" loading={busy === "counter"}>Atur</Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
