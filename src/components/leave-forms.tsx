"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Paperclip, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, Notice } from "@/components/ui/card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { RequestStatusBadge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { uploadFile } from "@/components/upload";
import { formatDateRange, formatDateTime } from "@/lib/format";
import { LEAVE_TYPE_LABEL, type LeaveType } from "@/lib/labels";
import type { LeaveDto } from "@/server/services/leave";

export function LeaveForm({ today, maxBackdateDays }: { today: string; maxBackdateDays: number }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({ type: "CUTI" as LeaveType, startDate: today, endDate: today, reason: "" });
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setFe({});
    try {
      const attachmentFileId = file ? (await uploadFile("/api/leaves/attachment", file)).id : null;
      await api("/api/leaves", { body: { ...form, attachmentFileId } });
      toast.success("Pengajuan terkirim dan menunggu persetujuan.");
      setForm({ ...form, reason: "" }); setFile(null);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiClientError) setFe(err.fieldErrors);
    } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader title="Ajukan izin, sakit, atau cuti" description={`Tanggal boleh mundur paling lama ${maxBackdateDays} hari. Hanya hari kerja terjadwal yang dihitung.`} />
      <form onSubmit={submit} className="space-y-4 p-5" aria-label="Form pengajuan">
        {error && <Notice tone="danger">{error}</Notice>}
        <SelectField label="Jenis pengajuan" required value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as LeaveType })} error={fe.type}>
          {(Object.keys(LEAVE_TYPE_LABEL) as LeaveType[]).map((t) => <option key={t} value={t}>{LEAVE_TYPE_LABEL[t]}{t === "CUTI" ? " (memotong saldo cuti)" : ""}</option>)}
        </SelectField>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextField label="Tanggal mulai" type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: e.target.value > form.endDate ? e.target.value : form.endDate })} error={fe.startDate} />
          <TextField label="Tanggal selesai" type="date" required value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} error={fe.endDate} />
        </div>
        <TextAreaField label="Alasan" required rows={3} maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} error={fe.reason} placeholder="Jelaskan singkat alasan pengajuan" />
        <div className="space-y-1.5">
          <label htmlFor="lampiran" className="block text-sm font-medium text-ink-soft">Lampiran pendukung (opsional)</label>
          <input id="lampiran" type="file" accept="image/png,image/jpeg,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-line file:bg-white file:px-3 file:py-1.5 file:text-sm hover:file:bg-canvas" />
          <p className="text-xs text-muted">PNG, JPG, atau PDF. Disarankan untuk sakit (mis. surat dokter).</p>
        </div>
        <Button type="submit" variant="primary" loading={busy}><Send className="size-4" />Kirim pengajuan</Button>
      </form>
    </Card>
  );
}

export function MyLeaveList({ items }: { items: LeaveDto[] }) {
  const router = useRouter();
  const toast = useToast();
  const [target, setTarget] = useState<LeaveDto | null>(null);
  const [busy, setBusy] = useState(false);

  async function cancel() {
    if (!target) return;
    setBusy(true);
    try { await api(`/api/leaves/${target.id}/cancel`, { body: {} }); toast.success("Pengajuan dibatalkan."); setTarget(null); router.refresh(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader title="Status pengajuan Anda" />
      {items.length === 0 ? <EmptyState title="Belum ada pengajuan" description="Pengajuan yang Anda kirim akan tampil di sini beserta statusnya." /> : (
        <ul className="divide-y divide-line">
          {items.map((l) => (
            <li key={l.id} className="space-y-1 px-5 py-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{LEAVE_TYPE_LABEL[l.type]} · {formatDateRange(l.startDate, l.endDate)} <span className="font-normal text-muted">({l.workingDays} hari kerja)</span></p>
                <RequestStatusBadge status={l.status} />
              </div>
              <p className="text-muted">{l.reason}</p>
              {l.attachmentUrl && <a href={l.attachmentUrl} className="inline-flex items-center gap-1 text-brand-700 hover:underline"><Paperclip className="size-3.5" />Lampiran</a>}
              {l.status !== "PENDING" && l.reviewedBy && <p className="text-xs text-muted">Diputuskan oleh {l.reviewedBy}, {formatDateTime(l.reviewedAt)}{l.reviewNote ? ` · Catatan: ${l.reviewNote}` : ""}</p>}
              {l.status === "CANCELLED" && <p className="text-xs text-muted">Dibatalkan: {l.cancelReason}</p>}
              {l.status === "PENDING" && <div><Button size="sm" variant="danger" onClick={() => setTarget(l)}>Batalkan pengajuan</Button></div>}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={!!target} onClose={() => setTarget(null)} onConfirm={cancel} loading={busy} title="Batalkan pengajuan?" confirmLabel="Ya, batalkan" tone="danger"
        description={target ? `${LEAVE_TYPE_LABEL[target.type]} ${formatDateRange(target.startDate, target.endDate)}` : undefined} />
    </Card>
  );
}
