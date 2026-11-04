"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { api } from "@/lib/api-client";
import { ACTIVITY_KINDS, ACTIVITY_KIND_LABEL, DELIVERY_MODES, DELIVERY_MODE_LABEL, type ActivityKind, type DeliveryMode } from "@/lib/training/types";
import { TRACKS, TRACK_LABEL, type Track } from "@/lib/training/indicators/config";
import { useRunner } from "./use-runner";

export interface ProjectFormValues {
  name: string; programId: string; kind: ActivityKind; clientName: string; deliveryMode: DeliveryMode; location: string;
  startDate: string; endDate: string; description: string; notes: string;
  /** Pemantauan: jenis program & data pelaksana indikator (angka disimpan sebagai teks agar kolom dapat dikosongkan). */
  track: Track; bnsp: boolean; participantsMin: string; participantsMax: string; requestDate: string; registrationCloseDate: string;
}

const EMPTY: ProjectFormValues = {
  name: "", programId: "", kind: "REGULAR", clientName: "", deliveryMode: "ONSITE", location: "", startDate: "", endDate: "", description: "", notes: "",
  track: "REGULAR", bnsp: false, participantsMin: "", participantsMax: "", requestDate: "", registrationCloseDate: "",
};

interface Option { id: string; name: string }

function Fields({ v, set, programs, errors }: { v: ProjectFormValues; set: (p: Partial<ProjectFormValues>) => void; programs: Option[]; errors: Record<string, string> }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TextField className="sm:col-span-2" label="Nama proyek / kegiatan" required maxLength={160} value={v.name} onChange={(e) => set({ name: e.target.value })} error={errors.name} placeholder="mis. Sertifikasi Food Production — Batch Yogyakarta" />
      <SelectField label="Program" value={v.programId} onChange={(e) => set({ programId: e.target.value })} error={errors.programId} hint="Opsional. Satu program dapat memiliki banyak batch.">
        <option value="">— Tanpa program —</option>
        {programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </SelectField>
      <SelectField label="Jenis kegiatan" value={v.kind} onChange={(e) => set({ kind: e.target.value as ActivityKind })}>
        {ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{ACTIVITY_KIND_LABEL[k]}</option>)}
      </SelectField>
      <TextField label="Klien / mitra" maxLength={160} value={v.clientName} onChange={(e) => set({ clientName: e.target.value })} error={errors.clientName} placeholder="Kosongkan bila kegiatan reguler" />
      <SelectField label="Moda pelaksanaan" value={v.deliveryMode} onChange={(e) => set({ deliveryMode: e.target.value as DeliveryMode })}>
        {DELIVERY_MODES.map((m) => <option key={m} value={m}>{DELIVERY_MODE_LABEL[m]}</option>)}
      </SelectField>
      <TextField className="sm:col-span-2" label="Lokasi / media" maxLength={200} value={v.location} onChange={(e) => set({ location: e.target.value })} error={errors.location} hint="Alamat atau kota (tatap muka), atau nama platform (daring). Jangan menulis kata sandi/tautan rahasia." />
      <TextField label="Tanggal mulai" type="date" value={v.startDate} onChange={(e) => set({ startDate: e.target.value })} error={errors.startDate} />
      <TextField label="Tanggal selesai" type="date" value={v.endDate} onChange={(e) => set({ endDate: e.target.value })} error={errors.endDate} />
      <div className="sm:col-span-2 mt-1 border-t border-line pt-4"><p className="text-sm font-semibold text-ink">Pemantauan program</p><p className="text-xs text-muted">Menentukan template milestone, bobot kesiapan, dan jam kerja. Jenis program tidak dapat diganti setelah pekerjaan mulai tercatat.</p></div>
      <SelectField label="Jenis program" value={v.track} onChange={(e) => set({ track: e.target.value as Track })} error={errors.track}>
        {TRACKS.map((t) => <option key={t} value={t}>{TRACK_LABEL[t]}</option>)}
      </SelectField>
      <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink"><input type="checkbox" className="size-4 rounded border-line" checked={v.bnsp} onChange={(e) => set({ bnsp: e.target.checked })} />Memakai skema sertifikasi BNSP</label>
      <TextField label={v.track === "PARTNER" ? "Jumlah peserta di kontrak" : "Peserta minimum"} type="number" inputMode="numeric" min={0} value={v.participantsMin} onChange={(e) => set({ participantsMin: e.target.value })} error={errors.participantsMin} hint="Acuan komponen Peserta pada Kesiapan." />
      <TextField label="Peserta maksimum" type="number" inputMode="numeric" min={0} value={v.participantsMax} onChange={(e) => set({ participantsMax: e.target.value })} error={errors.participantsMax} hint="Opsional." />
      {v.track === "PARTNER"
        ? <TextField label="Tanggal permintaan klien masuk (T)" type="date" value={v.requestDate} onChange={(e) => set({ requestDate: e.target.value })} error={errors.requestDate} hint="Acuan tenggat tahap awal program kerjasama." />
        : <TextField label="Tutup pendaftaran" type="date" value={v.registrationCloseDate} onChange={(e) => set({ registrationCloseDate: e.target.value })} error={errors.registrationCloseDate} hint="Kosong = sesuai pengaturan (bawaan H-3)." />}
      <TextAreaField className="sm:col-span-2" label="Deskripsi" rows={3} maxLength={2000} value={v.description} onChange={(e) => set({ description: e.target.value })} error={errors.description} />
      <TextAreaField className="sm:col-span-2" label="Catatan penting" rows={2} maxLength={2000} value={v.notes} onChange={(e) => set({ notes: e.target.value })} error={errors.notes} />
    </div>
  );
}

