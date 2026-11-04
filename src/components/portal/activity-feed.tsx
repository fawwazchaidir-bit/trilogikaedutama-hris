import Link from "next/link";
import { Activity, CalendarDays, CheckCircle2, FileText, Gauge, ListChecks, UserPlus, type LucideIcon } from "lucide-react";
import { timeAgo } from "@/lib/format";

export interface FeedItem { id: string; at: string; actorName: string | null; summary: string; action: string; projectId: string; projectCode: string | null }

const ICON: [string, LucideIcon, string][] = [
  ["project.close", CheckCircle2, "bg-emerald-50 text-emerald-700"], ["checklist", ListChecks, "bg-emerald-50 text-emerald-700"], ["task", ListChecks, "bg-sky-50 text-sky-700"],
  ["document", FileText, "bg-amber-50 text-amber-700"], ["participant", UserPlus, "bg-violet-50 text-violet-700"], ["schedule", CalendarDays, "bg-sky-50 text-sky-700"],
  ["milestone", Gauge, "bg-brand-50 text-brand-600"], ["readiness", Gauge, "bg-brand-50 text-brand-600"], ["indicator", Gauge, "bg-brand-50 text-brand-600"], ["recovery", Gauge, "bg-brand-50 text-brand-600"],
];
const pick = (a: string) => ICON.find(([k]) => a.includes(k)) ?? [a, Activity, "bg-stone-100 text-stone-600"] as const;

/** Umpan aktivitas terbaru proyek dalam lingkup akses (ringkasan audit — tanpa kontak/isi dokumen). */
export function ActivityFeed({ items, now }: { items: FeedItem[]; now: number }) {
  if (items.length === 0) return <p className="px-1 py-4 text-sm text-muted">Belum ada aktivitas.</p>;
  return (
    <ul className="space-y-3">
      {items.map((it) => {
        const [, Icon, tone] = pick(it.action);
        return (
          <li key={it.id} className="flex items-start gap-3">
            <span aria-hidden className={`grid size-9 shrink-0 place-items-center rounded-full ${tone}`}><Icon className="size-[18px]" /></span>
            <div className="min-w-0 text-sm">
              <Link href={`/training/proyek/${it.projectId}?tab=riwayat`} className="line-clamp-2 font-medium text-ink hover:underline">{it.summary}</Link>
              <p className="text-xs text-muted">{it.projectCode ? `${it.projectCode} · ` : ""}{it.actorName ?? "Sistem"} · {timeAgo(it.at, now)}</p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
