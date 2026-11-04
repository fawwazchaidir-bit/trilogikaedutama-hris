import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui/card";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { Breadcrumb, formatBytes } from "@/components/training/ui";
import { listAllDocuments } from "@/server/services/training/operations";
import { DOC_CATEGORY_LABEL } from "@/lib/training/types";
import { formatDateShort } from "@/lib/format";
import { guard, trainingPage } from "../_lib";

export const metadata: Metadata = { title: "Dokumen Proyek" };
export const dynamic = "force-dynamic";

export default async function DocumentsPage() {
  const { user } = await trainingPage();
  const docs = await guard(() => listAllDocuments(user));
  return (
    <div>
      <Breadcrumb items={[{ label: "Training & Operations", href: "/training" }, { label: "Dokumen Proyek" }]} />
      <PageHeader title="Dokumen Proyek" description="200 dokumen terbaru dari proyek dalam lingkup akses Anda. Unggah dan hapus dilakukan di tab Dokumen pada proyek." />
      <Notice tone="info">Berkas bersifat privat: setiap unduhan memeriksa akses Anda ke proyeknya. Dokumen peserta hanya terlihat oleh pengelola peserta.</Notice>
      <Card className="mt-4">
        {docs.length === 0 ? <EmptyState title="Belum ada dokumen" description="Dokumen yang diunggah pada proyek akan muncul di sini." /> : (
          <TableWrap><Table><thead><tr><Th>Dokumen</Th><Th>Proyek</Th><Th>Ukuran</Th><Th>Diunggah</Th><Th /></tr></thead>
            <tbody>{docs.map((d) => <tr key={d.id}><Td><p className="font-medium text-ink">{d.title}</p><Badge>{DOC_CATEGORY_LABEL[d.category]}</Badge></Td><Td><Link href={`/training/proyek/${d.projectId}?tab=dokumen`} className="text-brand-700 hover:underline">{d.projectCode}</Link><p className="text-xs text-muted">{d.projectName}</p></Td><Td>{formatBytes(d.size)}</Td><Td className="text-xs">{formatDateShort(d.createdAt)}<br />{d.uploadedByName ?? "—"}</Td><Td align="right"><a href={`/api/files/${d.fileId}`} aria-label={`Unduh ${d.title}`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-sm shadow-sm hover:bg-canvas"><Download className="size-3.5" />Unduh</a></Td></tr>)}</tbody></Table></TableWrap>
        )}
      </Card>
    </div>
  );
}
