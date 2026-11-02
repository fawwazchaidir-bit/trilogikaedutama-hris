import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/current";
import { actorCan } from "@/server/actor";
import { listDocuments, listRenewableContracts } from "@/server/services/documents";
import { listEmployeeOptions } from "@/server/services/employees";
import { Card, PageHeader } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { Tile } from "@/components/ui/stat";
import { FilterBar, FilterField, filterInput } from "@/components/filter-bar";
import { DocumentTable, DocumentUpload } from "@/components/documents";
import { buildQuery, flattenSearchParams, type SearchParams } from "@/lib/query-string";

export const metadata: Metadata = { title: "Dokumen" };
export const dynamic = "force-dynamic";

const VIEWS = {
  aktif: "Semua yang aktif", "perlu-keputusan": "Perlu keputusan pimpinan", "perlu-perpanjangan": "Menunggu kontrak perpanjangan",
  "segera-berakhir": "Segera berakhir (≤ 3 bulan)", berakhir: "Sudah berakhir", diarsipkan: "Diarsipkan", semua: "Semua termasuk arsip",
} as const;

export default async function DocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePagePermission("document:view_all");
  const sp = await flattenSearchParams(searchParams);
  const filters = { view: sp.view, kind: sp.kind, q: sp.q, employeeId: sp.employeeId };
  const manage = actorCan(user, "document:manage");
  const [res, employees, renewable] = await Promise.all([
    listDocuments(user, { ...filters, page: sp.page }),
    manage ? listEmployeeOptions(user) : Promise.resolve([]),
    manage ? listRenewableContracts(user) : Promise.resolve([]),
  ]);
  const c = res.counts;
  return (
    <div>
      <PageHeader title="Dokumen" description="Kontrak kerja bermaterai (PDF hasil pindai, tanda tangan basah) dan dokumen kepegawaian lain. Pimpinan diingatkan H-3 bulan sebelum kontrak berakhir untuk memutuskan lanjut atau tidak."
        actions={manage ? <DocumentUpload employees={employees} renewable={renewable} initialEmployeeId={sp.employeeId} /> : undefined} />
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Perlu keputusan pimpinan" value={c.needsDecision} tone={c.needsDecision ? "amber" : undefined} href="/dokumen?view=perlu-keputusan" hint="kontrak ≤ 3 bulan / sudah berakhir, belum diputuskan" />
        <Tile label="Menunggu kontrak perpanjangan" value={c.needsRenewalUpload} tone={c.needsRenewalUpload ? "amber" : undefined} href="/dokumen?view=perlu-perpanjangan" hint="diputuskan lanjut, PDF baru belum diunggah" />
        <Tile label="Segera berakhir" value={c.expiring} href="/dokumen?view=segera-berakhir" hint="dalam 3 bulan ke depan" />
        <Tile label="Dokumen aktif" value={c.active} href="/dokumen" hint={`${c.expired} kontrak sudah berakhir`} />
      </div>
      <FilterBar action="/dokumen" resetHref="/dokumen">
        <FilterField label="Tampilan"><select name="view" defaultValue={sp.view ?? "aktif"} className={filterInput}>{Object.entries(VIEWS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></FilterField>
        <FilterField label="Jenis"><select name="kind" defaultValue={sp.kind ?? ""} className={filterInput}><option value="">Semua</option><option value="CONTRACT">Kontrak kerja</option><option value="OTHER">Dokumen lain</option></select></FilterField>
        <FilterField label="Cari"><input type="search" name="q" defaultValue={sp.q} placeholder="Nama / no. induk / judul" className={`${filterInput} w-56`} /></FilterField>
        {sp.employeeId && <input type="hidden" name="employeeId" value={sp.employeeId} />}
      </FilterBar>
      <Card>
        <DocumentTable items={res.items} employees={employees} renewable={renewable} canManage={manage} canDecide={actorCan(user, "document:decide")} />
        <Pagination page={res.page} pageCount={res.pageCount} total={res.total} hrefFor={(p) => `/dokumen${buildQuery({ ...filters, page: p })}`} />
      </Card>
    </div>
  );
}
