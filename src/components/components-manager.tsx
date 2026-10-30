"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, Notice } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { MoneyInput } from "@/components/ui/money-input";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { CALC_LABEL, CATEGORY_LABEL, DEDUCTION_CATEGORIES, EARNING_CATEGORIES, percentLabel, type ComponentCalc, type ComponentCategory } from "@/lib/payroll";
import { formatDateShort } from "@/lib/format";
import { formatRupiah } from "@/lib/money";
import type { ComponentDto } from "@/server/services/components";

interface Form {
  category: ComponentCategory; name: string; calc: ComponentCalc; amount: number | null; percent: string; recurrence: "RECURRING" | "ONE_TIME";
  effectiveFrom: string; effectiveTo: string; description: string;
}
const blank = (today: string): Form => ({ category: "BASE_SALARY", name: "Gaji pokok", calc: "FIXED", amount: null, percent: "", recurrence: "RECURRING", effectiveFrom: today, effectiveTo: "", description: "" });
const fromDto = (c: ComponentDto): Form => ({
  category: c.category, name: c.name, calc: c.calc, amount: c.calc === "PERCENT_OF_BASE" ? null : c.amount, percent: c.percent === null ? "" : String(c.percent).replace(".", ","),
  recurrence: c.recurrence, effectiveFrom: c.effectiveFrom, effectiveTo: c.effectiveTo ?? "", description: c.description ?? "",
});

