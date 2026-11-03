"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, EmptyState, Notice } from "@/components/ui/card";
import { Dialog } from "@/components/ui/dialog";
import { PasswordField, SelectField, TextField } from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { ROLE_LABELS, type Role } from "@/lib/permissions";
import { formatDateTime } from "@/lib/format";
import type { UserDto } from "@/server/services/users";

interface EmpOpt { id: string; label: string }

export function UsersManager({ items, selfId, roles, freeEmployees }: { items: UserDto[]; selfId: string; roles: Role[]; freeEmployees: EmpOpt[] }) {
  const router = useRouter();
  const toast = useToast();
  const [create, setCreate] = useState<null | { email: string; name: string; role: Role; password: string; employeeId: string }>(null);
  const [reset, setReset] = useState<null | { id: string; name: string; password: string }>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const fail = (e: unknown) => { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); };
  async function submit(fn: () => Promise<unknown>, ok: string, done: () => void) {
    setBusy(true); setError(null); setFe({});
    try { await fn(); toast.success(ok); done(); router.refresh(); } catch (e) { fail(e); } finally { setBusy(false); }
  }
  const patch = (u: UserDto, body: Record<string, unknown>, msg: string) => api(`/api/users/${u.id}`, { method: "PATCH", body }).then(() => { toast.success(msg); router.refresh(); }).catch((e) => toast.error(errorMessage(e)));
  const superAdmin = roles.includes("SUPER_ADMIN");
  return (
    <Card>
      <CardHeader title="Akun pengguna" description={superAdmin ? "Super Admin mengelola akun admin dan karyawan. Akun baru wajib mengganti password sementara pada login pertama." : "Anda dapat membuat dan mengelola akun karyawan. Akun admin hanya dapat dikelola Super Admin."}
        actions={<Button variant="primary" onClick={() => { setError(null); setFe({}); setCreate({ email: "", name: "", role: roles.includes("EMPLOYEE") && !superAdmin ? "EMPLOYEE" : "HR_ADMIN", password: "", employeeId: "" }); }}><Plus className="size-4" />Tambah akun</Button>} />
      {items.length === 0 ? <EmptyState title="Belum ada akun" /> : (
        <TableWrap><Table>
          <thead><tr><Th>Nama</Th><Th>Email</Th><Th>Peran</Th><Th>Karyawan</Th><Th>Login terakhir</Th><Th>Status</Th><Th align="right">Aksi</Th></tr></thead>
          <tbody>{items.map((u) => (
            <tr key={u.id}>
              <Td className="font-medium">{u.name}{u.id === selfId && <Badge className="ml-2">Anda</Badge>}{u.isDemo && <Badge tone="amber" className="ml-2">Demo</Badge>}</Td><Td>{u.email}</Td>
              <Td>{superAdmin && u.id !== selfId ? (
                <select aria-label={`Peran ${u.name}`} value={u.role} onChange={(e) => void patch(u, { role: e.target.value }, "Peran diubah. Pengguna perlu login ulang.")} className="h-8 rounded-md border border-line bg-white px-2 text-sm">
                  {(Object.keys(ROLE_LABELS) as Role[]).filter((r) => r !== "EMPLOYEE" || u.employeeId).map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</select>) : ROLE_LABELS[u.role]}</Td>
              <Td>{u.employeeNo ?? "—"}</Td><Td>{u.lastLoginAt ? formatDateTime(u.lastLoginAt) : "Belum pernah"}</Td>
              <Td>{u.isActive ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge>}{u.mustChangePassword && <Badge tone="amber" className="ml-1">Wajib ganti password</Badge>}{u.twoFactorEnabled && <Badge tone="blue" className="ml-1">2FA</Badge>}</Td>
              <Td align="right"><div className="flex justify-end gap-2">
                <Button size="sm" onClick={() => { setError(null); setFe({}); setReset({ id: u.id, name: u.name, password: "" }); }}>Reset password</Button>
                {superAdmin && u.twoFactorEnabled && u.id !== selfId && <Button size="sm" onClick={() => { if (window.confirm(`Atur ulang 2FA untuk ${u.name}? Semua sesinya diakhiri dan 2FA harus diaktifkan kembali.`)) void api(`/api/users/${u.id}/reset-2fa`, { body: {} }).then(() => { toast.success("2FA diatur ulang."); router.refresh(); }).catch((e) => toast.error(errorMessage(e))); }}>Reset 2FA</Button>}
                {u.id !== selfId && (u.isActive ? <Button size="sm" variant="danger" onClick={() => void patch(u, { isActive: false }, "Akun dinonaktifkan.")}>Nonaktifkan</Button> : <Button size="sm" onClick={() => void patch(u, { isActive: true }, "Akun diaktifkan.")}>Aktifkan</Button>)}
              </div></Td>
            </tr>
          ))}</tbody>
        </Table></TableWrap>
      )}

      <Dialog open={!!create} onClose={() => !busy && setCreate(null)} title="Tambah akun" size="sm"
        footer={<><Button onClick={() => setCreate(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} onClick={() => create && void submit(() => api("/api/users", { body: { ...create, employeeId: create.employeeId || null } }), "Akun dibuat.", () => setCreate(null))}>Buat akun</Button></>}>
        {create && <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <SelectField label="Peran" value={create.role} onChange={(e) => setCreate({ ...create, role: e.target.value as Role })} error={fe.role}>{roles.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}</SelectField>
          {(create.role === "EMPLOYEE" || create.employeeId) && <SelectField label="Tautkan ke karyawan" required={create.role === "EMPLOYEE"} value={create.employeeId} onChange={(e) => { const emp = freeEmployees.find((x) => x.id === e.target.value); setCreate({ ...create, employeeId: e.target.value, name: emp ? emp.label.split(" (")[0]! : create.name }); }} error={fe.employeeId}>
            <option value="">— Pilih karyawan —</option>{freeEmployees.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</SelectField>}
          {create.role !== "EMPLOYEE" && !create.employeeId && freeEmployees.length > 0 && <button type="button" className="text-sm text-brand-700 underline" onClick={() => setCreate({ ...create, employeeId: freeEmployees[0]!.id })}>Tautkan juga ke data karyawan (agar admin ini dapat absen)</button>}
          <TextField label="Nama" required value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} error={fe.name} />
          <TextField label="Email" type="email" required value={create.email} onChange={(e) => setCreate({ ...create, email: e.target.value })} error={fe.email} />
          <PasswordField label="Password sementara" autoComplete="new-password" required value={create.password} onChange={(e) => setCreate({ ...create, password: e.target.value })} error={fe.password} hint="Minimal 12 karakter. Sampaikan lewat kanal aman; wajib diganti pada login pertama." />
        </div>}
      </Dialog>
      <Dialog open={!!reset} onClose={() => !busy && setReset(null)} title={`Reset password — ${reset?.name ?? ""}`} size="sm"
        footer={<><Button onClick={() => setReset(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} onClick={() => reset && void submit(() => api(`/api/users/${reset.id}/password`, { body: { password: reset.password } }), "Password direset. Sesi pengguna diakhiri.", () => setReset(null))}>Reset</Button></>}>
        {reset && <div className="space-y-4">{error && <Notice tone="danger">{error}</Notice>}<PasswordField label="Password sementara baru" autoComplete="new-password" required value={reset.password} onChange={(e) => setReset({ ...reset, password: e.target.value })} error={fe.password} hint="Pengguna wajib menggantinya saat login berikutnya." /></div>}
      </Dialog>
    </Card>
  );
}
