"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { api, errorMessage } from "@/lib/api-client";
import { useToast } from "@/components/ui/toast";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/cn";
import type { NotificationDto } from "@/server/services/notifications";

export function NotificationList({ items, unread }: { items: NotificationDto[]; unread: number }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function markAll() {
    setBusy(true);
    try { await api("/api/notifications/read", { body: {} }); router.refresh(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); }
  }
  async function open(id: string) { await api("/api/notifications/read", { body: { ids: [id] } }).catch(() => undefined); }
  return (
    <div>
      <div className="flex items-center justify-between border-b border-line px-5 py-3 text-sm"><span className="text-muted">{unread} belum dibaca</span><Button size="sm" onClick={markAll} loading={busy} disabled={unread === 0}>Tandai semua dibaca</Button></div>
      <ul className="divide-y divide-line">
        {items.map((n) => {
          const inner = (
            <div className={cn("px-5 py-3 text-sm", !n.read && "bg-brand-50/50")}>
              <p className={cn(!n.read && "font-semibold")}>{n.title}</p>
              {n.body && <p className="text-muted">{n.body}</p>}
              <p className="mt-0.5 text-xs text-muted">{formatDateTime(n.createdAt)}</p>
            </div>
          );
          return <li key={n.id}>{n.href ? <Link href={n.href} onClick={() => void open(n.id)} className="block hover:bg-canvas">{inner}</Link> : inner}</li>;
        })}
      </ul>
    </div>
  );
}
