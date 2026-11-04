import type { Metadata } from "next";
import Link from "next/link";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { FilterBar, FilterField, filterInput } from "@/components/filter-bar";
import { Breadcrumb, ParticipantStatusBadge } from "@/components/training/ui";
import { listAllParticipants } from "@/server/services/training/operations";
import { PARTICIPANT_STATUSES, PARTICIPANT_STATUS_LABEL } from "@/lib/training/types";
import { buildQuery, flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { guard, trainingPage } from "../_lib";

export const metadata: Metadata = { title: "Peserta" };
export const dynamic = "force-dynamic";

export default async function ParticipantsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user } = await trainingPage();
  const sp = await flattenSearchParams(searchParams);
  const filters = { q: sp.q, status: sp.status };
  const res = await guard(() => listAllParticipants(user, { ...filters, page: sp.page }));
  return (
    <div>
      <Breadcrumb items={[{ label: "Training & Operations", href: "/training" }, { label: "Peserta" }]} />
      <PageHeader title="Peserta" description="Peserta pada seluruh proyek dalam lingkup akses Anda. Menambah atau mengubah peserta dilakukan di tab Peserta pada proyek." />
      <Notice tone="info">Data peserta adalah data operasional lokal (input manual) dan belum tersinkron dengan website registrasi. Kontak hanya terlihat oleh pengelola peserta pada proyek terkait.</Notice>
      <div className="mt-4"><FilterBar action="/training/peserta" resetHref="/training/peserta">
        <FilterField label="Cari"><input type="search" name="q" defaultValue={sp.q} placeholder="Nama atau instansi" className={`${filterInput} w-56`} /></FilterField>
        <FilterField label="Status"><select name="status" defaultValue={sp.status ?? ""} className={filterInput}><option value="">Semua</option>{PARTICIPANT_STATUSES.map((s) => <option key={s} value={s}>{PARTICIPANT_STATUS_LABEL[s]}</option>)}</select></FilterField>
      </FilterBar></div>
      <Card>
        {res.items.length === 0 ? <EmptyState title="Belum ada peserta" description="Peserta muncul di sini setelah ditambahkan pada proyek." /> : (
          <TableWrap><Table><thead><tr><Th>Nama</Th><Th>Instansi</Th><Th>Proyek</Th><Th>Kontak</Th><Th>Status</Th></tr></thead>
            <tbody>{res.items.map((p) => <tr key={p.id}><Td className="font-medium text-ink">{p.fullName}</Td><Td>{p.organization ?? "—"}</Td><Td><Link href={`/training/proyek/${p.projectId}?tab=peserta`} className="text-brand-700 hover:underline">{p.projectCode}</Link></Td>
              <Td>{p.contactVisible ? <>{p.phone ?? "—"}<br /><span className="text-xs text-muted">{p.email ?? ""}</span></> : <span className="text-xs text-muted">Disembunyikan</span>}</Td><Td><ParticipantStatusBadge status={p.status} /></Td></tr>)}</tbody></Table></TableWrap>
        )}
        <Pagination page={res.page} pageCount={res.pageCount} total={res.total} hrefFor={(n) => `/training/peserta${buildQuery({ ...filters, page: n })}`} />
      </Card>
    </div>
  );
}
