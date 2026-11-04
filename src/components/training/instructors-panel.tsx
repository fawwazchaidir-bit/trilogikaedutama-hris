"use client";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState, Notice } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/field";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { CONFIRMATIONS, CONFIRMATION_LABEL, INSTRUCTOR_KINDS, INSTRUCTOR_KIND_LABEL, type Confirmation, type InstructorKind } from "@/lib/training/types";
import type { InstructorDto, ProjectInstructorDto } from "@/server/services/training/operations";
import type { DirectoryEmployee } from "@/server/services/training/access";
import { ConfirmationBadge } from "./ui";
import { useRunner } from "./use-runner";

/** Instruktur/asesor pada SATU proyek (dipilih dari direktori). */
export function ProjectInstructorsPanel({ projectId, assigned, directory, canManage, editable }: { projectId: string; assigned: ProjectInstructorDto[]; directory: InstructorDto[]; canManage: boolean; editable: boolean }) {
  const { busy, error, run, reset } = useRunner();
  const [add, setAdd] = useState<{ instructorId: string; kind: InstructorKind; confirmation: Confirmation; note: string } | null>(null);
  const [remove, setRemove] = useState<ProjectInstructorDto | null>(null);
  const live = canManage && editable;
  const used = new Set(assigned.map((a) => a.instructorId));
  return (
    <div className="space-y-3">
      {live && <div className="flex justify-end"><Button variant="primary" onClick={() => { reset(); setAdd({ instructorId: "", kind: "INSTRUCTOR", confirmation: "PENDING", note: "" }); }}><Plus className="size-4" />Tugaskan</Button></div>}
      {assigned.length === 0 ? <EmptyState title="Belum ada instruktur / asesor" description={live ? "Pilih dari direktori. Pihak eksternal tidak memerlukan akun portal." : "Belum ada yang ditugaskan."} /> : (
        <TableWrap><Table>
          <thead><tr><Th>Nama</Th><Th>Peran</Th><Th>Konfirmasi</Th><Th>Kontak</Th><Th>Jadwal</Th>{live && <Th />}</tr></thead>
          <tbody>{assigned.map((a) => (
            <tr key={a.id}>
              <Td><p className="font-medium text-ink">{a.name}</p>{a.note && <p className="text-xs text-muted">{a.note}</p>}</Td>
              <Td>{INSTRUCTOR_KIND_LABEL[a.kind]}</Td>
              <Td>{live ? (
                <select aria-label={`Status konfirmasi ${a.name}`} value={a.confirmation} disabled={busy} className="h-8 rounded-md border border-line bg-white px-2 text-xs" onChange={(e) => void run(() => api(`/api/training/projects/${projectId}/instructors/${a.id}`, { method: "PATCH", body: { confirmation: e.target.value } }), "Konfirmasi diperbarui.")}>
                  {CONFIRMATIONS.map((c) => <option key={c} value={c}>{CONFIRMATION_LABEL[c]}</option>)}
                </select>) : <ConfirmationBadge value={a.confirmation} />}</Td>
              <Td>{a.contactVisible ? <>{a.phone ?? "—"}<br /><span className="text-xs text-muted">{a.email ?? ""}</span></> : <span className="text-xs text-muted">Disembunyikan</span>}</Td>
              <Td>{a.scheduleCount} sesi</Td>
              {live && <Td align="right"><Button size="sm" variant="danger" onClick={() => { reset(); setRemove(a); }}>Lepas</Button></Td>}
            </tr>
          ))}</tbody>
        </Table></TableWrap>
      )}
      <Dialog open={add !== null} onClose={() => !busy && setAdd(null)} size="sm" title="Tugaskan instruktur / asesor"
        footer={add && <><Button onClick={() => setAdd(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} disabled={!add.instructorId} onClick={() => void run(() => api(`/api/training/projects/${projectId}/instructors`, { body: add }), "Instruktur ditugaskan.", () => setAdd(null))}>Tugaskan</Button></>}>
        {add && <div className="space-y-4">{error && <Notice tone="danger">{error}</Notice>}
          <SelectField label="Dari direktori" required value={add.instructorId} onChange={(e) => { const d = directory.find((x) => x.id === e.target.value); setAdd({ ...add, instructorId: e.target.value, kind: d?.kind ?? add.kind }); }} hint="Belum ada di daftar? Tambahkan lewat menu Instruktur / Asesor.">
            <option value="">— Pilih —</option>{directory.filter((d) => d.isActive && !used.has(d.id)).map((d) => <option key={d.id} value={d.id}>{d.name} ({INSTRUCTOR_KIND_LABEL[d.kind]})</option>)}
          </SelectField>
          <SelectField label="Peran pada proyek ini" value={add.kind} onChange={(e) => setAdd({ ...add, kind: e.target.value as InstructorKind })}>{INSTRUCTOR_KINDS.map((k) => <option key={k} value={k}>{INSTRUCTOR_KIND_LABEL[k]}</option>)}</SelectField>
          <SelectField label="Status konfirmasi" value={add.confirmation} onChange={(e) => setAdd({ ...add, confirmation: e.target.value as Confirmation })}>{CONFIRMATIONS.map((c) => <option key={c} value={c}>{CONFIRMATION_LABEL[c]}</option>)}</SelectField>
          <TextField label="Catatan" maxLength={300} value={add.note} onChange={(e) => setAdd({ ...add, note: e.target.value })} />
        </div>}
      </Dialog>
      <ConfirmDialog open={remove !== null} onClose={() => setRemove(null)} loading={busy} tone="danger" title={`Lepas ${remove?.name ?? ""} dari proyek?`} confirmLabel="Ya, lepas"
        description={remove && remove.scheduleCount > 0 ? `Masih dipakai pada ${remove.scheduleCount} jadwal; ganti atau batalkan jadwalnya dulu.` : "Penugasan dihapus dari proyek ini (data direktori tidak berubah)."}
        onConfirm={() => remove && void run(() => api(`/api/training/projects/${projectId}/instructors/${remove.id}`, { method: "DELETE" }), "Instruktur dilepas.", () => setRemove(null))}>{error && <Notice tone="danger">{error}</Notice>}</ConfirmDialog>
    </div>
  );
}

interface DirForm { id?: string; name: string; kind: InstructorKind; employeeId: string; organization: string; expertise: string; phone: string; email: string; isActive: boolean }
const BLANK: DirForm = { name: "", kind: "INSTRUCTOR", employeeId: "", organization: "", expertise: "", phone: "", email: "", isActive: true };

/** Direktori instruktur/asesor/narasumber/fasilitator (menu Instruktur / Asesor). */
export function InstructorDirectory({ items, employees, canManage }: { items: InstructorDto[]; employees: DirectoryEmployee[] | null; canManage: boolean }) {
  const { busy, error, fieldErrors, run, reset } = useRunner();
  const [form, setForm] = useState<DirForm | null>(null);
  const open = (i?: InstructorDto) => { reset(); setForm(i ? { id: i.id, name: i.name, kind: i.kind, employeeId: i.employeeId ?? "", organization: i.organization ?? "", expertise: i.expertise ?? "", phone: i.phone ?? "", email: i.email ?? "", isActive: i.isActive } : BLANK); };
  const body = (f: DirForm) => ({ name: f.name, kind: f.kind, employeeId: f.employeeId || null, organization: f.organization, expertise: f.expertise, ...(f.id && !items.find((i) => i.id === f.id)?.contactVisible ? {} : { phone: f.phone, email: f.email }), ...(f.id ? { isActive: f.isActive } : {}) });
  return (
    <div className="space-y-3">
      {canManage && <div className="flex justify-end"><Button variant="primary" onClick={() => open()}><Plus className="size-4" />Tambah ke direktori</Button></div>}
      {items.length === 0 ? <EmptyState title="Direktori masih kosong" description={canManage ? "Catat instruktur, asesor, narasumber, atau fasilitator. Karyawan internal dapat ditautkan; pihak eksternal tidak memerlukan akun." : "Belum ada data."} /> : (
        <TableWrap><Table>
          <thead><tr><Th>Nama</Th><Th>Jenis</Th><Th>Asal</Th><Th>Bidang</Th><Th>Kontak</Th><Th>Proyek</Th>{canManage && <Th />}</tr></thead>
          <tbody>{items.map((i) => (
            <tr key={i.id}>
              <Td><p className={`font-medium ${i.isActive ? "text-ink" : "text-muted"}`}>{i.name}</p>{!i.isActive && <Badge>Nonaktif</Badge>}</Td>
              <Td>{INSTRUCTOR_KIND_LABEL[i.kind]}</Td>
              <Td>{i.employeeId ? <Badge tone="blue">Karyawan internal</Badge> : (i.organization ?? "Eksternal")}</Td>
              <Td>{i.expertise ?? "—"}</Td>
              <Td>{i.contactVisible ? <>{i.phone ?? "—"}<br /><span className="text-xs text-muted">{i.email ?? ""}</span></> : <span className="text-xs text-muted">Disembunyikan</span>}</Td>
              <Td>{i.assignmentCount}</Td>
              {canManage && <Td align="right"><Button size="sm" onClick={() => open(i)}>Ubah</Button></Td>}
            </tr>
          ))}</tbody>
        </Table></TableWrap>
      )}
      <Dialog open={form !== null} onClose={() => !busy && setForm(null)} size="md" title={form?.id ? "Ubah data" : "Tambah ke direktori"}
        footer={form && <><Button onClick={() => setForm(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} disabled={form.name.trim().length < 2} onClick={() => void run(() => form.id ? api(`/api/training/instructors/${form.id}`, { method: "PATCH", body: body(form) }) : api("/api/training/instructors", { body: body(form) }), "Data disimpan.", () => setForm(null))}>Simpan</Button></>}>
        {form && <div className="grid gap-4 sm:grid-cols-2">
          {error && <div className="sm:col-span-2"><Notice tone="danger">{error}</Notice></div>}
          <SelectField className="sm:col-span-2" label="Karyawan internal (opsional)" value={form.employeeId} onChange={(e) => { const d = employees?.find((x) => x.id === e.target.value); setForm({ ...form, employeeId: e.target.value, name: d && !form.name ? d.fullName : form.name }); }} hint="Pilih bila ia karyawan; tidak membuat akun baru.">
            <option value="">— Pihak eksternal —</option>{employees?.map((d) => <option key={d.id} value={d.id}>{d.fullName} · {d.position}</option>)}
          </SelectField>
          <TextField label="Nama" required maxLength={150} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={fieldErrors.name} />
          <SelectField label="Jenis peran" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as InstructorKind })}>{INSTRUCTOR_KINDS.map((k) => <option key={k} value={k}>{INSTRUCTOR_KIND_LABEL[k]}</option>)}</SelectField>
          <TextField label="Instansi" maxLength={150} value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} />
          <TextField label="Bidang keahlian" maxLength={200} value={form.expertise} onChange={(e) => setForm({ ...form, expertise: e.target.value })} />
          <TextField label="Telepon" inputMode="tel" maxLength={30} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={fieldErrors.phone} />
          <TextField label="Email" type="email" maxLength={200} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={fieldErrors.email} />
          {form.id && <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="size-4" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />Aktif (dapat ditugaskan ke proyek baru)</label>}
        </div>}
      </Dialog>
    </div>
  );
}