export function ComponentsManager({ employeeId, items, today }: { employeeId: string; items: ComponentDto[]; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState<{ id: string | null; form: Form } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const f = editing?.form;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setEditing((e) => (e ? { ...e, form: { ...e.form, [k]: v } } : e));

  async function save() {
    if (!editing) return;
    setBusy(true); setError(null); setFe({});
    const x = editing.form;
    const body = {
      employeeId, category: x.category, name: x.name, calc: x.calc, recurrence: x.recurrence, effectiveFrom: x.effectiveFrom,
      effectiveTo: x.recurrence === "ONE_TIME" ? null : x.effectiveTo || null, description: x.description,
      ...(x.calc === "PERCENT_OF_BASE" ? { percent: x.percent.trim() === "" ? null : Number(x.percent.replace(",", ".")) } : { amount: x.amount ?? undefined }),
    };
    try {
      if (editing.id) await api(`/api/components/${editing.id}`, { method: "PUT", body }); else await api("/api/components", { body });
      toast.success("Komponen gaji disimpan."); setEditing(null); router.refresh();
    } catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); } finally { setBusy(false); }
  }
  async function toggle(c: ComponentDto) {
    try { await api(`/api/components/${c.id}/active`, { body: { active: !c.isActive } }); toast.success(c.isActive ? "Komponen dinonaktifkan." : "Komponen diaktifkan."); router.refresh(); }
    catch (e) { toast.error(errorMessage(e)); }
  }

  const amountText = (c: ComponentDto) => c.calc === "PERCENT_OF_BASE" ? `${percentLabel(Math.round((c.percent ?? 0) * 100))} gaji pokok` : c.calc === "PER_PRESENT_DAY" ? `${formatRupiah(c.amount)} / hari hadir` : formatRupiah(c.amount);
  const sensitive = f && (f.category === "BPJS" || f.category === "TAX");

  return (
    <Card>
      <CardHeader title="Komponen gaji" description="Komponen tetap berulang tiap periode selama masa berlakunya; komponen sekali hanya masuk ke satu periode. Periode yang sudah diterbitkan tidak berubah."
        actions={<Button variant="primary" onClick={() => { setError(null); setFe({}); setEditing({ id: null, form: blank(today) }); }}><Plus className="size-4" />Tambah komponen</Button>} />
      {items.length === 0 ? <EmptyState title="Belum ada komponen gaji" description="Mulai dengan gaji pokok. Karyawan tanpa komponen dilewati saat perhitungan gaji." /> : (
        <TableWrap><Table>
          <thead><tr><Th>Komponen</Th><Th>Jenis</Th><Th align="right">Nominal / rumus</Th><Th>Berlaku</Th><Th>Status</Th><Th align="right">Aksi</Th></tr></thead>
          <tbody>{items.map((c) => (
            <tr key={c.id} className={c.isActive ? "" : "text-muted"}>
              <Td className="font-medium">{c.name}<span className="block text-xs font-normal text-muted">{c.categoryLabel}{c.description ? ` · ${c.description}` : ""}</span></Td>
              <Td>{c.kind === "EARNING" ? <Badge tone="green">Pendapatan</Badge> : <Badge tone="red">Potongan</Badge>}</Td>
              <Td align="right" className="whitespace-nowrap">{amountText(c)}</Td>
              <Td className="whitespace-nowrap">{c.recurrence === "ONE_TIME" ? `Sekali · ${formatDateShort(c.effectiveFrom)}` : `${formatDateShort(c.effectiveFrom)} – ${c.effectiveTo ? formatDateShort(c.effectiveTo) : "seterusnya"}`}</Td>
              <Td>{c.isActive ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge>}</Td>
              <Td align="right"><div className="flex justify-end gap-2"><Button size="sm" onClick={() => { setError(null); setFe({}); setEditing({ id: c.id, form: fromDto(c) }); }}>Ubah</Button><Button size="sm" onClick={() => void toggle(c)}>{c.isActive ? "Nonaktifkan" : "Aktifkan"}</Button></div></Td>
            </tr>
          ))}</tbody>
        </Table></TableWrap>
      )}

      <Dialog open={!!editing} onClose={() => !busy && setEditing(null)} size="lg" title={editing?.id ? "Ubah komponen gaji" : "Tambah komponen gaji"}
        footer={<><Button onClick={() => setEditing(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} onClick={save}>Simpan</Button></>}>
        {f && <div className="grid gap-4 sm:grid-cols-2">
          {error && <div className="sm:col-span-2"><Notice tone="danger">{error}</Notice></div>}
          <SelectField label="Kategori" required value={f.category} onChange={(e) => set("category", e.target.value as ComponentCategory)} error={fe.category}>
            <optgroup label="Pendapatan">{EARNING_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</optgroup>
            <optgroup label="Potongan">{DEDUCTION_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}</optgroup>
          </SelectField>
          <TextField label="Nama komponen" required value={f.name} onChange={(e) => set("name", e.target.value)} error={fe.name} />
          <SelectField label="Cara hitung" required value={f.calc} onChange={(e) => set("calc", e.target.value as ComponentCalc)} error={fe.calc}>
            {(Object.keys(CALC_LABEL) as ComponentCalc[]).map((c) => <option key={c} value={c}>{CALC_LABEL[c]}</option>)}
          </SelectField>
          {f.calc === "PERCENT_OF_BASE"
            ? <TextField label="Persen dari gaji pokok (%)" required inputMode="decimal" value={f.percent} onChange={(e) => set("percent", e.target.value)} error={fe.percent} hint="mis. 1 atau 1,5 (maks. 2 desimal)" />
            : <MoneyInput label={f.calc === "PER_PRESENT_DAY" ? "Nominal per hari hadir" : "Nominal per periode"} required value={f.amount} onChange={(v) => set("amount", v)} error={fe.amount} />}
          <SelectField label="Berlaku" value={f.recurrence} onChange={(e) => set("recurrence", e.target.value as Form["recurrence"])} error={fe.recurrence}>
            <option value="RECURRING">Tetap — berulang tiap periode</option><option value="ONE_TIME">Sekali — satu periode saja</option>
          </SelectField>
          <TextField label={f.recurrence === "ONE_TIME" ? "Tanggal (menentukan periode gaji)" : "Berlaku mulai"} type="date" required value={f.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} error={fe.effectiveFrom} />
          {f.recurrence === "RECURRING" && <TextField label="Berlaku sampai (opsional)" type="date" min={f.effectiveFrom} value={f.effectiveTo} onChange={(e) => set("effectiveTo", e.target.value)} error={fe.effectiveTo} hint="Kosong = seterusnya. Isi untuk cicilan kasbon." />}
          <div className="sm:col-span-2"><TextAreaField label="Keterangan" rows={2} value={f.description} onChange={(e) => set("description", e.target.value)} error={fe.description} /></div>
          {sensitive && <div className="sm:col-span-2"><Notice tone="warn"><span className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><span>Aplikasi <strong>tidak menetapkan tarif BPJS/pajak</strong>. Isi nominal atau persen sesuai ketentuan yang berlaku dan kebijakan perusahaan, lalu verifikasi dengan pihak yang berwenang (mis. konsultan pajak/BPJS).</span></span></Notice></div>}
        </div>}
      </Dialog>
    </Card>
  );
}
