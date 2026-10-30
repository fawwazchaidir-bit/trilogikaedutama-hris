import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Download, FileArchive } from "lucide-react";
import { z } from "zod";
import { requirePagePermission } from "@/server/auth/current";
import { actorCan } from "@/server/actor";
import { AppError } from "@/server/errors";
import { getRun } from "@/server/services/payroll";
import { Card, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui/card";
import { Badge, PayrollStatusBadge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { Tile } from "@/components/ui/stat";
import { RunActions } from "@/components/payroll-forms";
import { PayrollDisclaimer } from "@/components/payroll-disclaimer";
import { formatDateLong, formatDateRange, formatDateTime } from "@/lib/format";
import { formatRupiah } from "@/lib/money";
import { ABSENCE_MODE_LABEL, LATE_MODE_LABEL, OVERTIME_MODE_LABEL } from "@/lib/labels";

export const metadata: Metadata = { title: "Detail Penggajian" };
export const dynamic = "force-dynamic";

export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("payroll:view");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  let d;
  try { d = await getRun(user, id); } catch (e) { if (e instanceof AppError) notFound(); throw e; }
  const { run } = d;
  const R = formatRupiah;
  const rules = d.rulesSnapshot ?? d.rules;
  const issued = run.status === "ISSUED";
  return (
    <div className="space-y-4">
      <Link href="/penggajian" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Semua periode</Link>
      <PageHeader title={run.label} description={`Gaji ${formatDateRange(run.periodStart, run.periodEnd)} · Dasar absensi ${formatDateRange(run.attendanceStart, run.attendanceEnd)}`}
        actions={<><PayrollStatusBadge status={run.status} /><RunActions runId={run.id} status={run.status} can={{ prepare: actorCan(user, "payroll:prepare"), approve: actorCan(user, "payroll:approve"), revoke: actorCan(user, "payroll:revoke") }} /></>} />

      <PayrollDisclaimer />
      {run.revisionOfId && <Notice tone="info">Revisi dari periode <Link className="underline" href={`/penggajian/${run.revisionOfId}`}>{run.revisionOfLabel}</Link>.</Notice>}
      {run.returnedNote && run.status === "DRAFT" && <Notice tone="warn"><strong>Dikembalikan pimpinan:</strong> {run.returnedNote}</Notice>}
      {run.status === "CANCELLED" && <Notice tone="danger"><strong>Dibatalkan</strong> oleh {run.cancelledBy} pada {formatDateTime(run.cancelledAt)}. Alasan: {run.cancelReason}</Notice>}
      {d.attendanceOngoing && ["DRAFT", "PENDING_APPROVAL"].includes(run.status) && <Notice tone="warn"><span className="flex gap-2"><AlertTriangle className="mt-0.5 size-4 shrink-0" />Periode absensi belum berakhir (s.d. {formatDateLong(run.attendanceEnd)}); data kehadiran belum final dan pengajuan baru ditolak sistem. Gunakan batas absensi (cut-off) lebih awal bila perlu.</span></Notice>}
      {d.staleCount > 0 && run.status !== "CANCELLED" && (
        <Notice tone={issued ? "info" : "warn"}>{issued
          ? <>Ada <strong>{d.staleCount}</strong> karyawan dengan koreksi absensi/jadwal/pengajuan <em>setelah</em> penghitungan. Slip yang sudah terbit <strong>tidak berubah</strong>; bila perlu, pimpinan dapat membatalkan dan HR membuat revisi.</>
          : <>Data absensi/jadwal/pengajuan berubah sejak penghitungan untuk <strong>{d.staleCount}</strong> karyawan. {run.status === "DRAFT" ? "Klik Hitung ulang." : "Kembalikan ke Draf lalu hitung ulang."}</>}</Notice>
      )}
      {d.negativeCount > 0 && run.status === "DRAFT" && <Notice tone="danger">{d.negativeCount} karyawan bergaji bersih negatif — sesuaikan sebelum diajukan.</Notice>}
      {!d.rulesConfirmedAt && ["DRAFT", "PENDING_APPROVAL"].includes(run.status) && <Notice tone="warn">Aturan penggajian belum dikonfirmasi pimpinan; persetujuan akan ditolak sampai dikonfirmasi di Pengaturan.</Notice>}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Ringkasan">
        <Tile label="Karyawan" value={run.itemCount} /><Tile label="Total pendapatan" value={R(run.totalEarnings)} /><Tile label="Total potongan" value={R(run.totalDeductions)} tone={run.totalDeductions ? "amber" : undefined} /><Tile label="Total gaji bersih" value={R(run.totalNet)} tone="green" />
      </section>

      <Card>
        <CardHeader title="Rincian per karyawan" description="Klik nama untuk memeriksa komponen, rumus, dan sumber data absensi sebelum disetujui."
          actions={issued && actorCan(user, "payslip:download_all") ? <div className="flex gap-2">
            <a href={`/api/payroll/${run.id}/slips?format=pdf`} className="inline-flex h-10 items-center gap-2 rounded-md bg-brand-600 px-4 text-sm font-medium text-white hover:bg-brand-700"><Download className="size-4" />Semua slip (1 PDF)</a>
            <a href={`/api/payroll/${run.id}/slips?format=zip`} className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium hover:bg-canvas"><FileArchive className="size-4" />ZIP per karyawan</a></div> : undefined} />
        {d.items.length === 0 ? <EmptyState title="Belum ada karyawan pada periode ini" description="Pastikan karyawan punya komponen gaji (minimal gaji pokok) yang berlaku pada periode, lalu hitung ulang." /> : (
          <TableWrap><Table>
            <thead><tr><Th>No. Induk</Th><Th>Nama</Th><Th align="right">Gaji pokok</Th><Th align="right">Pendapatan</Th><Th align="right">Potongan</Th><Th align="right">Gaji bersih</Th><Th>Catatan</Th><Th align="right">Slip</Th></tr></thead>
            <tbody>{d.items.map((i) => (
              <tr key={i.id}>
                <Td mono>{i.employeeNo}</Td><Td className="font-medium"><Link className="text-brand-700 hover:underline" href={`/penggajian/item/${i.id}`}>{i.name}</Link><span className="block text-xs font-normal text-muted">{i.position}</span></Td>
                <Td align="right">{R(i.baseSalary)}</Td><Td align="right">{R(i.totalEarnings)}</Td><Td align="right">{R(i.totalDeductions)}</Td><Td align="right" className={i.netPay < 0 ? "font-semibold text-brand-700" : "font-semibold"}>{R(i.netPay)}</Td>
                <Td>{i.stale && <Badge tone="amber">Data berubah</Badge>} {i.warnings.length > 0 && <Badge tone={i.netPay < 0 ? "red" : "gray"}>{i.warnings.length} peringatan</Badge>}</Td>
                <Td align="right">{i.payslipId ? <Link className="text-brand-700 hover:underline" href={`/slip/${i.payslipId}`}>{i.payslipNumber}</Link> : "—"}</Td>
              </tr>
            ))}</tbody>
          </Table></TableWrap>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Aturan yang dipakai" description={d.rulesSnapshot ? "Dibekukan saat penghitungan terakhir." : "Aturan saat ini (belum dihitung)."} actions={d.rulesConfirmedAt ? <Badge tone="green">Terkonfirmasi</Badge> : <Badge tone="amber">Belum dikonfirmasi</Badge>} />
          <dl className="divide-y divide-line px-5 text-sm">
            {[["Potongan keterlambatan", `${LATE_MODE_LABEL[rules.lateMode]}${rules.lateMode !== "NONE" ? ` · ${R(rules.lateAmount)}` : ""}`],
              ["Potongan ketidakhadiran", `${ABSENCE_MODE_LABEL[rules.absenceMode]}${rules.absenceMode === "FIXED_PER_DAY" ? ` · ${R(rules.absenceAmount)}/hari` : rules.absenceMode === "SALARY_DIVISOR" ? ` · ÷ ${rules.absenceDivisor ?? "?"}` : ""}`],
              ["Izin / sakit / cuti memotong gaji", `${rules.izinDeductsPay ? "Izin ya" : "Izin tidak"} · ${rules.sakitDeductsPay ? "Sakit ya" : "Sakit tidak"} · ${rules.cutiDeductsPay ? "Cuti ya" : "Cuti tidak"}`],
              ["Lembur", `${OVERTIME_MODE_LABEL[rules.overtimeMode]}${rules.overtimeMode === "AUTO" ? ` · ${R(rules.overtimeRatePerHour)}/jam` : ""}`]].map(([k, v]) => <div key={k} className="grid grid-cols-[11rem_1fr] gap-2 py-2"><dt className="text-muted">{k}</dt><dd className="font-medium">{v}</dd></div>)}
          </dl>
        </Card>
        <Card>
          <CardHeader title="Riwayat proses" />
          <ol className="divide-y divide-line text-sm">
            <li className="px-5 py-2.5"><span className="font-medium">Dibuat</span> oleh {run.createdBy ?? "—"}</li>
            {run.calculatedAt && <li className="px-5 py-2.5"><span className="font-medium">Dihitung</span> {formatDateTime(run.calculatedAt)}</li>}
            {run.submittedAt && <li className="px-5 py-2.5"><span className="font-medium">Diajukan</span> {formatDateTime(run.submittedAt)}</li>}
            {run.approvedAt && <li className="px-5 py-2.5"><span className="font-medium">Disetujui</span> oleh {run.approvedBy}, {formatDateTime(run.approvedAt)}{run.approvalNote ? ` · ${run.approvalNote}` : ""}</li>}
            {run.issuedAt && <li className="px-5 py-2.5"><span className="font-medium">Diterbitkan</span> oleh {run.issuedBy}, {formatDateTime(run.issuedAt)} (tanggal slip {formatDateLong(run.issueDate)})</li>}
            {run.cancelledAt && <li className="px-5 py-2.5"><span className="font-medium">Dibatalkan</span> oleh {run.cancelledBy}, {formatDateTime(run.cancelledAt)}</li>}
          </ol>
          <p className="border-t border-line px-5 py-3 text-xs text-muted">Jejak lengkap (siapa mengubah apa) ada di menu Audit Log.</p>
        </Card>
      </div>
    </div>
  );
}
