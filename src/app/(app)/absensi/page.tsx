import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/server/auth/current";
import { actorCan } from "@/server/actor";
import { getRecap } from "@/server/services/recap";
import { listCorrections } from "@/server/services/attendance";
import { listDivisions } from "@/server/services/employees";
import { env } from "@/server/env";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { DayStatusBadge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { Tile } from "@/components/ui/stat";
import { FilterBar, FilterField, filterInput } from "@/components/filter-bar";
import { CorrectionButton } from "@/components/attendance-admin";
import { buildQuery, flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { dotTime, formatClock, formatDateLong, formatDateTime, formatDuration, formatDays } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/attendance";
import { addDays, todayIso } from "@/lib/time";

export const metadata: Metadata = { title: "Absensi" };
export const dynamic = "force-dynamic";

const STATUS_OPTIONS = ["HADIR", "TERLAMBAT", "BELUM_ABSEN", "TIDAK_HADIR", "IZIN", "SAKIT", "CUTI", "LIBUR", "BELUM_CHECKOUT"] as const;

export default async function AttendanceMonitorPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePagePermission("attendance:view_all");
  const sp = await flattenSearchParams(searchParams);
  const today = todayIso(env().APP_TIMEZONE);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const filters = { date, divisionId: sp.divisionId, q: sp.q, status: sp.status };
  const [recap, divisions, corrections] = await Promise.all([
    getRecap(user, { view: "harian", ...filters, page: sp.page, pageSize: 30 }),
    listDivisions(user),
    listCorrections(user, { date, limit: 20 }),
  ]);
  const canCorrect = actorCan(user, "attendance:correct");
  const s = recap.summary;
  return (
    <div>
      <PageHeader title="Absensi" description="Pantau kehadiran per hari dan koreksi bila perlu. Koreksi wajib beralasan dan tercatat lengkap." />
      <div className="mb-3 flex flex-wrap gap-2 text-sm">
        {[["Hari ini", today], ["Kemarin", addDays(today, -1)]].map(([l, d]) => <Link key={l} href={`/absensi${buildQuery({ ...filters, date: d, page: undefined })}`} className="rounded-full border border-line bg-white px-3 py-1 hover:bg-canvas">{l}</Link>)}
      </div>
      <FilterBar action="/absensi" resetHref="/absensi">
        <FilterField label="Tanggal"><input type="date" name="date" defaultValue={date} className={filterInput} /></FilterField>
        <FilterField label="Cari"><input type="search" name="q" defaultValue={sp.q} placeholder="Nama / no. induk" className={`${filterInput} w-48`} /></FilterField>
        <FilterField label="Divisi"><select name="divisionId" defaultValue={sp.divisionId ?? ""} className={filterInput}><option value="">Semua</option>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></FilterField>
        <FilterField label="Status"><select name="status" defaultValue={sp.status ?? ""} className={filterInput}><option value="">Semua</option>{STATUS_OPTIONS.map((k) => <option key={k} value={k}>{k === "BELUM_CHECKOUT" ? "Belum check-out" : STATUS_LABEL[k]}</option>)}</select></FilterField>
      </FilterBar>
      <p className="mb-3 text-sm text-muted">{formatDateLong(date)} · {recap.page.total} karyawan</p>
      <section className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Ringkasan">
        <Tile label="Terjadwal" value={formatDays(s.scheduledDays)} /><Tile label="Hadir" value={formatDays(s.presentDays)} tone="green" /><Tile label="Terlambat" value={s.lateCount} tone={s.lateCount ? "amber" : undefined} /><Tile label="Tidak hadir" value={formatDays(s.absentDays)} tone={s.absentDays ? "red" : undefined} />
      </section>
      <Card>
        {recap.page.items.length === 0 ? <EmptyState title="Tidak ada data" description="Ubah tanggal atau filter." /> : (
          <TableWrap><Table>
            <thead><tr><Th>No. Induk</Th><Th>Nama</Th><Th>Divisi</Th><Th>Jadwal</Th><Th>Check-in</Th><Th>Check-out</Th><Th align="right">Terlambat</Th><Th>Jam kerja</Th><Th>Status</Th>{canCorrect && <Th align="right">Aksi</Th>}</tr></thead>
            <tbody>{recap.page.items.map((r) => {
              const d = r.days![0]!;
              return (
                <tr key={r.employeeId}>
                  <Td mono>{r.employeeNo}</Td><Td className="font-medium"><Link className="hover:underline" href={`/rekap/${r.employeeId}?view=bulanan&month=${date.slice(0, 7)}`}>{r.name}</Link></Td><Td>{r.division ?? "—"}</Td>
                  <Td className="whitespace-nowrap">{d.scheduled ? `${dotTime(d.scheduleStart!)}–${dotTime(d.scheduleEnd!)}` : "—"}</Td>
                  <Td className="tabular">{d.checkInTime ? dotTime(d.checkInTime) : "—"}</Td><Td className="tabular">{d.checkOutTime ? dotTime(d.checkOutTime) : "—"}</Td>
                  <Td align="right">{d.lateMinutes ? `${d.lateMinutes} mnt` : "—"}</Td><Td>{d.workedMinutes ? formatDuration(d.workedMinutes) : "—"}</Td>
                  <Td><DayStatusBadge status={d.status} missingCheckout={d.missingCheckout} />{d.offReason && !d.scheduled && <span className="ml-1 text-xs text-muted">{d.offReason}</span>}</Td>
                  {canCorrect && <Td align="right">{d.status !== "DI_LUAR_MASA_KERJA" && <CorrectionButton target={{ employeeId: r.employeeId, name: r.name, employeeNo: r.employeeNo, date, checkIn: d.checkInTime, checkOut: d.checkOutTime, hasRecord: !!d.checkInAt }} />}</Td>}
                </tr>
              );
            })}</tbody>
          </Table></TableWrap>
        )}
        <Pagination page={recap.page.page} pageCount={recap.page.pageCount} total={recap.page.total} hrefFor={(p) => `/absensi${buildQuery({ ...filters, page: p })}`} />
      </Card>

      <Card className="mt-4">
        <CardHeader title={`Riwayat koreksi — ${formatDateLong(date)}`} description="Data sebelum & sesudah, waktu perubahan, dan pengguna yang melakukan." />
        {corrections.length === 0 ? <EmptyState title="Tidak ada koreksi pada tanggal ini" /> : (
          <TableWrap><Table>
            <thead><tr><Th>Waktu koreksi</Th><Th>Karyawan</Th><Th>Sebelum</Th><Th>Sesudah</Th><Th>Alasan</Th><Th>Oleh</Th></tr></thead>
            <tbody>{corrections.map((c) => (
              <tr key={c.id}><Td className="whitespace-nowrap">{formatDateTime(c.createdAt)}</Td><Td>{c.employeeName}<span className="block text-xs text-muted">{c.employeeNo}</span></Td>
                <Td className="whitespace-nowrap">{c.before ? `${dotTime(formatClock(c.before.checkInAt))} – ${c.before.checkOutAt ? dotTime(formatClock(c.before.checkOutAt)) : "—"}` : "Tidak ada catatan"}</Td>
                <Td className="whitespace-nowrap">{c.after ? `${dotTime(formatClock(c.after.checkInAt))} – ${c.after.checkOutAt ? dotTime(formatClock(c.after.checkOutAt)) : "—"}` : "Catatan dihapus"}</Td>
                <Td className="min-w-48 text-muted">{c.reason}</Td><Td>{c.correctedBy}</Td></tr>
            ))}</tbody>
          </Table></TableWrap>
        )}
      </Card>
    </div>
  );
}
