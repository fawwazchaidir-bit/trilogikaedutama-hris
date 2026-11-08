"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Notice } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { BASIS_LABEL, type SettlementBasisValue } from "@/lib/final-settlement";

/** Dialog membuat penyelesaian akhir. Bila `employeeId` diberikan, karyawan terkunci; selain itu dipilih dari `employees`. */
export function SettlementCreate({ employeeId, employees, label = "Buat penyelesaian akhir", defaultLastWorkDate }: { employeeId?: string; employees?: { id: string; name: string; no: string; active: boolean }[]; label?: string; defaultLastWorkDate?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ employeeId: employeeId ?? "", lastWorkDate: defaultLastWorkDate ?? "", basis: "WORKING_DAYS" as SettlementBasisValue, leaveDivisor: "", note: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  async function save() {
    setBusy(true); setError(null); setFe({});
    try {
      const r = await api<{ id: string }>("/api/final-settlements", { body: { employeeId: form.employeeId, lastWorkDate: form.lastWorkDate || undefined, basis: form.basis, leaveDivisor: form.leaveDivisor.trim() === "" ? null : Number(form.leaveDivisor), note: form.note } });
      toast.success("Penyelesaian akhir dibuat; periksa usulan sistem.");
      setOpen(false);
      router.push(`/penyelesaian-akhir/${r.id}`);
    } catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); } finally { setBusy(false); }
  }
  return (
    <>
      <Button variant="primary" onClick={() => { setError(null); setFe({}); setOpen(true); }}>{label}</Button>
      <Dialog open={open} onClose={() => !busy && setOpen(false)} size="md" title="Buat penyelesaian akhir"
        footer={<><Button onClick={() => setOpen(false)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} onClick={save}>Buat &amp; hitung usulan</Button></>}>
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          {!employeeId && (
            <SelectField label="Karyawan" required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} error={fe.employeeId}>
              <option value="">— pilih karyawan —</option>
              {(employees ?? []).map((e) => <option key={e.id} value={e.id}>{e.name} ({e.no}){e.active ? "" : " · nonaktif"}</option>)}
            </SelectField>
          )}
          <TextField label="Tanggal terakhir bekerja" type="date" value={form.lastWorkDate} onChange={(e) => setForm({ ...form, lastWorkDate: e.target.value })} error={fe.lastWorkDate} hint="Kosong = tanggal berhenti pada data karyawan, atau hari ini." />
          <SelectField label="Dasar prorata gaji bulan terakhir" value={form.basis} onChange={(e) => setForm({ ...form, basis: e.target.value as SettlementBasisValue })} error={fe.basis} hint="Hari kerja terjadwal mengikuti jadwal & kalender libur karyawan.">
            {(Object.keys(BASIS_LABEL) as SettlementBasisValue[]).map((b) => <option key={b} value={b}>{BASIS_LABEL[b]}</option>)}
          </SelectField>
          <TextField label="Pembagi uang cuti (opsional)" type="number" min={1} max={31} value={form.leaveDivisor} onChange={(e) => setForm({ ...form, leaveDivisor: e.target.value })} error={fe.leaveDivisor} hint="Hari kerja per bulan menurut kebijakan perusahaan. Kosong = sisa cuti tidak dihitung (hanya diberi peringatan)." />
          <TextAreaField label="Catatan (opsional)" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} error={fe.note} />
        </div>
      </Dialog>
    </>
  );
}
