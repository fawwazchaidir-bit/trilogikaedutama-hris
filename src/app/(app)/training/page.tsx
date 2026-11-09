import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { Card, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui/card";
import { Tile } from "@/components/ui/stat";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AttentionBadges, Breadcrumb, ProgressBar, ProjectStatusBadge } from "@/components/training/ui";
import { TasksPanel } from "@/components/training/tasks-panel";
import { getTrainingDashboard, type DashboardDto } from "@/server/services/training/insights";
import { getTrainingHome } from "@/server/services/training/home";
import { TrainingHome } from "@/components/portal/training-home";
import { trainingNav } from "@/lib/training/nav";
import { formatDateRange, formatDateWithDay, monthLabel } from "@/lib/format";
import { PROJECT_STATUS_LABEL } from "@/lib/training/types";
import { guard, trainingPage } from "./_lib";

export const metadata: Metadata = { title: "Dashboard Training" };
export const dynamic = "force-dynamic";

const TITLE: Record<DashboardDto["variant"], { title: string; desc: string }> = {
  staff: { title: "Dashboard Training", desc: "Tugas, proyek, dan jadwal Anda." },
  admin: { title: "Dashboard Admin Program", desc: "Operasional harian pada proyek dalam lingkup akses Anda." },
  manager: { title: "Dashboard Koordinator Program", desc: "Pelaksanaan proyek, keterlambatan, dan penugasan tim." },
  director: { title: "Dashboard Direktur", desc: "Ringkasan seluruh proyek, status, dan risiko operasional." },
};

