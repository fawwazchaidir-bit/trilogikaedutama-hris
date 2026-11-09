import "server-only";
import type { ChatMessage, ChatRoom } from "@prisma/client";
import type { Tx } from "../../db";
import type { Actor } from "../../actor";
import { pushAvailable } from "../../notify/transports";
import { shouldPush } from "@/lib/chat/logic";
import { loadPeople, resolveAccess } from "./shared";

/**
 * Push obrolan: HANYA push desktop (langganan perangkat yang sengaja diaktifkan) — tidak ada email/WhatsApp, dan tidak ada baris
 * Notification per pesan (pipeline notifikasi umum akan membanjiri). Isi pesan tidak ditampilkan di notifikasi (layar terkunci/komputer bersama).
 * Dipanggil DI DALAM transaksi pengiriman pesan: bila transaksi gagal, tidak ada push yang terkirim.
 * Mengembalikan jumlah baris antrean yang dibuat.
 */
export async function enqueueChatPush(tx: Tx, room: ChatRoom, sender: Actor, msg: ChatMessage, opts: { mentionIds: string[]; mentionAll: boolean }): Promise<number> {
  if (!pushAvailable()) return 0;
  const members = await tx.chatMember.findMany({ where: { roomId: room.id, userId: { not: sender.userId } } });
  if (!members.length) return 0;
  const people = await loadPeople(tx, members.map((m) => m.userId));
  const now = new Date();
  const mentioned = new Set(opts.mentionIds);
  const recipients: { userId: string; mentioned: boolean }[] = [];
  for (const m of members) {
    const p = people.get(m.userId);
    if (!p?.isActive) continue;
    const isMentioned = mentioned.has(m.userId) || (opts.mentionAll && room.kind !== "DIRECT");
    if (!shouldPush({ roomKind: room.kind, notifyMode: m.notifyMode, mutedUntil: m.mutedUntil, lastActiveAt: m.lastActiveAt, lastPushAt: m.lastPushAt, mentioned: isMentioned }, now)) continue;
    // Utas penugasan: izin dihitung ulang — anggota yang sudah dikeluarkan dari proyek/surat tidak diberi tahu.
    if (room.kind === "SUBJECT" && !(await resolveAccess(tx, p, room)).canRead) continue;
    recipients.push({ userId: m.userId, mentioned: isMentioned });
  }
  if (!recipients.length) return 0;
  const subs = await tx.pushSubscription.findMany({ where: { userId: { in: recipients.map((r) => r.userId) } }, select: { userId: true, endpoint: true } });
  if (!subs.length) return 0;
  const mentionedUsers = new Set(recipients.filter((r) => r.mentioned).map((r) => r.userId));
  const where = room.kind === "DIRECT" ? "Japri" : room.kind === "CHANNEL" ? `#${room.name ?? "kanal"}` : "Utas penugasan";
  const data = subs.map((s) => ({
    userId: s.userId, channel: "PUSH" as const, toAddress: s.endpoint,
    subject: `Pesan baru dari ${sender.name}`, body: mentionedUsers.has(s.userId) ? `${where} · Anda disebut` : where,
    href: `/obrolan?room=${room.id}`, tag: `chat-${room.id}`,
  }));
  await tx.notificationDelivery.createMany({ data });
  await tx.chatMember.updateMany({ where: { roomId: room.id, userId: { in: [...new Set(subs.map((s) => s.userId))] } }, data: { lastPushAt: now } });
  void msg;
  return data.length;
}
