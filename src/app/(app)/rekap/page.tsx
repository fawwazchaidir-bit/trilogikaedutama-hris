import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/server/auth/current";
import { actorCan } from "@/server/actor";
import { getRecap, RECAP_VIEWS } from "@/server/services/recap";
import { listDivisions } from "@/server/services/employees";
import { getSettings } from "@/server/services/settings";
import { env } from "@/server/env";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { DayStatusBadge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { Tile } from "@/components/ui/stat";
import { FilterBar, FilterField, filterInput } from "@/components/filter-bar";
import { ExportLinks } from "@/components/export-links";
import { RecapExplanation } from "@/components/recap-explanation";
import { buildQuery, flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { dotTime, formatDuration, formatHours } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/attendance";
import { todayIso } from "@/lib/time";

export const metadata: Metadata = { title: "Rekap Absensi" };
export const dynamic = "force-dynamic";

const VIEW_LABEL: Record<(typeof RECAP_VIEWS)[number], string> = { harian: "Harian", mingguan: "Mingguan", bulanan: "Bulanan", kustom: "Periode bebas" };
const STATUS_OPTIONS = ["HADIR", "TERLAMBAT", "IZIN", "SAKIT", "CUTI", "TIDAK_HADIR", "BELUM_ABSEN", "BELUM_CHECKOUT"] as const;

export default async function RecapPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePagePermission("recap:view_all");
  const sp = await flattenSearchParams(searchParams);
  const view = (RECAP_VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as (typeof RECAP_VIEWS)[number]) : "bulanan";
  const today = todayIso(env().APP_TIMEZONE);
  const filters = { view, date: sp.date, month: sp.month, from: sp.from, to: sp.to, divisionId: sp.divisionId, q: sp.q, status: sp.status, employeeId: sp.employeeId, includeInactive: sp.includeInactive };
  const [res, divisions, settings] = await Promise.all([getRecap(user, { ...filters, page: sp.page, pageSize: 25 }), listDivisions(user), getSettings()]);
  const s = res.summary;
  const detailQuery = () => buildQuery({ view, date: res.from, month: res.from.slice(0, 7), from: res.from, to: res.to });
  return (
    <div>
      <PageHeader title="Rekap Absensi" description="Rekap otomatis harian, mingguan, dan bulanan — dihitung dari jadwal, hari libur, pengajuan disetujui, dan koreksi."
        actions={actorCan(user, "recap:export") ? <ExportLinks base="/api/recap/export" params={filters} formats={["xlsx", "csv", "pdf"]} /> : undefined} />
      <nav className="mb-3 flex flex-wrap gap-2 text-sm" aria-label="Jenis rekap">
        {RECAP_VIEWS.map((v) => (
          <Link key={v} href={`/rekap${buildQuery({ ...filters, view: v, page: undefined })}`} aria-current={v === view ? "page" : undefined}
            className={`rounded-full border px-3 py-1 ${v === view ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white text-ink-soft hover:bg-canvas"}`}>{VIEW_LABEL[v]}</Link>
        ))}
      </nav>
      <FilterBar action="/rekap" resetHref={`/rekap?view=${view}`}>
        <input type="hidden" name="view" value={view} />
        {(view === "harian" || view === "mingguan") && <FilterField label={view === "harian" ? "Tanggal" : "Pekan yang memuat tanggal"}><input type="date" name="date" defaultValue={sp.date ?? today} className={filterInput} /></FilterField>}
        {view === "bulanan" && <FilterField label="Bulan"><input type="month" name="month" defaultValue={sp.month ?? today.slice(0, 7)} className={filterInput} /></FilterField>}
        {view === "kustom" && <><FilterField label="Dari"><input type="date" name="from" defaultValue={res.from} className={filterInput} /></FilterField><FilterField label="Sampai"><input type="date" name="to" defaultValue={res.to} className={filterInput} /></FilterField></>}
        <FilterField label="Karyawan"><input type="search" name="q" defaultValue={sp.q} placeholder="Nama / no. induk" className={`${filterInput} w-44`} /></FilterField>
        <FilterField label="Divisi"><select name="divisionId" defaultValue={sp.divisionId ?? ""} className={filterInput}><option value="">Semua</option>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></FilterField>
        <FilterField label="Status kehadiran"><select name="status" defaultValue={sp.status ?? ""} className={filterInput}><option value="">Semua</option>{STATUS_OPTIONS.map((k) => <option key={k} value={k}>{k === "BELUM_CHECKOUT" ? "Belum check-out" : STATUS_LABEL[k]}</option>)}</select></FilterField>
      </FilterBar>
      <p className="mb-3 text-sm text-muted">Periode: <strong className="text-ink">{res.label}</strong> · {s.employees} karyawan</p>

      {view !== "harian" && (
        <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-6" aria-label="Total">
          <Tile label="Hari kerja terjadwal" value={s.scheduledDays} /><Tile label="Hadir" value={s.presentDays} tone="green" />
          <Tile label="Terlambat" value={`${s.lateCount}x`} hint={`${s.lateMinutes} menit`} tone={s.lateCount ? "amber" : undefined} />
          <Tile label="Izin / Sakit / Cuti" value={`${s.izinDays} / ${s.sakitDays} / ${s.cutiDays}`} />
          <Tile label="Tidak hadir" value={s.absentDays} tone={s.absentDays ? "red" : undefined} />
          <Tile label="Belum lengkap" value={s.incompleteCount} tone={s.incompleteCount ? "amber" : undefined} />
        </section>
      )}

      <Card>
        {res.page.items.length === 0 ? <EmptyState title="Tidak ada data" description="Ubah periode atau filter." /> : view === "harian" ? (
          <TableWrap><Table>
            <thead><tr><Th>No. Induk</Th><Th>Nama</Th><Th>Divisi</Th><Th>Check-in</Th><Th>Check-out</Th><Th align="right">Terlambat</Th><Th>Jam kerja</Th><Th>Status</Th><Th>Keterangan</Th></tr></thead>
            <tbody>{res.page.items.map((r) => { const d = r.days![0]!; return (
              <tr key={r.employeeId}><Td mono>{r.employeeNo}</Td><Td className="font-medium"><Link className="hover:underline" href={`/rekap/${r.employeeId}${detailQuery()}`}>{r.name}</Link></Td><Td>{r.division ?? "—"}</Td>
                <Td className="tabular">{d.checkInTime ? dotTime(d.checkInTime) : "—"}</Td><Td className="tabular">{d.checkOutTime ? dotTime(d.checkOutTime) : "—"}</Td><Td align="right">{d.lateMinutes ? `${d.lateMinutes} mnt` : "—"}</Td><Td>{d.workedMinutes ? formatDuration(d.workedMinutes) : "—"}</Td>
                <Td><DayStatusBadge status={d.status} missingCheckout={d.missingCheckout} /></Td><Td className="min-w-56 text-muted">{d.explain}</Td></tr>); })}</tbody>
          </Table></TableWrap>
        ) : (
          <TableWrap><Table>
            <thead><tr><Th>No. Induk</Th><Th>Nama</Th><Th>Divisi</Th><Th align="right">Hari kerja</Th><Th align="right">Hadir</Th><Th align="right">Terlambat</Th><Th align="right">Mnt telat</Th><Th align="right">Izin</Th><Th align="right">Sakit</Th><Th align="right">Cuti</Th><Th align="right">Tdk hadir</Th><Th align="right">Belum lengkap</Th><Th align="right">Jam kerja</Th></tr></thead>
            <tbody>{res.page.items.map((r) => { const t = r.totals; return (
              <tr key={r.employeeId}><Td mono>{r.employeeNo}</Td><Td className="font-medium"><Link className="text-brand-700 hover:underline" href={`/rekap/${r.employeeId}${detailQuery()}`}>{r.name}</Link></Td><Td>{r.division ?? "—"}</Td>
                <Td align="right">{t.scheduledDays}</Td><Td align="right">{t.presentDays}</Td><Td align="right">{t.lateCount}</Td><Td align="right">{t.lateMinutes}</Td><Td align="right">{t.izinDays}</Td><Td align="right">{t.sakitDays}</Td><Td align="right">{t.cutiDays}</Td>
                <Td align="right" className={t.absentDays ? "font-semibold text-brand-700" : ""}>{t.absentDays}</Td><Td align="right" className={t.incompleteCount ? "font-semibold text-amber-700" : ""}>{t.incompleteCount}</Td><Td align="right">{formatHours(t.workedMinutes)} j</Td></tr>); })}
              <tr className="bg-canvas/70 font-semibold"><Td>TOTAL</Td><Td /><Td /><Td align="right">{s.scheduledDays}</Td><Td align="right">{s.presentDays}</Td><Td align="right">{s.lateCount}</Td><Td align="right">{s.lateMinutes}</Td><Td align="right">{s.izinDays}</Td><Td align="right">{s.sakitDays}</Td><Td align="right">{s.cutiDays}</Td><Td align="right">{s.absentDays}</Td><Td align="right">{s.incompleteCount}</Td><Td align="right">{formatHours(s.workedMinutes)} j</Td></tr></tbody>
          </Table></TableWrap>
        )}
        <Pagination page={res.page.page} pageCount={res.page.pageCount} total={res.page.total} hrefFor={(p) => `/rekap${buildQuery({ ...filters, page: p })}`} />
      </Card>
      <div className="mt-4"><RecapExplanation lateAfterTolerance={settings.lateMinutesAfterTolerance} /></div>
    </div>
  );
}
