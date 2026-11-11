"use client";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, Notice } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/field";
import { api } from "@/lib/api-client";
import { formatDateShort } from "@/lib/format";
import { CHECKLIST_PHASES, CHECKLIST_PHASE_LABEL, type ChecklistPhase } from "@/lib/training/types";
import { UNAVAILABLE_LABEL } from "@/lib/training/availability";
import type { ChecklistDto } from "@/server/services/training/work";
import { ProgressBar } from "./ui";
import { useRunner } from "./use-runner";

interface Draft { phase: ChecklistPhase; title: string; isRequired: boolean; assigneeId: string }

/**
 * Checklist kesiapan proyek. Progres = item selesai ÷ seluruh item (checklist dan tugas sengaja terpisah agar satu pekerjaan
 * tidak terhitung dua kali). Item WAJIB menentukan apakah proyek dapat ditutup tanpa pengecualian.
 */
export function ChecklistPanel({ projectId, data, templates, members, editable }: {
  projectId: string; data: ChecklistDto; templates: { id: string; name: string; itemCount: number }[] | null; members: { employeeId: string; name: string }[]; editable: boolean;
}) {
  const { busy, error, run, reset } = useRunner();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [tpl, setTpl] = useState("");
  const live = editable;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface p-4">
        <div><p className="text-sm font-medium text-ink-soft">Progres checklist</p><ProgressBar progress={data.progress} className="mt-1 w-56" /></div>
        <div className="text-sm">{data.requiredOutstanding > 0 ? <Badge tone="amber">{data.requiredOutstanding} item wajib belum selesai</Badge> : data.progress.total > 0 ? <Badge tone="green">Semua item wajib selesai</Badge> : null}</div>
        {data.canManage && live && (
          <div className="flex flex-wrap items-end gap-2">
            {templates && templates.length > 0 && (
              <>
                <select aria-label="Template checklist" value={tpl} onChange={(e) => setTpl(e.target.value)} className="h-9 rounded-md border border-line bg-white px-2 text-sm"><option value="">Terapkan template…</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                <Button size="sm" disabled={!tpl} loading={busy} onClick={() => void run(() => api(`/api/training/projects/${projectId}/checklist/template`, { body: { templateId: tpl } }), "Template diterapkan.", () => setTpl(""))}>Terapkan</Button>
              </>
            )}
            <Button size="sm" variant="primary" onClick={() => { reset(); setDraft({ phase: "PREPARATION", title: "", isRequired: false, assigneeId: "" }); }}><Plus className="size-3.5" />Item</Button>
          </div>
        )}
      </div>
      {error && !draft && <Notice tone="danger">{error}</Notice>}
      {data.items.length === 0 ? <EmptyState title="Checklist belum tersedia" description={data.canManage ? "Terapkan template standar atau tambahkan item satu per satu. Progres baru dihitung setelah ada item." : "Belum ada item checklist pada proyek ini."} /> : CHECKLIST_PHASES.map((phase) => {
        const items = data.items.filter((i) => i.phase === phase);
        if (items.length === 0) return null;
        return (
          <section key={phase} aria-label={CHECKLIST_PHASE_LABEL[phase]}>
            <h3 className="mb-1.5 text-sm font-semibold text-ink">{CHECKLIST_PHASE_LABEL[phase]} <span className="font-normal text-muted">({items.filter((i) => i.isDone).length}/{items.length})</span></h3>
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
              {items.map((i) => (
                <li key={i.id} className="flex items-start gap-3 px-4 py-2.5">
                  <input type="checkbox" className="mt-1 size-4" checked={i.isDone} disabled={!i.canToggle || !live || busy} aria-label={`${i.title}${i.isRequired ? " (wajib)" : ""}`}
                    onChange={(e) => void run(() => api(`/api/training/checklist-items/${i.id}`, { method: "PATCH", body: { isDone: e.target.checked } }))} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm ${i.isDone ? "text-muted line-through" : "text-ink"}`}>{i.title} {i.isRequired && <Badge tone="red">Wajib</Badge>}</p>
                    <p className="text-xs text-muted">{i.assigneeName ? `PJ: ${i.assigneeName}` : "Tanpa penanggung jawab"}{i.assigneeUnavailable && !i.isDone && <span className="font-medium text-brand-700"> ({UNAVAILABLE_LABEL[i.assigneeUnavailable]})</span>}{i.isDone && i.doneAt && <> · selesai {formatDateShort(i.doneAt)}{i.doneByName ? ` oleh ${i.doneByName}` : ""}</>}{i.sourceTemplateName && <> · dari template &quot;{i.sourceTemplateName}&quot;</>}</p>
                  </div>
                  {data.canManage && live && !i.isDone && <Button size="sm" variant="ghost" aria-label={`Hapus item ${i.title}`} onClick={() => void run(() => api(`/api/training/checklist-items/${i.id}`, { method: "DELETE" }), "Item dihapus.")}><Trash2 className="size-3.5" /></Button>}
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <Dialog open={draft !== null} onClose={() => !busy && setDraft(null)} size="sm" title="Tambah item checklist"
        footer={draft && <><Button onClick={() => setDraft(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} disabled={draft.title.trim().length < 2} onClick={() => void run(() => api(`/api/training/projects/${projectId}/checklist`, { body: { ...draft, assigneeId: draft.assigneeId || null } }), "Item ditambahkan.", () => setDraft(null))}>Tambahkan</Button></>}>
        {draft && <div className="space-y-4">{error && <Notice tone="danger">{error}</Notice>}
          <SelectField label="Tahap" value={draft.phase} onChange={(e) => setDraft({ ...draft, phase: e.target.value as ChecklistPhase })}>{CHECKLIST_PHASES.map((p) => <option key={p} value={p}>{CHECKLIST_PHASE_LABEL[p]}</option>)}</SelectField>
          <TextField label="Judul item" required maxLength={200} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
          <SelectField label="Penanggung jawab" value={draft.assigneeId} onChange={(e) => setDraft({ ...draft, assigneeId: e.target.value })}><option value="">— Tanpa penanggung jawab —</option>{members.map((m) => <option key={m.employeeId} value={m.employeeId}>{m.name}</option>)}</SelectField>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={draft.isRequired} onChange={(e) => setDraft({ ...draft, isRequired: e.target.checked })} /><span>Wajib untuk penutupan proyek</span></label>
        </div>}
      </Dialog>
    </div>
  );
}
