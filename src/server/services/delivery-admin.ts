import "server-only";
import { prisma } from "../db";
import { assertCan, type Actor } from "../actor";
import { writeAudit } from "../audit";
import { emailAvailable, whatsappAvailable } from "../notify/transports";
import { processDeliveries, type ProcessResult } from "../notify/deliveries";

export interface DeliveryStats {
  email: boolean;
  whatsapp: boolean;
  counts: { pending: number; sent: number; failed: number; skipped: number };
  recentFailures: { id: string; channel: "EMAIL" | "WHATSAPP" | "PUSH"; to: string; subject: string | null; attempts: number; lastError: string | null; createdAt: string }[];
}

/** Ringkasan antrean pengiriman email/WhatsApp (Pengaturan, Super Admin). Alamat/nomor tujuan disamarkan. */
export async function getDeliveryStats(actor: Actor): Promise<DeliveryStats> {
  assertCan(actor, "settings:manage");
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [groups, failures] = await Promise.all([
    prisma.notificationDelivery.groupBy({ by: ["status"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.notificationDelivery.findMany({ where: { status: "FAILED" }, orderBy: { id: "desc" }, take: 8 }),
  ]);
  const n = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0;
  return {
    email: emailAvailable(), whatsapp: whatsappAvailable(),
    counts: { pending: n("PENDING"), sent: n("SENT"), failed: n("FAILED"), skipped: n("SKIPPED") },
    recentFailures: failures.map((f) => ({ id: f.id.toString(), channel: f.channel, to: maskAddress(f.toAddress), subject: f.subject, attempts: f.attempts, lastError: f.lastError, createdAt: f.createdAt.toISOString() })),
  };
}

export function maskAddress(a: string): string {
  const at = a.indexOf("@");
  if (at > 0) return `${a.slice(0, Math.min(2, at))}•••${a.slice(at)}`;
  return a.length > 6 ? `${a.slice(0, 4)}•••${a.slice(-3)}` : "•••";
}

/** Proses antrean sekarang (tanpa menunggu pekerja). */
export async function runDeliveriesNow(actor: Actor): Promise<ProcessResult> {
  assertCan(actor, "settings:manage");
  return processDeliveries({ limit: 50 });
}

/** Antrekan ulang pengiriman yang GAGAL (mis. setelah memperbaiki konfigurasi SMTP). */
export async function retryFailedDeliveries(actor: Actor): Promise<{ requeued: number }> {
  assertCan(actor, "settings:manage");
  const r = await prisma.notificationDelivery.updateMany({ where: { status: "FAILED" }, data: { status: "PENDING", attempts: 0, nextAttemptAt: new Date(), lastError: null } });
  await writeAudit(prisma, actor, { action: "delivery.retry_failed", entityType: "NotificationDelivery", summary: `${r.count} pengiriman gagal diantrekan ulang` });
  return { requeued: r.count };
}
