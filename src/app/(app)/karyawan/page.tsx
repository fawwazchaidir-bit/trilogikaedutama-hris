import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/server/auth/current";
import { listDivisions, listEmployees } from "@/server/services/employees";
import { env } from "@/server/env";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { FilterBar, FilterField, filterInput } from "@/components/filter-bar";
import { ExportLinks } from "@/components/export-links";
import { AddEmployeeButton } from "@/components/employee-forms";
import { EmployeeImport } from "@/components/employee-import";
import { actorCan } from "@/server/actor";
import { buildQuery, flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { formatDateShort } from "@/lib/format";
import { EMPLOYMENT_LABEL } from "@/lib/labels";
import { todayIso } from "@/lib/time";

export const metadata: Metadata = { title: "Karyawan" };
export const dynamic = "force-dynamic";

export default async function EmployeesPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePagePermission("employee:view");
  const sp = await flattenSearchParams(searchParams);
  const [res, divisions] = await Promise.all([listEmployees(user, sp), listDivisions(user)]);
  const canManage = actorCan(user, "employee:manage");
  const filters = { q: sp.q, divisionId: sp.divisionId, employmentStatus: sp.employmentStatus, active: sp.active };
  return (
    <div>
      <PageHeader title="Karyawan" description="Kelola data karyawan: tambah, ubah, nonaktifkan. Karyawan tidak dihapus agar riwayat absensi dan gaji tetap utuh."
        actions={<>
          {actorCan(user, "employee:export") && <ExportLinks base="/api/employees/export" params={filters} formats={["xlsx", "csv"]} />}
          {actorCan(user, "employee:import") && <EmployeeImport />}
          {canManage && <AddEmployeeButton divisions={divisions} today={todayIso(env().APP_TIMEZONE)} />}
        </>} />
      <FilterBar action="/karyawan" resetHref="/karyawan">
        <FilterField label="Cari"><input type="search" name="q" defaultValue={sp.q} placeholder="Nama, no. induk, jabatan" className={`${filterInput} w-56`} /></FilterField>
        <FilterField label="Divisi"><select name="divisionId" defaultValue={sp.divisionId ?? ""} className={filterInput}><option value="">Semua divisi</option>{divisions.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></FilterField>
        <FilterField label="Status karyawan"><select name="employmentStatus" defaultValue={sp.employmentStatus ?? ""} className={filterInput}><option value="">Semua</option>{Object.entries(EMPLOYMENT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></FilterField>
        <FilterField label="Keaktifan"><select name="active" defaultValue={sp.active ?? "active"} className={filterInput}><option value="active">Aktif</option><option value="inactive">Nonaktif</option><option value="all">Semua</option></select></FilterField>
      </FilterBar>
      <Card>
        {res.items.length === 0 ? <EmptyState title="Tidak ada karyawan" description="Ubah filter pencarian, atau tambahkan karyawan baru." /> : (
          <TableWrap><Table>
            <thead><tr><Th>No. Induk</Th><Th>Nama</Th><Th>Divisi</Th><Th>Jabatan</Th><Th>Status</Th><Th>Mulai</Th><Th>Akun</Th></tr></thead>
            <tbody>{res.items.map((e) => (
              <tr key={e.id}>
                <Td mono>{e.employeeNo}</Td>
                <Td className="font-medium"><Link href={`/karyawan/${e.id}`} className="text-brand-700 hover:underline">{e.fullName}</Link>{!e.isActive && <Badge className="ml-2">Nonaktif</Badge>}</Td>
                <Td>{e.divisionName ?? "—"}</Td><Td>{e.position}</Td><Td>{EMPLOYMENT_LABEL[e.employmentStatus]}</Td><Td>{formatDateShort(e.joinDate)}</Td>
                <Td>{e.userId ? <Badge tone="green">Ada</Badge> : <Badge>Belum</Badge>}</Td>
              </tr>
            ))}</tbody>
          </Table></TableWrap>
        )}
        <Pagination page={res.page} pageCount={res.pageCount} total={res.total} hrefFor={(p) => `/karyawan${buildQuery({ ...filters, page: p })}`} />
      </Card>
    </div>
  );
}
