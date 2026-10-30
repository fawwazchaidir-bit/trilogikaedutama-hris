import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth/current";
import { listAuditLogs } from "@/server/services/audit-log";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { FilterBar, FilterField, filterInput } from "@/components/filter-bar";
import { buildQuery, flattenSearchParams, type SearchParams } from "@/lib/query-string";
import { formatDateTime } from "@/lib/format";
import { ROLE_LABELS, type Role } from "@/lib/permissions";

export const metadata: Metadata = { title: "Audit Log" };
export const dynamic = "force-dynamic";

const GROUPS = [["auth.", "Autentikasi"], ["user.", "Akun"], ["employee.", "Karyawan"], ["attendance.", "Absensi"], ["leave", "Pengajuan & saldo cuti"], ["schedule.", "Jadwal"], ["calendar.", "Kalender"],
  ["component.", "Komponen gaji"], ["payroll.", "Penggajian"], ["payslip.", "Slip gaji"], ["settings.", "Pengaturan"], ["recap.", "Rekap"]] as const;

export default async function AuditLogPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requirePagePermission("audit:view");
  const sp = await flattenSearchParams(searchParams);
  const filters = { q: sp.q, action: sp.action, from: sp.from, to: sp.to, entityId: sp.entityId };
  const res = await listAuditLogs(user, { ...filters, page: sp.page });
  return (
    <div>
      <PageHeader title="Audit Log" description="Jejak perubahan data penting (append-only — tidak dapat diubah atau dihapus, bahkan lewat database)." />
      <FilterBar action="/audit-log" resetHref="/audit-log">
        <FilterField label="Cari"><input type="search" name="q" defaultValue={sp.q} placeholder="Ringkasan / email / alasan" className={`${filterInput} w-56`} /></FilterField>
        <FilterField label="Kelompok aksi"><select name="action" defaultValue={sp.action ?? ""} className={filterInput}><option value="">Semua</option>{GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></FilterField>
        <FilterField label="Dari"><input type="date" name="from" defaultValue={sp.from} className={filterInput} /></FilterField>
        <FilterField label="Sampai"><input type="date" name="to" defaultValue={sp.to} className={filterInput} /></FilterField>
      </FilterBar>
      <Card>
        {res.items.length === 0 ? <EmptyState title="Tidak ada catatan" /> : (
          <TableWrap><Table>
            <thead><tr><Th>Waktu</Th><Th>Pelaku</Th><Th>Aksi</Th><Th>Ringkasan</Th><Th>Alasan</Th></tr></thead>
            <tbody>{res.items.map((l) => (
              <tr key={l.id}>
                <Td className="whitespace-nowrap">{formatDateTime(l.createdAt)}</Td>
                <Td>{l.actorName ?? l.actorEmail ?? "Sistem"}{l.actorRole && <span className="block text-xs text-muted">{ROLE_LABELS[l.actorRole as Role] ?? l.actorRole}</span>}</Td>
                <Td><Badge>{l.action}</Badge></Td>
                <Td className="min-w-72 max-w-xl">{l.summary}
                  {(l.before != null || l.after != null) && <details className="mt-1 text-xs text-muted"><summary className="cursor-pointer">Lihat data</summary>
                    <pre className="mt-1 max-h-48 overflow-auto rounded bg-canvas p-2 text-[11px]">{JSON.stringify({ sebelum: l.before, sesudah: l.after }, null, 2)}</pre></details>}</Td>
                <Td className="min-w-40 text-muted">{l.reason ?? "—"}</Td>
              </tr>
            ))}</tbody>
          </Table></TableWrap>
        )}
        <Pagination page={res.page} pageCount={res.pageCount} total={res.total} hrefFor={(p) => `/audit-log${buildQuery({ ...filters, page: p })}`} />
      </Card>
    </div>
  );
}
