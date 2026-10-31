import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/current";
import { listLocationChecks } from "@/server/services/location";
import { Card, Notice, PageHeader } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { FilterBar, FilterField, filterInput } from "@/components/filter-bar";
import { LocationReviewTable } from "@/components/location-review";
import { buildQuery, flattenSearchParams, type SearchParams } from "@/lib/query-string";

export const metadata: Metadata = { title: "Tinjauan Lokasi" };
export const dynamic = "force-dynamic";

export default async function LocationReviewPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePagePermission("location:review");
  const sp = await flattenSearchParams(searchParams);
  const filters = { status: sp.status };
  const res = await listLocationChecks(user, { ...filters, page: sp.page });
  return (
    <div className="space-y-4">
      <PageHeader title="Tinjauan Lokasi" description="Absensi berbasis lokasi yang ditandai atau ditolak karena sinyal risiko (mis. aplikasi lokasi palsu). Skor adalah indikator — bukan bukti kecurangan." />
      <Notice tone="info">Aplikasi web tidak dapat memastikan koordinat benar-benar dari GPS. Sinyal yang dinilai: kesegaran pembacaan, akurasi/presisi tidak wajar, titik persis di pusat kantor, koordinat identik dengan pembacaan sebelumnya atau karyawan lain, perpindahan mustahil, perangkat baru/dipakai bergantian, dan jaringan kantor.</Notice>
      <FilterBar action="/lokasi" resetHref="/lokasi">
        <FilterField label="Status tinjauan"><select name="status" defaultValue={sp.status ?? "OPEN"} className={filterInput}><option value="OPEN">Perlu ditinjau</option><option value="CLEARED">Dinyatakan wajar</option><option value="CONFIRMED">Indikasi manipulasi</option><option value="ALL">Semua yang pernah ditinjau</option></select></FilterField>
      </FilterBar>
      <Card>
        <LocationReviewTable items={res.items} canReview />
        <Pagination page={res.page} pageCount={res.pageCount} total={res.total} hrefFor={(p) => `/lokasi${buildQuery({ ...filters, page: p })}`} />
      </Card>
    </div>
  );
}
