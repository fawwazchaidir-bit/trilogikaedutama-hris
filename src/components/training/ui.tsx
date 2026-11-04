/** Komponen presentasi bersama modul Training & Operations (tanpa state; aman untuk server maupun client component). */
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import {
  CONFIRMATION_LABEL, PARTICIPANT_STATUS_LABEL, PROJECT_STATUS_LABEL, SCHEDULE_STATUS_LABEL, TASK_PRIORITY_LABEL, TASK_STATUS_LABEL,
  type Confirmation, type ParticipantStatus, type ProjectStatus, type ScheduleStatus, type TaskPriority, type TaskStatus,
} from "@/lib/training/types";
import { ATTENTION_LABEL, type AttentionCode, type ChecklistProgress } from "@/lib/training/indicators";

type Tone = "gray" | "green" | "amber" | "red" | "blue" | "dark";

const PROJECT_TONE: Record<ProjectStatus, Tone> = { DRAFT: "gray", PREPARATION: "amber", RUNNING: "blue", COMPLETED: "green", CANCELLED: "dark" };
export const ProjectStatusBadge = ({ status }: { status: ProjectStatus }) => <Badge tone={PROJECT_TONE[status]}>{PROJECT_STATUS_LABEL[status]}</Badge>;

const TASK_TONE: Record<TaskStatus, Tone> = { TODO: "gray", IN_PROGRESS: "blue", IN_REVIEW: "amber", DONE: "green", CANCELLED: "dark" };
export const TaskStatusBadge = ({ status }: { status: TaskStatus }) => <Badge tone={TASK_TONE[status]}>{TASK_STATUS_LABEL[status]}</Badge>;

const PRIORITY_TONE: Record<TaskPriority, Tone> = { LOW: "gray", NORMAL: "gray", HIGH: "amber", URGENT: "red" };
export const PriorityBadge = ({ priority }: { priority: TaskPriority }) => <Badge tone={PRIORITY_TONE[priority]}>{TASK_PRIORITY_LABEL[priority]}</Badge>;

const SCHEDULE_TONE: Record<ScheduleStatus, Tone> = { PLANNED: "gray", CONFIRMED: "blue", DONE: "green", CANCELLED: "dark" };
export const ScheduleStatusBadge = ({ status }: { status: ScheduleStatus }) => <Badge tone={SCHEDULE_TONE[status]}>{SCHEDULE_STATUS_LABEL[status]}</Badge>;

const PART_TONE: Record<ParticipantStatus, Tone> = { REGISTERED: "gray", INCOMPLETE_DOCS: "amber", READY: "blue", ATTENDING: "blue", COMPLETED: "green", CANCELLED: "dark" };
export const ParticipantStatusBadge = ({ status }: { status: ParticipantStatus }) => <Badge tone={PART_TONE[status]}>{PARTICIPANT_STATUS_LABEL[status]}</Badge>;

const CONF_TONE: Record<Confirmation, Tone> = { PENDING: "amber", CONFIRMED: "green", DECLINED: "red" };
export const ConfirmationBadge = ({ value }: { value: Confirmation }) => <Badge tone={CONF_TONE[value]}>{CONFIRMATION_LABEL[value]}</Badge>;

export function AttentionBadges({ codes }: { codes: AttentionCode[] }) {
  if (codes.length === 0) return null;
  return <span className="inline-flex flex-wrap gap-1">{codes.map((c) => <Badge key={c} tone="red">{ATTENTION_LABEL[c]}</Badge>)}</span>;
}

/** Progres checklist. Tanpa item → "Belum tersedia" (bukan 0%) agar tidak menyesatkan. */
export function ProgressBar({ progress, className }: { progress: ChecklistProgress; className?: string }) {
  if (progress.percent === null) return <span className={cn("text-xs text-muted", className)}>Belum tersedia</span>;
  return (
    <div className={cn("min-w-28", className)}>
      <div className="flex items-baseline justify-between text-xs text-muted"><span>{progress.done}/{progress.total}</span><span className="tabular font-medium text-ink-soft">{progress.percent}%</span></div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-stone-200" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100} aria-label="Progres checklist">
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${progress.percent}%` }} />
      </div>
    </div>
  );
}

export interface Crumb { label: string; href?: string }

/** Breadcrumb + tautan kembali yang jelas. */
export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Navigasi halaman" className="no-print mb-3 flex flex-wrap items-center gap-1 text-sm text-muted">
      {items.map((c, i) => (
        <span key={`${c.label}-${i}`} className="inline-flex items-center gap-1">
          {i > 0 && <ChevronRight className="size-3.5" aria-hidden />}
          {c.href && i < items.length - 1 ? <Link href={c.href} className="hover:text-ink hover:underline">{c.label}</Link> : <span aria-current={i === items.length - 1 ? "page" : undefined} className={i === items.length - 1 ? "font-medium text-ink-soft" : ""}>{c.label}</span>}
        </span>
      ))}
    </nav>
  );
}

export function TabNav({ base, tabs, active }: { base: string; tabs: { key: string; label: string; count?: number }[]; active: string }) {
  return (
    <nav aria-label="Bagian proyek" className="no-print -mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-line px-1">
      {tabs.map((t) => (
        <Link
          key={t.key} href={`${base}?tab=${t.key}`} aria-current={t.key === active ? "page" : undefined}
          className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", t.key === active ? "border-brand-600 text-brand-700" : "border-transparent text-muted hover:text-ink")}
        >
          {t.label}{t.count !== undefined && t.count > 0 && <span className="ml-1.5 rounded-full bg-stone-100 px-1.5 text-[11px] text-ink-soft">{t.count}</span>}
        </Link>
      ))}
    </nav>
  );
}

export const formatBytes = (n: number): string => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
