"use client";
import { useState } from "react";
import { EyeOff, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, Notice } from "@/components/ui/card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { PARTICIPANT_STATUSES, PARTICIPANT_STATUS_LABEL, type ParticipantStatus } from "@/lib/training/types";
import type { ParticipantDto } from "@/server/services/training/operations";
import { ParticipantStatusBadge } from "./ui";
import { useRunner } from "./use-runner";

interface Form { id?: string; fullName: string; organization: string; phone: string; email: string; status: ParticipantStatus; note: string }
const BLANK: Form = { fullName: "", organization: "", phone: "", email: "", status: "REGISTERED", note: "" };

/**
 * Peserta = data operasional LOKAL (input manual), bukan sinkronisasi dari website. Status peserta tidak terkait status
 * pembayaran maupun status kompetensi. Kontak hanya terlihat bagi yang berwenang.
 */
export function ParticipantsPanel({ projectId, participants, canManage, editable }: { projectId: string; participants: ParticipantDto[]; canManage: boolean; editable: boolean }) {
  const { busy, error, fieldErrors, run, reset } = useRunner();
  const [form, setForm] = useState<Form | null>(null);
  const live = canManage && editable;
  const open = (p?: ParticipantDto) => { reset(); setForm(p ? { id: p.id, fullName: p.fullName, organization: p.organization ?? "", phone: p.phone ?? "", email: p.email ?? "", status: p.status, note: p.note ?? "" } : BLANK); };
  const hiddenContacts = participants.some((p) => !p.contactVisible);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">Data dimasukkan manual (referensi operasional lokal) — tidak tersinkron dengan website registrasi.</p>
        {live && <Button variant="primary" onClick={() => open()}><Plus className="size-4" />Tambah peserta</Button>}
      </div>
      {hiddenContacts && participants.length > 0 && <Notice tone="info"><span className="inline-flex items-center gap-1.5"><EyeOff className="size-4" />Kontak peserta hanya terlihat oleh pengelola peserta proyek ini.</span></Notice>}
      {participants.length === 0 ? <EmptyState title="Belum ada peserta" description={live ? "Tambahkan peserta satu per satu." : "Belum ada peserta pada proyek ini."} /> : (
        <TableWrap>
          <Table>
            <thead><tr><Th>Nama</Th><Th>Instansi</Th><Th>Kontak</Th><Th>Status</Th>{live && <Th />}</tr></thead>
            <tbody>{participants.map((p) => (
              <tr key={p.id}>
                <Td><p className="font-medium text-ink">{p.fullName}</p>{p.note && <p className="text-xs text-muted">{p.note}</p>}</Td>
                <Td>{p.organization ?? "—"}</Td>
                <Td>{p.contactVisible ? <>{p.phone ?? "—"}<br /><span className="text-xs text-muted">{p.email ?? ""}</span></> : <span className="text-xs text-muted">Disembunyikan</span>}</Td>
                <Td><ParticipantStatusBadge status={p.status} /></Td>
                {live && <Td align="right"><Button size="sm" onClick={() => open(p)}>Ubah</Button></Td>}
              </tr>
            ))}</tbody>
          </Table>
        </TableWrap>
      )}
      <Dialog open={form !== null} onClose={() => !busy && setForm(null)} size="md" title={form?.id ? "Ubah peserta" : "Tambah peserta"} description="Isi seperlunya: kumpulkan data seminimal mungkin."
        footer={form && <><Button onClick={() => setForm(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} disabled={form.fullName.trim().length < 2} onClick={() => void run(() => form.id ? api(`/api/training/participants/${form.id}`, { method: "PATCH", body: form }) : api(`/api/training/projects/${projectId}/participants`, { body: form }), "Peserta disimpan.", () => setForm(null))}>Simpan</Button></>}>
        {form && <div className="grid gap-4 sm:grid-cols-2">
          {error && <div className="sm:col-span-2"><Notice tone="danger">{error}</Notice></div>}
          <TextField className="sm:col-span-2" label="Nama peserta" required maxLength={150} value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} error={fieldErrors.fullName} />
          <TextField label="Instansi / perusahaan" maxLength={150} value={form.organization} onChange={(e) => setForm({ ...form, organization: e.target.value })} />
          <SelectField label="Status peserta" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as ParticipantStatus })}>{PARTICIPANT_STATUSES.map((s) => <option key={s} value={s}>{PARTICIPANT_STATUS_LABEL[s]}</option>)}</SelectField>
          <TextField label="Telepon" inputMode="tel" maxLength={30} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} error={fieldErrors.phone} />
          <TextField label="Email" type="email" maxLength={200} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} error={fieldErrors.email} />
          <TextAreaField className="sm:col-span-2" label="Catatan administratif" rows={2} maxLength={500} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>}
      </Dialog>
    </div>
  );
}