export default async function TrainingDashboardPage() {
  const { user, ctx } = await trainingPage();
  const [d, home] = await Promise.all([guard(() => getTrainingDashboard(user)), guard(() => getTrainingHome(user))]);
  const nav = trainingNav(ctx.caps, !!user.employeeId);
  const c = d.counts;
  const t = TITLE[d.variant];
  const staff = d.variant === "staff";
  const maxMonth = Math.max(1, ...d.byMonth.map((m) => m.count));

  return (
    <div>
      <Breadcrumb items={[{ label: "Training & Operations" }, { label: "Dashboard" }]} />
      <PageHeader title={t.title} description={`${t.desc} Hari ini ${formatDateWithDay(d.today)}. Semua angka dihitung langsung dari data proyek.`} />

      {staff && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Tile label="Tugas terbuka saya" value={c.openTasks} href="/training/tugas-saya" />
          <Tile label="Tugas terlambat" value={c.overdueTasks} tone={c.overdueTasks ? "red" : undefined} href="/training/tugas-saya?filter=overdue" hint="Tenggat sebelum hari ini (WIB)" />
          <Tile label="Mendekati tenggat" value={c.dueSoonTasks} tone={c.dueSoonTasks ? "amber" : undefined} href="/training/tugas-saya?filter=soon" hint="Dalam 3 hari ke depan" />
          <Tile label="Checklist saya" value={c.openChecklistItems} href="/training/checklist" hint="Belum selesai (proyek aktif)" />
        </div>
      )}
      <div className={staff ? "mt-5" : ""}><TrainingHome data={home} nav={nav} withKpis={!staff} /></div>

      {d.variant === "admin" && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Tile label="Proyek dalam lingkup" value={c.projectsInScope} />
          <Tile label="Checklist belum selesai" value={c.openChecklistItems} hint="Pada proyek aktif" />
          <Tile label="Proyek aktif tanpa dokumen" value={c.activeWithoutDocuments} tone={c.activeWithoutDocuments ? "amber" : undefined} hint="Belum ada satu pun dokumen" />
        </div>
      )}

      {staff && d.myTasks.length > 0 && (
        <Card className="mt-6"><CardHeader title="Tugas saya" actions={<Link className="text-sm font-medium text-brand-700 hover:underline" href="/training/tugas-saya">Lihat semua</Link>} />
          <div className="p-4"><TasksPanel tasks={d.myTasks} showProject editable /></div></Card>
      )}
      {staff && d.myChecklist.length > 0 && (
        <Card className="mt-6"><CardHeader title="Checklist yang menjadi tanggung jawab saya" />
          <ul className="divide-y divide-line">{d.myChecklist.map((i) => <li key={i.id} className="px-5 py-2.5 text-sm"><Link href={`/training/proyek/${i.projectId}?tab=tugas`} className="font-medium text-ink hover:underline">{i.title}</Link> {i.isRequired && <Badge tone="red">Wajib</Badge>}<span className="block text-xs text-muted">{i.projectCode} · {i.projectName}</span></li>)}</ul></Card>
      )}
      {staff && d.myTasks.length === 0 && d.myChecklist.length === 0 && <Card className="mt-6"><EmptyState title="Belum ada tugas untuk Anda" description="Tugas dan checklist yang ditugaskan kepada Anda akan muncul di sini." /></Card>}

      {!staff && (
        <div className="mt-6 grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader title={d.variant === "director" ? "Proyek aktif" : "Proyek yang ditangani"} description="Diurutkan menurut tanggal mulai terdekat." actions={<Link className="text-sm font-medium text-brand-700 hover:underline" href="/training/proyek">Semua proyek</Link>} />
            {d.projects.length === 0 ? <EmptyState title="Belum ada proyek aktif" description="Proyek berstatus Persiapan atau Berjalan akan tampil di sini." /> : (
              <TableWrap><Table><thead><tr><Th>Proyek</Th><Th>Status</Th><Th>Checklist</Th><Th align="right">Tugas</Th></tr></thead>
                <tbody>{d.projects.map((p) => (
                  <tr key={p.id}><Td><Link href={`/training/proyek/${p.id}`} className="font-medium text-ink hover:underline">{p.code}</Link><p className="text-xs text-muted">{p.name}</p><p className="text-xs text-muted">{p.startDate && p.endDate ? formatDateRange(p.startDate, p.endDate) : "Belum dijadwalkan"}</p><AttentionBadges codes={p.attention} /></Td>
                    <Td><ProjectStatusBadge status={p.status} /></Td>
                    <Td><ProgressBar progress={p.checklist} /></Td><Td align="right">{p.openTasks}{p.overdueTasks > 0 && <span className="ml-1 text-xs font-medium text-brand-700">({p.overdueTasks} telat)</span>}</Td></tr>))}</tbody></Table></TableWrap>
            )}
          </Card>
          <Card>
            <CardHeader title="Jadwal terdekat" description="14 hari ke depan" actions={<CalendarClock className="size-4 text-muted" aria-hidden />} />
            {d.upcoming.length === 0 ? <EmptyState title="Tidak ada jadwal" description="Belum ada sesi dalam 14 hari ke depan." /> : (
              <ul className="divide-y divide-line">{d.upcoming.map((s) => <li key={s.id} className="px-5 py-2.5 text-sm"><p className="font-medium text-ink">{s.title}</p><p className="text-xs text-muted">{formatDateWithDay(s.date)} · {s.startTime}–{s.endTime}</p><p className="text-xs text-muted">{s.projectCode}{s.room ? ` · ${s.room}` : ""}</p>{s.conflicts.length > 0 && <Badge tone="amber">Bentrok</Badge>}</li>)}</ul>
            )}
          </Card>
        </div>
      )}

      {staff && d.upcoming.length > 0 && <Card className="mt-6"><CardHeader title="Jadwal yang relevan" description="14 hari ke depan" /><ul className="divide-y divide-line">{d.upcoming.map((s) => <li key={s.id} className="px-5 py-2.5 text-sm"><span className="font-medium text-ink">{s.title}</span> <span className="text-xs text-muted">· {formatDateWithDay(s.date)} {s.startTime}–{s.endTime} · {s.projectCode}</span></li>)}</ul></Card>}

      {!staff && d.attention.length > 0 && (
        <Card className="mt-6"><CardHeader title="Proyek yang memerlukan perhatian" description="Proyek aktif dengan tugas terlambat, checklist wajib belum lengkap mendekati/melewati tanggal mulai, belum ada PIC, atau lewat tanggal selesai." actions={<AlertTriangle className="size-4 text-brand-700" aria-hidden />} />
          <ul className="divide-y divide-line">{d.attention.map((p) => <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"><div><Link href={`/training/proyek/${p.id}`} className="font-medium text-ink hover:underline">{p.code} · {p.name}</Link><p className="text-xs text-muted">PIC: {p.picName ?? "belum ada"}</p></div><AttentionBadges codes={p.attention} /></li>)}</ul></Card>
      )}

      {(d.variant === "manager" || d.variant === "admin") && d.teamLoad.length > 0 && (
        <Card className="mt-6"><CardHeader title="Ringkasan penugasan tim" description="Jumlah tugas terbuka per orang (angka, bukan persentase beban)." />
          <TableWrap><Table><thead><tr><Th>Nama</Th><Th align="right">Tugas terbuka</Th><Th align="right">Terlambat</Th></tr></thead><tbody>{d.teamLoad.map((m) => <tr key={m.employeeId}><Td>{m.name}</Td><Td align="right">{m.openTasks}</Td><Td align="right" className={m.overdueTasks ? "font-medium text-brand-700" : ""}>{m.overdueTasks}</Td></tr>)}</tbody></Table></TableWrap></Card>
      )}

      {(d.variant === "director" || d.variant === "manager") && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card><CardHeader title="Distribusi status proyek" />
            <ul className="space-y-2 px-5 py-4">{d.statusDistribution.map((s) => <li key={s.status} className="flex items-center gap-3 text-sm"><span className="w-24 text-muted">{PROJECT_STATUS_LABEL[s.status]}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-200"><div className="h-full rounded-full bg-brand-600" style={{ width: `${c.projectsInScope ? (s.count / c.projectsInScope) * 100 : 0}%` }} /></div><span className="tabular w-8 text-right font-medium">{s.count}</span></li>)}</ul></Card>
          <Card><CardHeader title="Proyek menurut bulan mulai" description="Enam bulan terakhir dan yang akan datang." />
            {d.byMonth.length === 0 ? <EmptyState title="Belum ada data" /> : <ul className="space-y-2 px-5 py-4">{d.byMonth.map((m) => <li key={m.month} className="flex items-center gap-3 text-sm"><span className="w-28 text-muted">{monthLabel(m.month)}</span><div className="h-2 flex-1 overflow-hidden rounded-full bg-stone-200"><div className="h-full rounded-full bg-ink" style={{ width: `${(m.count / maxMonth) * 100}%` }} /></div><span className="tabular w-8 text-right font-medium">{m.count}</span></li>)}</ul>}</Card>
        </div>
      )}

      {d.variant === "director" && (
        <Card className="mt-6"><CardHeader title="Ringkasan risiko operasional" description="Dihitung langsung dari data proyek." />
          <dl className="grid gap-4 px-5 py-4 sm:grid-cols-2 lg:grid-cols-5">
            {[["Tugas terlambat", d.risks.overdueTasks], ["Checklist wajib belum lengkap, mulai ≤ 7 hari", d.risks.requiredChecklistNearStart], ["Proyek aktif tanpa PIC", d.risks.noPic], ["Lewat tanggal selesai, belum ditutup", d.risks.pastEndNotClosed], ["Tugas milik anggota yang sudah keluar tim", d.risks.orphanTasks]].map(([l, n]) => <div key={String(l)}><dt className="text-xs text-muted">{l}</dt><dd className={`tabular text-2xl font-semibold ${Number(n) ? "text-brand-700" : "text-ink"}`}>{n}</dd></div>)}
          </dl>
          <div className="border-t border-line px-5 py-3"><Notice tone="info">Indikator <strong>Ketepatan Waktu</strong>, <strong>Kesiapan</strong>, dan <strong>Beban Tim</strong> ada di <Link href="/training/pemantauan" className="font-medium underline">Pemantauan Program</Link>; rumus dan ambang warnanya di <Link href="/training/indikator" className="font-medium underline">Rumus Indikator</Link>.</Notice></div></Card>
      )}
    </div>
  );
}
