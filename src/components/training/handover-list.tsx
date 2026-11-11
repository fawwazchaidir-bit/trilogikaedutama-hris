import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { PROJECT_ROLE_LABEL } from "@/lib/training/types";
import type { HandoverDto } from "@/server/services/training/handover";

const COUNT_LABELS: [keyof HandoverDto["projects"][number]["counts"], string][] = [
  ["tasks", "tugas"], ["checklist", "checklist"], ["milestones", "milestone"], ["readiness", "item kesiapan"], ["instructors", "penugasan instruktur"],
];

/** Daftar serah terima per proyek. Rincian (judul) tampil hanya bila pelaku berhak melihat proyek itu; selain itu hanya jumlah. */
export function HandoverList({ handover }: { handover: HandoverDto }) {
  if (handover.projects.length === 0) return <p className="text-sm text-muted">Tidak ada pekerjaan Training yang masih dipegang.</p>;
  return (
    <ul className="divide-y divide-line rounded-md border border-line" data-testid="handover-list">
      {handover.projects.map((p) => (
        <li key={p.projectId} className="space-y-1.5 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            {p.detail ? <Link href={`/training/proyek/${p.projectId}?tab=${p.isPic ? "tim" : "tugas"}`} className="font-medium text-brand-700 hover:underline">{p.code}</Link> : <span className="font-medium">{p.code}</span>}
            <span className="text-ink-soft">{p.name}</span>
            {p.role && <Badge tone={p.isPic ? "red" : "gray"}>{PROJECT_ROLE_LABEL[p.role]}</Badge>}
          </div>
          <p className="text-xs text-muted">
            {COUNT_LABELS.filter(([k]) => p.counts[k] > 0).map(([k, label]) => `${p.counts[k]} ${label}`).join(" · ") || "Hanya keanggotaan tim"}
            {p.isPic && " · PIC: tetapkan PIC baru"}
          </p>
          {p.detail && (
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-soft">
              {p.detail.tasks.map((t) => <li key={t.id}>Tugas: {t.title}{t.dueDate ? ` (tenggat ${t.dueDate})` : ""}</li>)}
              {p.detail.checklist.map((c) => <li key={c.id}>Checklist: {c.title}</li>)}
              {p.detail.milestones.map((m) => <li key={m.id}>Milestone: {m.code} {m.name}</li>)}
              {p.detail.readiness.map((r) => <li key={r.id}>Kesiapan: {r.name}</li>)}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}
