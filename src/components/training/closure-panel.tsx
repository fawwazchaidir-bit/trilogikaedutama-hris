"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, CircleAlert, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Card, CardHeader, Notice } from "@/components/ui/card";
import { SelectField, TextAreaField, TextField } from "@/components/ui/field";
import { api } from "@/lib/api-client";
import { formatDateRange, formatDateShort, formatDateTime } from "@/lib/format";
import { todayIso } from "@/lib/time";
import { checkClosureTasks, CLOSURE_TASK_ACTION_LABEL, type ClosureTaskAction, type ClosureTaskDecision } from "@/lib/training/closure";
import { UNAVAILABLE_LABEL } from "@/lib/training/availability";
import { DOC_CATEGORY_LABEL, PROJECT_STATUS_LABEL } from "@/lib/training/types";
import type { ClosurePreviewDto } from "@/server/services/training/insights";
import type { ProjectDetailDto } from "@/server/services/training/projects";
import { ProgressBar, TaskStatusBadge } from "./ui";
import { useRunner } from "./use-runner";

/** Pilihan per tugas terbuka di formulir (kosong = belum diputuskan). */
interface Pick { action: ClosureTaskAction | ""; assigneeId: string; dueDate: string; reason: string }

/**
 * Penutupan proyek: SATU ringkasan sebelum menutup — tugas terbuka (wajib diputuskan satu per satu), milestone kritis, dokumen, checklist wajib, dan
 * pelonggaran checklist wajib (harus diakui). Menutup proyek TIDAK berarti invoice dibayar, sertifikat terbit, peserta kompeten, atau surat tugas disetujui.
 */
