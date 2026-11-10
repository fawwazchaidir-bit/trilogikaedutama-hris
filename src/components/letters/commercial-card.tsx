"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { BellRing, FileUp, FolderPlus, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Card, CardHeader } from "@/components/ui/card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, errorMessage } from "@/lib/api-client";
import { formatRupiah } from "@/lib/money";
import { COMMERCIAL_STATUSES, STATUS_LABEL, type CommercialStatus, type DisplayStatus } from "@/lib/documents/commercial";
import type { CommercialDto } from "@/server/services/letters/commercial";

const TONE: Record<DisplayStatus, "gray" | "amber" | "green" | "red" | "blue"> = { DRAFT: "gray", SENT: "blue", FOLLOW_UP: "amber", NEGOTIATION: "amber", DEAL: "green", REJECTED: "red", DONE: "green", CANCELLED: "red" };
const rp = (n: number | null) => (n == null ? "—" : formatRupiah(n));

/** Kartu penjualan pada detail surat penawaran: klien, produk, PIC, nilai, status corong, jadwal follow-up, bukti Deal, tautan proyek. */
export function CommercialCard({ letterId, initial, issued, people }: { letterId: string; initial: CommercialDto; issued: boolean; people: { userId: string; name: string }[] }) {
  const router = useRouter(); const toast = useToast();
  const [c, setC] = useState(initial);
  const [f, setF] = useState({ clientName: initial.clientName ?? "", clientRef: initial.clientRef ?? "", product: initial.product ?? "", picId: initial.picId ?? "", potential: initial.potentialValue == null ? "" : String(initial.potentialValue), followUpAt: initial.followUpAt ?? "", note: initial.commercialNote ?? "" });
  const [busy, setBusy] = useState<string | null>(null);
  const [dlg, setDlg] = useState(false);
  const [to, setTo] = useState<CommercialStatus>("SENT"); const [dealValue, setDealValue] = useState(initial.dealValue == null ? "" : String(initial.dealValue)); const [note, setNote] = useState(""); const [fu, setFu] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const run = async (key: string, fn: () => Promise<CommercialDto>, ok: string) => { setBusy(key); try { const n = await fn(); setC(n); toast.success(ok); router.refresh(); return true; } catch (e) { toast.error(errorMessage(e)); return false; } finally { setBusy(null); } };

  const save = () => run("save", () => api<CommercialDto>(`/api/letters/${letterId}/commercial`, { method: "PATCH", body: { clientName: f.clientName, clientRef: f.clientRef, product: f.product, picId: f.picId || null, potentialValue: f.potential ? Number(f.potential) : null, followUpAt: f.followUpAt || null, commercialNote: f.note } }), "Data penjualan disimpan.");
  const setStatus = async () => { if (await run("status", () => api<CommercialDto>(`/api/letters/${letterId}/commercial/status`, { body: { to, dealValue: dealValue ? Number(dealValue) : undefined, note: note || undefined, followUpAt: fu || undefined } }), `Status: ${STATUS_LABEL[to]}.`)) { setDlg(false); setNote(""); } };
  const upload = (file: File | undefined) => { if (!file) return; const form = new FormData(); form.set("file", file); void run("ev", () => api<CommercialDto>(`/api/letters/${letterId}/commercial/evidence`, { method: "POST", form }), "Bukti Deal tersimpan."); if (fileRef.current) fileRef.current.value = ""; };
  const mkProject = () => run("proj", () => api<CommercialDto>(`/api/letters/${letterId}/commercial/project`, { body: {} }), "Proyek in-house dibuat dan ditautkan.");

  const editable = c.can.edit;
  return (
    <Card>
      <CardHeader title="Penawaran & penjualan" description="Data corong penjualan. Nilai tidak tampil di halaman verifikasi publik."
        actions={<div className="flex items-center gap-2">{c.alert && <Badge tone="red"><BellRing className="mr-1 size-3" />{c.alert === "TERLAMBAT" ? "Follow-up terlambat" : "Follow-up hari ini"}</Badge>}<Badge tone={TONE[c.status]}>{c.statusLabel}</Badge></div>} />
      <div className="grid gap-3 p-4 sm:grid-cols-2">
        <TextField label="Klien / instansi" value={f.clientName} onChange={(e) => setF({ ...f, clientName: e.target.value })} disabled={!editable} />
        <TextField label="ID lead CRM (HaloAI)" value={f.clientRef} onChange={(e) => setF({ ...f, clientRef: e.target.value })} disabled={!editable} hint="Hanya rujukan; data klien tetap di CRM." />
        <SelectField label="Produk" value={f.product} onChange={(e) => setF({ ...f, product: e.target.value })} disabled={!editable}>
          <option value="">— pilih —</option>{c.products.map((p) => <option key={p}>{p}</option>)}{f.product && !c.products.includes(f.product) && <option>{f.product}</option>}
        </SelectField>
        <SelectField label="PIC" value={f.picId} onChange={(e) => setF({ ...f, picId: e.target.value })} disabled={!editable}>
          <option value="">— pilih —</option>{people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}
        </SelectField>
        <TextField label="Nilai potensi (Rp)" type="number" min={0} value={f.potential} onChange={(e) => setF({ ...f, potential: e.target.value })} disabled={!editable} />
        <TextField label="Jadwal follow-up" type="date" value={f.followUpAt} onChange={(e) => setF({ ...f, followUpAt: e.target.value })} disabled={!editable} />
        <TextAreaField label="Catatan" rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} disabled={!editable} className="sm:col-span-2" />
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          {editable && <Button onClick={() => void save()} loading={busy === "save"}>Simpan data</Button>}
          {c.can.setStatus && <Button variant="primary" onClick={() => { setTo(c.status === "DRAFT" ? "SENT" : "FOLLOW_UP"); setDlg(true); }}><TrendingUp className="size-4" />Ubah status</Button>}
          <span className="text-xs text-muted">Terkirim: {c.sentAt ?? "—"} · Nilai deal: {rp(c.dealValue)}</span>
        </div>
      </div>
      {issued && (
        <div className="space-y-3 border-t border-line p-4 text-sm">
          <div className="flex flex-wrap items-center gap-3">
            <span className="font-medium text-ink">Bukti Deal (PO / persetujuan klien)</span>
            {c.evidence ? <a href={`/api/files/${c.evidence.fileId}`} className="text-brand-700 hover:underline">{c.evidence.name}</a> : <span className="text-muted">Belum ada</span>}
            {c.can.setStatus && <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium shadow-sm hover:bg-canvas"><FileUp className="size-3.5" />Unggah PDF/JPG
              <input ref={fileRef} type="file" accept="application/pdf,image/jpeg" aria-label="Unggah bukti Deal" className="sr-only" disabled={busy === "ev"} onChange={(e) => upload(e.target.files?.[0])} /></label>}
          </div>
          {(c.status === "DEAL" || c.status === "DONE" || c.projects.length > 0) && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="font-medium text-ink">Proyek Training</span>
              {c.projects.length === 0 && <span className="text-muted">Belum ditautkan</span>}
              {c.projects.map((p) => <Link key={p.projectId} href={`/training/proyek/${p.projectId}`} className="text-brand-700 hover:underline">{p.code ?? "Proyek"}{p.name ? ` · ${p.name}` : ""}</Link>)}
              {c.can.createProject && <Button size="sm" loading={busy === "proj"} onClick={() => void mkProject()}><FolderPlus className="size-3.5" />Buat proyek in-house</Button>}
            </div>
          )}
        </div>
      )}
      <Dialog open={dlg} onClose={() => setDlg(false)} size="sm" title="Ubah status penjualan" description="Deal wajib nilai deal dan bukti (unggah PO di atas) atau catatan bukti."
        footer={<><Button onClick={() => setDlg(false)}>Batal</Button><Button variant="primary" loading={busy === "status"} onClick={() => void setStatus()}>Simpan status</Button></>}>
        <div className="space-y-3">
          <SelectField label="Status baru" value={to} onChange={(e) => setTo(e.target.value as CommercialStatus)}>{COMMERCIAL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</SelectField>
          {to === "DEAL" && <TextField label="Nilai deal (Rp)" type="number" min={1} value={dealValue} onChange={(e) => setDealValue(e.target.value)} required />}
          {["SENT", "FOLLOW_UP", "NEGOTIATION"].includes(to) && <TextField label="Jadwal follow-up berikutnya" type="date" value={fu} onChange={(e) => setFu(e.target.value)} />}
          <TextAreaField label={to === "DEAL" ? "Catatan bukti (bila tanpa berkas)" : "Catatan"} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </Dialog>
    </Card>
  );
}
