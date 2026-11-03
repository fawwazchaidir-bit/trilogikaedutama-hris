"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardHeader, Notice } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextAreaField, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { formatDateLong } from "@/lib/format";
import type { LeavePolicyDto } from "@/server/services/leave";

const src = (s: "DEFAULT" | "CUSTOM") => (s === "CUSTOM" ? <Badge tone="amber">Khusus</Badge> : <Badge>Bawaan</Badge>);

/**
 * Kebijakan cuti satu karyawan: kuota, tanggal mulai berhak, dan saldo negatif — masing-masing "ikut bawaan lembaga" atau "khusus".
 * `canManage` menampilkan tombol ubah & pemberian kuota (Admin/HR & Super Admin).
 */
export function LeavePolicyCard({ policy, canManage, canGrant }: { policy: LeavePolicyDto; canManage: boolean; canGrant: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const p = policy.policy;
  const d = policy.defaults;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const [form, setForm] = useState({
    customQuota: p.source.quota === "CUSTOM", quota: String(p.quotaDays),
    customEligible: p.source.eligibleFrom === "CUSTOM", eligibleFrom: p.eligibleFrom,
    customNegative: p.source.allowNegative === "CUSTOM", allowNegative: p.allowNegative,
    note: p.note ?? "",
  });
  const reopen = () => {
    setError(null); setFe({});
    setForm({
      customQuota: p.source.quota === "CUSTOM", quota: String(p.quotaDays), customEligible: p.source.eligibleFrom === "CUSTOM", eligibleFrom: p.eligibleFrom,
      customNegative: p.source.allowNegative === "CUSTOM", allowNegative: p.allowNegative, note: p.note ?? "",
    });
    setOpen(true);
  };

  async function save() {
    setBusy(true); setError(null); setFe({});
    try {
      await api(`/api/employees/${policy.employeeId}/leave-policy`, {
        method: "PUT",
        body: {
          quotaDays: form.customQuota ? Number(form.quota) : null,
          eligibleFrom: form.customEligible ? form.eligibleFrom : null,
          allowNegative: form.customNegative ? form.allowNegative : null,
          note: form.note,
        },
      });
      toast.success("Kebijakan cuti karyawan diperbarui."); setOpen(false); router.refresh();
    } catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); } finally { setBusy(false); }
  }

  async function grant() {
    setBusy(true);
    try {
      const r = await api<{ granted: number; notEntitled: number }>("/api/leave-balance/grant-quota", { body: { year: policy.year, employeeId: policy.employeeId } });
      if (r.granted) toast.success(`Saldo awal cuti ${policy.year} (${policy.quotaThisYear} hari) diberikan.`);
      else if (r.notEntitled) toast.error("Belum berhak cuti pada tahun ini (atau kuota 0) — tidak ada saldo yang diberikan.");
      else toast.success("Saldo awal tahun ini sudah ada.");
      router.refresh();
    } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  const row = (k: string, v: React.ReactNode, s: "DEFAULT" | "CUSTOM", def: string) => (
    <div className="grid grid-cols-[11rem_1fr] items-center gap-2 py-2 text-sm">
      <dt className="text-muted">{k}</dt>
      <dd className="flex flex-wrap items-center gap-2"><span className="font-medium">{v}</span>{src(s)}{s === "CUSTOM" && <span className="text-xs text-muted">(bawaan lembaga: {def})</span>}</dd>
    </div>
  );

  return (
    <Card>
      <CardHeader
        title="Kebijakan cuti karyawan"
        description="Berlaku untuk karyawan ini saja. Isian yang tidak dikhususkan mengikuti kebijakan bawaan lembaga (Pengaturan)."
        actions={<div className="flex gap-2">
          {canGrant && !policy.grantedThisYear && <Button loading={busy} onClick={grant} title={`Beri saldo awal cuti ${policy.year} menurut kebijakan ini`}>Beri kuota {policy.year}</Button>}
          {canManage && <Button onClick={reopen}>Ubah kebijakan</Button>}
        </div>}
      />
      <div className="px-5 pb-4">
        <div className="flex flex-wrap items-center gap-2 py-3">
          {policy.entitledNow ? <Badge tone="green">Sudah berhak cuti tahunan</Badge> : <Badge tone="amber">Belum berhak cuti tahunan — berhak mulai {formatDateLong(p.eligibleFrom)}</Badge>}
          <span className="text-xs text-muted">Mulai bekerja {formatDateLong(policy.joinDate)}</span>
        </div>
        <dl className="divide-y divide-line">
          {row("Berhak cuti sejak", formatDateLong(p.eligibleFrom), p.source.eligibleFrom, `mulai bekerja + ${d.minTenureMonths} bulan`)}
          {row("Kuota per tahun", `${p.quotaDays} hari`, p.source.quota, `${d.annualQuota} hari`)}
          {row("Saldo boleh negatif", p.allowNegative ? "Ya" : "Tidak", p.source.allowNegative, d.allowNegative ? "Ya" : "Tidak")}
        </dl>
        {p.custom && p.note && <p className="mt-3 rounded-md bg-canvas px-3 py-2 text-sm"><span className="text-muted">Alasan kebijakan khusus: </span>{p.note}</p>}
        {!policy.entitledNow && <Notice tone="info">Selama belum berhak, pengajuan cuti ditolak sistem; izin dan sakit tetap dapat diajukan.</Notice>}
      </div>

      <Dialog open={open} onClose={() => !busy && setOpen(false)} size="md" title="Ubah kebijakan cuti karyawan"
        description={`${policy.employeeName} · bawaan lembaga: berhak setelah ${d.minTenureMonths} bulan, kuota ${d.annualQuota} hari/tahun`}
        footer={<><Button onClick={() => setOpen(false)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} onClick={save}>Simpan</Button></>}>
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={form.customEligible} onChange={(e) => setForm({ ...form, customEligible: e.target.checked })} />Tanggal mulai berhak cuti khusus</label>
          {form.customEligible && <TextField label="Berhak cuti sejak" type="date" required value={form.eligibleFrom} onChange={(e) => setForm({ ...form, eligibleFrom: e.target.value })} error={fe.eligibleFrom} hint="Mis. tanggal mulai bekerja + 12 bulan, atau lebih awal bila ada perjanjian khusus." />}
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={form.customQuota} onChange={(e) => setForm({ ...form, customQuota: e.target.checked })} />Kuota tahunan khusus</label>
          {form.customQuota && <TextField label="Kuota per tahun (hari)" type="number" min={0} max={366} required value={form.quota} onChange={(e) => setForm({ ...form, quota: e.target.value })} error={fe.quotaDays} hint="0 = tidak mendapat cuti tahunan." />}
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={form.customNegative} onChange={(e) => setForm({ ...form, customNegative: e.target.checked })} />Aturan saldo negatif khusus</label>
          {form.customNegative && <label className="ml-6 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.allowNegative} onChange={(e) => setForm({ ...form, allowNegative: e.target.checked })} />Izinkan saldo cuti menjadi negatif</label>}
          <TextAreaField label={form.customEligible || form.customQuota || form.customNegative ? "Alasan kebijakan khusus (wajib)" : "Alasan (tidak diperlukan bila semuanya mengikuti bawaan)"} rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} error={fe.note} placeholder="mis. sesuai perjanjian kerja / kebijakan pimpinan tgl …" />
          <p className="text-xs text-muted">Tidak mengubah saldo yang sudah tercatat. Perubahan tercatat di audit log dan karyawan diberi tahu.</p>
        </div>
      </Dialog>
    </Card>
  );
}
