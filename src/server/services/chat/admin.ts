import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, transaction } from "../../db";
import { Errors } from "../../errors";
import { parseInput } from "../../validate";
import { assertCan, type Actor } from "../../actor";
import { writeAudit } from "../../audit";
import { optionalText, requiredText } from "@/lib/validation/common";
import { slugify } from "@/lib/chat/logic";
import { notifyUsers, reviewerUserIds } from "../notifications";
import { assertChatEnabled, assertUuidOr404, loadPeople, loadRoom } from "./shared";
import { bumpRev } from "./messages";
import { GENERAL_SLUG } from "./rooms";

/** Pengelolaan kanal publik, moderasi, laporan, dan pemeriksaan japri oleh Direktur. Rancangan: docs/OBROLAN.md §7.5–§7.6. */

export interface ChannelAdminDto { id: string; name: string; slug: string; archived: boolean; members: number; lastMessageAt: string | null }

export async function listChannelsAdmin(actor: Actor): Promise<ChannelAdminDto[]> {
  assertChatEnabled(); assertCan(actor, "chat:moderate");
  const rows = await prisma.chatRoom.findMany({ where: { kind: "CHANNEL" }, include: { _count: { select: { members: true } } }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ id: r.id, name: r.name ?? "", slug: r.slug ?? "", archived: !!r.archivedAt, members: r._count.members, lastMessageAt: r.lastMessageAt?.toISOString() ?? null }));
}

/** Buat kanal publik (HR/Direktur). Semua akun aktif menjadi anggota (mode notifikasi: hanya bila disebut). */
export async function createChannel(actor: Actor, raw: unknown): Promise<{ id: string; slug: string }> {
  assertChatEnabled(); assertCan(actor, "chat:moderate");
  const input = parseInput(z.object({ name: requiredText(3, 40, "Nama kanal") }), raw);
  const slug = slugify(input.name);
  if (slug.length < 3) throw Errors.validation("Nama kanal harus memuat huruf atau angka.", { name: "Tidak valid" });
  return transaction(async (tx) => {
    if (await tx.chatRoom.findUnique({ where: { slug }, select: { id: true } })) throw Errors.validation("Nama kanal sudah dipakai.", { name: "Sudah dipakai" });
    const room = await tx.chatRoom.create({ data: { kind: "CHANNEL", name: input.name, slug, createdById: actor.userId } });
    const users = await tx.user.findMany({ where: { isActive: true }, select: { id: true } });
    await tx.chatMember.createMany({ data: users.map((u) => ({ roomId: room.id, userId: u.id, notifyMode: "MENTIONS" as const })), skipDuplicates: true });
    await writeAudit(tx, actor, { action: "chat.channel_create", entityType: "ChatRoom", entityId: room.id, summary: `Kanal publik "${input.name}" dibuat`, after: { name: input.name, slug } });
    return { id: room.id, slug };
  });
}

export async function setChannelArchived(actor: Actor, roomId: string, raw: unknown): Promise<void> {
  assertChatEnabled(); assertCan(actor, "chat:moderate");
  assertUuidOr404(roomId, "Kanal");
  const { archived } = parseInput(z.object({ archived: z.boolean() }), raw);
  await transaction(async (tx) => {
    const room = await tx.chatRoom.findUnique({ where: { id: roomId } });
    if (!room || room.kind !== "CHANNEL") throw Errors.notFound("Kanal");
    if (room.slug === GENERAL_SLUG) throw Errors.conflict('Kanal bawaan "Umum" tidak dapat diarsipkan.');
    if (!!room.archivedAt === archived) return;
    await tx.chatRoom.update({ where: { id: roomId }, data: { archivedAt: archived ? new Date() : null } });
    await bumpRev(tx, roomId);
    await writeAudit(tx, actor, { action: archived ? "chat.channel_archive" : "chat.channel_restore", entityType: "ChatRoom", entityId: roomId, summary: `Kanal "${room.name}" ${archived ? "diarsipkan" : "dipulihkan"}` });
  });
}

