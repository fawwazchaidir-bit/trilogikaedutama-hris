"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Card, CardHeader, EmptyState, Notice } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { formatDateLong } from "@/lib/format";
import { EMPLOYMENT_LABEL, type EmploymentStatus } from "@/lib/labels";
import type { OrgHistoryDto, OrgProfileDto } from "@/server/services/org";

const CHANGE_LABEL: Record<string, string> = { BASELINE: "Data awal", DIVISION: "Divisi", POSITION: "Jabatan", STATUS: "Status", SUPERVISOR: "Atasan" };

/**
 * Struktur organisasi satu karyawan: divisi, jabatan, status, ATASAN LANGSUNG, tanggal mulai berlaku, bawahan langsung, dan riwayat perubahan.
 * Atasan langsung (kepegawaian) berbeda dari PIC proyek Training. `canManage` menampilkan tombol ubah (HR / Super Admin).
 */
export function OrgCard({ profile, history, divisions, people, canManage, today }: {
  profile: OrgProfileDto; history: OrgHistoryDto[]; divisions: { id: string; name: string; isActive: boolean }[];
  people: { id: string; fullName: string; employeeNo: string }[]; canManage: boolean; today: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const initial = () => ({ divisionId: profile.divisionId ?? "", position: profile.position, employmentStatus: profile.employmentStatus as EmploymentStatus, supervisorId: profile.supervisor?.id ?? "", effectiveFrom: today, note: "" });
  const [form, setForm] = useState(initial);

  async function save() {
    setBusy(true); setError(null); setFe({});
    try {
      await api(`/api/employees/${profile.employeeId}/org`, {
        body: { divisionId: form.divisionId || null, position: form.position, employmentStatus: form.employmentStatus, supervisorId: form.supervisorId || null, effectiveFrom: form.effectiveFrom, note: form.note },
      });
      toast.success("Struktur organisasi diperbarui dan dicatat di riwayat."); setOpen(false); router.refresh();
    } catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); } finally { setBusy(false); }
  }

  const row = (k: string, v: React.ReactNode) => (<div className="grid grid-cols-[10rem_1fr] gap-2 py-2 text-sm"><dt className="text-muted">{k}</dt><dd className="font-medium">{v || "—"}</dd></div>);
  return (
    <Card>
      <CardHeader title="Organisasi & atasan langsung"
        description="Atasan langsung menentukan siapa yang meninjau cuti dan lembur. Ini berbeda dari PIC proyek: menjadi anggota proyek orang lain tidak mengubah atasan."
        actions={canManage ? <Button onClick={() => { setForm(initial()); setError(null); setFe({}); setOpen(true); }}>Ubah jabatan / atasan</Button> : undefined} />
      <div className="grid gap-x-10 px-5 pb-2 md:grid-cols-2">
        <dl className="divide-y divide-line">
          {row("Divisi", profile.divisionName)}
          {row("Jabatan", profile.position)}
          {row("Status", <Badge>{EMPLOYMENT_LABEL[profile.employmentStatus]}</Badge>)}
          {row("Berlaku sejak", <>{formatDateLong(profile.effectiveFrom)}{profile.sinceJoin && <span className="ml-2 text-xs font-normal text-muted">(sejak mulai bekerja)</span>}</>)}
        </dl>
        <dl className="divide-y divide-line">
          {row("Atasan langsung", profile.supervisor ? <>{profile.supervisor.name} <span className="font-normal text-muted">· {profile.supervisor.position}</span>{!profile.supervisor.active && <Badge tone="red">nonaktif</Badge>}</> : <span className="font-normal text-muted">Belum ditetapkan — pengajuan diproses HR/Super Admin</span>)}
          {row("Bawahan langsung", profile.reports.length ? <ul className="font-normal">{profile.reports.map((r) => <li key={r.id}>{r.name} <span className="text-muted">· {r.position}</span></li>)}</ul> : null)}
        </dl>
      </div>
      <div className="border-t border-line px-5 py-4">
        <h3 className="mb-2 text-sm font-semibold">Riwayat perubahan</h3>
        {history.length === 0 ? <EmptyState title="Belum ada riwayat" description="Riwayat dimulai saat data organisasi pertama kali diubah." /> : (
          <ol className="space-y-3 border-l border-line pl-4 text-sm">
            {history.map((h) => (
              <li key={h.id} className="relative">
                <span className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-brand-600" aria-hidden />
                <p className="font-medium">{formatDateLong(h.effectiveFrom)} <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">{h.changes.map((c) => <Badge key={c} tone={c === "BASELINE" ? "gray" : "green"}>{CHANGE_LABEL[c] ?? c}</Badge>)}</span></p>
                <p className="text-muted">{[h.divisionName, h.position, EMPLOYMENT_LABEL[h.employmentStatus], h.supervisorName ? `atasan: ${h.supervisorName}` : "tanpa atasan"].filter(Boolean).join(" · ")}</p>
                {h.note && <p className="text-muted">Catatan: {h.note}</p>}
                <p className="text-xs text-muted">Dicatat oleh {h.createdBy}</p>
              </li>
            ))}
          </ol>
        )}
      </div>
      <Dialog open={open} onClose={() => !busy && setOpen(false)} size="md" title="Ubah jabatan / atasan" description="Perubahan dicatat di riwayat dengan tanggal mulai berlaku. Isian yang tidak diubah dibiarkan apa adanya."
        footer={<><Button onClick={() => setOpen(false)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} onClick={save}>Simpan</Button></>}>
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Divisi" value={form.divisionId} onChange={(e) => setForm({ ...form, divisionId: e.target.value })} error={fe.divisionId}>
              <option value="">— Tanpa divisi —</option>
              {divisions.filter((d) => d.isActive || d.id === form.divisionId).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </SelectField>
            <TextField label="Jabatan" required value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} error={fe.position} />
            <SelectField label="Status karyawan" value={form.employmentStatus} onChange={(e) => setForm({ ...form, employmentStatus: e.target.value as EmploymentStatus })} error={fe.employmentStatus}>
              {(Object.keys(EMPLOYMENT_LABEL) as EmploymentStatus[]).map((k) => <option key={k} value={k}>{EMPLOYMENT_LABEL[k]}</option>)}
            </SelectField>
            <SelectField label="Atasan langsung" value={form.supervisorId} onChange={(e) => setForm({ ...form, supervisorId: e.target.value })} error={fe.supervisorId} hint="Peninjau cuti & lembur.">
              <option value="">— Belum ditetapkan —</option>
              {people.filter((p) => p.id !== profile.employeeId).map((p) => <option key={p.id} value={p.id}>{p.fullName} ({p.employeeNo})</option>)}
            </SelectField>
          </div>
          <TextField label="Berlaku sejak" type="date" required max={today} value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} error={fe.effectiveFrom} hint="Tidak boleh di masa depan atau sebelum perubahan struktural sebelumnya." />
          <TextAreaField label="Catatan" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} error={fe.note} placeholder="Mis. promosi, mutasi antar-divisi, perpanjangan kontrak" />
        </div>
      </Dialog>
    </Card>
  );
}
