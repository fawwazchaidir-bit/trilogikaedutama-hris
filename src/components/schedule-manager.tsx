"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, Notice } from "@/components/ui/card";
import { Dialog, ConfirmDialog } from "@/components/ui/dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { CALENDAR_KIND_LABEL, SCOPE_LABEL } from "@/lib/labels";
import { dotTime, formatDateCompact, formatDateShort, WEEKDAYS_ID_SHORT } from "@/lib/format";
import type { AssignmentDto, CalendarDayDto, ScheduleDto } from "@/server/services/schedules";

interface Opt { id: string; name: string }
type SForm = { name: string; description: string; workDays: number[]; startTime: string; endTime: string; lateToleranceMinutes: string; absentCutoffTime: string; isDefault: boolean };
const blank = (): SForm => ({ name: "", description: "", workDays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "16:00", lateToleranceMinutes: "15", absentCutoffTime: "12:00", isDefault: false });
const daysText = (d: number[]) => d.map((x) => WEEKDAYS_ID_SHORT[x]).join(", ");

function useSave() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  async function run(fn: () => Promise<unknown>, ok: string, done: () => void) {
    setBusy(true); setError(null); setFe({});
    try { await fn(); toast.success(ok); done(); router.refresh(); }
    catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); }
    finally { setBusy(false); }
  }
  return { busy, error, fe, run, reset: () => { setError(null); setFe({}); } };
}

