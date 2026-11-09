"use client";
import { useState } from "react";
import { UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, Dialog } from "@/components/ui/dialog";
import { EmptyState, Notice } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/field";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { formatDateShort } from "@/lib/format";
import { PROJECT_ROLES, PROJECT_ROLE_LABEL, type ProjectRole } from "@/lib/training/types";
import type { MemberDto } from "@/server/services/training/projects";
import type { DirectoryEmployee } from "@/server/services/training/access";
import { useRunner } from "./use-runner";

export function TeamPanel({ projectId, members, directory, canManageTeam, canManagePic, editable }: {
  projectId: string; members: MemberDto[]; directory: DirectoryEmployee[] | null; canManageTeam: boolean; canManagePic: boolean; editable: boolean;
}) {
  const { busy, error, run, reset } = useRunner();
  const [add, setAdd] = useState<{ employeeId: string; role: ProjectRole; note: string } | null>(null);
  const [edit, setEdit] = useState<{ id: string; name: string; role: ProjectRole; note: string; wasPic: boolean } | null>(null);
  const [end, setEnd] = useState<MemberDto | null>(null);
  const active = members.filter((m) => m.active);
  const history = members.filter((m) => !m.active);
  const taken = new Set(active.map((m) => m.employeeId));
  const roles = PROJECT_ROLES.filter((r) => r !== "PROJECT_MANAGER" || canManagePic);
  const manage = canManageTeam && editable;
  const canTouch = (m: MemberDto) => manage && (m.role !== "PROJECT_MANAGER" || canManagePic);

  return (
    <div className="space-y-4">
      {manage && <div className="flex justify-end"><Button variant="primary" disabled={!directory} onClick={() => { reset(); setAdd({ employeeId: "", role: "STAFF", note: "" }); }}><UserPlus className="size-4" />Tambah anggota</Button></div>}
      {!editable && <Notice tone="info">Proyek sudah ditutup/dibatalkan; tim tidak dapat diubah.</Notice>}
      {active.length === 0 ? <EmptyState title="Belum ada anggota tim" description={manage ? "Tambahkan karyawan dan tetapkan perannya. Peran proyek tidak mengubah hak akses Anda di HRIS." : "Belum ada anggota yang ditetapkan."} /> : (
        <TableWrap>
          <Table>
            <thead><tr><Th>Nama</Th><Th>Peran di proyek</Th><Th>Mulai</Th><Th>Tanggung jawab saat ini</Th>{manage && <Th />}</tr></thead>
            <tbody>
              {active.map((m) => (
                <tr key={m.id}>
                  <Td><p className="font-medium text-ink">{m.name}</p><p className="text-xs text-muted">{m.employeeNo} · {m.position}</p></Td>
                  <Td><Badge tone={m.role === "PROJECT_MANAGER" ? "red" : "gray"}>{PROJECT_ROLE_LABEL[m.role]}</Badge>{m.note && <p className="mt-1 text-xs text-muted">{m.note}</p>}</Td>
                  <Td>{formatDateShort(m.startedAt)}</Td>
                  <Td><span className="text-sm">{m.openTasks} tugas terbuka · {m.openChecklist} checklist</span></Td>
                  {manage && <Td align="right">{canTouch(m) && <span className="inline-flex gap-2"><Button size="sm" onClick={() => { reset(); setEdit({ id: m.id, name: m.name, role: m.role, note: m.note ?? "", wasPic: m.role === "PROJECT_MANAGER" }); }}>Ubah</Button><Button size="sm" variant="danger" onClick={() => { reset(); setEnd(m); }}>Akhiri</Button></span>}</Td>}
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
      {history.length > 0 && (
        <details className="rounded-md border border-line bg-surface px-4 py-3 text-sm">
          <summary className="cursor-pointer font-medium text-ink-soft">Riwayat penugasan ({history.length})</summary>
          <ul className="mt-2 divide-y divide-line">{history.map((m) => <li key={m.id} className="py-1.5">{m.name} · {PROJECT_ROLE_LABEL[m.role]} · {formatDateShort(m.startedAt)} – {formatDateShort(m.endedAt)}</li>)}</ul>
        </details>
      )}

      <Dialog open={add !== null} onClose={() => !busy && setAdd(null)} title="Tambah anggota tim" description="Pilih karyawan aktif. Penugasan ini hanya berlaku di proyek ini." footer={add && <><Button onClick={() => setAdd(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} disabled={!add.employeeId} onClick={() => void run(() => api(`/api/training/projects/${projectId}/members`, { body: add }), "Anggota ditambahkan.", () => setAdd(null))}>Tambahkan</Button></>}>
        {add && <div className="space-y-4">{error && <Notice tone="danger">{error}</Notice>}
          <SelectField label="Karyawan" required value={add.employeeId} onChange={(e) => setAdd({ ...add, employeeId: e.target.value })}>
            <option value="">— Pilih karyawan —</option>
            {directory?.filter((d) => !taken.has(d.id)).map((d) => <option key={d.id} value={d.id}>{d.fullName} · {d.position}{d.division ? ` (${d.division})` : ""}</option>)}
          </SelectField>
          <SelectField label="Peran di proyek" value={add.role} onChange={(e) => setAdd({ ...add, role: e.target.value as ProjectRole })} hint={canManagePic ? undefined : "Project Manager (PIC) hanya dapat ditetapkan oleh Koordinator Program."}>
            {roles.map((r) => <option key={r} value={r}>{PROJECT_ROLE_LABEL[r]}</option>)}
          </SelectField>
          <TextField label="Catatan" maxLength={200} value={add.note} onChange={(e) => setAdd({ ...add, note: e.target.value })} />
        </div>}
      </Dialog>

      <Dialog open={edit !== null} onClose={() => !busy && setEdit(null)} title={`Ubah penugasan — ${edit?.name ?? ""}`} footer={edit && <><Button onClick={() => setEdit(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} onClick={() => void run(() => api(`/api/training/projects/${projectId}/members/${edit.id}`, { method: "PATCH", body: { role: edit.role, note: edit.note } }), "Penugasan diperbarui.", () => setEdit(null))}>Simpan</Button></>}>
        {edit && <div className="space-y-4">{error && <Notice tone="danger">{error}</Notice>}
          <SelectField label="Peran di proyek" value={edit.role} onChange={(e) => setEdit({ ...edit, role: e.target.value as ProjectRole })}>
            {(edit.wasPic ? PROJECT_ROLES : roles).map((r) => <option key={r} value={r}>{PROJECT_ROLE_LABEL[r]}</option>)}
          </SelectField>
          <TextField label="Catatan" maxLength={200} value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
        </div>}
      </Dialog>

      <ConfirmDialog open={end !== null} onClose={() => setEnd(null)} loading={busy} tone="danger" title={`Akhiri penugasan ${end?.name ?? ""}?`} confirmLabel="Ya, akhiri"
        description="Ia langsung kehilangan akses ke proyek ini. Tugas yang masih dipegangnya tidak berubah dan akan ditandai agar dialihkan."
        onConfirm={() => end && void run(() => api<{ openTasks: number }>(`/api/training/projects/${projectId}/members/${end.id}`, { method: "DELETE" }), "Penugasan diakhiri.", () => setEnd(null))}>
        {error && <Notice tone="danger">{error}</Notice>}
      </ConfirmDialog>
    </div>
  );
}
