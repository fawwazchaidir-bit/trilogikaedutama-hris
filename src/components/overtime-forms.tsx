"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, Notice } from "@/components/ui/card";
import { TextAreaField, TextField } from "@/components/ui/field";
import { RequestStatusBadge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { dotTime, formatDateShort, formatDateTime, formatDuration } from "@/lib/format";
import type { OvertimeDto } from "@/server/services/overtime";

export function OvertimeForm({ today, maxBackdateDays, maxAheadDays }: { today: string; maxBackdateDays: number; maxAheadDays: number }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({ date: today, startTime: "16:00", hours: "2", reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setFe({});
    try {
      const minutes = Math.round(Number(form.hours.replace(",", ".")) * 60);
      if (!Number.isFinite(minutes)) throw new ApiClientError("Durasi harus berupa angka (jam).", 422, "VALIDATION", { minutes: "Durasi harus berupa angka (jam)" });
      await api("/api/overtime", { body: { date: form.date, startTime: form.startTime, minutes, reason: form.reason } });
      toast.success("Pengajuan lembur terkirim dan menunggu persetujuan.");
      setForm({ ...form, reason: "" });
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiClientError) setFe(err.fieldErrors);
    } finally { setBusy(false); }
  }

  return (
    <Card>
      <CardHeader title="Ajukan lembur" description={`Ajukan sebelum atau sesudah lembur (maksimal ${maxAheadDays} hari ke depan, ${maxBackdateDays} hari ke belakang). Lembur hanya dibayar bila disetujui dan terbukti pada absensi.`} />
      <form onSubmit={submit} className="space-y-4 p-5" aria-label="Form pengajuan lembur">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Tanggal" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} error={fe.date} />
          <TextField label="Jam mulai" type="time" required value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} error={fe.startTime} />
          <TextField label="Durasi (jam)" inputMode="decimal" required value={form.hours} onChange={(e) => setForm({ ...form, hours: e.target.value })} error={fe.minutes} hint="mis. 2 atau 1,5" />
        </div>
        <TextAreaField label="Pekerjaan yang dilembur" required rows={3} maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} error={fe.reason} placeholder="Jelaskan singkat pekerjaan dan alasan perlu lembur" />
        <Button type="submit" variant="primary" loading={busy}><Send className="size-4" />Kirim pengajuan</Button>
      </form>
    </Card>
  );
}

export function MyOvertimeList({ items }: { items: OvertimeDto[] }) {
  const router = useRouter();
  const toast = useToast();
  const [target, setTarget] = useState<OvertimeDto | null>(null);
  const [busy, setBusy] = useState(false);

  async function cancel() {
    if (!target) return;
    setBusy(true);
    try { await api(`/api/overtime/${target.id}/cancel`, { body: {} }); toast.success("Pengajuan lembur dibatalkan."); setTarget(null); router.refresh(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Card>
      <CardHeader title="Status pengajuan lembur" />
      {items.length === 0 ? <EmptyState title="Belum ada pengajuan lembur" description="Pengajuan yang Anda kirim tampil di sini beserta statusnya." /> : (
        <ul className="divide-y divide-line">
          {items.map((o) => (
            <li key={o.id} className="space-y-1 px-5 py-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{formatDateShort(o.date)} · {dotTime(o.startTime)}–{dotTime(o.endTime)}{o.endsNextDay ? " (+1 hari)" : ""} <span className="font-normal text-muted">({formatDuration(o.minutes)})</span></p>
                <RequestStatusBadge status={o.status} />
              </div>
              <p className="text-muted">{o.reason}</p>
              {o.status === "APPROVED" && o.approvedMinutes !== null && <p className="text-xs text-emerald-700">Disetujui {formatDuration(o.approvedMinutes)}{o.approvedMinutes < o.minutes ? " (kurang dari yang diajukan)" : ""} — dibayar sesuai bukti absensi.</p>}
              {o.status !== "PENDING" && o.reviewedBy && <p className="text-xs text-muted">Diputuskan oleh {o.reviewedBy}, {formatDateTime(o.reviewedAt)}{o.reviewNote ? ` · Catatan: ${o.reviewNote}` : ""}</p>}
              {o.status === "CANCELLED" && <p className="text-xs text-muted">Dibatalkan: {o.cancelReason}</p>}
              {o.status === "PENDING" && <div><Button size="sm" variant="danger" onClick={() => setTarget(o)}>Batalkan pengajuan</Button></div>}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={!!target} onClose={() => setTarget(null)} onConfirm={cancel} loading={busy} title="Batalkan pengajuan lembur?" confirmLabel="Ya, batalkan" tone="danger"
        description={target ? `${formatDateShort(target.date)} · ${formatDuration(target.minutes)}` : undefined} />
    </Card>
  );
}