export function SchedulesCard({ schedules }: { schedules: ScheduleDto[] }) {
  const s = useSave();
  const [edit, setEdit] = useState<{ id: string | null; form: SForm } | null>(null);
  const f = edit?.form;
  const set = <K extends keyof SForm>(k: K, v: SForm[K]) => setEdit((e) => (e ? { ...e, form: { ...e.form, [k]: v } } : e));
  const open = (id: string | null, form: SForm) => { s.reset(); setEdit({ id, form }); };
  return (
    <Card>
      <CardHeader title="Jadwal kerja" description="Jam masuk/pulang, toleransi keterlambatan, dan batas jam 'tidak hadir'. Contoh awal 08.00–16.00 WIB — sesuaikan dengan kebijakan perusahaan."
        actions={<Button variant="primary" onClick={() => open(null, blank())}><Plus className="size-4" />Tambah jadwal</Button>} />
      {schedules.length === 0 ? <EmptyState title="Belum ada jadwal" /> : (
        <TableWrap><Table>
          <thead><tr><Th>Nama</Th><Th>Hari kerja</Th><Th>Jam</Th><Th align="right">Toleransi</Th><Th>Batas tidak hadir</Th><Th>Status</Th><Th align="right">Aksi</Th></tr></thead>
          <tbody>{schedules.map((x) => (
            <tr key={x.id} className={x.isActive ? "" : "text-muted"}>
              <Td className="font-medium">{x.name}{x.isDefault && <Badge tone="blue" className="ml-2">Default</Badge>}{x.description && <span className="block text-xs font-normal text-muted">{x.description}</span>}</Td>
              <Td>{daysText(x.workDays)}</Td><Td className="whitespace-nowrap">{dotTime(x.startTime)} – {dotTime(x.endTime)}{x.endTime < x.startTime && <Badge tone="blue" className="ml-2">+1 hari</Badge>}</Td><Td align="right">{x.lateToleranceMinutes} mnt</Td><Td>{dotTime(x.absentCutoffTime)}</Td>
              <Td>{x.isActive ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge>}</Td>
              <Td align="right"><div className="flex justify-end gap-2">
                <Button size="sm" onClick={() => open(x.id, { name: x.name, description: x.description ?? "", workDays: x.workDays, startTime: x.startTime, endTime: x.endTime, lateToleranceMinutes: String(x.lateToleranceMinutes), absentCutoffTime: x.absentCutoffTime, isDefault: x.isDefault })}>Ubah</Button>
                {!x.isDefault && <Button size="sm" onClick={() => void s.run(() => api(`/api/schedules/${x.id}`, { method: "PUT", body: { name: x.name, description: x.description, workDays: x.workDays, startTime: x.startTime, endTime: x.endTime, lateToleranceMinutes: x.lateToleranceMinutes, absentCutoffTime: x.absentCutoffTime, isActive: !x.isActive } }), x.isActive ? "Jadwal dinonaktifkan." : "Jadwal diaktifkan.", () => undefined)}>{x.isActive ? "Nonaktifkan" : "Aktifkan"}</Button>}
              </div></Td>
            </tr>
          ))}</tbody>
        </Table></TableWrap>
      )}
      <Dialog open={!!edit} onClose={() => !s.busy && setEdit(null)} size="lg" title={edit?.id ? "Ubah jadwal kerja" : "Tambah jadwal kerja"}
        footer={<><Button onClick={() => setEdit(null)} disabled={s.busy}>Batal</Button><Button variant="primary" loading={s.busy} onClick={() => edit && void s.run(() => {
          const body = { name: f!.name, description: f!.description, workDays: f!.workDays, startTime: f!.startTime, endTime: f!.endTime, lateToleranceMinutes: Number(f!.lateToleranceMinutes), absentCutoffTime: f!.absentCutoffTime, ...(f!.isDefault ? { isDefault: true } : {}) };
          return edit.id ? api(`/api/schedules/${edit.id}`, { method: "PUT", body }) : api("/api/schedules", { body });
        }, "Jadwal disimpan.", () => setEdit(null))}>Simpan</Button></>}>
        {f && <div className="grid gap-4 sm:grid-cols-2">
          {s.error && <div className="sm:col-span-2"><Notice tone="danger">{s.error}</Notice></div>}
          <TextField label="Nama jadwal" required value={f.name} onChange={(e) => set("name", e.target.value)} error={s.fe.name} placeholder="mis. Reguler / Ramadan" />
          <TextField label="Keterangan" value={f.description} onChange={(e) => set("description", e.target.value)} error={s.fe.description} />
          <fieldset className="sm:col-span-2"><legend className="mb-1.5 text-sm font-medium text-ink-soft">Hari kerja</legend>
            <div className="flex flex-wrap gap-2">{[1, 2, 3, 4, 5, 6, 7].map((d) => (
              <label key={d} className={`inline-flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm ${f.workDays.includes(d) ? "border-brand-600 bg-brand-50 text-brand-700" : "border-line bg-white"}`}>
                <input type="checkbox" className="sr-only" checked={f.workDays.includes(d)} onChange={(e) => set("workDays", e.target.checked ? [...f.workDays, d].sort() : f.workDays.filter((x) => x !== d))} />{WEEKDAYS_ID_SHORT[d]}
              </label>))}</div>{s.fe.workDays && <p role="alert" className="mt-1 text-xs font-medium text-brand-700">{s.fe.workDays}</p>}</fieldset>
          {f.endTime < f.startTime && <div className="sm:col-span-2"><Notice tone="info">Shift lintas tengah malam: jam pulang jatuh pada <strong>hari berikutnya</strong>. Shift dihitung milik tanggal ia dimulai. Batas &quot;tidak hadir&quot; boleh dini hari berikutnya (mis. 02.00).</Notice></div>}
          <TextField label="Jam masuk" type="time" required value={f.startTime} onChange={(e) => set("startTime", e.target.value)} error={s.fe.startTime} />
          <TextField label="Jam pulang" type="time" required value={f.endTime} onChange={(e) => set("endTime", e.target.value)} error={s.fe.endTime} />
          <TextField label="Toleransi keterlambatan (menit)" type="number" min={0} max={240} required value={f.lateToleranceMinutes} onChange={(e) => set("lateToleranceMinutes", e.target.value)} error={s.fe.lateToleranceMinutes} hint="Check-in sampai jam masuk + toleransi masih tepat waktu." />
          <TextField label="Batas jam 'tidak hadir'" type="time" required value={f.absentCutoffTime} onChange={(e) => set("absentCutoffTime", e.target.value)} error={s.fe.absentCutoffTime} hint={f.endTime < f.startTime ? "Shift malam: bila lebih awal dari jam masuk, dihitung dini hari berikutnya." : "Tanpa check-in sampai jam ini, hari itu dinyatakan tidak hadir."} />
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={f.isDefault} onChange={(e) => set("isDefault", e.target.checked)} />Jadikan jadwal default (dipakai bila tidak ada penugasan lain)</label>
        </div>}
      </Dialog>
    </Card>
  );
}

