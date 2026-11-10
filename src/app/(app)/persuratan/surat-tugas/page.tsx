import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/current";
import { actorCan } from "@/server/actor";
import { env } from "@/server/env";
import { listAssignments, pendingAllowanceCount } from "@/server/services/assignments";
import { PageHeader } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { Tile } from "@/components/ui/stat";
import { FilterBar, FilterField, filterInput } from "@/components/filter-bar";
import { AssignmentList } from "@/components/assignments";
import { NewAssignmentButton } from "@/components/letters/new-assignment-button";
import { buildQuery, flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { todayIso } from "@/lib/time";

export const metadata: Metadata = { title: "Surat Tugas & Uang Harian" };
export const dynamic = "force-dynamic";

export default async function AssignmentsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePagePermission("assignment:view_all");
  const sp = await flattenSearchParams(searchParams);
  const filters = { status: sp.status, q: sp.q, pending: sp.pending };
  const manage = actorCan(user, "assignment:manage");
  const today = todayIso(env().APP_TIMEZONE);
  const [res, pending] = await Promise.all([listAssignments(user, { ...filters, page: sp.page }), pendingAllowanceCount()]);
  return (
    <div>
      <PageHeader title="Surat Tugas & Uang Harian"
        description="Surat Tugas dibuat dan diterbitkan lewat Persuratan (jenis INT-002) dan menjadi dasar Uang Harian. Di sini HR/Direktur menerbitkan Bukti Penerimaan Uang Harian per perjalanan — berdiri sendiri, di luar slip gaji."
        actions={manage ? <NewAssignmentButton /> : undefined} />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Tile label="Menunggu bukti penerimaan" value={pending} tone={pending ? "amber" : undefined} href="/persuratan/surat-tugas?pending=1" hint="surat tugas terbit yang masih ada penerima tanpa bukti" />
        <Tile label="Surat tugas ditampilkan" value={res.total} />
      </div>
      <FilterBar action="/persuratan/surat-tugas" resetHref="/persuratan/surat-tugas">
        <FilterField label="Status"><select name="status" defaultValue={sp.status ?? ""} className={filterInput}><option value="">Semua</option><option value="ISSUED">Terbit</option><option value="CANCELLED">Dibatalkan</option></select></FilterField>
        <FilterField label="Cari"><input type="search" name="q" defaultValue={sp.q} placeholder="No. surat / tujuan / nama" className={`${filterInput} w-56`} /></FilterField>
        <FilterField label="Bukti"><select name="pending" defaultValue={sp.pending ?? ""} className={filterInput}><option value="">Semua</option><option value="1">Belum lengkap</option></select></FilterField>
      </FilterBar>
      <AssignmentList items={res.items} today={today} canManage={manage} canRevoke={actorCan(user, "assignment:revoke")} selfEmployeeId={user.employeeId} isSuper={user.role === "SUPER_ADMIN"} canViewSettlement={actorCan(user, "payroll:view")} />
      <div className="mt-4 rounded-lg border border-line bg-surface"><Pagination page={res.page} pageCount={res.pageCount} total={res.total} hrefFor={(p) => `/persuratan/surat-tugas${buildQuery({ ...filters, page: p })}`} /></div>
    </div>
  );
}
