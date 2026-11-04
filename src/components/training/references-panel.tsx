"use client";
import { useState } from "react";
import Link from "next/link";
import { Link2, Plus, Unlink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/field";
import { api } from "@/lib/api-client";
import { formatDateRange } from "@/lib/format";
import { EXTERNAL_SYSTEMS, EXTERNAL_SYSTEM_LABEL, type ExternalSystem } from "@/lib/training/types";
import type { AssignmentLinkDto, AssignmentOptionDto, ExternalRefDto } from "@/server/services/training/operations";
import { useRunner } from "./use-runner";

/**
 * Referensi ke surat tugas (HRIS) dan sistem lain. Hanya REFERENSI: tidak mengubah status surat tugas/uang harian, dan
 * referensi sistem lain dicatat MANUAL (belum ada integrasi/sinkronisasi dengan Website, HaloAI, maupun Sistem Keuangan).
 */
export function ReferencesPanel({ projectId, links, refs, canLink, canSearchLetters, canOpenLetters }: {
  projectId: string; links: AssignmentLinkDto[]; refs: ExternalRefDto[]; canLink: boolean; canSearchLetters: boolean; canOpenLetters: boolean;
}) {
  const { busy, error, run, reset } = useRunner();
  const [pick, setPick] = useState<{ q: string; results: AssignmentOptionDto[] } | null>(null);
  const [ref, setRef] = useState<{ system: ExternalSystem; externalId: string; label: string } | null>(null);

  async function search(q: string) {
    setPick({ q, results: [] });
    try { setPick({ q, results: await api<AssignmentOptionDto[]>(`/api/training/assignment-letters?q=${encodeURIComponent(q)}`) }); } catch { /* ditampilkan saat aksi berikutnya */ }
  }

  return (
    <div className="space-y-6">
      <section aria-label="Surat tugas terkait">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">Surat tugas terkait</h3>
          {canLink && canSearchLetters && <Button size="sm" onClick={() => { reset(); void search(""); }}><Link2 className="size-3.5" />Tautkan surat tugas</Button>}
        </div>
        <Notice tone="info">Hanya referensi. Penerbitan, persetujuan, dan uang harian tetap dikelola di menu Surat Tugas (HRIS); nominal tidak ditampilkan di sini.</Notice>
        {links.length === 0 ? <p className="mt-2 text-sm text-muted">Belum ada surat tugas yang ditautkan.</p> : (
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface">
            {links.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <div><p className="font-medium text-ink">{canOpenLetters ? <Link href="/surat-tugas" className="hover:underline">{l.number}</Link> : l.number} {l.status === "CANCELLED" && <Badge tone="dark">Dibatalkan</Badge>}</p>
                  <p className="text-xs text-muted">{l.purpose} · {l.destination} · {formatDateRange(l.startDate, l.endDate)}</p></div>
                {canLink && <Button size="sm" variant="danger" aria-label={`Lepas tautan ${l.number}`} onClick={() => void run(() => api(`/api/training/projects/${projectId}/assignments/${l.id}`, { method: "DELETE" }), "Tautan dilepas.")}><Unlink className="size-3.5" /></Button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Referensi sistem lain">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink">Referensi sistem lain</h3>
          {canLink && <Button size="sm" onClick={() => { reset(); setRef({ system: "FINANCE", externalId: "", label: "" }); }}><Plus className="size-3.5" />Catat referensi</Button>}
        </div>
        <Notice tone="warn">Dicatat manual. <strong>Belum ada integrasi</strong> dengan Website, HaloAI, atau Sistem Keuangan: data tidak tersinkron dan tidak diverifikasi otomatis.</Notice>
        {refs.length === 0 ? <p className="mt-2 text-sm text-muted">Belum ada referensi.</p> : (
          <ul className="mt-2 divide-y divide-line rounded-lg border border-line bg-surface">
            {refs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                <p><Badge>{EXTERNAL_SYSTEM_LABEL[r.system]}</Badge> <span className="ml-1 font-medium text-ink">{r.externalId}</span>{r.label && <span className="text-muted"> · {r.label}</span>}</p>
                {canLink && <Button size="sm" variant="danger" aria-label={`Hapus referensi ${r.externalId}`} onClick={() => void run(() => api(`/api/training/projects/${projectId}/references/${r.id}`, { method: "DELETE" }), "Referensi dihapus.")}><Unlink className="size-3.5" /></Button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog open={pick !== null} onClose={() => !busy && setPick(null)} size="md" title="Tautkan surat tugas" description="Cari berdasarkan nomor, tujuan, atau kota." footer={<Button onClick={() => setPick(null)}>Tutup</Button>}>
        {pick && <div className="space-y-3">{error && <Notice tone="danger">{error}</Notice>}
          <form onSubmit={(e) => { e.preventDefault(); void search(pick.q); }} className="flex gap-2"><input aria-label="Cari surat tugas" value={pick.q} onChange={(e) => setPick({ ...pick, q: e.target.value })} className="h-10 flex-1 rounded-md border border-line px-3 text-sm" placeholder="mis. 001/ST atau Bandung" /><Button type="submit">Cari</Button></form>
          {pick.results.length === 0 ? <p className="text-sm text-muted">Tidak ada hasil.</p> : <ul className="divide-y divide-line rounded-md border border-line">{pick.results.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm"><div><p className="font-medium">{l.number}</p><p className="text-xs text-muted">{l.purpose} · {l.destination} · {formatDateRange(l.startDate, l.endDate)}</p></div><Button size="sm" variant="primary" loading={busy} disabled={links.some((x) => x.letterId === l.id)} onClick={() => void run(() => api(`/api/training/projects/${projectId}/assignments`, { body: { letterId: l.id } }), "Surat tugas ditautkan.", () => setPick(null))}>{links.some((x) => x.letterId === l.id) ? "Sudah" : "Tautkan"}</Button></li>))}</ul>}
        </div>}
      </Dialog>

      <Dialog open={ref !== null} onClose={() => !busy && setRef(null)} size="sm" title="Catat referensi sistem lain"
        footer={ref && <><Button onClick={() => setRef(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} disabled={!ref.externalId.trim()} onClick={() => void run(() => api(`/api/training/projects/${projectId}/references`, { body: ref }), "Referensi dicatat.", () => setRef(null))}>Simpan</Button></>}>
        {ref && <div className="space-y-4">{error && <Notice tone="danger">{error}</Notice>}
          <SelectField label="Sistem" value={ref.system} onChange={(e) => setRef({ ...ref, system: e.target.value as ExternalSystem })}>{EXTERNAL_SYSTEMS.map((s) => <option key={s} value={s}>{EXTERNAL_SYSTEM_LABEL[s]}</option>)}</SelectField>
          <TextField label="ID / nomor referensi" required maxLength={100} value={ref.externalId} onChange={(e) => setRef({ ...ref, externalId: e.target.value })} hint="mis. nomor invoice, ID deal, ID pendaftaran." />
          <TextField label="Keterangan" maxLength={120} value={ref.label} onChange={(e) => setRef({ ...ref, label: e.target.value })} />
        </div>}
      </Dialog>
    </div>
  );
}
