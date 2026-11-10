"use client";
import { useRouter } from "next/navigation";
import { Fragment, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TableWrap } from "@/components/ui/table";
import { TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api-client";
import type { LetterSettingsDto } from "@/server/services/letters/admin";
import type { LetterTypeDto, SignerMatrixRow, SignerPerson } from "@/server/services/letters/types";

type Holder = { userId: string; name: string; title: string | null; hasSignature: boolean };

export function LetterSettings({ settings, types, holders, matrix }: { settings: LetterSettingsDto; types: LetterTypeDto[]; holders: Holder[]; matrix: { rows: SignerMatrixRow[]; people: SignerPerson[] } }) {
  const router = useRouter(); const toast = useToast();
  const [s, setS] = useState({ place: settings.place, idLine: settings.idLine ?? "", footerText: settings.footerText ?? "", escalationDays: String(settings.escalationDays), annualTarget: String(settings.annualTarget), products: settings.products.join("\n") });
  const [counter, setCounter] = useState({ series: "EKS", year: String(new Date().getFullYear()), lastSeq: "" });
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<unknown>, ok: string) => { setBusy(key); try { await fn(); toast.success(ok); router.refresh(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(null); } };
  const upload = (url: string, f: File | undefined, key: string) => { if (!f) return; const form = new FormData(); form.set("file", f); void run(key, () => api(url, { method: "POST", form }), "Gambar tersimpan."); };
  const policy = (t: LetterTypeDto, patch: Record<string, unknown>) => run(`t${t.id}`, () => api(`/api/letters/types/${t.id}`, { method: "PATCH", body: patch }), "Kebijakan jenis surat diperbarui.");

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Bagan hak tanda tangan" description="Siapa yang berwenang menandatangani tiap jenis surat. Direktur selalu berwenang. Centang = diizinkan; kolom 'Pemegang saat ini' dihitung dari tingkat jabatan & role akun yang sekarang berlaku." />
        <div className="flex flex-wrap gap-x-5 gap-y-1 border-b border-line px-4 py-2 text-xs text-muted" aria-label="Legenda">
          <span><b className="text-ink">Direktur</b> = Super Admin (selalu)</span><span><b className="text-ink">Manajer / Supervisor</b> = menurut tingkat jabatan karyawan</span><span><b className="text-ink">HR</b> = role Admin/HR</span><span><b className="text-ink">Magang</b> = boleh membuat draf (tidak pernah menandatangani)</span>
        </div>
        <TableWrap>
          <table className="w-full min-w-[60rem] text-sm">
            <thead className="bg-canvas text-xs uppercase tracking-wide text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 text-left">Jenis surat</th>
                <th scope="col" className="px-2 py-2 text-center">Direktur</th><th scope="col" className="px-2 py-2 text-center">Manajer</th><th scope="col" className="px-2 py-2 text-center">Supervisor</th><th scope="col" className="px-2 py-2 text-center">HR</th>
                <th scope="col" className="px-2 py-2 text-center">Magang buat</th><th scope="col" className="px-2 py-2 text-center">Aktif</th><th scope="col" className="px-4 py-2 text-left">Pemegang saat ini</th>
              </tr>
            </thead>
            <tbody>
              {(["EKS", "INT"] as const).map((series) => (
                <Fragment key={series}>
                  <tr className="bg-brand-50"><th scope="colgroup" colSpan={8} className="px-4 py-1.5 text-left text-xs font-semibold text-brand-800">{series === "EKS" ? "Surat Eksternal (TE-EKS)" : "Surat Internal (TE-INT)"}</th></tr>
                  {types.filter((t) => t.series === series).map((t) => {
                    const holders = matrix.rows.find((r) => r.typeId === t.id)?.holders ?? [];
                    const lock = t.directorOnly;
                    const Cb = ({ on, disabled, label, change }: { on: boolean; disabled?: boolean; label: string; change: (v: boolean) => void }) => (
                      <input type="checkbox" className="size-4 accent-[#8c1d2d]" aria-label={`${label} — ${t.name}`} checked={on} disabled={disabled || busy === `t${t.id}`} onChange={(e) => change(e.target.checked)} />
                    );
                    return (
                      <tr key={t.id} className="border-t border-line align-top hover:bg-canvas">
                        <th scope="row" className="px-4 py-2 text-left font-normal"><span className="font-medium text-ink">{t.name}</span> <span className="font-mono text-xs text-muted">{t.series}-{t.codeText}</span>
                          <span className="mt-0.5 flex flex-wrap gap-1">{t.confidential && <Badge tone="amber">Rahasia</Badge>}{t.multiSigner && <Badge tone="blue">Multi-penandatangan</Badge>}{t.funnel && <Badge tone="green">Corong</Badge>}{t.adminCreateOnly && <Badge>Dibuat HR/Direktur</Badge>}{t.hrCanView && <Badge>HR boleh melihat</Badge>}</span></th>
                        <td className="px-2 py-2 text-center"><input type="checkbox" className="size-4" checked disabled aria-label={`Direktur — ${t.name}`} /></td>
                        <td className="px-2 py-2 text-center"><Cb label="Manajer" on={!lock && t.signerJobLevels.includes("MANAGER")} disabled={lock} change={(v) => void policy(t, { signerJobLevels: v ? [...new Set([...t.signerJobLevels, "MANAGER"])] : t.signerJobLevels.filter((x) => x !== "MANAGER") })} /></td>
                        <td className="px-2 py-2 text-center"><Cb label="Supervisor" on={!lock && t.signerJobLevels.includes("SUPERVISOR")} disabled={lock} change={(v) => void policy(t, { signerJobLevels: v ? [...new Set([...t.signerJobLevels, "SUPERVISOR"])] : t.signerJobLevels.filter((x) => x !== "SUPERVISOR") })} /></td>
                        <td className="px-2 py-2 text-center"><Cb label="HR" on={!lock && t.hrCanSign} disabled={lock} change={(v) => void policy(t, { hrCanSign: v })} /></td>
                        <td className="px-2 py-2 text-center"><Cb label="Magang boleh membuat" on={t.internAllowed} change={(v) => void policy(t, { internAllowed: v })} /></td>
                        <td className="px-2 py-2 text-center"><Cb label="Aktif" on={t.isActive} change={(v) => void policy(t, { isActive: v })} /></td>
                        <td className="px-4 py-2">
                          <label className="mb-1 flex items-center gap-1.5 text-xs text-muted"><input type="checkbox" className="size-3.5" checked={t.directorOnly} disabled={busy === `t${t.id}`} onChange={(e) => void policy(t, { directorOnly: e.target.checked })} aria-label={`Hanya Direktur — ${t.name}`} />Hanya Direktur</label>
                          {!t.isActive ? <span className="text-xs text-muted">Nonaktif</span> : holders.length === 0 ? <span className="text-xs text-brand-700">Belum ada pemegang</span> : (
                            <ul className="flex flex-wrap gap-1">{holders.map((h) => <li key={h.userId} className="rounded-full bg-canvas px-2 py-0.5 text-xs text-ink-soft ring-1 ring-line" title={`${h.title ?? ""} · via ${h.via}`}>{h.name}<span className="ml-1 text-[10px] uppercase text-muted">{h.via === "DIREKTUR" ? "Dir" : h.via === "MANAJER" ? "Mgr" : h.via === "SUPERVISOR" ? "Spv" : "HR"}</span></li>)}</ul>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </TableWrap>
      </Card>

      <Card>
        <CardHeader title="Pemegang wewenang per orang" description="Ringkasan siapa saja yang saat ini dapat menandatangani, berapa jenis, dan apakah gambar tanda tangannya sudah ada." />
        <ul className="divide-y divide-line">
          {matrix.people.map((p) => (
            <li key={p.userId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
              <span className="min-w-48 flex-1"><span className="font-medium text-ink">{p.name}</span><span className="block text-xs text-muted">{p.title ?? "—"} · {p.via === "DIREKTUR" ? "Direktur" : p.via === "MANAJER" ? "Manajer" : p.via === "SUPERVISOR" ? "Supervisor" : "HR"}</span></span>
              <span className="text-xs text-ink-soft">{p.typeCount} jenis surat</span>
              {p.hasSignature ? <Badge tone="green">Tanda tangan terpasang</Badge> : <Badge tone="amber">Belum ada gambar tanda tangan</Badge>}
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardHeader title="Kop & eskalasi" description="Alamat, telepon, dan logo kop diambil dari Pengaturan lembaga." />
        <form className="grid gap-3 p-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); void run("settings", () => api("/api/letters/settings", { method: "PATCH", body: { place: s.place, idLine: s.idLine || null, footerText: s.footerText || null, escalationDays: Number(s.escalationDays), annualTarget: Number(s.annualTarget), products: s.products.split("\n").map((x) => x.trim()).filter(Boolean) } }), "Pengaturan disimpan."); }}>
          <TextField label="Kota penerbitan" value={s.place} onChange={(e) => setS({ ...s, place: e.target.value })} />
          <TextField label="Batas eskalasi (hari kerja)" type="number" min={1} max={30} value={s.escalationDays} onChange={(e) => setS({ ...s, escalationDays: e.target.value })} hint="Setelah ini Direktur boleh mengambil alih surat yang belum ditandatangani." />
          <TextField label="Baris identitas kop" value={s.idLine} onChange={(e) => setS({ ...s, idLine: e.target.value })} className="sm:col-span-2" placeholder="Vocational Identity Number: …" />
          <TextField label="Teks kaki halaman" value={s.footerText} onChange={(e) => setS({ ...s, footerText: e.target.value })} className="sm:col-span-2" />
          <TextField label="Target revenue tahunan (Rp)" type="number" min={0} value={s.annualTarget} onChange={(e) => setS({ ...s, annualTarget: e.target.value })} hint="Dipakai untuk capaian di dasbor penjualan." />
          <label className="block text-sm"><span className="mb-1 block font-medium text-ink">Daftar produk penawaran (satu per baris)</span><textarea rows={5} value={s.products} onChange={(e) => setS({ ...s, products: e.target.value })} className="w-full rounded-md border border-line px-3 py-2 text-sm" /></label>
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
        <CardHeader title="Nomor urut" description="Urutan terpisah untuk seri eksternal (TE-EKS) dan internal (TE-INT), kembali ke 001 tiap tahun. Nomor berikutnya = nomor terakhir + 1; gunakan untuk melanjutkan register yang sudah berjalan. Tidak dapat diturunkan." />
        <div className="space-y-3 p-4">
          <ul className="flex flex-wrap gap-2 text-sm">{settings.counters.length === 0 ? <li className="text-muted">Belum ada nomor terbit.</li> : settings.counters.map((c) => <li key={`${c.series}${c.year}`} className="rounded-md border border-line bg-canvas px-3 py-1.5">TE-{c.series} {c.year}: nomor terakhir <b>{String(c.lastSeq).padStart(3, "0")}</b></li>)}</ul>
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