export function ClosurePanel({ project, preview, canClose }: { project: ProjectDetailDto; preview: ClosurePreviewDto; canClose: boolean }) {
  const { busy, error, run, reset } = useRunner();
  const [confirm, setConfirm] = useState(false);
  const [f, setF] = useState({ summary: "", followUp: "", overrideReason: "", acknowledge: false });
  const today = todayIso("Asia/Jakarta");
  const closed = project.status === "COMPLETED";
  const open = project.status === "PREPARATION" || project.status === "RUNNING";
  const needOverride = !preview.canCloseClean;
  const t = preview.tasks;
  const needAck = preview.unacknowledgedRelaxations > 0;

  const [picks, setPicks] = useState<Record<string, Pick>>(() => Object.fromEntries(preview.openTasks.map((x) => [x.id, {
    action: "" as const,
    assigneeId: x.assigneeId && !x.assigneeUnavailable ? x.assigneeId : "",
    dueDate: x.dueDate && x.dueDate >= today ? x.dueDate : "",
    reason: "",
  }])));
  const setPick = (id: string, patch: Partial<Pick>) => setPicks((p) => ({ ...p, [id]: { ...p[id]!, ...patch } }));

  /** Keputusan yang dikirim — dan diperiksa dengan fungsi yang sama dengan server (`checkClosureTasks`), supaya tombol baru aktif bila sah. */
  const decisions: ClosureTaskDecision[] = useMemo(() => preview.openTasks.flatMap((x) => {
    const p = picks[x.id];
    if (!p || p.action === "") return [];
    return [{ taskId: x.id, action: p.action, assigneeId: p.assigneeId || null, dueDate: p.dueDate || null, reason: p.reason || null }];
  }), [picks, preview.openTasks]);
  const taskCheck = useMemo(() => checkClosureTasks(preview.openTasks, decisions, today), [preview.openTasks, decisions, today]);
  const problemOf = (id: string) => taskCheck.invalid.find((x) => x.taskId === id)?.message;
  const ready = f.summary.trim().length >= 5 && (!needOverride || f.overrideReason.trim().length >= 5) && taskCheck.ok && (!needAck || f.acknowledge);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Ringkasan penutupan" description="Semua yang perlu diketahui sebelum proyek ditutup, dalam satu tempat." />
        <dl className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs text-muted">Proyek</dt><dd className="text-sm font-medium">{project.code} · {PROJECT_STATUS_LABEL[project.status]}</dd><dd className="text-xs text-muted">{project.startDate && project.endDate ? formatDateRange(project.startDate, project.endDate) : "Tanggal belum diisi"}</dd></div>
          <div><dt className="text-xs text-muted">Tugas</dt><dd className="text-sm font-medium">{t.done} selesai dari {t.total - t.cancelled}</dd><dd className="text-xs text-muted">{t.open} terbuka · {t.overdue} terlambat</dd></div>
          <div><dt className="text-xs text-muted">Checklist</dt><dd><ProgressBar progress={preview.checklist} /></dd></div>
          <div><dt className="text-xs text-muted">Checklist wajib</dt><dd className="text-sm font-medium">{preview.requiredOutstanding.length === 0 ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="size-4" />Lengkap</span> : <span className="inline-flex items-center gap-1 text-brand-700"><CircleAlert className="size-4" />{preview.requiredOutstanding.length} belum selesai</span>}</dd></div>
        </dl>
        {preview.requiredOutstanding.length > 0 && <div className="border-t border-line px-5 py-3"><p className="text-sm font-medium text-ink-soft">Checklist wajib yang masih menghalangi:</p><ul className="mt-1 list-disc pl-5 text-sm">{preview.requiredOutstanding.map((o) => <li key={o.id}>{o.title}</li>)}</ul></div>}
        {preview.criticalMilestones.length > 0 && (
          <div className="border-t border-line px-5 py-3" data-testid="closure-milestones">
            <p className="text-sm font-medium text-ink-soft">Milestone kritis yang belum selesai <span className="font-normal text-muted">(tidak memblokir; untuk diketahui)</span></p>
            <ul className="mt-1 list-disc pl-5 text-sm">{preview.criticalMilestones.map((m) => <li key={m.id}>{m.code} · {m.name}{m.due && <span className={m.overdue ? "text-brand-700" : "text-muted"}> — tenggat {formatDateShort(m.due)}{m.overdue ? " (terlambat)" : ""}</span>}{m.assigneeName && <span className="text-muted"> · {m.assigneeName}</span>}</li>)}</ul>
          </div>
        )}
        <div className="border-t border-line px-5 py-3 text-sm">
          <p className="font-medium text-ink-soft">Dokumen tersedia</p>
          <p className="mt-1 flex flex-wrap gap-1.5">{preview.documents.length === 0 ? <span className="text-muted">Belum ada dokumen.</span> : preview.documents.map((d) => <Badge key={d.category} tone="green">{DOC_CATEGORY_LABEL[d.category]} ({d.count})</Badge>)}</p>
          {preview.missingRecommendedDocuments.length > 0 && <p className="mt-2 text-xs text-amber-800">Dianjurkan ada sebelum ditutup (tidak memblokir): {preview.missingRecommendedDocuments.map((c) => DOC_CATEGORY_LABEL[c]).join(", ")}.</p>}
        </div>
        {preview.relaxations.length > 0 && (
          <div className="border-t border-line px-5 py-3 text-sm" data-testid="closure-relaxations">
            <p className="font-medium text-ink-soft">Checklist wajib yang dilonggarkan <span className="font-normal text-muted">(dijadikan tidak wajib atau dihapus)</span></p>
            <ul className="mt-1 space-y-1">{preview.relaxations.map((r) => (
              <li key={r.id}><span className="font-medium">{r.title}</span> <Badge tone={r.kind === "DELETED" ? "red" : "amber"}>{r.kind === "DELETED" ? "Dihapus" : "Tidak wajib"}</Badge> {r.acknowledged && <Badge tone="gray">Sudah diakui</Badge>}
                <span className="block text-xs text-muted">Alasan: {r.reason}{r.byName ? ` · ${r.byName}` : ""} · {formatDateTime(r.at)}</span></li>
            ))}</ul>
          </div>
        )}
      </Card>

      {open && preview.openTasks.length > 0 && (
        <Card>
          <CardHeader title={`Tugas yang masih terbuka (${preview.openTasks.length})`} description="Tugas terbuka tidak menghalangi penutupan, tetapi tidak boleh menggantung: putuskan setiap tugas. Tugas yang masih perlu diselesaikan lewat alurnya (termasuk pemeriksaan) selesaikan dulu sebelum menutup." />
          <ul className="divide-y divide-line">
            {preview.openTasks.map((x) => {
              const p = picks[x.id]!;
              const problem = p.action !== "" ? problemOf(x.id) : undefined;
              return (
                <li key={x.id} className="space-y-3 px-5 py-3" data-testid="closure-task">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-ink">{x.title}</p><TaskStatusBadge status={x.status} />
                    {x.overdue && <Badge tone="red">Terlambat</Badge>}
                    {x.requiresReview && <Badge tone="amber">Perlu diperiksa</Badge>}
                    <span className="text-xs text-muted">{x.assigneeName ?? "Belum ada penanggung jawab"}{x.assigneeUnavailable && <span className="font-medium text-brand-700"> ({UNAVAILABLE_LABEL[x.assigneeUnavailable]})</span>}{x.assigneeNoAccount && <span className="text-muted" data-testid="no-account-note"> (tanpa akun login — tidak dapat masuk sendiri; pastikan ada yang memantau)</span>}{x.dueDate && <> · tenggat {formatDateShort(x.dueDate)}</>}</span>
                  </div>
                  {canClose ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <SelectField label="Keputusan" aria-label={`Keputusan untuk tugas ${x.title}`} value={p.action} onChange={(e) => setPick(x.id, { action: e.target.value as Pick["action"] })}>
                        <option value="">— Pilih keputusan —</option>
                        <option value="FOLLOW_UP">{CLOSURE_TASK_ACTION_LABEL.FOLLOW_UP}</option>
                        <option value="CANCEL">{CLOSURE_TASK_ACTION_LABEL.CANCEL}</option>
                      </SelectField>
                      {p.action === "FOLLOW_UP" && (
                        <>
                          <SelectField label="Penanggung jawab" aria-label={`Penanggung jawab tindak lanjut ${x.title}`} value={p.assigneeId} onChange={(e) => setPick(x.id, { assigneeId: e.target.value })}>
                            <option value="">— Pilih —</option>{preview.assignees.map((a) => <option key={a.employeeId} value={a.employeeId}>{a.name}</option>)}
                          </SelectField>
                          <TextField label="Tenggat" type="date" min={today} aria-label={`Tenggat tindak lanjut ${x.title}`} value={p.dueDate} onChange={(e) => setPick(x.id, { dueDate: e.target.value })} />
                          {x.status !== "TODO" && p.assigneeId !== "" && p.assigneeId !== x.assigneeId && (
                            <TextField className="sm:col-span-3" label="Alasan mengganti penanggung jawab" aria-label={`Alasan ganti penanggung jawab ${x.title}`} maxLength={300} value={p.reason} onChange={(e) => setPick(x.id, { reason: e.target.value })} hint="Wajib karena pekerjaan sudah dimulai." />
                          )}
                        </>
                      )}
                      {p.action === "CANCEL" && <TextField className="sm:col-span-2" label="Alasan pembatalan" aria-label={`Alasan pembatalan ${x.title}`} maxLength={300} value={p.reason} onChange={(e) => setPick(x.id, { reason: e.target.value })} />}
                    </div>
                  ) : <p className="text-xs text-muted">Diputuskan oleh Koordinator Program saat menutup proyek.</p>}
                  {problem && <p role="alert" className="text-xs font-medium text-brand-700">{problem}</p>}
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      {closed && (
        <Card>
          <CardHeader title="Proyek ditutup" description={`${project.closedByName ?? "—"} · ${formatDateTime(project.closedAt)}`} actions={<Badge tone="green"><Lock className="mr-1 size-3" />Selesai</Badge>} />
          <div className="space-y-3 px-5 py-4 text-sm">
            <div><p className="text-xs text-muted">Catatan hasil pelaksanaan</p><p className="whitespace-pre-wrap">{project.closureSummary}</p></div>
            {project.closureFollowUp && <div><p className="text-xs text-muted">Permasalahan & tindak lanjut</p><p className="whitespace-pre-wrap">{project.closureFollowUp}</p></div>}
            {project.closureOverrideReason && <Notice tone="warn"><strong>Ditutup dengan pengecualian.</strong> Alasan: {project.closureOverrideReason}</Notice>}
          </div>
          {preview.followUps.length > 0 && (
            <div className="border-t border-line px-5 py-4 text-sm" data-testid="closure-followups">
              <p className="font-medium text-ink-soft">Tugas tindak lanjut <span className="font-normal text-muted">(tetap dapat dikerjakan walau proyek ditutup)</span></p>
              <ul className="mt-2 space-y-1">{preview.followUps.map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-2"><span className="font-medium">{x.title}</span><TaskStatusBadge status={x.status} />{x.overdue && <Badge tone="red">Terlambat</Badge>}
                  <span className="text-xs text-muted">{x.assigneeName ?? "—"}{x.dueDate && <> · tenggat {formatDateShort(x.dueDate)}</>}</span></li>
              ))}</ul>
              <p className="mt-2 text-xs"><Link href={`/training/proyek/${project.id}?tab=tugas`} className="font-medium text-brand-700 hover:underline">Buka tab Tugas →</Link></p>
            </div>
          )}
        </Card>
      )}

      {open && canClose && (
        <Card>
          <CardHeader title="Tutup proyek" description="Hanya Koordinator Program. Tindakan ini tercatat di riwayat." />
          <form className="space-y-4 px-5 py-4" onSubmit={(e) => { e.preventDefault(); reset(); setConfirm(true); }}>
            {needOverride && <Notice tone="warn">Masih ada checklist wajib yang belum selesai. Selesaikan dulu, atau isi alasan pengecualian di bawah (dicatat di riwayat beserta daftar item yang dilewati).</Notice>}
            <TextAreaField label="Catatan hasil pelaksanaan" required rows={3} maxLength={2000} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} hint="Ringkas hasil pelaksanaan. Minimal 5 karakter." />
            <TextAreaField label="Permasalahan & tindak lanjut" rows={2} maxLength={2000} value={f.followUp} onChange={(e) => setF({ ...f, followUp: e.target.value })} />
            {needOverride && <TextAreaField label="Alasan pengecualian" required rows={2} maxLength={500} value={f.overrideReason} onChange={(e) => setF({ ...f, overrideReason: e.target.value })} />}
            {needAck && (
              <label className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
                <input type="checkbox" className="mt-0.5 size-4" checked={f.acknowledge} onChange={(e) => setF({ ...f, acknowledge: e.target.checked })} />
                <span>Saya telah memeriksa <strong>{preview.unacknowledgedRelaxations}</strong> pelonggaran checklist wajib di atas beserta alasannya, dan menyetujuinya.</span>
              </label>
            )}
            {!taskCheck.ok && preview.openTasks.length > 0 && <p className="text-xs text-muted">Putuskan semua tugas terbuka di atas (jadikan tindak lanjut atau batalkan) untuk dapat menutup.</p>}
            <div className="flex justify-end"><Button type="submit" variant="primary" disabled={!ready}>Tutup proyek…</Button></div>
          </form>
        </Card>
      )}
      {open && !canClose && <Notice tone="info">Penutupan proyek dilakukan oleh Koordinator Program setelah checklist wajib selesai dan setiap tugas terbuka diputuskan.</Notice>}

      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} loading={busy} confirmLabel="Ya, tutup proyek" title={`Tutup proyek ${project.code}?`}
        description="Proyek berstatus Selesai dan datanya dikunci (baca-saja), kecuali tugas tindak lanjut. Koordinator Program dapat membukanya kembali dengan alasan."
        onConfirm={() => void run(() => api(`/api/training/projects/${project.id}/close`, { body: { summary: f.summary, followUp: f.followUp, overrideReason: f.overrideReason, acknowledgeRelaxed: f.acknowledge, taskDecisions: decisions } }), "Proyek ditutup.", () => setConfirm(false))}>
        {error && <Notice tone="danger">{error}</Notice>}
        <ul className="mt-2 list-disc pl-5 text-sm">
          {needOverride && <li>Ditutup <strong>dengan pengecualian</strong> ({preview.requiredOutstanding.length} checklist wajib dilewati).</li>}
          {taskCheck.plan.followUp.length > 0 && <li>{taskCheck.plan.followUp.length} tugas menjadi <strong>tindak lanjut</strong>.</li>}
          {taskCheck.plan.cancel.length > 0 && <li>{taskCheck.plan.cancel.length} tugas <strong>dibatalkan</strong>.</li>}
          {needAck && <li>{preview.unacknowledgedRelaxations} pelonggaran checklist wajib <strong>diakui</strong>.</li>}
        </ul>
      </ConfirmDialog>
    </div>
  );
}
