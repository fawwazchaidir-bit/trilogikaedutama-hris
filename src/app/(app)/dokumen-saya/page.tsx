import type { Metadata } from "next";
import { requirePageSelf } from "@/server/auth/current";
import { listMyDocuments } from "@/server/services/documents";
import { Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/card";
import { DocumentStatus, PdfViewButton } from "@/components/documents";
import { formatDateLong } from "@/lib/format";

export const metadata: Metadata = { title: "Dokumen Saya" };
export const dynamic = "force-dynamic";

export default async function MyDocumentsPage() {
  const user = await requirePageSelf();
  const items = await listMyDocuments(user);
  return (
    <div>
      <PageHeader title="Dokumen Saya" description="Kontrak kerja dan dokumen kepegawaian Anda yang tersimpan di HR. Hanya Anda dan HR/pimpinan yang dapat membukanya." />
      <Card>
        <CardHeader title="Dokumen" description="Klik Lihat untuk membuka PDF langsung di aplikasi." />
        {items.length === 0 ? <EmptyState title="Belum ada dokumen" description="Kontrak kerja Anda akan muncul di sini setelah diunggah HR." /> : (
          <ul className="divide-y divide-line">{items.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <p className="font-medium">{d.title}</p>
                <p className="text-sm text-muted">{d.kind === "CONTRACT" ? "Kontrak kerja" : "Dokumen"}{d.documentNo ? ` · No. ${d.documentNo}` : ""}{d.startDate ? ` · ${formatDateLong(d.startDate)}` : ""}{d.kind === "CONTRACT" ? ` s.d. ${d.endDate ? formatDateLong(d.endDate) : "tanpa batas waktu"}` : ""}</p>
              </div>
              <div className="flex items-center gap-3">
                {d.kind === "CONTRACT" && d.phase !== "NO_EXPIRY" && <span className="text-sm"><DocumentStatus d={{ ...d, decision: "PENDING", needsDecision: false, needsRenewalUpload: false }} /></span>}
                <PdfViewButton doc={d} />
              </div>
            </li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}
