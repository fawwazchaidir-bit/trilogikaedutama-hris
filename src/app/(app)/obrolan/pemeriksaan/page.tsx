import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/server/auth/current";
import { chatEnabled } from "@/server/env";
import { can } from "@/lib/permissions";
import { listDirectRoomsForAudit } from "@/server/services/chat/admin";
import { Card, EmptyState, Notice, PageHeader } from "@/components/ui/card";

export const metadata: Metadata = { title: "Pemeriksaan Japri" };
export const dynamic = "force-dynamic";

export default async function AuditRoomsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requirePageUser();
  if (!chatEnabled() || !can(user.role, "chat:audit_access")) notFound();
  const { q } = await searchParams;
  const rooms = await listDirectRoomsForAudit(user, { q });
  return (
    <div className="space-y-4">
      <PageHeader title="Pemeriksaan Japri" description="Khusus Direktur. Setiap kali Anda membuka percakapan, pembukaannya dicatat di Audit Log (tanpa isi pesan), paling banyak sekali per percakapan per 24 jam." />
      <Notice tone="warn">Gunakan hanya bila ada alasan kerja yang sah (mis. dugaan pelanggaran). Isi pesan tidak masuk Audit Log; yang tercatat adalah siapa yang membuka percakapan siapa, dan kapan.</Notice>
      <form className="flex gap-2" role="search"><input name="q" defaultValue={q ?? ""} placeholder="Cari nama peserta percakapan" aria-label="Cari nama" className="h-10 w-full max-w-sm rounded-md border border-line bg-white px-3 text-sm" /><button className="h-10 rounded-md border border-line bg-white px-4 text-sm font-medium">Cari</button></form>
      <Card>
        {rooms.length === 0 ? <EmptyState title="Tidak ada japri" description="Belum ada percakapan japri yang berisi pesan." /> : (
          <ul className="divide-y divide-line">{rooms.map((r) => (
            <li key={r.id}><Link href={`/obrolan?room=${r.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-canvas"><span className="text-sm font-medium text-ink">{r.participants.join(" ↔ ")}</span><span className="text-xs text-muted">{r.messages} pesan · {r.lastMessageAt ? new Date(r.lastMessageAt).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Jakarta" }) : "—"}</span></Link></li>
          ))}</ul>
        )}
      </Card>
    </div>
  );
}
