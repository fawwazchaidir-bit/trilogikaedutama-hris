import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { requirePageSelf } from "@/server/auth/current";
import { getMyMonth, getTodayState, listCorrections } from "@/server/services/attendance";
import { AttendancePanel } from "@/components/attendance-panel";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { DayStatusBadge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { Tile } from "@/components/ui/stat";
import { RecapExplanation } from "@/components/recap-explanation";
import { flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { dotTime, formatClock, formatDateCompact, formatDateLong, formatDuration, monthLabel, formatDays } from "@/lib/format";
import { addDays } from "@/lib/time";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Absensi Saya" };
export const dynamic = "force-dynamic";

const shiftMonth = (ym: string, n: number) => addDays(`${ym}-15`, n * 30).slice(0, 7);

export default async function MyAttendancePage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePageSelf();
  const sp = await flattenSearchParams(searchParams);
  const [state, month, corrections] = await Promise.all([getTodayState(user), getMyMonth(user, { month: sp.month }), listCorrections(user, { limit: 10 })]);
  const ym = month.from.slice(0, 7);
  const t = month.totals;
  return (
    <div>
      <PageHeader title="Absensi Saya" description="Catat kehadiran dan lihat riwayat serta rekap bulanan Anda." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <AttendancePanel initial={state} />
        <div className="space-y-4">
          <Card>
            <CardHeader title={`Rekap ${monthLabel(ym)}`} actions={
              <div className="flex items-center gap-1">
                <Link aria-label="Bulan sebelumnya" href={`/absensi-saya?month=${shiftMonth(ym, -1)}`} className="rounded-md border border-line p-1.5 hover:bg-canvas"><ChevronLeft className="size-4" /></Link>
                <Link aria-label="Bulan berikutnya" href={`/absensi-saya?month=${shiftMonth(ym, 1)}`} className="rounded-md border border-line p-1.5 hover:bg-canvas"><ChevronRight className="size-4" /></Link>
              </div>} />
            <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
              <Tile label="Hari kerja terjadwal" value={formatDays(t.scheduledDays)} />
              <Tile label="Hadir" value={formatDays(t.presentDays)} tone="green" />
              <Tile label="Terlambat" value={t.lateCount} hint={t.lateCount ? `${t.lateMinutes} menit` : undefined} tone={t.lateCount ? "amber" : undefined} />
              <Tile label="Tidak hadir" value={formatDays(t.absentDays)} tone={t.absentDays ? "red" : undefined} />
              <Tile label="Izin" value={formatDays(t.izinDays)} /><Tile label="Sakit" value={formatDays(t.sakitDays)} /><Tile label="Cuti" value={formatDays(t.cutiDays)} />
              <Tile label="Jam kerja tercatat" value={formatDuration(t.workedMinutes)} hint={t.incompleteCount ? `${t.incompleteCount} absensi belum lengkap` : undefined} />
            </div>
          </Card>
          <RecapExplanation />
        </div>
      </div>

      <Card className="mt-4">
        <CardHeader title="Riwayat harian" description={`${monthLabel(ym)} · status dihitung dari jadwal, hari libur, pengajuan disetujui, dan catatan absensi.`} />
        <TableWrap>
          <Table>
            <thead><tr><Th>Tanggal</Th><Th>Jadwal</Th><Th>Check-in</Th><Th>Check-out</Th><Th>Jam kerja</Th><Th>Status</Th><Th>Keterangan</Th></tr></thead>
            <tbody>
              {month.days.filter((d) => d.status !== "DI_LUAR_MASA_KERJA").map((d) => (
                <tr key={d.date} className={cn(!d.scheduled && !d.checkInAt && "bg-canvas/60 text-muted")}>
                  <Td className="whitespace-nowrap font-medium">{formatDateCompact(d.date)}</Td>
                  <Td className="whitespace-nowrap">{d.scheduled ? `${dotTime(d.scheduleStart!)}–${dotTime(d.scheduleEnd!)}` : "—"}</Td>
                  <Td className="tabular">{d.checkInTime ? dotTime(d.checkInTime) : "—"}</Td>
                  <Td className="tabular">{d.checkOutTime ? dotTime(d.checkOutTime) : "—"}</Td>
                  <Td className="tabular">{d.workedMinutes ? formatDuration(d.workedMinutes) : "—"}</Td>
                  <Td><DayStatusBadge status={d.status} missingCheckout={d.missingCheckout} /></Td>
                  <Td className="min-w-64 max-w-md text-muted">{d.explain}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      <Card className="mt-4">
        <CardHeader title="Koreksi absensi terbaru" description="Setiap koreksi oleh admin tercatat lengkap (sebelum, sesudah, alasan, pelaku)." />
        {corrections.length === 0 ? <EmptyState title="Belum ada koreksi" /> : (
          <ul className="divide-y divide-line text-sm">
            {corrections.map((c) => (
              <li key={c.id} className="px-5 py-3">
                <p className="font-medium">{formatDateLong(c.date)} <span className="font-normal text-muted">· oleh {c.correctedBy}</span></p>
                <p className="text-muted">
                  {c.after
                    ? `Menjadi: check-in ${dotTime(formatClock(c.after.checkInAt))}, check-out ${c.after.checkOutAt ? dotTime(formatClock(c.after.checkOutAt)) : "—"}.`
                    : "Catatan absensi dihapus."}{" "}
                  Alasan: {c.reason}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
