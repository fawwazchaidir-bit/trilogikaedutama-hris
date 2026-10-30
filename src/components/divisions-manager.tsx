"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Notice } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import type { DivisionDto } from "@/server/services/employees";

export function DivisionsManager({ divisions }: { divisions: DivisionDto[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [edit, setEdit] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<unknown>, ok: string, done?: () => void) {
    setBusy(true); setError(null);
    try { await fn(); toast.success(ok); done?.(); router.refresh(); }
    catch (e) { setError(e instanceof ApiClientError ? (e.fieldErrors.name ?? e.message) : errorMessage(e)); }
    finally { setBusy(false); }
  }

  return (
    <>
      <Button onClick={() => { setError(null); setOpen(true); }}><Building2 className="size-4" />Kelola divisi</Button>
      <Dialog open={open} onClose={() => !busy && setOpen(false)} size="md" title="Kelola divisi" description="Divisi dipakai untuk pengelompokan karyawan, filter, dan penugasan jadwal. Divisi tidak dihapus — nonaktifkan bila tidak dipakai.">
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <form className="flex gap-2" aria-label="Tambah divisi" onSubmit={(e) => { e.preventDefault(); void run(() => api("/api/divisions", { body: { name } }), "Divisi ditambahkan.", () => setName("")); }}>
            <input aria-label="Nama divisi baru" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nama divisi baru" maxLength={80} className="h-10 flex-1 rounded-md border border-line px-3 text-sm" />
            <Button type="submit" variant="primary" loading={busy} disabled={name.trim().length < 2}>Tambah</Button>
          </form>
          <ul className="divide-y divide-line rounded-md border border-line">
            {divisions.length === 0 && <li className="px-4 py-3 text-sm text-muted">Belum ada divisi.</li>}
            {divisions.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                {edit?.id === d.id ? (
                  <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => api(`/api/divisions/${d.id}`, { method: "PATCH", body: { name: edit.name } }), "Divisi diubah.", () => setEdit(null)); }}>
                    <input aria-label={`Nama baru untuk ${d.name}`} autoFocus value={edit.name} onChange={(e) => setEdit({ id: d.id, name: e.target.value })} className="h-9 flex-1 rounded-md border border-line px-3 text-sm" />
                    <Button type="submit" size="sm" variant="primary" loading={busy}>Simpan</Button><Button size="sm" onClick={() => setEdit(null)}>Batal</Button>
                  </form>
                ) : (
                  <>
                    <span className={d.isActive ? "font-medium" : "text-muted"}>{d.name} <span className="font-normal text-muted">· {d.employeeCount} karyawan aktif</span>{!d.isActive && <Badge className="ml-2">Nonaktif</Badge>}</span>
                    <span className="flex gap-2">
                      <Button size="sm" onClick={() => { setError(null); setEdit({ id: d.id, name: d.name }); }} aria-label={`Ubah nama ${d.name}`}>Ubah nama</Button>
                      <Button size="sm" onClick={() => void run(() => api(`/api/divisions/${d.id}`, { method: "PATCH", body: { isActive: !d.isActive } }), d.isActive ? "Divisi dinonaktifkan." : "Divisi diaktifkan.")} aria-label={`${d.isActive ? "Nonaktifkan" : "Aktifkan"} divisi ${d.name}`}>{d.isActive ? "Nonaktifkan" : "Aktifkan"}</Button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      </Dialog>
    </>
  );
}
