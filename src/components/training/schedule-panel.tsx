"use client";
import { useState } from "react";
import { AlertTriangle, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, Notice } from "@/components/ui/card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { api } from "@/lib/api-client";
import { formatDateWithDay } from "@/lib/format";
import { SCHEDULE_STATUSES, SCHEDULE_STATUS_LABEL, type ScheduleStatus } from "@/lib/training/types";
import type { ScheduleDto, ScheduleSaveResult } from "@/server/services/training/operations";
import type { ProjectInstructorDto } from "@/server/services/training/operations";
import { ScheduleStatusBadge } from "./ui";
import { useRunner } from "./use-runner";

interface Form { id?: string; title: string; date: string; startTime: string; endTime: string; location: string; room: string; inchargeId: string; projectInstructorId: string; status: ScheduleStatus; note: string }
const BLANK: Form = { title: "", date: "", startTime: "09:00", endTime: "16:00", location: "", room: "", inchargeId: "", projectInstructorId: "", status: "PLANNED", note: "" };

/** Daftar jadwal berdasarkan tanggal (WIB). Bentrok ruangan/instruktur ditampilkan sebagai PERINGATAN (tidak memblokir). */
export function SchedulePanel({ projectId, schedules, members, instructors, canManage, editable }: {
  projectId: string; schedules: ScheduleDto[]; members: { employeeId: string; name: string }[]; instructors: ProjectInstructorDto[]; canManage: boolean; editable: boolean;
}) {
  const { busy, error, fieldErrors, run, reset, toast } = useRunner();
  const [form, setForm] = useState<Form | null>(null);
  const byDate = new Map<string, ScheduleDto[]>();
  for (const s of schedules) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  const open = (s?: ScheduleDto) => { reset(); setForm(s ? { id: s.id, title: s.title, date: s.date, startTime: s.startTime, endTime: s.endTime, location: s.location ?? "", room: s.room ?? "", inchargeId: s.inchargeId ?? "", projectInstructorId: s.projectInstructorId ?? "", status: s.status, note: s.note ?? "" } : BLANK); };
  const save = (f: Form) => run(
    () => f.id ? api<ScheduleSaveResult>(`/api/training/schedules/${f.id}`, { method: "PATCH", body: { ...f, inchargeId: f.inchargeId || null, projectInstructorId: f.projectInstructorId || null } }) : api<ScheduleSaveResult>(`/api/training/projects/${projectId}/schedules`, { body: { ...f, inchargeId: f.inchargeId || null, projectInstructorId: f.projectInstructorId || null } }),
    "Jadwal disimpan.", (r) => { setForm(null); r.warnings.forEach((w) => toast.error(`Perhatian: ${w}`)); },
  );

  return (
    <div className="space-y-4">
      {canManage && editable && <div className="flex justify-end"><Button variant="primary" onClick={() => open()}><Plus className="size-4" />Tambah jadwal</Button></div>}
      {schedules.length === 0 ? <EmptyState title="Belum ada jadwal" description={canManage ? "Tambahkan sesi kegiatan beserta ruangan dan instrukturnya." : "Belum ada jadwal pada proyek ini."} /> : [...byDate.entries()].map(([date, list]) => (
        <section key={date} aria-label={formatDateWithDay(date)}>
          <h3 className="mb-1.5 text-sm font-semibold text-ink">{formatDateWithDay(date)}</h3>
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {list.map((s) => (
              <li key={s.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-ink"><span className="tabular text-ink-soft">{s.startTime}–{s.endTime}</span> · {s.title} <ScheduleStatusBadge status={s.status} /></p>
                  <p className="text-xs text-muted">{[s.room, s.location, s.instructorName && `Pengajar: ${s.instructorName}`, s.inchargeName && `PJ: ${s.inchargeName}`].filter(Boolean).join(" · ") || "—"}</p>
                  {s.note && <p className="mt-0.5 text-xs text-muted">{s.note}</p>}
                  {s.conflicts.map((c, i) => <p key={i} role="status" className="mt-1 flex items-start gap-1.5 text-xs font-medium text-amber-800"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{c.kind === "ROOM" ? "Ruangan sama" : "Instruktur sama"} dipakai {c.visible ? `${c.withProjectCode} · "${c.withTitle}"` : "proyek lain (di luar akses Anda)"} pada waktu beririsan.</p>)}
                </div>
                {canManage && editable && <Button size="sm" onClick={() => open(s)}>Ubah</Button>}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Dialog open={form !== null} onClose={() => !busy && setForm(null)} size="md" title={form?.id ? "Ubah jadwal" : "Tambah jadwal"} description="Waktu dalam WIB (Asia/Jakarta). Satu sesi per baris, di hari yang sama."
        footer={form && <><Button onClick={() => setForm(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} disabled={form.title.trim().length < 3 || !form.date} onClick={() => void save(form)}>Simpan</Button></>}>
        {form && <div className="grid gap-4 sm:grid-cols-2">
          {error && <div className="sm:col-span-2"><Notice tone="danger">{error}</Notice></div>}
          <TextField className="sm:col-span-2" label="Nama kegiatan" required maxLength={160} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={fieldErrors.title} />
          <TextField label="Tanggal" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} error={fieldErrors.date} />
          <SelectField label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ScheduleStatus })}>{SCHEDULE_STATUSES.map((s) => <option key={s} value={s}>{SCHEDULE_STATUS_LABEL[s]}</option>)}</SelectField>
          <TextField label="Jam mulai" type="time" required value={form.startTime} onChange={(e) => setForm({ ...form, startTime: e.target.value })} error={fieldErrors.startTime} />
          <TextField label="Jam selesai" type="time" required value={form.endTime} onChange={(e) => setForm({ ...form, endTime: e.target.value })} error={fieldErrors.endTime} />
          <TextField label="Ruangan" maxLength={80} value={form.room} onChange={(e) => setForm({ ...form, room: e.target.value })} hint="Dipakai untuk peringatan bentrok." />
          <TextField label="Lokasi / media" maxLength={200} value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          <SelectField label="Instruktur / asesor" value={form.projectInstructorId} onChange={(e) => setForm({ ...form, projectInstructorId: e.target.value })} error={fieldErrors.projectInstructorId}><option value="">— Belum ditentukan —</option>{instructors.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</SelectField>
          <SelectField label="Penanggung jawab" value={form.inchargeId} onChange={(e) => setForm({ ...form, inchargeId: e.target.value })} error={fieldErrors.inchargeId}><option value="">— Belum ditentukan —</option>{members.map((m) => <option key={m.employeeId} value={m.employeeId}>{m.name}</option>)}</SelectField>
          <TextAreaField className="sm:col-span-2" label="Catatan" rows={2} maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>}
      </Dialog>
    </div>
  );
}