export function AssignmentsCard({ assignments, schedules, divisions, employees }: { assignments: AssignmentDto[]; schedules: ScheduleDto[]; divisions: Opt[]; employees: Opt[] }) {
  const s = useSave();
  const [form, setForm] = useState<null | { scheduleId: string; scope: "ALL" | "DIVISION" | "EMPLOYEE"; divisionId: string; employeeId: string; startDate: string; endDate: string; note: string }>(null);
  const [del, setDel] = useState<AssignmentDto | null>(null);
  const active = schedules.filter((x) => x.isActive);
  return (
    <Card>
      <CardHeader title="Penugasan jadwal" description="Prioritas: per karyawan › per divisi › seluruh perusahaan › jadwal default. Gunakan rentang tanggal untuk perubahan sementara, mis. bulan Ramadan."
        actions={<Button variant="primary" onClick={() => { s.reset(); setForm({ scheduleId: active[0]?.id ?? "", scope: "ALL", divisionId: "", employeeId: "", startDate: "", endDate: "", note: "" }); }}><Plus className="size-4" />Tambah penugasan</Button>} />
      {assignments.length === 0 ? <EmptyState title="Belum ada penugasan" description="Semua karyawan memakai jadwal default." /> : (
        <TableWrap><Table>
          <thead><tr><Th>Jadwal</Th><Th>Berlaku untuk</Th><Th>Periode</Th><Th>Catatan</Th><Th align="right">Aksi</Th></tr></thead>
          <tbody>{assignments.map((a) => (
            <tr key={a.id}><Td className="font-medium">{a.scheduleName}</Td><Td>{SCOPE_LABEL[a.scope]}: {a.targetName}</Td><Td className="whitespace-nowrap">{formatDateShort(a.startDate)} – {a.endDate ? formatDateShort(a.endDate) : "seterusnya"}</Td><Td className="text-muted">{a.note ?? "—"}</Td>
              <Td align="right"><Button size="sm" variant="danger" onClick={() => setDel(a)}><Trash2 className="size-3.5" />Hapus</Button></Td></tr>
          ))}</tbody>
        </Table></TableWrap>
      )}
      <Dialog open={!!form} onClose={() => !s.busy && setForm(null)} size="md" title="Tambah penugasan jadwal"
        footer={<><Button onClick={() => setForm(null)} disabled={s.busy}>Batal</Button><Button variant="primary" loading={s.busy} onClick={() => form && void s.run(() => api("/api/schedule-assignments", { body: { scheduleId: form.scheduleId, scope: form.scope, divisionId: form.scope === "DIVISION" ? form.divisionId || null : null, employeeId: form.scope === "EMPLOYEE" ? form.employeeId || null : null, startDate: form.startDate, endDate: form.endDate || null, note: form.note } }), "Penugasan disimpan.", () => setForm(null))}>Simpan</Button></>}>
        {form && <div className="grid gap-4 sm:grid-cols-2">
          {s.error && <div className="sm:col-span-2"><Notice tone="danger">{s.error}</Notice></div>}
          <SelectField label="Jadwal" required value={form.scheduleId} onChange={(e) => setForm({ ...form, scheduleId: e.target.value })} error={s.fe.scheduleId}>{active.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</SelectField>
          <SelectField label="Berlaku untuk" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as typeof form.scope })}><option value="ALL">Seluruh perusahaan</option><option value="DIVISION">Satu divisi</option><option value="EMPLOYEE">Satu karyawan</option></SelectField>
          {form.scope === "DIVISION" && <SelectField label="Divisi" required value={form.divisionId} onChange={(e) => setForm({ ...form, divisionId: e.target.value })} error={s.fe.divisionId}><option value="">— Pilih —</option>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</SelectField>}
          {form.scope === "EMPLOYEE" && <SelectField label="Karyawan" required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} error={s.fe.employeeId}><option value="">— Pilih —</option>{employees.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</SelectField>}
          <TextField label="Mulai" type="date" required value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} error={s.fe.startDate} />
          <TextField label="Sampai (opsional)" type="date" min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} error={s.fe.endDate} hint="Kosong = seterusnya" />
          <div className="sm:col-span-2"><TextAreaField label="Catatan" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="mis. Jadwal Ramadan" /></div>
        </div>}
      </Dialog>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} loading={s.busy} tone="danger" title="Hapus penugasan?" confirmLabel="Hapus"
        description={del ? `${del.scheduleName} · ${SCOPE_LABEL[del.scope]}: ${del.targetName}. Rekap hari-hari tersebut akan mengikuti jadwal lain yang berlaku.` : undefined}
        onConfirm={() => del && void s.run(() => api(`/api/schedule-assignments/${del.id}`, { method: "DELETE" }), "Penugasan dihapus.", () => setDel(null))} />
    </Card>
  );
}

