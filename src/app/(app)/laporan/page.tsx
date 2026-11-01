import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, Info, TrendingDown, TrendingUp } from "lucide-react";
import { requirePagePermission } from "@/server/auth/current";
import { actorCan } from "@/server/actor";
import {
  getAttendanceReport, getComplianceReport, getCostReport, getExecutiveSummary, getLeaveOvertimeReport, getWorkforceReport, type Kpi,
} from "@/server/services/reports";
import { listDivisions } from "@/server/services/employees";
import { env } from "@/server/env";
import { Card, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui/card";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { Tile } from "@/components/ui/stat";
import { FilterBar, FilterField, filterInput } from "@/components/filter-bar";
import { ExportLinks } from "@/components/export-links";
import { BarChart, HBarList, LineChart } from "@/components/charts";
import { cn } from "@/lib/cn";
import { buildQuery, flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { formatPercent } from "@/lib/analytics";
import { formatDays, formatDuration, monthLabel } from "@/lib/format";
import { formatRupiah } from "@/lib/money";
import { WEEKDAYS_ID } from "@/lib/format";
import { todayIso } from "@/lib/time";

export const metadata: Metadata = { title: "Laporan & Analisis" };
export const dynamic = "force-dynamic";

const TABS = [
  { id: "ringkasan", label: "Ringkasan" },
  { id: "kehadiran", label: "Kehadiran" },
  { id: "cuti-lembur", label: "Cuti & Lembur" },
  { id: "biaya", label: "Biaya SDM", payroll: true },
  { id: "kepatuhan", label: "BPJS & PPh 21", payroll: true },
  { id: "karyawan", label: "Karyawan" },
] as const;
type TabId = (typeof TABS)[number]["id"];

const R = (n: number) => formatRupiah(n);
const pct = (v: number | null) => formatPercent(v);

function KpiCard({ k }: { k: Kpi }) {
  const Icon = k.delta?.startsWith("-") ? TrendingDown : TrendingUp;
  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
      <p className="text-sm text-muted">{k.label}</p>
      <p className="tabular mt-1 text-2xl font-semibold tracking-tight">{k.value}</p>
      <p className="mt-1 flex min-h-4 items-center gap-1 text-xs">
        {k.delta && k.delta !== "—" && <span className={cn("inline-flex items-center gap-0.5 font-medium", k.tone === "good" ? "text-emerald-700" : k.tone === "bad" ? "text-brand-700" : "text-muted")}><Icon className="size-3.5" aria-hidden />{k.delta}<span className="sr-only"> dibanding bulan lalu</span></span>}
        {k.hint && <span className="text-muted">{k.delta && k.delta !== "—" ? "· " : ""}{k.hint}</span>}
      </p>
    </div>
  );
}

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePagePermission("report:view");
  const sp = await flattenSearchParams(searchParams);
  const canPayroll = actorCan(user, "report:payroll");
  const tabs = TABS.filter((t) => !("payroll" in t && t.payroll) || canPayroll);
  const tab = (tabs.find((t) => t.id === sp.tab)?.id ?? "ringkasan") as TabId;
  const today = todayIso(env().APP_TIMEZONE);
  const month = sp.month ?? today.slice(0, 7);
  const year = sp.year ? Number(sp.year) : Number(today.slice(0, 4));
  const base = { month: sp.month, from: sp.from, to: sp.to, year: sp.year, divisionId: sp.divisionId };
  const divisions = tab === "kehadiran" ? await listDivisions(user) : [];

  const periodFilter = tab === "biaya" || tab === "karyawan"
    ? <FilterField label="Tahun"><input type="number" name="year" min={2000} max={2200} defaultValue={year} className={`${filterInput} w-28`} /></FilterField>
    : <><FilterField label="Bulan"><input type="month" name="month" defaultValue={month} className={filterInput} /></FilterField>
      {(tab === "kehadiran" || tab === "cuti-lembur") && <>
        <FilterField label="atau dari tanggal"><input type="date" name="from" defaultValue={sp.from} className={filterInput} /></FilterField>
        <FilterField label="sampai"><input type="date" name="to" defaultValue={sp.to} className={filterInput} /></FilterField></>}
      {tab === "kehadiran" && <FilterField label="Divisi"><select name="divisionId" defaultValue={sp.divisionId ?? ""} className={filterInput}><option value="">Semua</option>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></FilterField>}</>;

  return (
    <div className="space-y-4">
      <PageHeader title="Laporan & Analisis" description="Ringkasan eksekutif dan analisis lanjutan dari data yang sama dengan rekap absensi, pengajuan, dan penggajian — dapat ditelusuri dan diekspor." />
      <nav aria-label="Jenis laporan" className="flex flex-wrap gap-1 border-b border-line">
        {tabs.map((t) => (
          <Link key={t.id} href={`/laporan${buildQuery({ tab: t.id, month: sp.month, year: sp.year })}`} aria-current={t.id === tab ? "page" : undefined}
            className={cn("-mb-px rounded-t-md border-b-2 px-4 py-2 text-sm font-medium", t.id === tab ? "border-brand-600 text-brand-700" : "border-transparent text-muted hover:text-ink")}>{t.label}</Link>
        ))}
      </nav>
      <FilterBar action="/laporan" resetHref={`/laporan?tab=${tab}`}>
        <input type="hidden" name="tab" value={tab} />
        {periodFilter}
      </FilterBar>

      {tab === "ringkasan" && <Summary user={user} month={month} />}
      {tab === "kehadiran" && <Attendance user={user} base={base} />}
      {tab === "cuti-lembur" && <LeaveOvertime user={user} base={base} />}
      {tab === "biaya" && canPayroll && <Cost user={user} year={year} />}
      {tab === "kepatuhan" && canPayroll && <Compliance user={user} month={sp.month} />}
      {tab === "karyawan" && <Workforce user={user} year={year} />}
    </div>
  );
}

