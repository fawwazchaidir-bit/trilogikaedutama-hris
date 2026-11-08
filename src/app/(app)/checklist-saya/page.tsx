import type { Metadata } from "next";
import { requirePageUser } from "@/server/auth/current";
import { listMyChecklistItems } from "@/server/services/employee-checklists";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { MyChecklistList } from "@/components/my-checklist-list";

export const metadata: Metadata = { title: "Checklist Saya" };
export const dynamic = "force-dynamic";

export default async function MyChecklistPage() {
  const user = await requirePageUser();
  const items = await listMyChecklistItems(user);
  return (
    <div className="space-y-4">
      <PageHeader title="Checklist Saya" description="Butir checklist karyawan masuk/berhenti yang ditunjuk kepada Anda. Tandai selesai bila sudah dikerjakan; HR melihat siapa dan kapan." />
      <Card>
        {items.length === 0 ? <EmptyState title="Tidak ada butir yang menunggu Anda" description="Butir baru muncul di sini dan di notifikasi saat HR menunjuk Anda." /> : <MyChecklistList items={items} />}
      </Card>
    </div>
  );
}
