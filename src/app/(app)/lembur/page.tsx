import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/current";
import { actorCan } from "@/server/actor";
import { listOvertime } from "@/server/services/overtime";
import { Card, PageHeader } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { FilterBar, FilterField, filterInput } from "@/components/filter-bar";
import { OvertimeReviewTable } from "@/components/overtime-admin";
import { buildQuery, flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { REQUEST_STATUS_LABEL } from "@/lib/labels";

export const metadata: Metadata = { title: "Pengajuan Lembur" };
export const dynamic = "force-dynamic";

export default async function OvertimeAdminPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePagePermission("overtime:view_all");
  const sp = await flattenSearchParams(searchParams);
  const filters = { status: sp.status, q: sp.q };
  const res = await listOvertime(user, { ...filters, page: sp.page });
  return (
    <div>
      <PageHeader title="Pengajuan Lembur" description="Setujui, kurangi, atau tolak pengajuan lembur. Lembur dibayar hanya bila disetujui dan terbukti pada absensi (mode lembur &quot;disetujui&quot; di Pengaturan). Anda tidak dapat memproses pengajuan sendiri (kecuali Super Admin)." />
      <FilterBar action="/lembur" resetHref="/lembur">
        <FilterField label="Status"><select name="status" defaultValue={sp.status ?? ""} className={filterInput}><option value="">Semua</option>{Object.entries(REQUEST_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></FilterField>
        <FilterField label="Karyawan"><input type="search" name="q" defaultValue={sp.q} placeholder="Nama / no. induk" className={`${filterInput} w-48`} /></FilterField>
      </FilterBar>
      <Card>
        <OvertimeReviewTable items={res.items} canReview={actorCan(user, "overtime:review")} selfEmployeeId={user.employeeId} isSuper={user.role === "SUPER_ADMIN"} />
        <Pagination page={res.page} pageCount={res.pageCount} total={res.total} hrefFor={(p) => `/lembur${buildQuery({ ...filters, page: p })}`} />
      </Card>
    </div>
  );
}
