import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { Breadcrumb, ScheduleStatusBadge } from "@/components/training/ui";
import { listCalendar } from "@/server/services/training/operations";
import { addMonths, currentYearMonth, isValidYearMonth, monthRange } from "@/lib/time";
import { formatDateWithDay, monthLabel } from "@/lib/format";
import { conflictMessage } from "@/lib/training/misc";
import { env } from "@/server/env";
import { flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { guard, trainingPage } from "../_lib";

export const metadata: Metadata = { title: "Kalender Kegiatan" };
export const dynamic = "force-dynamic";

export default async function CalendarPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await trainingPage();
  const sp = await flattenSearchParams(searchParams);
  const ym = sp.bulan && isValidYearMonth(sp.bulan) ? sp.bulan : currentYearMonth(env().APP_TIMEZONE);
  const { from, to } = monthRange(ym);
  const items = await guard(() => listCalendar(user, { from, to }));
  const prev = addMonths(`${ym}-01`, -1).slice(0, 7);
  const next = addMonths(`${ym}-01`, 1).slice(0, 7);
  const byDate = new Map<string, typeof items>();
  for (const s of items) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  return (
    <div>
      <Breadcrumb items={[{ label: "Training & Operations", href: "/training" }, { label: "Kalender Kegiatan" }]} />
      <PageHeader title="Kalender Kegiatan" description="Jadwal sesi pada proyek dalam lingkup akses Anda, menurut tanggal (WIB). Peringatan bentrok ruangan (menurut lokasi + ruangan)/instruktur ditandai; lokasi yang belum jelas ditandai perlu diperiksa." />
      <div className="mb-4 flex items-center gap-2">
        <Link href={`/training/kalender?bulan=${prev}`} aria-label="Bulan sebelumnya" className="rounded-md border border-line bg-white p-2 hover:bg-canvas"><ChevronLeft className="size-4" /></Link>
        <h2 className="min-w-40 text-center text-base font-semibold text-ink">{monthLabel(ym)}</h2>
        <Link href={`/training/kalender?bulan=${next}`} aria-label="Bulan berikutnya" className="rounded-md border border-line bg-white p-2 hover:bg-canvas"><ChevronRight className="size-4" /></Link>
        <Link href="/training/kalender" className="ml-2 text-sm text-brand-700 hover:underline">Bulan ini</Link>
      </div>
      {items.length === 0 ? <Card><EmptyState title="Tidak ada jadwal pada bulan ini" description="Jadwal ditambahkan pada tab Jadwal di dalam proyek." /></Card> : (
        <div className="space-y-4">{[...byDate.entries()].map(([date, list]) => (
          <section key={date} aria-label={formatDateWithDay(date)}><h3 className="mb-1.5 text-sm font-semibold text-ink">{formatDateWithDay(date)}</h3>
            <ul className="divide-y divide-line rounded-lg border border-line bg-surface">{list.map((s) => (
              <li key={s.id} className="px-4 py-3 text-sm">
                <p className="font-medium text-ink"><span className="tabular text-ink-soft">{s.startTime}–{s.endTime}</span> · {s.title} <ScheduleStatusBadge status={s.status} /></p>
                <p className="text-xs text-muted"><Link href={`/training/proyek/${s.projectId}?tab=jadwal`} className="font-medium text-brand-700 hover:underline">{s.projectCode}</Link> · {s.projectName}{[s.room, s.location, s.instructorName && `Pengajar: ${s.instructorName}`, s.inchargeName && `PJ: ${s.inchargeName}`].filter(Boolean).map((x) => ` · ${x}`).join("")}</p>
                {s.conflicts.map((c, i) => <p key={i} role="status" data-testid={`conflict-${c.kind}`} className={`mt-1 flex items-start gap-1.5 text-xs font-medium ${c.kind === "ROOM_CHECK" ? "text-sky-800" : "text-amber-800"}`}><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{conflictMessage(c)}</p>)}
              </li>))}</ul></section>))}</div>
      )}
    </div>
  );
}
