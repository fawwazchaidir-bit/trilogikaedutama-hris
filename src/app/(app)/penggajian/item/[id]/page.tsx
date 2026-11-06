import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { requirePagePermission } from "@/server/auth/current";
import { actorCan } from "@/server/actor";
import { AppError } from "@/server/errors";
import { getItem } from "@/server/services/payroll";
import { Card, CardHeader, Notice, PageHeader } from "@/components/ui/card";
import { Badge, DayStatusBadge, PayrollStatusBadge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { Tile } from "@/components/ui/stat";
import { AdjustmentForm, RemoveAdjustmentButton, SlipNoteForm } from "@/components/payroll-forms";
import { RecapExplanation } from "@/components/recap-explanation";
import { dotTime, formatDateCompact, formatDateRange, formatDuration, formatDays } from "@/lib/format";
import { formatRupiah } from "@/lib/money";
import { cn } from "@/lib/cn";

export const metadata: Metadata = { title: "Periksa Gaji Karyawan" };
export const dynamic = "force-dynamic";

const SOURCE: Record<string, string> = { COMPONENT: "Komponen", RULE_LATE: "Aturan keterlambatan", RULE_ABSENCE: "Aturan ketidakhadiran", RULE_OVERTIME: "Lembur otomatis", ADJUSTMENT: "Penyesuaian" };

export default async function PayrollItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("payroll:view");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  let d;
  try { d = await getItem(user, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const R = formatRupiah;
  const { item, run, lines } = d;
  const t = d.attendance.totals;
  const canEdit = d.editable && actorCan(user, "payroll:prepare");
  const table = (kind: "EARNING" | "DEDUCTION", title: string, total: number) => (
    <Card>
      <CardHeader title={title} />
      <TableWrap><Table>
        <thead><tr><Th>Komponen</Th><Th>Sumber</Th><Th>Rumus / keterangan</Th><Th align="right">Jumlah</Th>{canEdit && <Th />}</tr></thead>
        <tbody>
          {lines.filter((l) => l.kind === kind).map((l) => (
            <tr key={l.id}>
              <Td className="font-medium">{l.name}</Td><Td><Badge tone={l.source === "ADJUSTMENT" ? "amber" : "gray"}>{SOURCE[l.source]}</Badge></Td>
              <Td className="min-w-56 text-muted">{l.formula}{l.reason ? ` · Ket: ${l.reason}` : ""}</Td><Td align="right" className="font-medium">{R(l.amount)}</Td>
              {canEdit && <Td align="right">{l.source === "ADJUSTMENT" && <RemoveAdjustmentButton lineId={l.id} />}</Td>}
            </tr>
          ))}
          {lines.filter((l) => l.kind === kind).length === 0 && <tr><Td className="text-muted">— tidak ada —</Td><Td /><Td /><Td align="right">{R(0)}</Td>{canEdit && <Td />}</tr>}
          <tr className="bg-canvas/70 font-semibold"><Td>Total</Td><Td /><Td /><Td align="right">{R(total)}</Td>{canEdit && <Td />}</tr>
        </tbody>
      </Table></TableWrap>
    </Card>
  );
  return (
    <div className="space-y-4">
      <Link href={`/penggajian/${run.id}`} className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />{run.label}</Link>
      <PageHeader title={item.name} description={`${item.employeeNo} · ${item.position}${item.division ? ` · ${item.division}` : ""}`} actions={<PayrollStatusBadge status={run.status} />} />
      {item.stale && <Notice tone="warn">{item.staleComponents ? "Komponen gaji (dan/atau data absensi/jadwal/pengajuan)" : "Data absensi/jadwal/pengajuan"} karyawan ini <strong>berubah sejak dihitung</strong>. {run.status === "DRAFT" ? "Klik Hitung ulang pada halaman periode." : run.status === "ISSUED" ? "Slip yang sudah terbit tidak berubah." : "Kembalikan ke Draf lalu hitung ulang."}</Notice>}
      {item.warnings.length > 0 && <Notice tone={item.netPay < 0 ? "danger" : "warn"}><ul className="list-disc pl-5">{item.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></Notice>}
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Tile label="Gaji pokok" value={R(item.baseSalary)} /><Tile label="Total pendapatan" value={R(item.totalEarnings)} /><Tile label="Total potongan" value={R(item.totalDeductions)} tone={item.totalDeductions ? "amber" : undefined} /><Tile label="Gaji bersih" value={R(item.netPay)} tone={item.netPay < 0 ? "red" : "green"} hint="= pendapatan − potongan" /></section>
      <div className="grid gap-4 xl:grid-cols-2">{table("EARNING", "Pendapatan", item.totalEarnings)}{table("DEDUCTION", "Potongan", item.totalDeductions)}</div>
      {d.statutory && (
        <Card>
          <CardHeader title="BPJS & PPh 21 otomatis" description="Dihitung dari konfigurasi di Pengaturan. Porsi perusahaan bersifat informasi dan tidak mengurangi gaji bersih." />
          <div className="grid gap-4 p-5 text-sm lg:grid-cols-2">
            {d.statutory.bpjs && (
              <div>
                <p className="mb-1 font-medium">Beban perusahaan (BPJS) <span className="font-normal text-muted">· dasar upah {R(d.statutory.bpjs.wage)}</span></p>
                <ul className="space-y-0.5">{d.statutory.employerLines.map((l) => <li key={l.name} className="flex justify-between gap-4"><span>{l.name}</span><span className="tabular">{R(l.amount)}</span></li>)}
                  <li className="flex justify-between gap-4 border-t border-line pt-1 font-medium"><span>Total beban perusahaan</span><span className="tabular">{R(d.statutory.bpjs.employerTotal)}</span></li></ul>
              </div>
            )}
            {d.statutory.pph21 && (
              <div>
                <p className="mb-1 font-medium">PPh 21 {d.statutory.finalPeriod ? "(masa pajak terakhir)" : `(TER${d.statutory.pph21.category ? ` kategori ${d.statutory.pph21.category}` : ""})`} <span className="font-normal text-muted">· masa {d.statutory.taxMonth}</span></p>
                <p className="text-muted">{d.statutory.pph21.detail}</p>
                <p className="mt-1">Dipotong: <strong className="tabular">{R(d.statutory.pph21.amount)}</strong> · bruto {R(d.statutory.pph21.gross)}</p>
              </div>
            )}
          </div>
        </Card>
      )}
      {d.attendance.overtime && (
        <Notice tone="info">Lembur: disetujui {formatDuration(d.attendance.overtime.approvedMinutes)}, dibayar {formatDuration(d.attendance.overtime.paidMinutes)} ({d.attendance.overtime.days} hari) sesuai bukti absensi.</Notice>
      )}
      {item.payslipId && <p className="text-sm"><Link className="text-brand-700 underline" href={`/slip/${item.payslipId}`}>Lihat slip terbit {item.payslipNumber}</Link></p>}

      {canEdit && <div className="grid gap-4 lg:grid-cols-2"><AdjustmentForm itemId={item.id} /><Card><CardHeader title="Catatan slip" /><SlipNoteForm itemId={item.id} initial={item.slipNote ?? ""} /></Card></div>}
      {!canEdit && item.slipNote && <Card><div className="p-5 text-sm"><span className="text-muted">Catatan slip:</span> {item.slipNote}</div></Card>}

      <Card>
        <CardHeader title="Sumber data absensi" description={`Rekap saat dihitung — ${formatDateRange(d.attendance.from, d.attendance.to)}. Dipakai untuk komponen per hari hadir dan aturan potongan.`} />
        <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4 xl:grid-cols-8">
          <Tile label="Hari kerja" value={formatDays(t.scheduledDays)} /><Tile label="Hadir" value={formatDays(t.presentDays)} tone="green" /><Tile label="Terlambat" value={`${t.lateCount}x`} hint={`${t.lateMinutes} mnt`} /><Tile label="Tidak hadir" value={formatDays(t.absentDays)} tone={t.absentDays ? "red" : undefined} />
          <Tile label="Izin" value={formatDays(t.izinDays)} /><Tile label="Sakit" value={formatDays(t.sakitDays)} /><Tile label="Cuti" value={formatDays(t.cutiDays)} /><Tile label="Belum lengkap" value={t.incompleteCount} tone={t.incompleteCount ? "amber" : undefined} />
        </div>
        <details className="border-t border-line">
          <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-ink-soft">Lihat rincian harian (kondisi saat ini)</summary>
          <TableWrap><Table>
            <thead><tr><Th>Tanggal</Th><Th>Check-in</Th><Th>Check-out</Th><Th>Jam kerja</Th><Th>Status</Th><Th>Penjelasan</Th></tr></thead>
            <tbody>{d.days.filter((x) => x.status !== "DI_LUAR_MASA_KERJA").map((x) => (
              <tr key={x.date} className={cn(!x.scheduled && !x.checkInAt && "bg-canvas/60 text-muted")}><Td className="whitespace-nowrap font-medium">{formatDateCompact(x.date)}</Td><Td className="tabular">{x.checkInTime ? dotTime(x.checkInTime) : "—"}</Td><Td className="tabular">{x.checkOutTime ? dotTime(x.checkOutTime) : "—"}</Td><Td>{x.workedMinutes ? formatDuration(x.workedMinutes) : "—"}</Td><Td><DayStatusBadge status={x.status} missingCheckout={x.missingCheckout} /></Td><Td className="min-w-64 text-muted">{x.explain}</Td></tr>
            ))}</tbody>
          </Table></TableWrap>
        </details>
      </Card>
      <RecapExplanation />
    </div>
  );
}
