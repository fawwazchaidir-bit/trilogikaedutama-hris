import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, PageHeader } from "@/components/ui/card";
import { Breadcrumb } from "@/components/training/ui";
import { TasksPanel } from "@/components/training/tasks-panel";
import { listMyTasks } from "@/server/services/training/work";
import { cn } from "@/lib/cn";
import { flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { guard, trainingPage } from "../_lib";

export const metadata: Metadata = { title: "Tugas Saya" };
export const dynamic = "force-dynamic";

const FILTERS = [["open", "Terbuka"], ["overdue", "Terlambat"], ["today", "Jatuh tempo hari ini"], ["soon", "Mendekati tenggat"], ["done", "Selesai"], ["all", "Semua"]] as const;

export default async function MyTasksPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await trainingPage();
  if (!user.employeeId) notFound();
  const sp = await flattenSearchParams(searchParams);
  const filter = FILTERS.some(([k]) => k === sp.filter) ? (sp.filter as (typeof FILTERS)[number][0]) : "open";
  const tasks = await guard(() => listMyTasks(user, { filter }));
  return (
    <div>
      <Breadcrumb items={[{ label: "Training & Operations", href: "/training" }, { label: "Tugas Saya" }]} />
      <PageHeader title="Tugas Saya" description="Tugas yang ditugaskan kepada Anda di seluruh proyek yang masih Anda ikuti. Tugas yang terlambat ada di urutan teratas." />
      <nav aria-label="Filter tugas" className="mb-4 flex flex-wrap gap-2">{FILTERS.map(([k, l]) => <Link key={k} href={`/training/tugas-saya?filter=${k}`} aria-current={k === filter ? "page" : undefined} className={cn("rounded-full border px-3 py-1 text-sm", k === filter ? "border-brand-600 bg-brand-50 font-medium text-brand-700" : "border-line bg-white text-ink-soft hover:bg-canvas")}>{l}</Link>)}</nav>
      <Card className="p-4"><TasksPanel tasks={tasks} showProject editable /></Card>
    </div>
  );
}
