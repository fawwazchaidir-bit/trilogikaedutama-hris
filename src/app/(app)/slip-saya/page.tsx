import type { Metadata } from "next";
import Link from "next/link";
import { Download, Eye } from "lucide-react";
import { requirePageSelf } from "@/server/auth/current";
import { listMyPayslips } from "@/server/services/payslips";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { formatDateLong, formatDateRange } from "@/lib/format";
import { formatRupiah } from "@/lib/money";

export const metadata: Metadata = { title: "Slip Gaji Saya" };
export const dynamic = "force-dynamic";

export default async function MyPayslipsPage() {
  const user = await requirePageSelf();
  const items = await listMyPayslips(user);
  return (
    <div>
      <PageHeader title="Slip Gaji Saya" description="Hanya slip milik Anda yang sudah diterbitkan. Unduh sebagai PDF untuk arsip pribadi." />
      <Card>
        {items.length === 0 ? <EmptyState title="Belum ada slip gaji" description="Slip akan muncul di sini setelah diterbitkan oleh HR. Anda akan mendapat notifikasi." /> : (
          <TableWrap><Table>
            <thead><tr><Th>Periode</Th><Th>No. Slip</Th><Th>Tanggal terbit</Th><Th align="right">Gaji bersih</Th><Th align="right">Aksi</Th></tr></thead>
            <tbody>{items.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium">{p.periodLabel}<span className="block text-xs font-normal text-muted">{formatDateRange(p.periodStart, p.periodEnd)}</span></Td>
                <Td mono>{p.number}</Td><Td>{formatDateLong(p.issueDate)}</Td><Td align="right" className="font-medium">{formatRupiah(p.netPay)}</Td>
                <Td align="right"><div className="flex justify-end gap-2">
                  <Link href={`/slip/${p.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-sm hover:bg-canvas"><Eye className="size-4" />Lihat</Link>
                  <a href={`/api/payslips/${p.id}/pdf`} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700"><Download className="size-4" />PDF</a>
                </div></Td>
              </tr>
            ))}</tbody>
          </Table></TableWrap>
        )}
      </Card>
    </div>
  );
}
