import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/current";
import { actorCan } from "@/server/actor";
import { env } from "@/server/env";
import { listAssignments, pendingAllowanceCount } from "@/server/services/assignments";
import { listEmployeeOptions } from "@/server/services/employees";
import { PageHeader } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { Tile } from "@/components/ui/stat";
import { FilterBar, FilterField, filterInput } from "@/components/filter-bar";
import { AssignmentCreate, AssignmentList } from "@/components/assignments";
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
  const [res, employees, pending] = await Promise.all([
    listAssignments(user, { ...filters, page: sp.page }),
    manage ? listEmployeeOptions(user) : Promise.resolve([]),
    pendingAllowanceCount(),
  ]);
  return (
    <div>
      <PageHeader title="Surat Tugas & Uang Harian"
        description="Surat Tugas dari HR / pimpinan kepada karyawan yang ditunjuk menjadi dasar Uang Harian. Penyerahan uang dibuktikan dengan Bukti Penerimaan Uang Harian per perjalanan — berdiri sendiri, di luar slip gaji."
        actions={manage ? <AssignmentCreate employees={employees} today={today} selfEmployeeId={user.employeeId} isSuper={user.role === "SUPER_ADMIN"} /> : undefined} />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <Tile label="Menunggu bukti penerimaan" value={pending} tone={pending ? "amber" : undefined} href="/surat-tugas?pending=1" hint="surat tugas terbit yang masih ada penerima tanpa bukti" />
        <Tile label="Surat tugas ditampilkan" value={res.total} />
      </div>
      <FilterBar action="/surat-tugas" resetHref="/surat-tugas">
        <FilterField label="Status"><select name="status" defaultValue={sp.status ?? ""} className={filterInput}><option value="">Semua</option><option value="ISSUED">Terbit</option><option value="CANCELLED">Dibatalkan</option></select></FilterField>
        <FilterField label="Cari"><input type="search" name="q" defaultValue={sp.q} placeholder="No. surat / tujuan / nama" className={`${filterInput} w-56`} /></FilterField>
        <FilterField label="Bukti"><select name="pending" defaultValue={sp.pending ?? ""} className={filterInput}><option value="">Semua</option><option value="1">Belum lengkap</option></select></FilterField>
      </FilterBar>
      <AssignmentList items={res.items} today={today} canManage={manage} canRevoke={actorCan(user, "assignment:revoke")} selfEmployeeId={user.employeeId} isSuper={user.role === "SUPER_ADMIN"} />
      <div className="mt-4 rounded-lg border border-line bg-surface"><Pagination page={res.page} pageCount={res.pageCount} total={res.total} hrefFor={(p) => `/surat-tugas${buildQuery({ ...filters, page: p })}`} /></div>
    </div>
  );
}
