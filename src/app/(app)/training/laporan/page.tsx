import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui/card";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { ExportLinks } from "@/components/export-links";
import { FilterBar, FilterField, filterInput } from "@/components/filter-bar";
import { AttentionBadges, Breadcrumb, ProgressBar, ProjectStatusBadge } from "@/components/training/ui";
import { projectReportRows } from "@/server/services/training/insights";
import { PROJECT_STATUSES, PROJECT_STATUS_LABEL } from "@/lib/training/types";
import { formatDateRange } from "@/lib/format";
import { flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { guard, trainingPage } from "../_lib";

export const metadata: Metadata = { title: "Laporan Proyek" };
export const dynamic = "force-dynamic";

export default async function ReportsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await trainingPage();
  const sp = await flattenSearchParams(searchParams);
  const filters = { from: sp.from, to: sp.to, status: sp.status };
  const rows = await guard(() => projectReportRows(user, filters));
  return (
    <div>
      <Breadcrumb items={[{ label: "Training & Operations", href: "/training" }, { label: "Laporan Proyek" }]} />
      <PageHeader title="Laporan Proyek" description="Ringkasan operasional proyek dalam lingkup akses Anda (maksimal 100 proyek)." actions={<ExportLinks base="/api/training/reports/export" params={filters} formats={["csv", "xlsx", "pdf"]} />} />
      <FilterBar action="/training/laporan" resetHref="/training/laporan">
        <FilterField label="Periode dari"><input type="date" name="from" defaultValue={sp.from} className={filterInput} /></FilterField>
        <FilterField label="sampai"><input type="date" name="to" defaultValue={sp.to} className={filterInput} /></FilterField>
        <FilterField label="Status"><select name="status" defaultValue={sp.status ?? ""} className={filterInput}><option value="">Semua</option>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}</select></FilterField>
      </FilterBar>
      <Notice tone="info">Progres checklist = item selesai ÷ seluruh item (“Belum tersedia” bila belum ada item). Tugas terlambat = tugas terbuka dengan tenggat sebelum hari ini (WIB). Status Selesai tidak berarti invoice dibayar, sertifikat terbit, peserta kompeten, atau surat tugas disetujui.</Notice>
      <Card className="mt-4">
        {rows.length === 0 ? <EmptyState title="Tidak ada proyek" description="Belum ada proyek dalam lingkup akses dan filter ini." /> : (
          <TableWrap><Table><thead><tr><Th>Proyek</Th><Th>Status</Th><Th>Periode</Th><Th>PIC</Th><Th align="right">Tugas</Th><Th>Checklist</Th><Th align="right">Peserta</Th><Th align="right">Dokumen</Th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id}>
              <Td className="max-w-xs"><Link href={`/training/proyek/${r.id}`} className="font-medium text-brand-700 hover:underline">{r.code}</Link><p className="text-sm text-ink">{r.name}</p><AttentionBadges codes={r.attention} />{r.closureSummary && <p className="mt-1 line-clamp-2 text-xs text-muted">Hasil: {r.closureSummary}</p>}</Td>
              <Td><ProjectStatusBadge status={r.status} /></Td><Td className="whitespace-nowrap text-xs">{r.startDate && r.endDate ? formatDateRange(r.startDate, r.endDate) : "—"}</Td><Td>{r.picName ?? "—"}</Td>
              <Td align="right">{r.tasksDone}/{r.tasksTotal}{r.tasksOverdue > 0 && <span className="ml-1 text-xs font-medium text-brand-700">({r.tasksOverdue} telat)</span>}</Td><Td><ProgressBar progress={r.checklist} /></Td><Td align="right">{r.participants}</Td><Td align="right">{r.documents}</Td></tr>)}</tbody></Table></TableWrap>
        )}
      </Card>
    </div>
  );
}
