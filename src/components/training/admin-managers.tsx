"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, Notice } from "@/components/ui/card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { api } from "@/lib/api-client";
import { ROLE_LABELS } from "@/lib/permissions";
import {
  ACTIVITY_KINDS, ACTIVITY_KIND_LABEL, CHECKLIST_PHASES, CHECKLIST_PHASE_LABEL, TRAINING_LEVELS, TRAINING_LEVEL_HELP, TRAINING_LEVEL_LABEL,
  type ActivityKind, type ChecklistPhase, type TrainingLevel,
} from "@/lib/training/types";
import { suggestLevel } from "@/lib/training/suggest";
import type { ProgramDto } from "@/server/services/training/projects";
import type { AccessRowDto } from "@/server/services/training/access";
import type { TemplateDto } from "@/server/services/training/work";
import { useRunner } from "./use-runner";

// ───────────────────────── Program ─────────────────────────

interface ProgForm { id?: string; name: string; kind: ActivityKind; description: string; isActive: boolean }

export function ProgramManager({ programs, canManage }: { programs: ProgramDto[]; canManage: boolean }) {
  const { busy, error, fieldErrors, run, reset } = useRunner();
  const [form, setForm] = useState<ProgForm | null>(null);
  const open = (p?: ProgramDto) => { reset(); setForm(p ? { id: p.id, name: p.name, kind: p.kind, description: p.description ?? "", isActive: p.isActive } : { name: "", kind: "REGULAR", description: "", isActive: true }); };
  return (
    <div className="space-y-3">
      {canManage && <div className="flex justify-end"><Button variant="primary" onClick={() => open()}><Plus className="size-4" />Program baru</Button></div>}
      {programs.length === 0 ? <EmptyState title="Belum ada program" description={canManage ? "Program = jenis pelatihan yang dilaksanakan berkali-kali (batch). Contoh: Sertifikasi BNSP Food Production, Pelatihan HACCP." : "Belum ada program."} /> : (
        <TableWrap><Table>
          <thead><tr><Th>Program</Th><Th>Jenis</Th><Th>Deskripsi</Th><Th>Batch</Th>{canManage && <Th />}</tr></thead>
          <tbody>{programs.map((p) => (
            <tr key={p.id}>
              <Td><p className={`font-medium ${p.isActive ? "text-ink" : "text-muted"}`}>{p.name}</p>{!p.isActive && <Badge>Nonaktif</Badge>}</Td>
              <Td>{ACTIVITY_KIND_LABEL[p.kind]}</Td><Td className="max-w-md"><span className="line-clamp-2">{p.description ?? "—"}</span></Td><Td>{p.projectCount}</Td>
              {canManage && <Td align="right"><Button size="sm" onClick={() => open(p)}>Ubah</Button></Td>}
            </tr>
          ))}</tbody>
        </Table></TableWrap>
      )}
      <Dialog open={form !== null} onClose={() => !busy && setForm(null)} size="md" title={form?.id ? "Ubah program" : "Program baru"}
        footer={form && <><Button onClick={() => setForm(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} disabled={form.name.trim().length < 3} onClick={() => void run(() => form.id ? api(`/api/training/programs/${form.id}`, { method: "PATCH", body: form }) : api("/api/training/programs", { body: form }), "Program disimpan.", () => setForm(null))}>Simpan</Button></>}>
        {form && <div className="space-y-4">{error && <Notice tone="danger">{error}</Notice>}
          <TextField label="Nama program" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={fieldErrors.name} />
          <SelectField label="Jenis" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as ActivityKind })}>{ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{ACTIVITY_KIND_LABEL[k]}</option>)}</SelectField>
          <TextAreaField label="Deskripsi singkat" rows={3} maxLength={1000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          {form.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />Aktif (dapat dipilih untuk proyek baru)</label>}
        </div>}
      </Dialog>
    </div>
  );
}

// ───────────────────────── Template checklist ─────────────────────────

interface TplForm { id?: string; name: string; description: string; isActive: boolean; items: { phase: ChecklistPhase; title: string; isRequired: boolean }[] }

