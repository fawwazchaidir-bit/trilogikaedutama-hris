import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/server/auth/current";
import { listChecklistOverview } from "@/server/services/employee-checklists";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { formatDateLong } from "@/lib/format";
import { KIND_LABEL } from "@/lib/employee-checklist";

export const metadata: Metadata = { title: "Masuk & Berhenti" };
export const dynamic = "force-dynamic";

export default async function LifecyclePage() {
  const user = await requirePagePermission("employee:view");
  const { open, recent } = await listChecklistOverview(user);
  const row = (r: (typeof open)[number]) => (
    <tr key={r.id}>
      <Td><Link className="font-medium text-brand-700 hover:underline" href={`/karyawan/${r.employeeId}`}>{r.employeeName}</Link><p className="text-xs text-muted">{r.employeeNo} · {r.position}{r.division ? ` · ${r.division}` : ""}</p></Td>
      <Td><Badge tone={r.kind === "ONBOARDING" ? "green" : "amber"}>{KIND_LABEL[r.kind]}</Badge></Td>
      <Td className="tabular whitespace-nowrap">{r.progress.done + r.progress.notApplicable}/{r.progress.total}{r.status === "OPEN" && r.progress.requiredLeft > 0 && <span className="ml-1 text-xs text-muted">({r.progress.requiredLeft} wajib tersisa)</span>}</Td>
      <Td className="whitespace-nowrap">{r.targetDate ? formatDateLong(r.targetDate) : "—"} {r.overdue && <Badge tone="red">Terlambat</Badge>}</Td>
      <Td>{r.status === "OPEN" ? <Badge tone="amber">Berjalan</Badge> : r.status === "COMPLETED" ? <Badge tone="green">Selesai</Badge> : <Badge>Dibatalkan</Badge>}</Td>
    </tr>
  );
  return (
    <div className="space-y-4">
      <PageHeader title="Masuk & Berhenti" description="Daftar centang proses karyawan baru masuk dan karyawan berhenti. Dimulai otomatis saat karyawan baru ditambahkan atau karyawan dinonaktifkan; buka detail karyawan untuk mengerjakannya." />
      <Card>
        <CardHeader title={`Proses berjalan (${open.length})`} />
        {open.length === 0 ? <EmptyState title="Tidak ada proses berjalan" description="Semua proses masuk dan berhenti sudah selesai." /> : (
          <TableWrap><Table><thead><tr><Th>Karyawan</Th><Th>Proses</Th><Th>Kemajuan</Th><Th>Target</Th><Th>Status</Th></tr></thead><tbody>{open.map(row)}</tbody></Table></TableWrap>
        )}
      </Card>
      {recent.length > 0 && (
        <Card>
          <CardHeader title="Baru ditutup" />
          <TableWrap><Table><thead><tr><Th>Karyawan</Th><Th>Proses</Th><Th>Kemajuan</Th><Th>Target</Th><Th>Status</Th></tr></thead><tbody>{recent.map(row)}</tbody></Table></TableWrap>
        </Card>
      )}
    </div>
  );
}
