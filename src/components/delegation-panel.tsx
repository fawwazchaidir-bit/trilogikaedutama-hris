"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardHeader, Notice } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SelectField, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { formatDateRange } from "@/lib/format";
import type { DelegationDto, PersonRef } from "@/server/services/org";

/** Pengganti peninjau: saat atasan cuti/dinas luar, orang yang ditunjuk ikut berwenang meninjau pengajuan bawahan langsungnya pada rentang tanggal itu. */
export function DelegationPanel({ items, candidates, today, selfEmployeeId }: { items: DelegationDto[]; candidates: PersonRef[]; today: string; selfEmployeeId: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({ delegateId: "", startDate: today, endDate: today, reason: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  async function add() {
    setBusy(true); setError(null); setFe({});
    try {
      await api("/api/team/delegations", { body: { delegateId: form.delegateId, startDate: form.startDate, endDate: form.endDate, reason: form.reason } });
      toast.success("Pengganti ditunjuk."); setForm({ delegateId: "", startDate: today, endDate: today, reason: "" }); router.refresh();
    } catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); } finally { setBusy(false); }
  }
  async function cancel(id: string) {
    setBusy(true);
    try { await api(`/api/team/delegations/${id}`, { method: "DELETE" }); toast.success("Penunjukan dibatalkan."); router.refresh(); }
    catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  return (
    <Card>
      <CardHeader title="Pengganti saat saya tidak ada" description="Tunjuk rekan untuk meninjau pengajuan bawahan Anda selama cuti atau dinas luar (maks. 90 hari per penunjukan). Tanpa pengganti, pengajuan naik ke atasan Anda bila Anda sedang cuti." />
      <div className="space-y-4 px-5 pb-5">
        {items.length > 0 && (
          <ul className="divide-y divide-line rounded-md border border-line text-sm">
            {items.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                <span><b>{d.delegateName}</b> menggantikan {d.supervisorId === selfEmployeeId ? "Anda" : d.supervisorName} · {formatDateRange(d.startDate, d.endDate)}{d.reason ? ` · ${d.reason}` : ""} {d.active ? <Badge tone="green">Berlaku</Badge> : <Badge>Akan datang</Badge>}</span>
                {(d.supervisorId === selfEmployeeId) && <Button onClick={() => cancel(d.id)} disabled={busy}>Batalkan</Button>}
              </li>
            ))}
          </ul>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="grid items-end gap-3 md:grid-cols-[1.4fr_1fr_1fr_auto]">
          <SelectField label="Pengganti" value={form.delegateId} onChange={(e) => setForm({ ...form, delegateId: e.target.value })} error={fe.delegateId}>
            <option value="">— Pilih rekan —</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.position}</option>)}
          </SelectField>
          <TextField label="Mulai" type="date" value={form.startDate} min={today} onChange={(e) => setForm({ ...form, startDate: e.target.value })} error={fe.startDate} />
          <TextField label="Sampai" type="date" value={form.endDate} min={today} onChange={(e) => setForm({ ...form, endDate: e.target.value })} error={fe.endDate} />
          <Button variant="primary" loading={busy} disabled={!form.delegateId} onClick={add}>Tunjuk</Button>
        </div>
      </div>
    </Card>
  );
}