export function TemplateManager({ templates, canManage }: { templates: TemplateDto[]; canManage: boolean }) {
  const { busy, error, run, reset } = useRunner();
  const [form, setForm] = useState<TplForm | null>(null);
  const open = (t?: TemplateDto) => { reset(); setForm(t ? { id: t.id, name: t.name, description: t.description ?? "", isActive: t.isActive, items: t.items.map(({ phase, title, isRequired }) => ({ phase, title, isRequired })) } : { name: "", description: "", isActive: true, items: [{ phase: "PREPARATION", title: "", isRequired: false }] }); };
  const setItem = (i: number, p: Partial<TplForm["items"][number]>) => form && setForm({ ...form, items: form.items.map((it, k) => (k === i ? { ...it, ...p } : it)) });
  return (
    <div className="space-y-3">
      {canManage && <div className="flex flex-wrap justify-end gap-2">
        <Button loading={busy} onClick={() => void run(() => api<{ created: boolean }>("/api/training/checklist-templates/default", { method: "POST", body: {} }), "Template standar siap.")}>Buat template standar</Button>
        <Button variant="primary" onClick={() => open()}><Plus className="size-4" />Template baru</Button>
      </div>}
      {error && !form && <Notice tone="danger">{error}</Notice>}
      {templates.length === 0 ? <EmptyState title="Belum ada template" description={canManage ? "Template checklist dipakai saat membuat proyek. Item yang diterapkan menjadi milik proyek (tidak berubah bila template diubah). Gunakan “Buat template standar” untuk daftar usulan." : "Belum ada template."} /> : (
        <div className="grid gap-3 md:grid-cols-2">{templates.map((t) => (
          <section key={t.id} className="rounded-lg border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-2"><div><h3 className="font-semibold text-ink">{t.name} {!t.isActive && <Badge>Nonaktif</Badge>}</h3>{t.description && <p className="text-xs text-muted">{t.description}</p>}</div>{canManage && <Button size="sm" onClick={() => open(t)}>Ubah</Button>}</div>
            <p className="mt-2 text-xs text-muted">{t.items.length} item · {t.items.filter((i) => i.isRequired).length} wajib</p>
            {CHECKLIST_PHASES.map((ph) => { const its = t.items.filter((i) => i.phase === ph); return its.length === 0 ? null : <div key={ph} className="mt-2"><p className="text-xs font-semibold uppercase tracking-wide text-muted">{CHECKLIST_PHASE_LABEL[ph]}</p><ul className="mt-0.5 list-disc pl-5 text-sm">{its.map((i, k) => <li key={k}>{i.title}{i.isRequired && <> <Badge tone="red">Wajib</Badge></>}</li>)}</ul></div>; })}
          </section>))}</div>
      )}
      <Dialog open={form !== null} onClose={() => !busy && setForm(null)} size="lg" title={form?.id ? "Ubah template" : "Template baru"} description="Menyimpan mengganti daftar item template. Checklist proyek yang sudah dibuat tidak terpengaruh."
        footer={form && <><Button onClick={() => setForm(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} disabled={form.name.trim().length < 3 || form.items.length === 0 || form.items.some((i) => i.title.trim().length < 2)} onClick={() => void run(() => form.id ? api(`/api/training/checklist-templates/${form.id}`, { method: "PUT", body: form }) : api("/api/training/checklist-templates", { body: form }), "Template disimpan.", () => setForm(null))}>Simpan</Button></>}>
        {form && <div className="space-y-4">{error && <Notice tone="danger">{error}</Notice>}
          <div className="grid gap-4 sm:grid-cols-2"><TextField label="Nama template" required maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /><TextField label="Deskripsi" maxLength={500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
          {form.id && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />Aktif (dapat dipilih untuk proyek baru)</label>}
          <div className="space-y-2" role="group" aria-label="Item template">
            {form.items.map((it, i) => (
              <div key={i} className="grid grid-cols-[8rem_1fr_auto_auto] items-center gap-2">
                <select aria-label={`Tahap item ${i + 1}`} value={it.phase} onChange={(e) => setItem(i, { phase: e.target.value as ChecklistPhase })} className="h-9 rounded-md border border-line bg-white px-2 text-sm">{CHECKLIST_PHASES.map((p) => <option key={p} value={p}>{CHECKLIST_PHASE_LABEL[p]}</option>)}</select>
                <input aria-label={`Judul item ${i + 1}`} value={it.title} maxLength={200} onChange={(e) => setItem(i, { title: e.target.value })} className="h-9 rounded-md border border-line px-2 text-sm" placeholder="Judul item" />
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" className="size-4" checked={it.isRequired} onChange={(e) => setItem(i, { isRequired: e.target.checked })} />Wajib</label>
                <Button size="sm" variant="ghost" aria-label={`Hapus item ${i + 1}`} onClick={() => setForm({ ...form, items: form.items.filter((_, k) => k !== i) })}><Trash2 className="size-3.5" /></Button>
              </div>))}
            <Button size="sm" onClick={() => setForm({ ...form, items: [...form.items, { phase: form.items.at(-1)?.phase ?? "PREPARATION", title: "", isRequired: false }] })}><Plus className="size-3.5" />Tambah item</Button>
          </div>
        </div>}
      </Dialog>
    </div>
  );
}

// ───────────────────────── Akses modul (Super Admin) ─────────────────────────

export function AccessManager({ rows }: { rows: AccessRowDto[] }) {
  const { busy, error, run, reset } = useRunner();
  const [sel, setSel] = useState<Record<string, TrainingLevel | "">>(() => Object.fromEntries(rows.map((r) => [r.userId, r.level ?? ""])));
  const [busyId, setBusyId] = useState<string | null>(null);
  const save = async (r: AccessRowDto) => {
    setBusyId(r.userId); reset();
    const level = sel[r.userId];
    await run(() => level ? api("/api/training/access", { body: { userId: r.userId, level } }) : api("/api/training/access", { method: "DELETE", body: { userId: r.userId } }), level ? "Level akses disimpan." : "Level akses dicabut.");
    setBusyId(null);
  };
  return (
    <div className="space-y-4">
      <div className="grid gap-3 md:grid-cols-3">{TRAINING_LEVELS.map((l) => <div key={l} className="rounded-lg border border-line bg-surface p-3"><p className="text-sm font-semibold text-ink">{TRAINING_LEVEL_LABEL[l]}</p><p className="mt-1 text-xs text-muted">{TRAINING_LEVEL_HELP[l]}</p></div>)}</div>
      <Notice tone="info">Level modul <strong>tidak mengubah role HRIS</strong> (slip gaji, presensi, cuti, dan data sensitif tetap mengikuti aturan HRIS). Karyawan tanpa level tetap dapat melihat proyek tempat ia ditugaskan. Kolom “Usulan” berasal dari bagan organisasi dan hanya petunjuk — tidak diterapkan otomatis.</Notice>
      {error && <Notice tone="danger">{error}</Notice>}
      <TableWrap><Table>
        <thead><tr><Th>Akun</Th><Th>Jabatan (info)</Th><Th>Level modul &amp; usulan</Th><Th /></tr></thead>
        <tbody>{rows.map((r) => {
          const sug = suggestLevel(r.position);
          const changed = (sel[r.userId] ?? "") !== (r.level ?? "");
          return (
            <tr key={r.userId}>
              <Td><p className="font-medium text-ink">{r.name}</p><p className="text-xs text-muted">{r.email}</p><span className="mt-1 inline-block"><Badge>Role HRIS: {ROLE_LABELS[r.globalRole as keyof typeof ROLE_LABELS] ?? r.globalRole}</Badge></span></Td>
              <Td><span className="text-sm">{r.position ?? "—"}</span>{r.division && <p className="text-xs text-muted">{r.division}</p>}</Td>
              <Td>{r.intern && <p className="mb-1 max-w-sm whitespace-normal text-xs text-amber-800">Karyawan berstatus Magang: tidak dapat diberi level modul.</p>}{!r.intern && !r.level && r.jobLevel === "MANAGER" && <p className="mb-1"><Badge tone="blue">Pemantau (otomatis: tingkat Manajer)</Badge></p>}<select aria-label={`Level modul ${r.name}`} disabled={r.intern} value={sel[r.userId] ?? ""} onChange={(e) => setSel({ ...sel, [r.userId]: e.target.value as TrainingLevel | "" })} className="h-9 rounded-md border border-line bg-white px-2 text-sm"><option value="">Tanpa level</option>{TRAINING_LEVELS.map((l) => <option key={l} value={l}>{TRAINING_LEVEL_LABEL[l]}</option>)}</select>
                <p className="mt-1.5 max-w-sm whitespace-normal text-xs"><span className="font-medium">Usulan: {sug.level ? TRAINING_LEVEL_LABEL[sug.level] : "tanpa level"}</span><span className="block text-muted">{sug.reason}</span></p></Td>
              <Td align="right"><Button size="sm" variant={changed ? "primary" : "secondary"} disabled={!changed || (busy && busyId !== r.userId)} loading={busy && busyId === r.userId} onClick={() => void save(r)}>Simpan</Button></Td>
            </tr>);
        })}</tbody>
      </Table></TableWrap>
    </div>
  );
}
