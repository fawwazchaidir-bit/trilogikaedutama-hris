import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/server/auth/current";
import { actorCan } from "@/server/actor";
import { listRuns } from "@/server/services/payroll";
import { getSettings } from "@/server/services/settings";
import { env } from "@/server/env";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui/card";
import { PayrollStatusBadge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { CreateRunButton } from "@/components/payroll-forms";
import { PayrollDisclaimer } from "@/components/payroll-disclaimer";
import { flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { formatDateLong, formatDateRange } from "@/lib/format";
import { formatRupiah } from "@/lib/money";
import { todayIso } from "@/lib/time";

export const metadata: Metadata = { title: "Penggajian" };
export const dynamic = "force-dynamic";

export default async function PayrollListPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePagePermission("payroll:view");
  const sp = await flattenSearchParams(searchParams);
  const [runs, settings] = await Promise.all([listRuns(user, { includeCancelled: sp.all === "1" }), getSettings()]);
  return (
    <div>
      <PageHeader title="Penggajian" description="Alur: pilih periode → tarik rekap absensi → hitung → periksa & sesuaikan → persetujuan pimpinan → terbitkan slip."
        actions={actorCan(user, "payroll:prepare") ? <CreateRunButton today={todayIso(env().APP_TIMEZONE)} /> : undefined} />
      <div className="mb-4 space-y-3">
        <PayrollDisclaimer />
        {!settings.payrollRulesConfirmedAt && <Notice tone="warn"><strong>Aturan penggajian belum dikonfirmasi.</strong> Periode dapat dihitung, tetapi tidak dapat disetujui sampai pimpinan memverifikasi aturan di <Link className="underline" href="/pengaturan">Pengaturan</Link>.</Notice>}
      </div>
      <Card>
        {runs.length === 0 ? <EmptyState title="Belum ada periode penggajian" description="Buat periode pertama. Pastikan komponen gaji karyawan sudah diisi pada halaman detail karyawan." /> : (
          <TableWrap><Table>
            <thead><tr><Th>Periode</Th><Th>Rentang gaji</Th><Th>Status</Th><Th align="right">Karyawan</Th><Th align="right">Total gaji bersih</Th><Th>Diterbitkan</Th></tr></thead>
            <tbody>{runs.map((r) => (
              <tr key={r.id}>
                <Td className="font-medium"><Link href={`/penggajian/${r.id}`} className="text-brand-700 hover:underline">{r.label}</Link>{r.revisionOfId && <span className="ml-2 text-xs text-muted">revisi</span>}</Td>
                <Td className="whitespace-nowrap">{formatDateRange(r.periodStart, r.periodEnd)}</Td><Td><PayrollStatusBadge status={r.status} /></Td>
                <Td align="right">{r.itemCount}</Td><Td align="right" className="font-medium">{formatRupiah(r.totalNet)}</Td><Td>{r.issueDate ? formatDateLong(r.issueDate) : "—"}</Td>
              </tr>
            ))}</tbody>
          </Table></TableWrap>
        )}
      </Card>
      <p className="mt-3 text-sm"><Link className="text-brand-700 hover:underline" href={sp.all === "1" ? "/penggajian" : "/penggajian?all=1"}>{sp.all === "1" ? "Sembunyikan periode yang dibatalkan" : "Tampilkan periode yang dibatalkan"}</Link></p>
    </div>
  );
}
