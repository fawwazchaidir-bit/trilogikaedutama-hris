import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/current";
import { actorCan } from "@/server/actor";
import { listLeaves } from "@/server/services/leave";
import { getSettings } from "@/server/services/settings";
import { env } from "@/server/env";
import { Card, PageHeader } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { FilterBar, FilterField, filterInput } from "@/components/filter-bar";
import { GrantQuota, LeaveReviewTable } from "@/components/leave-admin";
import { buildQuery, flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { LEAVE_TYPE_LABEL, REQUEST_STATUS_LABEL } from "@/lib/labels";
import { todayIso } from "@/lib/time";

export const metadata: Metadata = { title: "Pengajuan & Cuti" };
export const dynamic = "force-dynamic";

export default async function LeavesAdminPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePagePermission("leave:view_all");
  const sp = await flattenSearchParams(searchParams);
  const filters = { status: sp.status, type: sp.type, q: sp.q };
  const [res, settings] = await Promise.all([listLeaves(user, { ...filters, page: sp.page }), getSettings()]);
  return (
    <div>
      <PageHeader title="Pengajuan & Cuti" description="Proses izin, sakit, dan cuti. Yang disetujui otomatis masuk rekap absensi; cuti memotong saldo. Anda tidak dapat memproses pengajuan sendiri (kecuali Super Admin)." />
      {actorCan(user, "leave_balance:manage") && <GrantQuota year={Number(todayIso(env().APP_TIMEZONE).slice(0, 4))} quota={settings.annualLeaveQuota} />}
      <FilterBar action="/pengajuan" resetHref="/pengajuan">
        <FilterField label="Status"><select name="status" defaultValue={sp.status ?? ""} className={filterInput}><option value="">Semua</option>{Object.entries(REQUEST_STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></FilterField>
        <FilterField label="Jenis"><select name="type" defaultValue={sp.type ?? ""} className={filterInput}><option value="">Semua</option>{Object.entries(LEAVE_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></FilterField>
        <FilterField label="Karyawan"><input type="search" name="q" defaultValue={sp.q} placeholder="Nama / no. induk" className={`${filterInput} w-48`} /></FilterField>
      </FilterBar>
      <Card>
        <LeaveReviewTable items={res.items} canReview={actorCan(user, "leave:review")} selfEmployeeId={user.employeeId} isSuper={user.role === "SUPER_ADMIN"} />
        <Pagination page={res.page} pageCount={res.pageCount} total={res.total} hrefFor={(p) => `/pengajuan${buildQuery({ ...filters, page: p })}`} />
      </Card>
    </div>
  );
}
