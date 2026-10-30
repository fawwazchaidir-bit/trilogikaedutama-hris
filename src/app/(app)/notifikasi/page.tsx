import type { Metadata } from "next";
import { requirePageUser } from "@/server/auth/current";
import { listNotifications } from "@/server/services/notifications";
import { Card, EmptyState, PageHeader } from "@/components/ui/card";
import { NotificationList } from "@/components/notification-list";

export const metadata: Metadata = { title: "Notifikasi" };
export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requirePageUser();
  const { items, unread } = await listNotifications(user, 50);
  return (
    <div>
      <PageHeader title="Notifikasi" description="Pengajuan baru, keputusan pengajuan, dan slip gaji yang terbit." />
      <Card>{items.length === 0 ? <EmptyState title="Belum ada notifikasi" /> : <NotificationList items={items} unread={unread} />}</Card>
    </div>
  );
}
