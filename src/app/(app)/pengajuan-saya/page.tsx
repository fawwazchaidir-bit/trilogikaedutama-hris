import type { Metadata } from "next";
import { requirePageSelf } from "@/server/auth/current";
import { getBalance, getLedger, getLeavePolicy, listMyLeaves } from "@/server/services/leave";
import { getSettings } from "@/server/services/settings";
import { env } from "@/server/env";
import { Card, CardHeader, EmptyState, Notice, PageHeader } from "@/components/ui/card";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { Tile } from "@/components/ui/stat";
import { LeaveForm, MyLeaveList } from "@/components/leave-forms";
import { formatDateLong, formatDateTime } from "@/lib/format";
import { LEDGER_KIND_LABEL } from "@/lib/labels";
import { todayIso } from "@/lib/time";

export const metadata: Metadata = { title: "Pengajuan Saya" };
export const dynamic = "force-dynamic";

export default async function MyLeavesPage() {
  const user = await requirePageSelf();
  const today = todayIso(env().APP_TIMEZONE);
  const year = Number(today.slice(0, 4));
  const [items, settings, balance, ledger, policy] = await Promise.all([listMyLeaves(user), getSettings(), getBalance(user, user.employeeId, year), getLedger(user, user.employeeId, year), getLeavePolicy(user, user.employeeId)]);
  return (
    <div>
      <PageHeader title="Pengajuan Saya" description="Ajukan izin, sakit, atau cuti dan pantau statusnya. Pengajuan yang disetujui otomatis memengaruhi rekap absensi." />
      <div className="mb-4">
        {policy.entitledNow
          ? <Notice tone="info">Kebijakan cuti Anda: <strong>{policy.policy.quotaDays} hari/tahun</strong>, berhak sejak {formatDateLong(policy.policy.eligibleFrom)}{policy.policy.custom ? " (kebijakan khusus)" : ""}.</Notice>
          : <Notice tone="warn">Anda <strong>belum berhak cuti tahunan</strong> — hak cuti Anda mulai {formatDateLong(policy.policy.eligibleFrom)}. Sampai saat itu, pengajuan cuti tidak dapat diproses; izin dan sakit tetap dapat diajukan.</Notice>}
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Tile label={`Saldo cuti ${year}`} value={`${balance.balance} hari`} />
        <Tile label="Menunggu persetujuan" value={`${balance.reserved} hari`} hint="dicadangkan dari saldo" tone={balance.reserved ? "amber" : undefined} />
        <Tile label="Tersedia diajukan" value={`${balance.available} hari`} tone="green" />
        <Tile label="Sudah terpakai" value={`${Math.abs(balance.used + balance.restored)} hari`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,28rem)_1fr]">
        <LeaveForm today={today} maxBackdateDays={settings.requestBackdateDays} />
        <MyLeaveList items={items} />
      </div>
      <Card className="mt-4">
        <CardHeader title={`Riwayat saldo cuti ${year}`} description="Setiap perubahan saldo tercatat dan tidak dapat diubah." />
        {ledger.length === 0 ? <EmptyState title="Belum ada saldo cuti" description="Saldo awal diatur oleh Admin/HR." /> : (
          <TableWrap><Table>
            <thead><tr><Th>Waktu</Th><Th>Jenis</Th><Th align="right">Hari</Th><Th>Catatan</Th><Th>Oleh</Th></tr></thead>
            <tbody>{ledger.map((l) => (
              <tr key={l.id}><Td className="whitespace-nowrap">{formatDateTime(l.createdAt)}</Td><Td>{LEDGER_KIND_LABEL[l.kind as keyof typeof LEDGER_KIND_LABEL] ?? l.kind}</Td><Td align="right">{l.days > 0 ? `+${l.days}` : l.days}</Td><Td className="text-muted">{l.note ?? "—"}</Td><Td>{l.createdBy}</Td></tr>
            ))}</tbody>
          </Table></TableWrap>
        )}
      </Card>
    </div>
  );
}
