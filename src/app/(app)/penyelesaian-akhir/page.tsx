import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/server/auth/current";
import { actorCan } from "@/server/actor";
import { listSettlements } from "@/server/services/final-settlements";
import { listEmployeeOptions } from "@/server/services/employees";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { SettlementCreate } from "@/components/settlement-create";
import { formatDateLong } from "@/lib/format";
import { formatRupiah } from "@/lib/money";
import { SETTLEMENT_STATUS_LABEL, type SettlementStatusValue } from "@/lib/final-settlement";

export const metadata: Metadata = { title: "Penyelesaian Akhir" };
export const dynamic = "force-dynamic";

const TONE: Record<SettlementStatusValue, "gray" | "amber" | "blue" | "green" | "red"> = { DRAFT: "gray", PENDING_APPROVAL: "amber", APPROVED: "blue", PAID: "green", CANCELLED: "red" };

export default async function SettlementsPage() {
  const user = await requirePagePermission("payroll:view");
  const canPrepare = actorCan(user, "payroll:prepare");
  const [rows, employees] = await Promise.all([listSettlements(user), canPrepare ? listEmployeeOptions(user, { includeInactive: true }) : Promise.resolve([])]);
  const live = rows.filter((r) => r.status !== "CANCELLED");
  const cancelled = rows.filter((r) => r.status === "CANCELLED");
  const table = (list: typeof rows) => (
    <TableWrap><Table>
      <thead><tr><Th>Karyawan</Th><Th>Terakhir bekerja</Th><Th>Status</Th><Th align="right">Bersih</Th></tr></thead>
      <tbody>{list.map((r) => (
        <tr key={r.id}>
          <Td><Link className="font-medium text-brand-700 hover:underline" href={`/penyelesaian-akhir/${r.id}`}>{r.employeeName}</Link><p className="text-xs text-muted">{r.employeeNo}</p></Td>
          <Td className="whitespace-nowrap">{formatDateLong(r.lastWorkDate)}</Td>
          <Td><Badge tone={TONE[r.status]}>{SETTLEMENT_STATUS_LABEL[r.status]}</Badge></Td>
          <Td align="right" className="tabular whitespace-nowrap">{formatRupiah(r.netPayable, "PLAIN")}</Td>
        </tr>
      ))}</tbody>
    </Table></TableWrap>
  );
  return (
    <div className="space-y-4">
      <PageHeader title="Penyelesaian Akhir" description="Hak dan kewajiban finansial saat karyawan berhenti: gaji prorata, uang cuti, uang harian, serta pesangon/UPMK/UPH/THR/pajak yang diisi manual. Disiapkan HR, disetujui pimpinan, lalu dicatat dibayar."
        actions={canPrepare ? <SettlementCreate employees={employees.map((e) => ({ id: e.id, name: e.fullName, no: e.employeeNo, active: e.isActive }))} /> : undefined} />
      <Card>
        <CardHeader title={`Berlaku (${live.length})`} />
        {live.length === 0 ? <EmptyState title="Belum ada penyelesaian akhir" description="Buat saat karyawan berhenti — idealnya dari butir &quot;Hak dan kewajiban&quot; pada checklist karyawan berhenti." /> : table(live)}
      </Card>
      {cancelled.length > 0 && <Card><CardHeader title={`Dibatalkan (${cancelled.length})`} />{table(cancelled)}</Card>}
    </div>
  );
}
