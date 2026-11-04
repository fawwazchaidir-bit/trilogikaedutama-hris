"use client";
import { useState } from "react";
import { CheckCircle2, CircleAlert, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Card, CardHeader, Notice } from "@/components/ui/card";
import { TextAreaField } from "@/components/ui/field";
import { api } from "@/lib/api-client";
import { formatDateRange, formatDateTime } from "@/lib/format";
import { DOC_CATEGORY_LABEL, PROJECT_STATUS_LABEL, TASK_STATUS_LABEL } from "@/lib/training/types";
import type { ClosurePreviewDto } from "@/server/services/training/insights";
import type { ProjectDetailDto } from "@/server/services/training/projects";
import { ProgressBar } from "./ui";
import { useRunner } from "./use-runner";

/**
 * Penutupan proyek. Menampilkan kesiapan (checklist wajib, tugas, dokumen) sebelum menutup. Menutup proyek TIDAK berarti
 * invoice dibayar, sertifikat terbit, peserta kompeten, atau surat tugas disetujui.
 */
export function ClosurePanel({ project, preview, canClose }: { project: ProjectDetailDto; preview: ClosurePreviewDto; canClose: boolean }) {
  const { busy, error, run, reset } = useRunner();
  const [confirm, setConfirm] = useState(false);
  const [f, setF] = useState({ summary: "", followUp: "", overrideReason: "" });
  const closed = project.status === "COMPLETED";
  const open = project.status === "PREPARATION" || project.status === "RUNNING";
  const needOverride = !preview.canCloseClean;
  const t = preview.tasks;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader title="Kesiapan penutupan" description="Ringkasan keadaan proyek saat ini." />
        <dl className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <div><dt className="text-xs text-muted">Proyek</dt><dd className="text-sm font-medium">{project.code} · {PROJECT_STATUS_LABEL[project.status]}</dd><dd className="text-xs text-muted">{project.startDate && project.endDate ? formatDateRange(project.startDate, project.endDate) : "Tanggal belum diisi"}</dd></div>
          <div><dt className="text-xs text-muted">Tugas</dt><dd className="text-sm font-medium">{t.done} selesai dari {t.total - t.cancelled}</dd><dd className="text-xs text-muted">{t.open} terbuka · {t.overdue} terlambat</dd></div>
          <div><dt className="text-xs text-muted">Checklist</dt><dd><ProgressBar progress={preview.checklist} /></dd></div>
          <div><dt className="text-xs text-muted">Checklist wajib</dt><dd className="text-sm font-medium">{preview.requiredOutstanding.length === 0 ? <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 className="size-4" />Lengkap</span> : <span className="inline-flex items-center gap-1 text-brand-700"><CircleAlert className="size-4" />{preview.requiredOutstanding.length} belum selesai</span>}</dd></div>
        </dl>
        {preview.requiredOutstanding.length > 0 && <div className="border-t border-line px-5 py-3"><p className="text-sm font-medium text-ink-soft">Yang masih menghalangi:</p><ul className="mt-1 list-disc pl-5 text-sm">{preview.requiredOutstanding.map((o) => <li key={o.id}>{o.title}</li>)}</ul></div>}
        <div className="border-t border-line px-5 py-3 text-sm">
          <p className="font-medium text-ink-soft">Dokumen tersedia</p>
          <p className="mt-1 flex flex-wrap gap-1.5">{preview.documents.length === 0 ? <span className="text-muted">Belum ada dokumen.</span> : preview.documents.map((d) => <Badge key={d.category} tone="green">{DOC_CATEGORY_LABEL[d.category]} ({d.count})</Badge>)}</p>
          {preview.missingRecommendedDocuments.length > 0 && <p className="mt-2 text-xs text-amber-800">Dianjurkan ada sebelum ditutup (tidak memblokir): {preview.missingRecommendedDocuments.map((c) => DOC_CATEGORY_LABEL[c]).join(", ")}.</p>}
          {t.open > 0 && <p className="mt-2 text-xs text-amber-800">Masih ada {t.open} tugas berstatus {TASK_STATUS_LABEL.TODO.toLowerCase()}/proses/pemeriksaan. Menutup proyek tidak mengubah status tugas.</p>}
        </div>
      </Card>

      {closed && (
        <Card>
          <CardHeader title="Proyek ditutup" description={`${project.closedByName ?? "—"} · ${formatDateTime(project.closedAt)}`} actions={<Badge tone="green"><Lock className="mr-1 size-3" />Selesai</Badge>} />
          <div className="space-y-3 px-5 py-4 text-sm">
            <div><p className="text-xs text-muted">Catatan hasil pelaksanaan</p><p className="whitespace-pre-wrap">{project.closureSummary}</p></div>
            {project.closureFollowUp && <div><p className="text-xs text-muted">Permasalahan & tindak lanjut</p><p className="whitespace-pre-wrap">{project.closureFollowUp}</p></div>}
            {project.closureOverrideReason && <Notice tone="warn"><strong>Ditutup dengan pengecualian.</strong> Alasan: {project.closureOverrideReason}</Notice>}
          </div>
        </Card>
      )}

      {open && canClose && (
        <Card>
          <CardHeader title="Tutup proyek" description="Hanya Manajer Program. Tindakan ini tercatat di riwayat." />
          <form className="space-y-4 px-5 py-4" onSubmit={(e) => { e.preventDefault(); reset(); setConfirm(true); }}>
            {needOverride && <Notice tone="warn">Masih ada checklist wajib yang belum selesai. Selesaikan dulu, atau isi alasan pengecualian di bawah (dicatat di riwayat beserta daftar item yang dilewati).</Notice>}
            <TextAreaField label="Catatan hasil pelaksanaan" required rows={3} maxLength={2000} value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} hint="Ringkas hasil pelaksanaan. Minimal 5 karakter." />
            <TextAreaField label="Permasalahan & tindak lanjut" rows={2} maxLength={2000} value={f.followUp} onChange={(e) => setF({ ...f, followUp: e.target.value })} />
            {needOverride && <TextAreaField label="Alasan pengecualian" required rows={2} maxLength={500} value={f.overrideReason} onChange={(e) => setF({ ...f, overrideReason: e.target.value })} />}
            <div className="flex justify-end"><Button type="submit" variant="primary" disabled={f.summary.trim().length < 5 || (needOverride && f.overrideReason.trim().length < 5)}>Tutup proyek…</Button></div>
          </form>
        </Card>
      )}
      {open && !canClose && <Notice tone="info">Penutupan proyek dilakukan oleh Manajer Program setelah checklist wajib selesai.</Notice>}

      <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} loading={busy} confirmLabel="Ya, tutup proyek" title={`Tutup proyek ${project.code}?`}
        description="Proyek berstatus Selesai dan datanya dikunci (baca-saja). Manajer Program dapat membukanya kembali dengan alasan."
        onConfirm={() => void run(() => api(`/api/training/projects/${project.id}/close`, { body: { summary: f.summary, followUp: f.followUp, overrideReason: f.overrideReason } }), "Proyek ditutup.", () => setConfirm(false))}>
        {error && <Notice tone="danger">{error}</Notice>}
        {needOverride && <p className="mt-2 text-sm">Ditutup <strong>dengan pengecualian</strong> ({preview.requiredOutstanding.length} checklist wajib dilewati).</p>}
      </ConfirmDialog>
    </div>
  );
}