type User = Awaited<ReturnType<typeof requirePagePermission>>;

async function Summary({ user, month }: { user: User; month: string }) {
  const s = await getExecutiveSummary(user, { month });
  const ICON = { info: Info, warn: AlertTriangle, good: CheckCircle2 } as const;
  return (
    <div className="space-y-4">
      <section aria-label={`Indikator utama ${s.monthLabel}`} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{s.kpis.map((k) => <KpiCard key={k.label} k={k} />)}</section>
      {s.insights.length > 0 && (
        <Card>
          <CardHeader title="Perlu perhatian" description="Hanya temuan yang melewati ambang — bukan seluruh angka." />
          <ul className="divide-y divide-line">{s.insights.map((i, idx) => { const Icon = ICON[i.tone]; return (
            <li key={idx} className="flex items-start gap-3 px-5 py-3 text-sm"><Icon className={cn("mt-0.5 size-4 shrink-0", i.tone === "warn" ? "text-amber-600" : i.tone === "good" ? "text-emerald-600" : "text-sky-600")} aria-hidden />
              <span className="flex-1">{i.text}</span>{i.href && <Link href={i.href} className="shrink-0 text-brand-700 hover:underline">Lihat</Link>}</li>); })}</ul>
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card><CardHeader title="Tingkat kehadiran" description="6 bulan terakhir" /><div className="p-4"><LineChart title="Tingkat kehadiran" points={s.trend.map((t) => ({ label: t.label, value: t.attendance }))} format={pct} /></div></Card>
        <Card><CardHeader title="Ketepatan waktu" description="Tepat waktu ÷ hadir" /><div className="p-4"><LineChart title="Ketepatan waktu" points={s.trend.map((t) => ({ label: t.label, value: t.punctuality }))} format={pct} /></div></Card>
        <Card><CardHeader title="Tidak hadir tanpa keterangan" /><div className="p-4"><LineChart title="Tidak hadir" points={s.trend.map((t) => ({ label: t.label, value: t.absence }))} format={pct} /></div></Card>
      </div>
      {s.trend.some((t) => t.cost !== null) && (
        <Card><CardHeader title="Biaya SDM per bulan" description="Pendapatan + BPJS porsi perusahaan dari periode gaji yang disetujui/diterbitkan." />
          <div className="p-4"><BarChart title="Biaya SDM" items={s.trend.map((t) => ({ label: t.label, value: t.cost }))} format={(v) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1).replace(".", ",")} jt` : R(v))} /></div></Card>
      )}
      {s.location && (
        <Card><CardHeader title="Sinyal integritas lokasi" description={`${s.monthLabel} · penilaian risiko lokasi palsu`} actions={<Link href="/lokasi" className="text-sm text-brand-700 hover:underline">Buka tinjauan</Link>} />
          <div className="grid gap-3 p-5 sm:grid-cols-4"><Tile label="Absensi dinilai" value={s.location.total} /><Tile label="Ditandai" value={s.location.flagged} tone={s.location.flagged ? "amber" : undefined} /><Tile label="Ditolak" value={s.location.blocked} tone={s.location.blocked ? "red" : undefined} /><Tile label="Terkonfirmasi" value={s.location.confirmed} tone={s.location.confirmed ? "red" : undefined} /></div>
          {s.location.topFlags.length > 0 && <div className="border-t border-line p-5"><HBarList tone="amber" items={s.location.topFlags.map((f) => ({ label: f.label, value: f.count }))} format={(v) => `${v}×`} /></div>}
        </Card>
      )}
    </div>
  );
}

async function Attendance({ user, base }: { user: User; base: Record<string, string | undefined> }) {
  const r = await getAttendanceReport(user, base);
  if (r.totals.scheduledDays === 0) return <Card><EmptyState title="Belum ada hari kerja pada periode ini" description="Ubah periode atau filter divisi." /></Card>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">Periode <strong className="text-ink">{r.label}</strong> · {r.rows.length} karyawan</p>
        <ExportLinks base="/api/reports/export" params={{ ...base, kind: "kehadiran" }} formats={["xlsx", "csv", "pdf"]} /></div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="Tingkat kehadiran" value={pct(r.rates.attendance)} tone="green" hint="Hadir ÷ hari kerja yang dapat dinilai" />
        <Tile label="Ketepatan waktu" value={pct(r.rates.punctuality)} />
        <Tile label="Tidak hadir tanpa keterangan" value={pct(r.rates.absence)} tone={r.rates.absence ? "red" : undefined} />
        <Tile label="Terlambat" value={`${r.totals.lateCount}×`} hint={formatDuration(r.totals.lateMinutes)} tone={r.totals.lateCount ? "amber" : undefined} />
        <Tile label="Rata-rata jam kerja / hari" value={r.avgWorkedMinutes === null ? "—" : formatDuration(r.avgWorkedMinutes)} hint="Dari absensi lengkap" />
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Jam datang terhadap jam masuk" description="Sebaran seluruh hari hadir" /><div className="p-5"><HBarList tone="amber" items={r.arrival.map((b) => ({ label: b.label, value: b.count }))} format={(v) => `${v}`} /></div></Card>
        <Card><CardHeader title="Per hari dalam seminggu" description="Di hari apa keterlambatan & ketidakhadiran menumpuk" />
          <TableWrap><Table><thead><tr><Th>Hari</Th><Th align="right">Hari kerja</Th><Th align="right">Terlambat</Th><Th align="right">Tidak hadir</Th></tr></thead>
            <tbody>{r.byWeekday.map((w) => <tr key={w.weekday}><Td className="font-medium">{WEEKDAYS_ID[w.weekday]}</Td><Td align="right">{w.scheduled}</Td><Td align="right">{w.late}</Td><Td align="right">{formatDays(w.absent)}</Td></tr>)}</tbody></Table></TableWrap></Card>
      </div>
      {r.weekly.length > 1 && <Card><CardHeader title="Tren mingguan" description="Tingkat kehadiran per minggu" /><div className="p-4"><LineChart title="Kehadiran mingguan" points={r.weekly.map((w, i) => ({ label: `M${i + 1}`, value: w.attendance }))} format={pct} /></div></Card>}
      <Card><CardHeader title="Per divisi" />
        <TableWrap><Table><thead><tr><Th>Divisi</Th><Th align="right">Karyawan</Th><Th align="right">Kehadiran</Th><Th align="right">Tepat waktu</Th><Th align="right">Tidak hadir</Th><Th align="right">Izin/sakit/cuti</Th><Th align="right">Terlambat</Th></tr></thead>
          <tbody>{r.byDivision.map((d) => <tr key={d.name}><Td className="font-medium">{d.name}</Td><Td align="right">{d.employees}</Td><Td align="right">{pct(d.attendance)}</Td><Td align="right">{pct(d.punctuality)}</Td><Td align="right" className={d.absence && d.absence >= 0.05 ? "font-semibold text-brand-700" : ""}>{pct(d.absence)}</Td><Td align="right">{formatDays(d.leave)}</Td><Td align="right">{d.late}×</Td></tr>)}</tbody></Table></TableWrap></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Keterlambatan terbanyak" description="10 teratas" /><div className="p-5"><HBarList tone="amber" items={r.topLate.map((p) => ({ label: p.name, value: p.late, hint: `${p.division ?? "Tanpa divisi"} · ${formatDuration(p.lateMinutes)}` }))} format={(v) => `${v}×`} /></div></Card>
        <Card><CardHeader title="Tidak hadir terbanyak" description="Hari tanpa keterangan, 10 teratas" /><div className="p-5"><HBarList items={r.topAbsent.map((p) => ({ label: p.name, value: p.absent, hint: p.division ?? "Tanpa divisi" }))} format={(v) => `${formatDays(v)} hari`} /></div></Card>
      </div>
    </div>
  );
}

async function LeaveOvertime({ user, base }: { user: User; base: Record<string, string | undefined> }) {
  const r = await getLeaveOvertimeReport(user, base);
  const LABEL = { IZIN: "Izin", SAKIT: "Sakit", CUTI: "Cuti" } as const;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">Periode <strong className="text-ink">{r.label}</strong></p><ExportLinks base="/api/reports/export" params={{ ...base, kind: "cuti-lembur" }} formats={["xlsx", "csv", "pdf"]} /></div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {r.leaveByType.map((t) => <Tile key={t.type} label={`${LABEL[t.type]} disetujui`} value={`${formatDays(t.days)} hari`} hint={`${t.requests} pengajuan`} />)}
        <Tile label="Lembur disetujui" value={formatDuration(r.overtime.approvedMinutes)} hint={`${r.overtime.requests.approved} pengajuan · ${r.overtime.requests.pending} menunggu`} tone={r.overtime.requests.pending ? "amber" : undefined} />
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Izin, sakit & cuti per divisi" description="Hari kerja (pengajuan yang dimulai pada periode ini)" />
          <TableWrap><Table><thead><tr><Th>Divisi</Th><Th align="right">Izin</Th><Th align="right">Sakit</Th><Th align="right">Cuti</Th></tr></thead>
            <tbody>{r.leaveByDivision.length === 0 ? <tr><Td className="text-muted">Tidak ada pengajuan disetujui</Td><Td /><Td /><Td /></tr> : r.leaveByDivision.map((d) => <tr key={d.name}><Td className="font-medium">{d.name}</Td><Td align="right">{formatDays(d.izin)}</Td><Td align="right">{formatDays(d.sakit)}</Td><Td align="right">{formatDays(d.cuti)}</Td></tr>)}</tbody></Table></TableWrap></Card>
        <Card><CardHeader title={`Saldo cuti ${r.balance.year} (belum terpakai)`} description={`Total ${formatDays(r.balance.totalDays)} hari dari ${r.balance.employees} karyawan — kewajiban cuti yang belum diambil`} />
          <div className="p-5"><HBarList tone="green" items={r.balance.highest.map((b) => ({ label: b.name, value: b.balance }))} format={(v) => `${formatDays(v)} hari`} /></div></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Lembur per karyawan" description="Menit yang disetujui (belum tentu seluruhnya dibayar — bergantung pada bukti absensi)" /><div className="p-5"><HBarList items={r.overtime.byEmployee.map((o) => ({ label: o.name, value: o.minutes, hint: `${o.division ?? "Tanpa divisi"} · ${o.days} hari` }))} format={formatDuration} /></div></Card>
        <Card><CardHeader title="Lembur per divisi" /><div className="p-5"><HBarList items={r.overtime.byDivision.map((o) => ({ label: o.name, value: o.minutes }))} format={formatDuration} /></div></Card>
      </div>
    </div>
  );
}

async function Cost({ user, year }: { user: User; year: number }) {
  const r = await getCostReport(user, { year });
  if (r.months.length === 0) return <Card><EmptyState title={`Belum ada periode gaji yang disetujui/diterbitkan pada ${year}`} description="Laporan biaya hanya memuat periode berstatus Disetujui atau Diterbitkan." /></Card>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">Tahun <strong className="text-ink">{r.year}</strong> · {r.runsIncluded} periode gaji</p><ExportLinks base="/api/reports/export" params={{ year, kind: "biaya" }} formats={["xlsx", "csv", "pdf"]} /></div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Biaya SDM (pendapatan + BPJS perusahaan)" value={R(r.totals.employerCost)} />
        <Tile label="Total pendapatan karyawan" value={R(r.totals.earnings)} />
        <Tile label="Gaji bersih dibayarkan" value={R(r.totals.net)} tone="green" />
        <Tile label="PPh 21 dipotong" value={R(r.totals.pph21)} hint={`BPJS perusahaan ${R(r.totals.employerBpjs)}`} />
      </section>
      <Card><CardHeader title="Biaya SDM per bulan" /><div className="p-4"><BarChart title="Biaya SDM per bulan" items={r.months.map((m) => ({ label: monthLabel(m.ym, true), value: m.employerCost }))} format={(v) => `${(v / 1_000_000).toFixed(1).replace(".", ",")} jt`} /></div></Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Per divisi (setahun)" />
          <TableWrap><Table><thead><tr><Th>Divisi</Th><Th align="right">Slip</Th><Th align="right">Pendapatan</Th><Th align="right">Rata-rata / slip</Th></tr></thead>
            <tbody>{r.byDivision.map((d) => <tr key={d.name}><Td className="font-medium">{d.name}</Td><Td align="right">{d.employees}</Td><Td align="right">{R(d.earnings)}</Td><Td align="right">{R(d.avgEarnings)}</Td></tr>)}</tbody></Table></TableWrap></Card>
        <Card><CardHeader title="Komposisi per kategori" description="Jumlah seluruh periode pada tahun ini" />
          <TableWrap><Table><thead><tr><Th>Kategori</Th><Th>Jenis</Th><Th align="right">Jumlah</Th></tr></thead>
            <tbody>{r.byCategory.map((c) => <tr key={`${c.kind}-${c.category}`}><Td className="font-medium">{c.category}</Td><Td>{c.kind === "EARNING" ? "Pendapatan" : "Potongan"}</Td><Td align="right">{R(c.amount)}</Td></tr>)}</tbody></Table></TableWrap></Card>
      </div>
    </div>
  );
}

async function Compliance({ user, month }: { user: User; month: string | undefined }) {
  const r = await getComplianceReport(user, { month });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">Bulan <strong className="text-ink">{r.monthLabel}</strong>{r.runs.length ? ` · ${r.runs.join(", ")}` : ""}</p><ExportLinks base="/api/reports/export" params={{ month: r.month, kind: "kepatuhan" }} formats={["xlsx", "csv", "pdf"]} /></div>
      <Notice tone="warn">Rekap ini membantu menyiapkan pembayaran iuran dan pelaporan, bukan pengganti verifikasi. Cocokkan dengan konsultan pajak/BPJS sebelum membayar atau melapor.</Notice>
      {!r.automatic && r.rows.length > 0 && <Notice tone="info">Periode ini tidak memakai perhitungan BPJS/PPh 21 otomatis — angka di bawah kosong. Potongan manual tercatat sebagai komponen gaji per karyawan.</Notice>}
      {r.issues.length > 0 && <Card><CardHeader title="Perlu diperiksa" /><ul className="divide-y divide-line">{r.issues.map((i) => <li key={i.text} className="flex items-center justify-between gap-3 px-5 py-3 text-sm"><span>{i.text}</span><span className="tabular font-semibold text-amber-700">{i.count}</span></li>)}</ul></Card>}
      {r.rows.length === 0 ? <Card><EmptyState title="Tidak ada periode gaji disetujui/diterbitkan pada bulan ini" /></Card> : (
        <>
          <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Tile label="BPJS Kesehatan (karyawan + perusahaan)" value={R(r.totals.kesEmp + r.totals.kesEr)} />
            <Tile label="BPJS Ketenagakerjaan (JHT+JP+JKK+JKM)" value={R(r.totals.jhtEmp + r.totals.jhtEr + r.totals.jpEmp + r.totals.jpEr + r.totals.jkk + r.totals.jkm)} />
            <Tile label="PPh 21 dipotong" value={R(r.totals.pph21)} tone="amber" />
            <Tile label="Bruto kena pajak" value={R(r.totals.taxableGross)} />
          </section>
          <Card><TableWrap><Table>
            <thead><tr><Th>Karyawan</Th><Th>PTKP</Th><Th align="right">Dasar upah</Th><Th align="right">Kes. K</Th><Th align="right">Kes. P</Th><Th align="right">JHT K</Th><Th align="right">JHT P</Th><Th align="right">JP K</Th><Th align="right">JP P</Th><Th align="right">JKK</Th><Th align="right">JKM</Th><Th align="right">Bruto</Th><Th align="right">PPh 21</Th><Th>Metode</Th></tr></thead>
            <tbody>{r.rows.map((x) => <tr key={x.employeeNo}><Td className="font-medium">{x.name}<span className="block text-xs font-normal text-muted">{x.employeeNo}{x.hasNpwp ? "" : " · tanpa NPWP"}</span></Td><Td>{x.taxStatus}</Td><Td align="right">{R(x.bpjsWage)}</Td><Td align="right">{R(x.kesEmp)}</Td><Td align="right">{R(x.kesEr)}</Td><Td align="right">{R(x.jhtEmp)}</Td><Td align="right">{R(x.jhtEr)}</Td><Td align="right">{R(x.jpEmp)}</Td><Td align="right">{R(x.jpEr)}</Td><Td align="right">{R(x.jkk)}</Td><Td align="right">{R(x.jkm)}</Td><Td align="right">{R(x.taxableGross)}</Td><Td align="right" className="font-semibold">{R(x.pph21)}</Td><Td>{x.pph21Method}</Td></tr>)}</tbody>
          </Table></TableWrap></Card>
        </>
      )}
    </div>
  );
}

async function Workforce({ user, year }: { user: User; year: number }) {
  const r = await getWorkforceReport(user, { year });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-muted">Tahun <strong className="text-ink">{r.year}</strong></p><ExportLinks base="/api/reports/export" params={{ year, kind: "karyawan" }} formats={["xlsx", "csv", "pdf"]} /></div>
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Karyawan aktif" value={r.headcount} />
        {r.byStatus.map((s) => <Tile key={s.status} label={s.label} value={s.count} />).slice(0, 2)}
        <Tile label="Turnover (tahun berjalan)" value={pct(r.turnover)} hint="Keluar ÷ rata-rata headcount" tone={r.turnover && r.turnover > 0.15 ? "red" : undefined} />
      </section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Headcount akhir bulan" /><div className="p-4"><BarChart title="Headcount" items={r.movement.map((m) => ({ label: m.label, value: m.headcountEnd }))} format={(v) => String(v)} /></div></Card>
        <Card><CardHeader title="Masuk & keluar per bulan" />
          <TableWrap><Table><thead><tr><Th>Bulan</Th><Th align="right">Masuk</Th><Th align="right">Keluar</Th><Th align="right">Headcount</Th></tr></thead>
            <tbody>{r.movement.map((m) => <tr key={m.ym}><Td className="font-medium">{monthLabel(m.ym)}</Td><Td align="right">{m.joiners}</Td><Td align="right" className={m.leavers ? "text-brand-700" : ""}>{m.leavers}</Td><Td align="right">{m.headcountEnd}</Td></tr>)}</tbody></Table></TableWrap></Card>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader title="Per divisi" /><div className="p-5"><HBarList items={r.byDivision.map((d) => ({ label: d.name, value: d.count }))} format={(v) => `${v} orang`} /></div></Card>
        <Card><CardHeader title="Masa kerja" description={r.averageTenureYears === null ? undefined : `Rata-rata ${r.averageTenureYears.toFixed(1).replace(".", ",")} tahun`} /><div className="p-5"><HBarList tone="green" items={r.tenure.map((t) => ({ label: t.label, value: t.count }))} format={(v) => `${v} orang`} /></div></Card>
      </div>
    </div>
  );
}