export function CalendarCard({ year, items }: { year: number; items: CalendarDayDto[] }) {
  const router = useRouter();
  const s = useSave();
  const [form, setForm] = useState<null | { date: string; kind: "HOLIDAY" | "SPECIAL_WORKDAY"; name: string }>(null);
  const [del, setDel] = useState<CalendarDayDto | null>(null);
  return (
    <Card>
      <CardHeader title="Kalender hari libur & hari kerja khusus" description="Hari libur tidak dihitung hari kerja. Hari kerja khusus tetap dijadwalkan walau jatuh pada hari libur mingguan. Tanggal libur nasional/cuti bersama harus diinput dan diverifikasi admin."
        actions={<div className="flex items-center gap-2">
          <select aria-label="Tahun" value={year} onChange={(e) => router.push(`/jadwal?year=${e.target.value}`)} className="h-10 rounded-md border border-line bg-white px-3 text-sm">{[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}</select>
          <Button variant="primary" onClick={() => { s.reset(); setForm({ date: `${year}-01-01`, kind: "HOLIDAY", name: "" }); }}><Plus className="size-4" />Tambah</Button></div>} />
      {items.length === 0 ? <EmptyState title={`Belum ada entri kalender ${year}`} description="Tambahkan hari libur nasional, cuti bersama, atau hari kerja khusus." /> : (
        <TableWrap><Table>
          <thead><tr><Th>Tanggal</Th><Th>Jenis</Th><Th>Nama</Th><Th align="right">Aksi</Th></tr></thead>
          <tbody>{items.map((c) => (
            <tr key={c.id}><Td className="whitespace-nowrap font-medium">{formatDateCompact(c.date)} {c.date.slice(0, 4)}</Td><Td>{c.kind === "HOLIDAY" ? <Badge tone="red">{CALENDAR_KIND_LABEL.HOLIDAY}</Badge> : <Badge tone="blue">{CALENDAR_KIND_LABEL.SPECIAL_WORKDAY}</Badge>}</Td><Td>{c.name}</Td>
              <Td align="right"><Button size="sm" variant="danger" onClick={() => setDel(c)}><Trash2 className="size-3.5" />Hapus</Button></Td></tr>
          ))}</tbody>
        </Table></TableWrap>
      )}
      <Dialog open={!!form} onClose={() => !s.busy && setForm(null)} size="sm" title="Tambah entri kalender"
        footer={<><Button onClick={() => setForm(null)} disabled={s.busy}>Batal</Button><Button variant="primary" loading={s.busy} onClick={() => form && void s.run(() => api("/api/calendar", { body: form }), "Entri kalender ditambahkan.", () => setForm(null))}>Simpan</Button></>}>
        {form && <div className="space-y-4">{s.error && <Notice tone="danger">{s.error}</Notice>}
          <TextField label="Tanggal" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} error={s.fe.date} />
          <SelectField label="Jenis" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as typeof form.kind })}><option value="HOLIDAY">Hari libur</option><option value="SPECIAL_WORKDAY">Hari kerja khusus</option></SelectField>
          <TextField label="Nama" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={s.fe.name} placeholder="mis. Hari Kemerdekaan RI" /></div>}
      </Dialog>
      <ConfirmDialog open={!!del} onClose={() => setDel(null)} loading={s.busy} tone="danger" title="Hapus entri kalender?" confirmLabel="Hapus" description={del ? `${formatDateShort(del.date)} — ${del.name}. Rekap tanggal ini kembali mengikuti jadwal biasa.` : undefined}
        onConfirm={() => del && void s.run(() => api(`/api/calendar/${del.id}`, { method: "DELETE" }), "Entri dihapus.", () => setDel(null))} />
    </Card>
  );
}
