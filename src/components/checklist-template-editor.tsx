"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Card, CardHeader, Notice } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import type { ChecklistKind } from "@/lib/employee-checklist";
import type { TemplateItemDto } from "@/server/services/employee-checklist-templates";

type Form = { title: string; hint: string; group: string; required: boolean; dueOffsetDays: string; defaultAssigneeId: string };
const blank: Form = { title: "", hint: "", group: "Tambahan HR", required: true, dueOffsetDays: "", defaultAssigneeId: "" };

/** Editor template checklist: judul, keterangan, wajib/opsional, tenggat (hari sejak dimulai), penanggung jawab bawaan, urutan, aktif. Hanya berlaku untuk checklist BARU. */
export function ChecklistTemplateEditor({ kind, items, users, canManage }: { kind: ChecklistKind; items: TemplateItemDto[]; users: { id: string; name: string }[]; canManage: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [dlg, setDlg] = useState<null | { id: string | null }>(null);
  const [form, setForm] = useState<Form>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  const openEdit = (t: TemplateItemDto | null) => {
    setError(null); setFe({});
    setForm(t ? { title: t.title, hint: t.hint ?? "", group: t.group, required: t.required, dueOffsetDays: t.dueOffsetDays === null ? "" : String(t.dueOffsetDays), defaultAssigneeId: t.defaultAssigneeId ?? "" } : blank);
    setDlg({ id: t?.id ?? null });
  };
  async function run(fn: () => Promise<unknown>, ok: string, close = false) {
    setBusy(true); setError(null); setFe({});
    try { await fn(); toast.success(ok); if (close) setDlg(null); router.refresh(); } catch (e) { setError(errorMessage(e)); if (e instanceof ApiClientError) setFe(e.fieldErrors); } finally { setBusy(false); }
  }
  const body = () => ({ title: form.title, hint: form.hint, group: form.group, required: form.required, dueOffsetDays: form.dueOffsetDays.trim() === "" ? null : Number(form.dueOffsetDays), defaultAssigneeId: form.defaultAssigneeId || null });
  const save = () => dlg?.id
    ? run(() => api(`/api/employee-checklist-templates/${dlg.id}`, { method: "PATCH", body: body() }), "Butir template disimpan.", true)
    : run(() => api("/api/employee-checklist-templates", { body: { kind, ...body() } }), "Butir template ditambahkan.", true);

  return (
    <Card>
      <CardHeader title={kind === "ONBOARDING" ? "Template: karyawan masuk" : "Template: karyawan berhenti"}
        description="Perubahan hanya berlaku untuk checklist yang dimulai SESUDAH ini; checklist yang sedang berjalan tidak berubah. Butir tidak dihapus, hanya dinonaktifkan."
        actions={canManage ? <Button variant="primary" onClick={() => openEdit(null)}>Tambah butir</Button> : undefined} />
      <ul className="divide-y divide-line border-t border-line">
        {items.map((t, idx) => (
          <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3 text-sm">
            <div className="min-w-0 flex-1">
              <p className={t.active ? "font-medium" : "font-medium text-muted line-through"}>{t.title}</p>
              <p className="text-xs text-muted">{t.group} · {t.required ? "wajib" : "opsional"} · {t.dueOffsetDays === null ? "tanpa tenggat" : `tenggat ${t.dueOffsetDays} hari sejak dimulai`} · {t.defaultAssigneeName ? `penanggung jawab: ${t.defaultAssigneeName}` : "tanpa penanggung jawab bawaan (HR)"}</p>
              {t.hint && <p className="text-xs text-muted">{t.hint}</p>}
              <div className="mt-1 flex gap-1">{t.builtin && <Badge>Bawaan</Badge>}{!t.active && <Badge tone="amber">Nonaktif</Badge>}</div>
            </div>
            {canManage && (
              <div className="flex shrink-0 flex-wrap gap-2">
                <Button size="sm" disabled={busy || idx === 0} aria-label={`Naikkan: ${t.title}`} onClick={() => run(() => api(`/api/employee-checklist-templates/${t.id}/move`, { body: { direction: "UP" } }), "Urutan diubah.")}><ArrowUp className="size-3.5" /></Button>
                <Button size="sm" disabled={busy || idx === items.length - 1} aria-label={`Turunkan: ${t.title}`} onClick={() => run(() => api(`/api/employee-checklist-templates/${t.id}/move`, { body: { direction: "DOWN" } }), "Urutan diubah.")}><ArrowDown className="size-3.5" /></Button>
                <Button size="sm" disabled={busy} onClick={() => openEdit(t)} aria-label={`Ubah: ${t.title}`}>Ubah</Button>
                <Button size="sm" disabled={busy} onClick={() => run(() => api(`/api/employee-checklist-templates/${t.id}`, { method: "PATCH", body: { active: !t.active } }), t.active ? "Butir dinonaktifkan." : "Butir diaktifkan.")} aria-label={`${t.active ? "Nonaktifkan" : "Aktifkan"}: ${t.title}`}>{t.active ? "Nonaktifkan" : "Aktifkan"}</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {error && !dlg && <div className="px-5 pb-4"><Notice tone="danger">{error}</Notice></div>}
      <Dialog open={!!dlg} onClose={() => !busy && setDlg(null)} size="md" title={dlg?.id ? "Ubah butir template" : "Tambah butir template"}
        footer={<><Button onClick={() => setDlg(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} onClick={save}>Simpan</Button></>}>
        <div className="space-y-4">
          {error && <Notice tone="danger">{error}</Notice>}
          <TextField label="Judul butir" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={fe.title} />
          <TextAreaField label="Keterangan (opsional)" rows={2} value={form.hint} onChange={(e) => setForm({ ...form, hint: e.target.value })} error={fe.hint} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Kelompok" value={form.group} onChange={(e) => setForm({ ...form, group: e.target.value })} error={fe.group} />
            <TextField label="Tenggat (hari sejak dimulai)" type="number" min={0} max={365} value={form.dueOffsetDays} onChange={(e) => setForm({ ...form, dueOffsetDays: e.target.value })} error={fe.dueOffsetDays} hint="Kosong = tanpa tenggat dan tanpa pengingat." />
          </div>
          <SelectField label="Penanggung jawab bawaan" value={form.defaultAssigneeId} onChange={(e) => setForm({ ...form, defaultAssigneeId: e.target.value })} error={fe.defaultAssigneeId} hint="Diberi tahu dan diingatkan; boleh menandai butir ini.">
            <option value="">— HR (tanpa penanggung jawab khusus) —</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </SelectField>
          <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} />Wajib (proses tidak dapat diselesaikan sebelum butir ini beres)</label>
        </div>
      </Dialog>
    </Card>
  );
}
