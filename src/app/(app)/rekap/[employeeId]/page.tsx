import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Camera, MapPin } from "lucide-react";
import { z } from "zod";
import { requirePageUser } from "@/server/auth/current";
import { getRecapDetail } from "@/server/services/recap";
import { AppError } from "@/server/errors";
import { Card, CardHeader, PageHeader } from "@/components/ui/card";
import { DayStatusBadge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { Tile } from "@/components/ui/stat";
import { RecapExplanation } from "@/components/recap-explanation";
import { flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { dotTime, formatDateCompact, formatDuration, formatHours, formatDays } from "@/lib/format";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Rincian Rekap" };
export const dynamic = "force-dynamic";

export default async function RecapDetailPage({ params, searchParams }: { params: Promise<{ employeeId: string }>; searchParams: SearchParams }) {
  const user = await requirePageUser();
  const { employeeId } = await params;
  if (!z.string().uuid().safeParse(employeeId).success) notFound();
  const sp = await flattenSearchParams(searchParams);
  let d;
  try { d = await getRecapDetail(user, employeeId, sp); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const t = d.totals;
  const admin = can(user.role, "recap:view_all");
  return (
    <div className="space-y-4">
      <Link href={admin ? "/rekap" : "/absensi-saya"} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Kembali</Link>
      <PageHeader title={d.employee.name} description={`${d.employee.employeeNo} · ${d.employee.position}${d.employee.division ? ` · ${d.employee.division}` : ""} · ${d.label}`} />
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8" aria-label="Ringkasan">
        <Tile label="Hari kerja" value={formatDays(t.scheduledDays)} /><Tile label="Hadir" value={formatDays(t.presentDays)} tone="green" /><Tile label="Terlambat" value={`${t.lateCount}x`} hint={`${t.lateMinutes} mnt`} tone={t.lateCount ? "amber" : undefined} />
        <Tile label="Tidak hadir" value={formatDays(t.absentDays)} tone={t.absentDays ? "red" : undefined} /><Tile label="Izin" value={formatDays(t.izinDays)} /><Tile label="Sakit" value={formatDays(t.sakitDays)} /><Tile label="Cuti" value={formatDays(t.cutiDays)} />
        <Tile label="Jam kerja" value={`${formatHours(t.workedMinutes)} j`} hint={t.incompleteCount ? `${t.incompleteCount} belum lengkap` : undefined} />
      </section>
      <Card>
        <CardHeader title="Rincian harian" description="Setiap angka di atas berasal dari baris-baris ini. Kolom 'Penjelasan' menunjukkan aturan yang dipakai." />
        <TableWrap><Table>
          <thead><tr><Th>Tanggal</Th><Th>Jadwal</Th><Th>Check-in</Th><Th>Check-out</Th><Th align="right">Telat</Th><Th>Jam kerja</Th><Th>Status</Th><Th>Foto absensi</Th><Th>Penjelasan</Th></tr></thead>
          <tbody>{d.days.filter((x) => x.status !== "DI_LUAR_MASA_KERJA").map((x) => (
            <tr key={x.date} className={cn(!x.scheduled && !x.checkInAt && "bg-canvas/60 text-muted")}>
              <Td className="whitespace-nowrap font-medium">{formatDateCompact(x.date)}</Td><Td className="whitespace-nowrap">{x.scheduled ? `${dotTime(x.scheduleStart!)}–${dotTime(x.scheduleEnd!)}` : "—"}</Td>
              <Td className="tabular">{x.checkInTime ? dotTime(x.checkInTime) : "—"}</Td><Td className="tabular">{x.checkOutTime ? dotTime(x.checkOutTime) : "—"}</Td><Td align="right">{x.lateMinutes ? `${x.lateMinutes} mnt` : "—"}</Td>
              <Td>{x.workedMinutes ? formatDuration(x.workedMinutes) : "—"}</Td><Td><DayStatusBadge status={x.status} missingCheckout={x.missingCheckout} /></Td>
              <Td className="whitespace-nowrap text-xs">{(d.photos[x.date] ?? []).length === 0 ? <span className="text-muted">—</span> : (
                <span className="flex flex-col gap-1">{d.photos[x.date]!.map((p) => (
                  <span key={p.kind} className="flex items-center gap-2">
                    {p.url
                      ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-brand-700 hover:underline"><Camera className="size-3" />{p.kind === "CHECK_IN" ? "Masuk" : "Pulang"}</a>
                      : <span className="inline-flex items-center gap-1 text-muted" title={`Foto dihapus otomatis (retensi) · ${p.stamp.split("\n").join(" · ")}`}><Camera className="size-3" />{p.kind === "CHECK_IN" ? "Masuk" : "Pulang"} · foto dihapus</span>}
                    {p.mapUrl && <a href={p.mapUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-muted hover:underline" aria-label={`Lokasi foto ${p.kind === "CHECK_IN" ? "masuk" : "pulang"}`}><MapPin className="size-3" />peta</a>}
                  </span>
                ))}</span>
              )}</Td>
              <Td className="min-w-64 max-w-md text-muted">{x.explain}</Td>
            </tr>
          ))}</tbody>
        </Table></TableWrap>
      </Card>
      <RecapExplanation />
    </div>
  );
}