/** Sembunyikan pesan di kanal publik (moderator). Isi tetap tersimpan sampai retensi; Audit Log mencatat pelaku & alasan, TANPA isi pesan. */
export async function moderateMessage(actor: Actor, messageId: string, raw: unknown): Promise<void> {
  assertChatEnabled(); assertCan(actor, "chat:moderate");
  assertUuidOr404(messageId, "Pesan");
  const input = parseInput(z.object({ reason: requiredText(3, 200, "Alasan") }), raw);
  await transaction(async (tx) => {
    const msg = await tx.chatMessage.findUnique({ where: { id: messageId }, include: { room: true } });
    if (!msg || msg.room.kind !== "CHANNEL") throw Errors.notFound("Pesan"); // japri & utas tidak dapat dimoderasi HR
    if (msg.deletedAt) throw Errors.conflict("Pesan ini sudah disembunyikan.");
    await tx.chatMessage.update({ where: { id: messageId }, data: { deletedAt: new Date(), deletedById: actor.userId, deleteReason: input.reason } });
    await bumpRev(tx, msg.roomId);
    await writeAudit(tx, actor, { action: "chat.message_moderate", entityType: "ChatMessage", entityId: messageId, summary: `Pesan di kanal "${msg.room.name}" disembunyikan oleh moderator`, reason: input.reason, after: { roomId: msg.roomId, senderId: msg.senderId } });
  });
}

/** Laporkan pesan di kanal publik / utas penugasan ke HR & Direktur. Japri tidak dapat dilaporkan ke HR (hanya Direktur yang dapat memeriksa). */
export async function reportMessage(actor: Actor, messageId: string, raw: unknown): Promise<void> {
  assertChatEnabled();
  assertUuidOr404(messageId, "Pesan");
  const input = parseInput(z.object({ reason: optionalText(200, "Alasan") }), raw);
  await transaction(async (tx) => {
    const msg = await tx.chatMessage.findUnique({ where: { id: messageId }, select: { id: true, roomId: true, senderId: true } });
    if (!msg) throw Errors.notFound("Pesan");
    const { room } = await loadRoom(tx, actor, msg.roomId, "read");
    if (room.kind === "DIRECT") throw Errors.validation("Pesan japri tidak dapat dilaporkan ke HR.", { messageId: "Tidak berlaku" });
    if (msg.senderId === actor.userId) throw Errors.validation("Anda tidak dapat melaporkan pesan sendiri.", { messageId: "Tidak berlaku" });
    const people = await loadPeople(tx, [msg.senderId]);
    const to = await reviewerUserIds(tx, actor.userId);
    await notifyUsers(tx, to, {
      type: "chat.report", title: "Pesan obrolan dilaporkan",
      body: `${actor.name} melaporkan pesan dari ${people.get(msg.senderId)?.name ?? "—"} di ${room.kind === "CHANNEL" ? `kanal ${room.name}` : "utas penugasan"}${input.reason ? `: ${input.reason}` : ""}`,
      href: `/obrolan?room=${room.id}`,
    });
    await writeAudit(tx, actor, { action: "chat.message_report", entityType: "ChatMessage", entityId: messageId, summary: "Pesan obrolan dilaporkan", reason: input.reason });
  });
}

export interface AuditRoomDto { id: string; participants: string[]; lastMessageAt: string | null; messages: number }

/** Daftar japri milik orang lain untuk pemeriksaan Direktur (`chat:audit_access`). Membuka isi percakapan dicatat di Audit Log oleh `listMessages`. */
export async function listDirectRoomsForAudit(actor: Actor, raw: unknown = {}): Promise<AuditRoomDto[]> {
  assertChatEnabled(); assertCan(actor, "chat:audit_access");
  const { q } = parseInput(z.object({ q: z.string().trim().max(60).optional() }), raw);
  const rooms = await prisma.chatRoom.findMany({ where: { kind: "DIRECT", members: { none: { userId: actor.userId } } }, include: { members: { select: { userId: true } } }, orderBy: [{ lastMessageAt: { sort: "desc", nulls: "last" } }], take: 200 });
  const people = await loadPeople(prisma, rooms.flatMap((r) => r.members.map((m) => m.userId)));
  const out = rooms.filter((r) => r.lastSeq > BigInt(0)).map((r) => ({ id: r.id, participants: r.members.map((m) => people.get(m.userId)?.name ?? "—"), lastMessageAt: r.lastMessageAt?.toISOString() ?? null, messages: Number(r.lastSeq) }));
  const needle = q?.toLowerCase();
  return needle ? out.filter((r) => r.participants.some((n) => n.toLowerCase().includes(needle))) : out;
}

/** Jaring pengaman: setiap akun aktif menjadi anggota semua kanal publik yang belum diarsipkan (idempoten; dipakai pekerja). */
export async function healChannelMembers(): Promise<number> {
  const n = await prisma.$executeRaw(Prisma.sql`
    INSERT INTO chat_members ("roomId", "userId", "lastReadSeq", "notifyMode")
    SELECT r.id, u.id, r."lastSeq", 'MENTIONS'::"ChatNotifyMode" FROM chat_rooms r CROSS JOIN users u
    WHERE r.kind = 'CHANNEL' AND r."archivedAt" IS NULL AND u."isActive"
    ON CONFLICT ("roomId", "userId") DO NOTHING`);
  return Number(n);
}
