import { Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateLong, formatDateRange, formatDuration, formatDays } from "@/lib/format";
import { formatRupiah } from "@/lib/money";
import { terbilang } from "@/lib/terbilang";
import { EMPLOYMENT_LABEL } from "@/lib/labels";
import type { PayslipLine, PayslipSnapshot } from "@/lib/payslip";

const R = (n: number) => formatRupiah(n);

function Lines({ title, lines, total, label }: { title: string; lines: PayslipLine[]; total: number; label: string }) {
  return (
    <Card>
      <CardHeader title={title} />
      <ul className="divide-y divide-line text-sm">
        {lines.length === 0 && <li className="px-5 py-3 text-muted">— tidak ada —</li>}
        {lines.map((l, i) => (
          <li key={i} className="flex items-start justify-between gap-4 px-5 py-3">
            <div><p>{l.name}{l.manual && <Badge tone="amber" className="ml-2">Penyesuaian</Badge>}</p>
              {(l.formula || l.note) && <p className="text-xs text-muted">{[l.formula, l.note ? `Ket: ${l.note}` : null].filter(Boolean).join(" · ")}</p>}</div>
            <p className="tabular shrink-0 font-medium">{R(l.amount)}</p>
          </li>
        ))}
        <li className="flex justify-between bg-canvas/60 px-5 py-3 font-semibold"><span>{label}</span><span className="tabular">{R(total)}</span></li>
      </ul>
    </Card>
  );
}

/** Tampilan layar slip gaji — dirender dari SNAPSHOT yang dibekukan saat terbit. */
export function PayslipView({ s, voided }: { s: PayslipSnapshot; voided?: boolean }) {
  const a = s.attendance;
  return (
    <div className="space-y-4">
      {voided && <div role="alert" className="rounded-md border border-brand-200 bg-brand-50 px-4 py-3 text-sm font-medium text-brand-800">Slip ini DIBATALKAN dan tidak berlaku.</div>}
      <Card>
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">{s.company.name}</p>
            <h2 className="text-xl font-semibold">Slip Gaji</h2>
            <p className="text-sm text-muted">Periode {formatDateRange(s.period.start, s.period.end)}</p>
            <p className="text-sm text-muted">No. {s.number} · terbit {formatDateLong(s.issueDate)}</p>
          </div>
          <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-muted">Nama</dt><dd className="font-medium">{s.employee.name}</dd>
            <dt className="text-muted">No. Induk</dt><dd>{s.employee.employeeNo}</dd>
            <dt className="text-muted">Jabatan</dt><dd>{s.employee.position}</dd>
            <dt className="text-muted">Divisi</dt><dd>{s.employee.division ?? "—"}</dd>
            <dt className="text-muted">Status</dt><dd>{EMPLOYMENT_LABEL[s.employee.employmentStatus]}</dd>
            <dt className="text-muted">Rekening</dt><dd>{s.employee.bankAccountMasked ? `${s.employee.bankName ?? ""} ${s.employee.bankAccountMasked}` : "—"}</dd>
          </dl>
        </div>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Lines title="Pendapatan" lines={s.earnings} total={s.totalEarnings} label="Total pendapatan" />
        <Lines title="Potongan" lines={s.deductions} total={s.totalDeductions} label="Total potongan" />
      </div>
      <div className="rounded-xl border border-brand-200 bg-brand-50 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold">Gaji bersih diterima</p><p className="tabular text-2xl font-semibold text-brand-700">{R(s.netPay)}</p></div>
        {s.netPay >= 0 && <p className="mt-1 text-sm italic text-muted">Terbilang: {terbilang(s.netPay)}</p>}
      </div>
      {a && (
        <Card>
          <CardHeader title="Ringkasan kehadiran" description={formatDateRange(s.attendanceBasis.start, s.attendanceBasis.end)} />
          <dl className="grid grid-cols-2 gap-3 p-5 text-sm sm:grid-cols-4">
            {[["Hari kerja terjadwal", formatDays(a.scheduledDays)], ["Hadir", formatDays(a.presentDays)], ["Terlambat", `${a.lateCount}x (${formatDuration(a.lateMinutes)})`], ["Tidak hadir", formatDays(a.absentDays)],
              ["Izin", formatDays(a.izinDays)], ["Sakit", formatDays(a.sakitDays)], ["Cuti", formatDays(a.cutiDays)], ["Jam kerja tercatat", formatDuration(a.workedMinutes)]].map(([k, v]) => (
              <div key={String(k)}><dt className="text-xs text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>
            ))}
          </dl>
        </Card>
      )}
      {(s.note || s.revisionNote || s.footerNote) && (
        <Card><div className="space-y-1 p-5 text-sm">{s.note && <p><span className="text-muted">Catatan:</span> {s.note}</p>}{s.revisionNote && <p className="text-muted">{s.revisionNote}</p>}{s.footerNote && <p className="text-xs text-muted">{s.footerNote}</p>}</div></Card>
      )}
    </div>
  );
}
