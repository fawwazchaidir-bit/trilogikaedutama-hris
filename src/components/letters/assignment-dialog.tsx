"use client";
import { useMemo, useState } from "react";
import { Plus, Settings2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { formatRupiah } from "@/lib/money";
import { formatDateRange } from "@/lib/format";
import { tripDays } from "@/lib/assignment";
import type { AssignmentPayload } from "@/lib/documents/assignment-body";
import type { LetterDetailDto } from "@/server/services/letters/documents";

interface EmpOpt { id: string; employeeNo: string; fullName: string }
interface Row { employeeId: string; dailyRate: number | null; days: string }

/** Data penugasan Surat Tugas (INT-002): maksud, lokasi, tanggal, penerima + uang harian. Isi surat dibangkitkan otomatis dari data ini. */
export function AssignmentDialog({ letterId, current, employees, editable, selfEmployeeId, isSuper, onSaved }: {
  letterId: string; current: AssignmentPayload | null; employees: EmpOpt[]; editable: boolean; selfEmployeeId: string | null; isSuper: boolean; onSaved: (d: LetterDetailDto) => void;
}) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ purpose: current?.purpose ?? "", destination: current?.destination ?? "", startDate: current?.startDate ?? today, endDate: current?.endDate ?? today, details: current?.details ?? "" });
  const [rows, setRows] = useState<Row[]>(current ? current.assignees.map((a) => ({ employeeId: a.employeeId, dailyRate: a.dailyRate, days: a.days ? String(a.days) : "" })) : [{ employeeId: "", dailyRate: null, days: "" }]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null); const [fe, setFe] = useState<Record<string, string>>({});
  const span = form.startDate && form.endDate && form.endDate >= form.startDate ? tripDays(form.startDate, form.endDate) : 0;
  const options = useMemo(() => employees.filter((e) => isSuper || e.id !== selfEmployeeId), [employees, isSuper, selfEmployeeId]);
  const total = rows.reduce((a, r) => a + (r.dailyRate ?? 0) * (r.days ? Number(r.days) : span), 0);
  const setRow = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function save() {
    setBusy(true); setError(null); setFe({});
    try {
      const d = await api<LetterDetailDto>(`/api/letters/${letterId}`, { method: "PATCH", body: { assignment: { ...form, details: form.details || null, assignees: rows.filter((x) => x.employeeId || x.dailyRate !== null).map((x) => ({ employeeId: x.employeeId, dailyRate: x.dailyRate ?? 0, days: x.days ? Number(x.days) : null })) } } });
      onSaved(d); setOpen(false);
    } catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); } finally { setBusy(false); }
  }

  return (
    <fieldset className="space-y-2 rounded-lg border border-line p-2.5">
      <legend className="px-1 text-xs font-semibold text-ink-soft">Data penugasan</legend>
      {current ? (
        <div className="space-y-0.5 text-sm">
          <p className="font-medium text-ink">{current.purpose}</p>
          <p className="text-xs text-muted">{current.destination} · {formatDateRange(current.startDate, current.endDate)} ({tripDays(current.startDate, current.endDate)} hari)</p>
          <p className="text-xs text-muted">{current.assignees.length} penerima · uang harian {formatRupiah(current.assignees.reduce((a, x) => a + x.dailyRate * (x.days ?? tripDays(current.startDate, current.endDate)), 0))}</p>
        </div>
      ) : <p className="text-xs text-muted">Belum diisi. Isi surat dibangkitkan otomatis dari data ini.</p>}
      {editable && <Button size="sm" onClick={() => setOpen(true)}><Settings2 className="size-3.5" />{current ? "Ubah data penugasan" : "Isi data penugasan"}</Button>}
      <Dialog open={open} onClose={() => !busy && setOpen(false)} size="lg" title="Data penugasan" description="Menjadi dasar Uang Harian. Uang harian tidak dicetak di surat; Bukti Penerimaan diterbitkan HR/Direktur setelah surat terbit."
        footer={<><Button onClick={() => setOpen(false)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Simpan</Button></>}>
        <div className="grid gap-4 sm:grid-cols-2">
          {error && <div className="sm:col-span-2"><Notice tone="danger">{error}</Notice></div>}
          <TextField className="sm:col-span-2" label="Maksud / tujuan penugasan" required value={form.purpose} onChange={(e) => setForm({ ...form, purpose: e.target.value })} error={fe.purpose} placeholder="mis. Pendampingan pelatihan di klien" />
          <TextField className="sm:col-span-2" label="Lokasi tujuan" required value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} error={fe.destination} placeholder="mis. Bandung, Jawa Barat" />
          <TextField label="Tanggal mulai" type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value, endDate: form.endDate < e.target.value ? e.target.value : form.endDate })} error={fe.startDate} />
          <TextField label="Tanggal selesai" type="date" required value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} error={fe.endDate} hint={span ? `Lama penugasan ${span} hari` : undefined} />
          <TextAreaField className="sm:col-span-2" label="Uraian tugas (opsional)" rows={2} value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} error={fe.details} />
          <fieldset className="space-y-3 sm:col-span-2">
            <legend className="mb-1 text-sm font-semibold text-ink">Karyawan yang ditugaskan & uang harian</legend>
            {fe.assignees && <p role="alert" className="text-xs font-medium text-brand-700">{fe.assignees}</p>}
            {rows.map((r, i) => (
              <div key={i} className="grid items-end gap-3 rounded-md border border-line p-3 sm:grid-cols-[1fr_9rem_6rem_auto]">
                <SelectField label={`Karyawan ${i + 1}`} required value={r.employeeId} onChange={(e) => setRow(i, { employeeId: e.target.value })} error={fe[`assignees.${i}.employeeId`]}>
                  <option value="">— pilih —</option>{options.map((e) => <option key={e.id} value={e.id}>{e.fullName} ({e.employeeNo})</option>)}
                </SelectField>
                <MoneyInput label="Uang harian / hari" required value={r.dailyRate} onChange={(v) => setRow(i, { dailyRate: v })} error={fe[`assignees.${i}.dailyRate`]} />
                <TextField label="Hari" type="number" min={1} max={span || undefined} placeholder={span ? String(span) : ""} value={r.days} onChange={(e) => setRow(i, { days: e.target.value })} error={fe[`assignees.${i}.days`]} />
                <Button variant="ghost" aria-label={`Hapus baris penerima ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button size="sm" onClick={() => setRows((rs) => [...rs, { employeeId: "", dailyRate: null, days: "" }])}><Plus className="size-3.5" />Tambah karyawan</Button>
              <p className="text-sm">Total uang harian: <strong>{formatRupiah(total)}</strong></p>
            </div>
            <p className="text-xs text-muted">“Hari” kosong = seluruh lama penugasan (hari kalender).{!isSuper && " Anda tidak dapat menugaskan diri sendiri (hanya Direktur)."}</p>
          </fieldset>
        </div>
      </Dialog>
    </fieldset>
  );
}
