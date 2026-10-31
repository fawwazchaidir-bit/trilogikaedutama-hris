import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { Actor } from "../actor";
import { queueDeliveries } from "../notify/deliveries";

export interface NotificationDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  href: string | null;
  createdAt: string;
  read: boolean;
}

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Buat notifikasi dalam aplikasi untuk banyak pengguna (dipanggil dalam transaksi yang sama dengan peristiwanya) dan
 * antrekan pengiriman email/WhatsApp (outbox) bagi pengguna yang memilihnya. Notifikasi dalam aplikasi SELALU dibuat.
 */
export async function notifyUsers(
  db: Db,
  userIds: string[],
  n: { type: string; title: string; body?: string | null; href?: string | null },
): Promise<void> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return;
  const rows = await db.notification.createManyAndReturn({
    data: ids.map((userId) => ({ userId, type: n.type, title: n.title, body: n.body ?? null, href: n.href ?? null })),
    select: { id: true, userId: true, title: true, body: true, href: true },
  });
  await queueDeliveries(db, rows);
}

/** Semua pengguna aktif yang berhak meninjau pengajuan (HR & Super Admin), kecuali `exceptUserId`. */
export async function reviewerUserIds(db: Db, exceptUserId?: string): Promise<string[]> {
  const rows = await db.user.findMany({
    where: { isActive: true, role: { in: ["HR_ADMIN", "SUPER_ADMIN"] }, ...(exceptUserId ? { id: { not: exceptUserId } } : {}) },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function superAdminUserIds(db: Db, exceptUserId?: string): Promise<string[]> {
  const rows = await db.user.findMany({
    where: { isActive: true, role: "SUPER_ADMIN", ...(exceptUserId ? { id: { not: exceptUserId } } : {}) },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function listNotifications(actor: Actor, limit = 30): Promise<{ items: NotificationDto[]; unread: number }> {
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId: actor.userId }, orderBy: { id: "desc" }, take: limit }),
    prisma.notification.count({ where: { userId: actor.userId, readAt: null } }),
  ]);
  return {
    items: rows.map((r) => ({ id: r.id.toString(), type: r.type, title: r.title, body: r.body, href: r.href, createdAt: r.createdAt.toISOString(), read: r.readAt !== null })),
    unread,
  };
}

export async function unreadCount(actor: Actor): Promise<number> {
  return prisma.notification.count({ where: { userId: actor.userId, readAt: null } });
}

/** Tandai dibaca — hanya milik pelaku sendiri (filter userId), `ids` kosong = semua. */
export async function markRead(actor: Actor, ids?: string[]): Promise<void> {
  await prisma.notification.updateMany({
    where: { userId: actor.userId, readAt: null, ...(ids?.length ? { id: { in: ids.map((i) => BigInt(i)) } } : {}) },
    data: { readAt: new Date() },
  });
}
