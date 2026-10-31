import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarCheck2, FileText } from "lucide-react";
import { requirePageUser } from "@/server/auth/current";
import { getAdminDashboard, getEmployeeDashboard } from "@/server/services/dashboard";
import { Card, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui/card";
import { Tile } from "@/components/ui/stat";
import { Badge, PayrollStatusBadge, RequestStatusBadge } from "@/components/ui/badge";
import { AttendancePanel } from "@/components/attendance-panel";
import { can } from "@/lib/permissions";
import { formatDateLong, formatDateRange, formatDuration, monthLabel, formatDays } from "@/lib/format";
import { formatRupiah } from "@/lib/money";
import { LEAVE_TYPE_LABEL } from "@/lib/labels";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requirePageUser();
  if (can(user.role, "dashboard:admin")) return <AdminView />;
  return <EmployeeView />;
}

async function AdminView() {
  const user = await requirePageUser();
  const d = await getAdminDashboard(user);
  const R = (n: number) => formatRupiah(n);
  return (
    <div>
      <PageHeader title="Dashboard" description={`Ringkasan hari ini, ${formatDateLong(d.today)}. Semua angka dihitung langsung dari data absensi, jadwal, dan pengajuan.`} />

      {d.missingDefaultSchedule && <div className="mb-4"><Notice tone="danger">Belum ada <strong>jadwal kerja default</strong>. Tanpa jadwal, tidak ada hari kerja yang dihitung. <Link className="underline" href="/jadwal">Atur jadwal</Link>.</Notice></div>}
      {(!d.setup.attendanceConfirmed || !d.setup.payrollRulesConfirmed) && can(user.role, "settings:view") && (
        <div className="mb-4"><Notice tone="warn">
          <p className="font-medium">Kebijakan perlu dikonfirmasi sebelum dipakai operasional</p>
          <ul className="mt-1 list-disc pl-5">
            {!d.setup.attendanceConfirmed && <li>Kebijakan absensi &amp; cuti (toleransi, kuota cuti, lokasi) masih memakai nilai awal.</li>}
            {!d.setup.payrollRulesConfirmed && <li>Aturan penggajian (potongan, lembur, BPJS/pajak) belum dikonfirmasi — gaji tidak dapat disetujui. <Link className="underline" href="/pengaturan">Buka Pengaturan</Link>.</li>}
          </ul>
        </Notice></div>
      )}

      <section aria-label="Kehadiran hari ini" className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Karyawan aktif" value={d.activeEmployees} href="/karyawan" />
        <Tile label="Hadir hari ini" value={d.present} hint={d.late ? `${d.late} di antaranya terlambat` : "termasuk yang terlambat"} tone="green" href={`/absensi?date=${d.today}`} />
        <Tile label="Terlambat" value={d.late} tone={d.late ? "amber" : undefined} href={`/absensi?date=${d.today}&status=TERLAMBAT`} />
        <Tile label="Belum absen" value={d.notYet} hint={d.absent ? `${d.absent} sudah lewat batas (tidak hadir)` : "sebelum batas jam tidak hadir"} tone={d.notYet ? "amber" : undefined} href={`/absensi?date=${d.today}&status=BELUM_ABSEN`} />
      </section>
      <section aria-label="Ringkasan lain" className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Izin / sakit / cuti hari ini" value={d.onLeave} href="/pengajuan?status=APPROVED" />
        <Tile label="Pengajuan menunggu" value={d.pendingRequests} tone={d.pendingRequests ? "red" : undefined} hint={d.pendingRequests ? "Perlu persetujuan HR" : undefined} href="/pengajuan?status=PENDING" />
        <Tile label="Absensi belum lengkap" value={d.incomplete} tone={d.incomplete ? "red" : undefined} hint="Tanpa check-out, 31 hari terakhir" href="/absensi?status=BELUM_CHECKOUT" />
        <Tile label="Belum check-out hari ini" value={d.openCheckouts} hint="Informasi — belum dihitung tidak lengkap" />
        {d.openLocationReviews !== null && d.openLocationReviews > 0 && <Tile label="Lokasi perlu ditinjau" value={d.openLocationReviews} tone="amber" hint="Absensi lokasi ditandai/ditolak" href="/lokasi" />}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Pengajuan menunggu persetujuan" actions={<Link href="/pengajuan?status=PENDING" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">Lihat semua<ArrowRight className="size-4" /></Link>} />
          {d.pendingList.length === 0 ? <EmptyState title="Tidak ada pengajuan menunggu" description="Pengajuan baru karyawan akan muncul di sini." /> : (
            <ul className="divide-y divide-line">
              {d.pendingList.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <div><p className="font-medium">{l.employeeName}</p><p className="text-muted">{LEAVE_TYPE_LABEL[l.type]} · {formatDateRange(l.startDate, l.endDate)} · {l.workingDays} hari kerja</p></div>
                  <Link href={`/pengajuan?status=PENDING&q=${encodeURIComponent(l.employeeNo)}`} className="shrink-0 text-brand-700 hover:underline">Proses</Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Absensi belum lengkap" description="Ada check-in tetapi tidak ada check-out (31 hari terakhir)." />
          {d.incompleteList.length === 0 ? <EmptyState title="Semua absensi lengkap" /> : (
            <ul className="divide-y divide-line">
              {d.incompleteList.map((x) => (
                <li key={`${x.employeeId}-${x.date}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                  <span className="font-medium">{x.name}</span>
                  <span className="flex items-center gap-3 text-muted">{formatDateLong(x.date)}<Link className="text-brand-700 hover:underline" href={`/absensi?date=${x.date}&q=${encodeURIComponent(x.name)}`}>Koreksi</Link></span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {d.payroll && (
          <Card className="lg:col-span-2">
            <CardHeader title="Penggajian" description="Status proses periode berjalan dan ringkasan total gaji." actions={<Link href="/penggajian" className="inline-flex items-center gap-1 text-sm text-brand-700 hover:underline">Buka penggajian<ArrowRight className="size-4" /></Link>} />
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Periode berjalan / diproses</p>
                {d.payroll.run ? (
                  <Link href={`/penggajian/${d.payroll.run.id}`} className="mt-2 block rounded-lg border border-line p-4 hover:border-brand-200 hover:bg-brand-50/30">
                    <div className="flex items-center justify-between gap-2"><p className="font-semibold">{d.payroll.run.label}</p><PayrollStatusBadge status={d.payroll.run.status} /></div>
                    <p className="mt-1 text-sm text-muted">{formatDateRange(d.payroll.run.periodStart, d.payroll.run.periodEnd)} · {d.payroll.run.itemCount} karyawan</p>
                    <p className="tabular mt-2 text-xl font-semibold">{R(d.payroll.run.totalNet)} <span className="text-xs font-normal text-muted">gaji bersih</span></p>
                  </Link>
                ) : <p className="mt-2 text-sm text-muted">Belum ada periode penggajian. <Link href="/penggajian" className="text-brand-700 underline">Buat periode</Link>.</p>}
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted">Terakhir diterbitkan</p>
                {d.payroll.latestIssued ? (
                  <Link href={`/penggajian/${d.payroll.latestIssued.id}`} className="mt-2 block rounded-lg border border-line p-4 hover:border-brand-200 hover:bg-brand-50/30">
                    <div className="flex items-center justify-between gap-2"><p className="font-semibold">{d.payroll.latestIssued.label}</p><PayrollStatusBadge status="ISSUED" /></div>
                    <p className="mt-1 text-sm text-muted">Terbit {formatDateLong(d.payroll.latestIssued.issueDate)}</p>
                    <p className="tabular mt-2 text-xl font-semibold">{R(d.payroll.latestIssued.totalNet)} <span className="text-xs font-normal text-muted">total gaji bersih</span></p>
                  </Link>
                ) : <p className="mt-2 text-sm text-muted">Belum ada slip yang diterbitkan.</p>}
              </div>
            </div>
          </Card>
        )}
      </div>
      <p className="mt-4 flex items-start gap-1.5 text-xs text-muted"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />Aturan penggajian (potongan, lembur, BPJS/pajak) bukan tarif baku — wajib disesuaikan dengan kebijakan perusahaan dan ketentuan yang berlaku.</p>
    </div>
  );
}

async function EmployeeView() {
  const user = await requirePageUser();
  if (!user.employeeId) {
    return <div><PageHeader title="Dashboard" /><Notice tone="info">Akun Anda belum tertaut ke data karyawan. Hubungi Admin/HR.</Notice></div>;
  }
  const d = await getEmployeeDashboard(user);
  const t = d.month.totals;
  return (
    <div>
      <PageHeader title={`Halo, ${user.name.split(" ")[0]}`} description="Absensi, status pengajuan, dan slip gaji terbaru Anda." />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_1fr]">
        <AttendancePanel initial={d.today} />
        <div className="space-y-4">
          <Card>
            <CardHeader title={`Kehadiran ${monthLabel(d.month.label)}`} description="Ringkasan bulan berjalan (hari kerja terjadwal dihitung penuh satu bulan)." actions={<Link href="/absensi-saya" className="text-sm text-brand-700 hover:underline">Rincian</Link>} />
            <div className="grid grid-cols-2 gap-3 p-5 sm:grid-cols-4">
              <Tile label="Hari kerja" value={formatDays(t.scheduledDays)} />
              <Tile label="Hadir" value={formatDays(t.presentDays)} tone="green" />
              <Tile label="Terlambat" value={t.lateCount} hint={t.lateCount ? formatDuration(t.lateMinutes) : undefined} tone={t.lateCount ? "amber" : undefined} />
              <Tile label="Tidak hadir" value={formatDays(t.absentDays)} tone={t.absentDays ? "red" : undefined} />
              <Tile label="Izin" value={formatDays(t.izinDays)} />
              <Tile label="Sakit" value={formatDays(t.sakitDays)} />
              <Tile label="Cuti" value={formatDays(t.cutiDays)} />
              <Tile label="Belum lengkap" value={t.incompleteCount} tone={t.incompleteCount ? "amber" : undefined} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Pengajuan terbaru" actions={<Link href="/pengajuan-saya" className="text-sm text-brand-700 hover:underline">Ajukan baru</Link>} />
            {d.leaves.length === 0 ? <EmptyState title="Belum ada pengajuan" description="Ajukan izin, sakit, atau cuti dari menu Pengajuan Saya." /> : (
              <ul className="divide-y divide-line">
                {d.leaves.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div><p className="font-medium">{LEAVE_TYPE_LABEL[l.type]} · {formatDateRange(l.startDate, l.endDate)}</p>{l.reviewNote && <p className="text-muted">Catatan: {l.reviewNote}</p>}</div>
                    <RequestStatusBadge status={l.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Slip gaji terbaru" actions={<Link href="/slip-saya" className="text-sm text-brand-700 hover:underline">Semua slip</Link>} />
            {d.latestPayslip ? (
              <div className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div><p className="font-semibold">{d.latestPayslip.periodLabel}</p><p className="text-sm text-muted">No. {d.latestPayslip.number} · terbit {formatDateLong(d.latestPayslip.issueDate)}</p></div>
                <div className="flex items-center gap-2">
                  <Link href={`/slip/${d.latestPayslip.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-sm hover:bg-canvas"><FileText className="size-4" />Lihat</Link>
                  <a href={`/api/payslips/${d.latestPayslip.id}/pdf`} className="inline-flex h-9 items-center gap-1.5 rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700"><CalendarCheck2 className="size-4" />Unduh PDF</a>
                </div>
              </div>
            ) : <EmptyState title="Belum ada slip gaji" description="Slip akan muncul di sini setelah diterbitkan oleh HR." />}
          </Card>
        </div>
      </div>
      <p className="mt-3 text-xs text-muted"><Badge>Info</Badge> Waktu absensi memakai jam server perusahaan, bukan jam perangkat Anda.</p>
    </div>
  );
}
