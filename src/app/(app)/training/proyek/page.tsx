import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { FilterBar, FilterField, filterInput } from "@/components/filter-bar";
import { AttentionBadges, Breadcrumb, ProgressBar, ProjectStatusBadge } from "@/components/training/ui";
import { listPicOptions, listPrograms, listProjects } from "@/server/services/training/projects";
import { ACTIVITY_KINDS, ACTIVITY_KIND_LABEL, PROJECT_STATUSES, PROJECT_STATUS_LABEL } from "@/lib/training/types";
import { formatDateRange } from "@/lib/format";
import { buildQuery, flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { guard, trainingPage } from "../_lib";

export const metadata: Metadata = { title: "Proyek Pelatihan" };
export const dynamic = "force-dynamic";

export default async function ProjectsPage({ searchParams }: { searchParams: SearchParams }) {
  const { user, ctx } = await trainingPage();
  const sp = await flattenSearchParams(searchParams);
  const filters = { q: sp.q, status: sp.status, kind: sp.kind, programId: sp.programId, picId: sp.picId, from: sp.from, to: sp.to, attention: sp.attention, active: sp.active, sort: sp.sort };
  const [res, pics, programs] = await Promise.all([guard(() => listProjects(user, { ...filters, page: sp.page })), guard(() => listPicOptions(user)), guard(() => listPrograms(user, { includeInactive: true }))]);
  const hasFilter = Object.values(filters).some(Boolean);

  return (
    <div>
      <Breadcrumb items={[{ label: "Training & Operations", href: "/training" }, { label: "Proyek Pelatihan" }]} />
      <PageHeader title="Proyek Pelatihan" description="Setiap pelaksanaan atau batch pelatihan. Anda hanya melihat proyek yang menjadi lingkup akses Anda."
        actions={ctx.caps.createProject ? <Link href="/training/proyek/baru"><Button variant="primary"><Plus className="size-4" />Proyek baru</Button></Link> : undefined} />
      <FilterBar action="/training/proyek" resetHref="/training/proyek">
        <FilterField label="Cari"><input type="search" name="q" defaultValue={sp.q} placeholder="Nama, kode, atau klien" className={`${filterInput} w-52`} /></FilterField>
        <FilterField label="Status"><select name="status" defaultValue={sp.status ?? ""} className={filterInput}><option value="">Semua</option>{PROJECT_STATUSES.map((s) => <option key={s} value={s}>{PROJECT_STATUS_LABEL[s]}</option>)}</select></FilterField>
        <FilterField label="Jenis"><select name="kind" defaultValue={sp.kind ?? ""} className={filterInput}><option value="">Semua</option>{ACTIVITY_KINDS.map((k) => <option key={k} value={k}>{ACTIVITY_KIND_LABEL[k]}</option>)}</select></FilterField>
        <FilterField label="Program"><select name="programId" defaultValue={sp.programId ?? ""} className={filterInput}><option value="">Semua</option>{programs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></FilterField>
        <FilterField label="PIC"><select name="picId" defaultValue={sp.picId ?? ""} className={filterInput}><option value="">Semua</option>{pics.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></FilterField>
        <FilterField label="Periode dari"><input type="date" name="from" defaultValue={sp.from} className={filterInput} /></FilterField>
        <FilterField label="sampai"><input type="date" name="to" defaultValue={sp.to} className={filterInput} /></FilterField>
        <FilterField label="Urutkan"><select name="sort" defaultValue={sp.sort ?? ""} className={filterInput}><option value="">Mulai terbaru</option><option value="start_asc">Mulai terdekat</option><option value="code_desc">Kode terbaru</option><option value="name_asc">Nama A–Z</option></select></FilterField>
        <label className="flex items-center gap-2 pb-2 text-xs font-medium text-muted"><input type="checkbox" name="attention" value="1" defaultChecked={sp.attention === "1"} className="size-4" />Perlu perhatian saja</label>
        <label className="flex items-center gap-2 pb-2 text-xs font-medium text-muted"><input type="checkbox" name="active" value="1" defaultChecked={sp.active === "1"} className="size-4" />Aktif saja</label>
      </FilterBar>
      <Card>
        {res.items.length === 0 ? (
          <EmptyState title={hasFilter ? "Tidak ada proyek yang cocok" : "Belum ada proyek"} description={hasFilter ? "Ubah atau reset filter." : ctx.caps.createProject ? "Buat proyek pertama dari tombol “Proyek baru”." : "Anda belum ditugaskan pada proyek mana pun."} />
        ) : (
          <TableWrap><Table>
            <thead><tr><Th>Kode</Th><Th>Proyek</Th><Th>Jenis</Th><Th>Tanggal</Th><Th>PIC</Th><Th>Status</Th><Th>Checklist</Th><Th align="right">Tugas</Th></tr></thead>
            <tbody>{res.items.map((p) => (
              <tr key={p.id}>
                <Td mono><Link href={`/training/proyek/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.code}</Link></Td>
                <Td className="max-w-xs"><Link href={`/training/proyek/${p.id}`} className="font-medium text-ink hover:underline">{p.name}</Link><p className="text-xs text-muted">{[p.programName, p.clientName].filter(Boolean).join(" · ") || "—"}</p><AttentionBadges codes={p.attention} /></Td>
                <Td>{ACTIVITY_KIND_LABEL[p.kind]}</Td>
                <Td className="whitespace-nowrap text-xs">{p.startDate && p.endDate ? formatDateRange(p.startDate, p.endDate) : "Belum dijadwalkan"}</Td>
                <Td>{p.picName ?? <span className="text-xs text-muted">Belum ada</span>}</Td>
                <Td><ProjectStatusBadge status={p.status} /></Td>
                <Td><ProgressBar progress={p.checklist} /></Td>
                <Td align="right">{p.openTasks}{p.overdueTasks > 0 && <span className="ml-1 text-xs font-medium text-brand-700">({p.overdueTasks} telat)</span>}</Td>
              </tr>))}</tbody>
          </Table></TableWrap>
        )}
        <Pagination page={res.page} pageCount={res.pageCount} total={res.total} hrefFor={(p) => `/training/proyek${buildQuery({ ...filters, page: p })}`} />
      </Card>
    </div>
  );
}
