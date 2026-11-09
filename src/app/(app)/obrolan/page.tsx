import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requirePageUser } from "@/server/auth/current";
import { chatEnabled } from "@/server/env";
import { can } from "@/lib/permissions";
import { PageHeader } from "@/components/ui/card";
import { ChatApp } from "@/components/chat/chat-app";
import { isUuid } from "@/lib/chat/logic";

export const metadata: Metadata = { title: "Obrolan" };
export const dynamic = "force-dynamic";

export default async function ChatPage({ searchParams }: { searchParams: Promise<{ room?: string }> }) {
  const user = await requirePageUser();
  if (!chatEnabled()) notFound();
  const { room } = await searchParams;
  return (
    <div className="space-y-4">
      <PageHeader title="Obrolan" description="Japri dan kanal publik untuk berkoordinasi. Utas penugasan dibuka dari tombol “Diskusi” pada Surat Tugas dan tugas Training." />
      <ChatApp me={{ userId: user.userId, name: user.name, canModerate: can(user.role, "chat:moderate"), canAudit: can(user.role, "chat:audit_access") }} initialRoomId={room && isUuid(room) ? room : null} />
    </div>
  );
}
