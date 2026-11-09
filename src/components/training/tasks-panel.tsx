"use client";
import { DiscussButton } from "@/components/chat/discuss-button";
import { useState } from "react";
import { MessageSquare, Pencil, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState, Notice } from "@/components/ui/card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { api } from "@/lib/api-client";
import { formatDateShort, formatDateTime } from "@/lib/format";
import { TASK_PRIORITIES, TASK_PRIORITY_LABEL, TASK_STATUS_LABEL, type TaskPriority, type TaskStatus } from "@/lib/training/types";
import type { TaskDto, TaskCommentDto } from "@/server/services/training/work";
import Link from "next/link";
import { PriorityBadge, TaskStatusBadge } from "./ui";
import { useRunner } from "./use-runner";

interface FormState { id?: string; title: string; description: string; assigneeId: string; dueDate: string; priority: TaskPriority; requiresReview: boolean }
const BLANK: FormState = { title: "", description: "", assigneeId: "", dueDate: "", priority: "NORMAL", requiresReview: false };

/** Daftar tugas (dipakai di tab proyek dan halaman "Tugas Saya"). Tombol hanya muncul sesuai `allowedNext`/`canEdit` dari server. */
export function TasksPanel({ tasks, projectId, members = [], canCreate = false, editable = true, showProject = false }: {
  tasks: TaskDto[]; projectId?: string; members?: { employeeId: string; name: string }[]; canCreate?: boolean; editable?: boolean; showProject?: boolean;
}) {
  const { busy, error, fieldErrors, run, reset } = useRunner();
  const [form, setForm] = useState<FormState | null>(null);
  const [status, setStatus] = useState<{ task: TaskDto; to: TaskStatus | ""; note: string } | null>(null);
  const [talk, setTalk] = useState<{ task: TaskDto; items: TaskCommentDto[]; body: string } | null>(null);

  async function openComments(task: TaskDto) {
    reset(); setTalk({ task, items: [], body: "" });
    try { const items = await api<TaskCommentDto[]>(`/api/training/tasks/${task.id}/comments`); setTalk({ task, items, body: "" }); } catch { /* pesan ditampilkan oleh run berikutnya */ }
  }
  const showForm = (t?: TaskDto) => { reset(); setForm(t ? { id: t.id, title: t.title, description: t.description ?? "", assigneeId: t.assigneeId ?? "", dueDate: t.dueDate ?? "", priority: t.priority, requiresReview: t.requiresReview } : BLANK); };
  const body = (f: FormState) => ({ title: f.title, description: f.description, assigneeId: f.assigneeId || null, dueDate: f.dueDate || null, priority: f.priority, requiresReview: f.requiresReview });

  return (
    <div className="space-y-3">
      {canCreate && editable && projectId && <div className="flex justify-end"><Button variant="primary" onClick={() => showForm()}><Plus className="size-4" />Tugas baru</Button></div>}
      {tasks.length === 0 ? <EmptyState title="Belum ada tugas" description={canCreate ? "Buat tugas, tentukan penanggung jawab dan tenggatnya." : "Tidak ada tugas pada daftar ini."} /> : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {tasks.map((t) => (
            <li key={t.id} className="flex flex-wrap items-start justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className={`font-medium ${t.status === "DONE" || t.status === "CANCELLED" ? "text-muted line-through" : "text-ink"}`}>{t.title}</p>
                  <TaskStatusBadge status={t.status} /><PriorityBadge priority={t.priority} />
                  {t.requiresReview && <Badge tone="amber">Perlu diperiksa</Badge>}
                  {t.overdue && <Badge tone="red">Terlambat</Badge>}
                </div>
                {t.description && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{t.description}</p>}
                <p className="mt-1 text-xs text-muted">
                  {showProject && <><Link href={`/training/proyek/${t.projectId}?tab=tugas`} className="font-medium text-ink-soft hover:underline">{t.projectCode}</Link> · </>}
                  {t.assigneeName ?? "Belum ada penanggung jawab"}{t.assigneeInactive && <span className="font-medium text-brand-700"> (sudah tidak di tim — alihkan)</span>}
                  {t.dueDate && <> · tenggat {formatDateShort(t.dueDate)}</>}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DiscussButton type="TRAINING_TASK" id={t.id} />
                <Button size="sm" onClick={() => void openComments(t)} aria-label={`Komentar tugas ${t.title}`}><MessageSquare className="size-3.5" />{t.commentCount}</Button>
                {editable && t.canEdit && <Button size="sm" onClick={() => showForm(t)} aria-label={`Ubah tugas ${t.title}`}><Pencil className="size-3.5" />Ubah</Button>}
                {editable && t.allowedNext.length > 0 && <Button size="sm" variant="primary" onClick={() => { reset(); setStatus({ task: t, to: t.allowedNext[0]!, note: "" }); }}>Ubah status</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={form !== null} onClose={() => !busy && setForm(null)} title={form?.id ? "Ubah tugas" : "Tugas baru"} size="md"
        footer={form && <><Button onClick={() => setForm(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} disabled={form.title.trim().length < 3}
          onClick={() => void run(() => form.id ? api(`/api/training/tasks/${form.id}`, { method: "PATCH", body: body(form) }) : api(`/api/training/projects/${projectId}/tasks`, { body: body(form) }), form.id ? "Tugas diperbarui." : "Tugas dibuat.", () => setForm(null))}>Simpan</Button></>}>
        {form && <div className="space-y-4">{error && <Notice tone="danger">{error}</Notice>}
          <TextField label="Judul tugas" required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} error={fieldErrors.title} />
          <TextAreaField label="Deskripsi" rows={3} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField label="Penanggung jawab" value={form.assigneeId} onChange={(e) => setForm({ ...form, assigneeId: e.target.value })} error={fieldErrors.assigneeId} hint="Hanya anggota aktif proyek.">
              <option value="">— Belum ditentukan —</option>{members.map((m) => <option key={m.employeeId} value={m.employeeId}>{m.name}</option>)}
            </SelectField>
            <TextField label="Tenggat" type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} error={fieldErrors.dueDate} />
            <SelectField label="Prioritas" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}>
              {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{TASK_PRIORITY_LABEL[p]}</option>)}
            </SelectField>
          </div>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-0.5 size-4" checked={form.requiresReview} onChange={(e) => setForm({ ...form, requiresReview: e.target.checked })} /><span><span className="font-medium text-ink-soft">Hasil perlu diperiksa</span><span className="block text-xs text-muted">Penanggung jawab hanya dapat mengirim ke &quot;Menunggu pemeriksaan&quot;; orang lain yang berwenang menyelesaikannya.</span></span></label>
        </div>}
      </Dialog>

      <Dialog open={status !== null} onClose={() => !busy && setStatus(null)} size="sm" title="Ubah status tugas" description={status?.task.title}
        footer={status && <><Button onClick={() => setStatus(null)} disabled={busy}>Batal</Button><Button variant="primary" loading={busy} disabled={!status.to} onClick={() => void run(() => api(`/api/training/tasks/${status.task.id}/status`, { body: { status: status.to, note: status.note } }), "Status tugas diperbarui.", () => setStatus(null))}>Simpan</Button></>}>
        {status && <div className="space-y-4">{error && <Notice tone="danger">{error}</Notice>}
          <SelectField label="Status baru" value={status.to} onChange={(e) => setStatus({ ...status, to: e.target.value as TaskStatus })}>
            {status.task.allowedNext.map((s) => <option key={s} value={s}>{TASK_STATUS_LABEL[s]}</option>)}
          </SelectField>
          <TextAreaField label="Catatan (opsional)" rows={2} maxLength={500} value={status.note} onChange={(e) => setStatus({ ...status, note: e.target.value })} hint="Dicatat sebagai komentar pada tugas." />
          {status.task.requiresReview && <p className="text-xs text-muted">Tugas ini perlu diperiksa: pemeriksa tidak boleh penanggung jawabnya sendiri.</p>}
        </div>}
      </Dialog>

      <Dialog open={talk !== null} onClose={() => !busy && setTalk(null)} size="md" title="Komentar tugas" description={talk?.task.title}
        footer={talk && <><Button onClick={() => setTalk(null)}>Tutup</Button><Button variant="primary" loading={busy} disabled={!talk.body.trim()} onClick={() => void run(() => api<TaskCommentDto[]>(`/api/training/tasks/${talk.task.id}/comments`, { body: { body: talk.body } }), undefined, (items) => setTalk({ task: talk.task, items, body: "" }))}>Kirim</Button></>}>
        {talk && <div className="space-y-3">{error && <Notice tone="danger">{error}</Notice>}
          {talk.items.length === 0 ? <p className="text-sm text-muted">Belum ada komentar.</p> : <ul className="space-y-2">{talk.items.map((c) => <li key={c.id} className="rounded-md bg-canvas px-3 py-2 text-sm"><p className="text-xs text-muted">{c.authorName} · {formatDateTime(c.createdAt)}</p><p className="whitespace-pre-wrap">{c.body}</p></li>)}</ul>}
          <TextAreaField label="Komentar baru" rows={2} maxLength={2000} value={talk.body} onChange={(e) => setTalk({ ...talk, body: e.target.value })} hint="Komentar tidak dapat diubah atau dihapus." />
        </div>}
      </Dialog>
    </div>
  );
}
