import Link from "next/link";
import { ArrowRight, CircleAlert, FolderKanban, Gauge, ListChecks, ShieldCheck, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, EmptyState } from "@/components/ui/card";
import { ProjectStatusBadge } from "@/components/training/ui";
import { formatDateRange } from "@/lib/format";
import type { NavItem } from "@/lib/permissions";
import type { TrainingHomeDto } from "@/server/services/training/home";
import { ActivityChart } from "./activity-chart";
import { ActivityFeed } from "./activity-feed";
import { MenuTiles } from "./menu-tiles";
import { MiniCalendar } from "./mini-calendar";
import { ProgressRing } from "./progress-ring";
import { StatCard } from "./stat-card";

const TRAINING_MENU = ["/training/proyek", "/training/tugas-saya", "/training/kalender", "/training/peserta", "/training/dokumen", "/training/pemantauan", "/training/laporan"];

/**
 * Beranda Training & Operations (gaya portal): ringkasan, grafik aktivitas, menu utama, proyek saya, kalender, aktivitas terbaru, pemantauan.
 * Semua angka dari `getTrainingHome` (data nyata, sesuai lingkup akses pengguna).
 */
export function TrainingHome({ data, nav, withKpis = true }: { data: TrainingHomeDto; nav: Pick<NavItem, "href" | "label">[]; withKpis?: boolean }) {
  const k = data.kpis;
  const scope = data.scope === "all" ? "Seluruh proyek" : "Proyek yang saya ikuti";
  const mine = data.myProjects.some((p) => p.isMember);
  return (
    <div className="space-y-5">
      {withKpis && (
        <section aria-label="Ringkasan" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          <StatCard icon={FolderKanban} label="Proyek aktif" value={k.activeProjects} hint={scope} href="/training/proyek?active=1" />
          <StatCard icon={Users} label="Peserta di proyek aktif" value={k.participants} hint="Tidak termasuk yang dibatalkan" tone="green" href="/training/peserta" />
          <StatCard icon={ListChecks} label="Tugas tepat waktu" value={k.tasksOnTrackPct === null ? "—" : `${k.tasksOnTrackPct}%`} hint={k.openTasks ? `${k.openTasks} tugas terbuka` : "Tidak ada tugas terbuka"} tone={k.tasksOnTrackPct !== null && k.tasksOnTrackPct < 80 ? "amber" : "slate"} href="/training/tugas-saya" />
          <StatCard icon={Gauge} label="Program perlu perhatian" value={k.attentionPrograms === null ? "—" : k.attentionPrograms} hint={k.attentionPrograms === null ? "Belum ada program dinilai" : `${k.redPrograms} Merah · ${k.attentionPrograms - k.redPrograms} Kuning`} tone={k.redPrograms ? "maroon" : k.attentionPrograms ? "amber" : "green"} href="/training/pemantauan" />
          <StatCard icon={ShieldCheck} label="Cakupan data" value={data.scope === "all" ? "Semua" : "Terbatas"} hint={data.scope === "all" ? "Anda melihat seluruh proyek" : "Hanya proyek yang Anda ikuti"} tone="slate" />
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Ringkasan aktivitas" description="14 hari terakhir" />
          <div className="px-5 pb-5 pt-3">
            <ActivityChart title="Tugas selesai dan peserta ditambahkan" days={data.chart.days} series={[
              { label: "Tugas selesai", color: "#8c1d2d", values: data.chart.tasksDone },
              { label: "Peserta ditambahkan", color: "#2f7f86", values: data.chart.participantsAdded },
            ]} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Menu utama" />
          <div className="p-4"><MenuTiles nav={nav} order={TRAINING_MENU} /></div>
        </Card>
        <Card>
          <CardHeader title={mine ? "Proyek saya" : "Proyek aktif"} actions={<Link href="/training/proyek" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">Lihat semua<ArrowRight className="size-4" aria-hidden /></Link>} />
          {data.myProjects.length === 0 ? <EmptyState title="Belum ada proyek" description="Proyek yang Anda ikuti akan tampil di sini." /> : (
            <ul className="divide-y divide-line">
              {data.myProjects.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2"><ProjectStatusBadge status={p.status} /></p>
                    <Link href={`/training/proyek/${p.id}`} className="mt-1 block truncate text-sm font-semibold text-ink hover:underline">{p.name}</Link>
                    <p className="truncate text-xs text-muted">{p.startDate && p.endDate ? formatDateRange(p.startDate, p.endDate) : "Belum dijadwalkan"} · {p.participants} peserta</p>
                  </div>
                  <ProgressRing percent={p.checklist.percent} label={`Progres checklist ${p.code}`} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader title="Kalender pelatihan" actions={<Link href="/training/kalender" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline">Lihat detail<ArrowRight className="size-4" aria-hidden /></Link>} />
          <div className="p-4"><MiniCalendar month={data.calendar.month} today={data.calendar.today} days={data.calendar.days} href="/training/kalender" />
            <p className="mt-2 flex items-center justify-center gap-4 text-[11px] text-muted"><span className="inline-flex items-center gap-1"><span aria-hidden className="size-1.5 rounded-full bg-brand-600" />Ada sesi</span><span className="inline-flex items-center gap-1"><span aria-hidden className="size-3 rounded-full bg-brand-600" />Hari ini</span></p></div>
        </Card>
        <Card>
          <CardHeader title="Aktivitas terbaru" />
          <div className="p-5"><ActivityFeed items={data.activity} now={data.nowMs} /></div>
        </Card>
        <section aria-label="Pemantauan program" className="relative overflow-hidden rounded-xl bg-gradient-to-br from-maroon-950 via-maroon-900 to-brand-600 p-6 text-white shadow-sm">
          <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 size-40 rounded-full bg-white/10" />
          <div className="relative flex h-full flex-col">
            <Gauge className="size-8 text-white/80" aria-hidden />
            <p className="mt-3 text-xl font-bold leading-snug">Pemantauan program</p>
            <p className="mt-1 text-sm text-white/80">Ketepatan Waktu, Kesiapan, dan Beban Tim dihitung menurut rumus yang ditetapkan Direktur.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {k.attentionPrograms === null ? <Badge tone="gray">Belum ada program dinilai</Badge> : (<>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-medium"><CircleAlert className="size-3.5" aria-hidden />{k.redPrograms} Merah</span>
                <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-xs font-medium">{k.attentionPrograms - k.redPrograms} Kuning</span>
              </>)}
            </div>
            <Link href="/training/pemantauan" className="mt-auto inline-flex w-fit items-center gap-2 pt-5 text-sm font-semibold text-white hover:underline"><span className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-brand-700">Buka pemantauan<ArrowRight className="size-4" aria-hidden /></span></Link>
          </div>
        </section>
      </div>
    </div>
  );
}
