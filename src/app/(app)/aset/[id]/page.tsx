import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { requirePagePermission } from "@/server/auth/current";
import { AppError } from "@/server/errors";
import { getAsset } from "@/server/services/assets";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { formatDateLong } from "@/lib/format";
import { ASSET_CONDITION_LABEL, ASSET_STATUS_LABEL } from "@/lib/assets";

export const metadata: Metadata = { title: "Detail Aset" };
export const dynamic = "force-dynamic";

export default async function AssetDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePagePermission("employee:view");
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  let data;
  try { data = await getAsset(user, id); } catch (err) { if (err instanceof AppError) notFound(); throw err; }
  const { asset: a, history } = data;
  return (
    <div className="space-y-4">
      <Link href="/aset" className="inline-flex items-center gap-1 text-sm text-muted hover:text-ink"><ArrowLeft className="size-4" />Daftar aset</Link>
      <PageHeader title={`${a.code} · ${a.name}`} description={`${a.categoryLabel}${a.serialNo ? ` · No. seri ${a.serialNo}` : ""}`} />
      <Card>
        <div className="flex flex-wrap items-center gap-2 p-5 text-sm">
          <Badge tone={a.status === "AVAILABLE" ? "green" : a.status === "ASSIGNED" ? "blue" : a.status === "LOST" ? "red" : "gray"}>{ASSET_STATUS_LABEL[a.status]}</Badge>
          {a.holder && <span>Dipegang <Link className="font-medium text-brand-700 hover:underline" href={`/karyawan/${a.holder.employeeId}`}>{a.holder.employeeName}</Link> sejak {formatDateLong(a.holder.assignedOn)}</span>}
          {a.retireReason && <span className="text-muted">Dinonaktifkan: {a.retireReason}</span>}
          {a.note && <span className="text-muted">{a.note}</span>}
        </div>
      </Card>
      <Card>
        <CardHeader title="Riwayat serah-terima" description="Setiap pinjaman satu baris; yang sudah dikembalikan terkunci." />
        {history.length === 0 ? <EmptyState title="Belum pernah diserahkan" /> : (
          <TableWrap><Table>
            <thead><tr><Th>Karyawan</Th><Th>Diserahkan</Th><Th>Dikembalikan</Th><Th>Kondisi</Th><Th>Catatan</Th></tr></thead>
            <tbody>{history.map((h) => (
              <tr key={h.id}>
                <Td><Link className="font-medium text-brand-700 hover:underline" href={`/karyawan/${h.employeeId}`}>{h.employeeName}</Link></Td>
                <Td className="whitespace-nowrap">{formatDateLong(h.assignedOn)}<p className="text-xs text-muted">oleh {h.assignedBy}</p></Td>
                <Td className="whitespace-nowrap">{h.returnedOn ? <>{formatDateLong(h.returnedOn)}<p className="text-xs text-muted">dicatat {h.returnedBy}</p></> : <Badge tone="blue">Masih dipegang</Badge>}</Td>
                <Td>{h.returnCondition ? <Badge tone={h.returnCondition === "GOOD" ? "green" : h.returnCondition === "DAMAGED" ? "amber" : "red"}>{ASSET_CONDITION_LABEL[h.returnCondition]}</Badge> : "—"}</Td>
                <Td className="text-xs text-muted">{[h.note, h.returnNote].filter(Boolean).join(" · ") || "—"}</Td>
              </tr>
            ))}</tbody>
          </Table></TableWrap>
        )}
      </Card>
    </div>
  );
}