const payload = (v: ProjectFormValues) => ({
  name: v.name, programId: v.programId || null, kind: v.kind, clientName: v.clientName, deliveryMode: v.deliveryMode, location: v.location,
  startDate: v.startDate || null, endDate: v.endDate || null, description: v.description, notes: v.notes,
  track: v.track, bnsp: v.bnsp, participantsMin: v.participantsMin === "" ? null : Number(v.participantsMin), participantsMax: v.participantsMax === "" ? null : Number(v.participantsMax),
  requestDate: v.requestDate || null, registrationCloseDate: v.registrationCloseDate || null,
});

/** Formulir proyek baru (halaman penuh). */
export function ProjectCreateForm({ programs, templates, directory, canSetPic }: {
  programs: Option[]; templates: { id: string; name: string; itemCount: number }[]; directory: { id: string; fullName: string; position: string }[] | null; canSetPic: boolean;
}) {
  const { busy, error, fieldErrors, run, router } = useRunner();
  const [v, setV] = useState<ProjectFormValues>(EMPTY);
  const [templateId, setTemplateId] = useState("");
  const [pic, setPic] = useState("");
  const set = (p: Partial<ProjectFormValues>) => setV((x) => ({ ...x, ...p }));

  return (
    <form
      className="space-y-5" aria-label="Proyek baru"
      onSubmit={(e) => {
        e.preventDefault();
        void run(() => api<{ id: string; code: string }>("/api/training/projects", { body: { ...payload(v), checklistTemplateId: templateId || null, picEmployeeId: pic || null } }), "Proyek dibuat.", (r) => router.push(`/training/proyek/${r.id}`));
      }}
    >
      {error && <Notice tone="danger">{error}</Notice>}
      <Fields v={v} set={set} programs={programs} errors={fieldErrors} />
      <div className="grid gap-4 border-t border-line pt-5 sm:grid-cols-2">
        <SelectField label="Template checklist" value={templateId} onChange={(e) => setTemplateId(e.target.value)} hint="Item disalin menjadi milik proyek ini; perubahan template di kemudian hari tidak mengubahnya.">
          <option value="">— Tanpa template —</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.itemCount} item)</option>)}
        </SelectField>
        {canSetPic ? (
          <SelectField label="Project Manager (PIC)" value={pic} onChange={(e) => setPic(e.target.value)} hint="Wajib sebelum proyek dapat masuk tahap Persiapan.">
            <option value="">— Tetapkan nanti —</option>
            {directory?.map((d) => <option key={d.id} value={d.id}>{d.fullName} · {d.position}</option>)}
          </SelectField>
        ) : <Notice tone="info">PIC ditetapkan oleh Manajer Program. Anda otomatis menjadi anggota (Admin Program) proyek ini.</Notice>}
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={() => router.push("/training/proyek")} disabled={busy}>Batal</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={v.name.trim().length < 3}>Buat proyek</Button>
      </div>
    </form>
  );
}

/** Dialog ubah data proyek. */
export function ProjectEditButton({ projectId, initial, programs }: { projectId: string; initial: ProjectFormValues; programs: Option[] }) {
  const { busy, error, fieldErrors, run, reset } = useRunner();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<ProjectFormValues>(initial);
  const set = (p: Partial<ProjectFormValues>) => setV((x) => ({ ...x, ...p }));
  return (
    <>
      <Button onClick={() => { reset(); setV(initial); setOpen(true); }}>Ubah data</Button>
      <Dialog
        open={open} onClose={() => !busy && setOpen(false)} size="lg" title="Ubah data proyek"
        footer={<><Button onClick={() => setOpen(false)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} disabled={v.name.trim().length < 3} onClick={() => void run(() => api(`/api/training/projects/${projectId}`, { method: "PATCH", body: payload(v) }), "Data proyek diperbarui.", () => setOpen(false))}>Simpan</Button></>}
      >
        <div className="space-y-4">{error && <Notice tone="danger">{error}</Notice>}<Fields v={v} set={set} programs={programs} errors={fieldErrors} /></div>
      </Dialog>
    </>
  );
}
