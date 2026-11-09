"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/card";
import { TextField } from "@/components/ui/field";
import { api } from "@/lib/api-client";
import type { StaffCapacityList } from "@/server/services/training/indicator-data";
import { useRunner } from "./use-runner";

const DAYS = [[1, "Sen"], [2, "Sel"], [3, "Rab"], [4, "Kam"], [5, "Jum"], [6, "Sab"], [7, "Min"]] as const;
const cell = "h-8 rounded-md border border-line bg-white px-2 text-sm";

/** Pengecualian kapasitas per staf (mis. paruh waktu). Tanpa pengecualian, staf memakai bawaan konfigurasi. Hanya Koordinator Program / Direktur. */
export function CapacityPanel({ data }: { data: StaffCapacityList }) {
  const { busy, error, fieldErrors, run } = useRunner();
  const [emp, setEmp] = useState("");
  const [hours, setHours] = useState("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [note, setNote] = useState("");
  const free = data.employees.filter((e) => !data.rows.some((r) => r.employeeId === e.id));

  const put = (employeeId: string, h: string, d: number[], n: string) =>
    run(() => api(`/api/training/capacity/${employeeId}`, { method: "PUT", body: { hoursPerDay: h.trim() === "" ? null : Number(h.replace(",", ".")), workDays: d, note: n || null } }), "Kapasitas disimpan.");

  return (
    <section aria-label="Kapasitas per staf" className="rounded-lg border border-line bg-surface shadow-sm">
      <div className="border-b border-line px-5 py-3"><h2 className="text-base font-semibold text-ink">Kapasitas per staf</h2>
        <p className="text-xs text-muted">Bawaan: {data.defaults.hoursPerDay} jam/hari, hari kerja {data.defaults.workDays.map((d) => DAYS[d - 1]![1]).join(", ")}. Tambahkan pengecualian bila seseorang bekerja paruh waktu atau berjadwal lain.</p></div>
      <div className="space-y-3 px-5 py-4">
        {error && <Notice tone="danger">{error}</Notice>}
        {data.rows.length === 0 ? <p className="text-sm text-muted">Belum ada pengecualian; semua staf memakai bawaan.</p> : (
          <ul className="divide-y divide-line rounded-md border border-line">{data.rows.map((r) => (
            <li key={r.employeeId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <span><span className="font-medium text-ink">{r.name}</span> · {r.hoursPerDay ?? data.defaults.hoursPerDay} jam/hari · {r.workDays.map((d) => DAYS[d - 1]![1]).join(", ")}{r.note ? ` · ${r.note}` : ""}</span>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => void run(() => api(`/api/training/capacity/${r.employeeId}`, { method: "DELETE" }), "Pengecualian dihapus.")}><Trash2 className="size-4" />Hapus</Button>
            </li>))}</ul>
        )}
        <div className="grid items-end gap-3 sm:grid-cols-[minmax(12rem,1fr)_8rem_auto_minmax(8rem,1fr)_auto]">
          <label className="text-sm"><span className="mb-1 block font-medium text-ink">Staf</span><select aria-label="Staf" className={`${cell} w-full`} value={emp} onChange={(e) => setEmp(e.target.value)}><option value="">— Pilih —</option>{free.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
          <TextField label="Jam/hari" inputMode="decimal" value={hours} onChange={(e) => setHours(e.target.value)} error={fieldErrors.hoursPerDay} />
          <fieldset className="text-sm"><legend className="mb-1 font-medium text-ink">Hari kerja</legend><div className="flex gap-2">{DAYS.map(([d, l]) => <label key={d} className="inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={days.includes(d)} onChange={(e) => setDays((cur) => (e.target.checked ? [...new Set([...cur, d])].sort() : cur.filter((x) => x !== d)))} />{l}</label>)}</div></fieldset>
          <TextField label="Catatan" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button variant="primary" loading={busy} disabled={!emp || days.length === 0} onClick={() => void put(emp, hours, days, note).then((ok) => { if (ok) { setEmp(""); setHours(""); setNote(""); } })}><Plus className="size-4" />Tambah</Button>
        </div>
      </div>
    </section>
  );
}
