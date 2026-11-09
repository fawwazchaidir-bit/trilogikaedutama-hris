import "server-only";
import { z } from "zod";
import { Prisma, type ChatMessage, type ChatRoom } from "@prisma/client";
import { prisma, transaction, type Tx } from "../../db";
import { Errors } from "../../errors";
import { parseInput } from "../../validate";
import type { Actor } from "../../actor";
import { writeAudit } from "../../audit";
import { blockedSeconds, recordFailure } from "../../auth/rate-limit";
import { can } from "@/lib/permissions";
import { uuid } from "@/lib/validation/common";
import { formatDateRange, formatDateShort } from "@/lib/format";
import {
  CHAT_LIMITS, CHAT_SUBJECT_TYPES, type ChatMessageDto, type ChatRef, type ChatRefCardDto,
} from "@/lib/chat/types";
import { canEditMessage, dedupeRefs, isUuid, normalizeBody, parseMentions, snippet } from "@/lib/chat/logic";
import { assertChatEnabled, assertUuidOr404, ensureMember, loadPeople, loadRoom, resolveAccess, subjectAccess, type Db, type Who } from "./shared";
import { enqueueChatPush } from "./push";
import { processDeliveries } from "../../notify/deliveries";

/** Pesan obrolan: kirim (idempoten, berurutan), baca delta/riwayat, tandai dibaca, sunting, hapus. Rancangan: docs/OBROLAN.md §7. */

const refSchema = z.object({ type: z.enum(CHAT_SUBJECT_TYPES, { error: "Jenis rujukan tidak valid" }), id: uuid });
export const sendSchema = z.object({
  body: z.string({ error: "Isi pesan wajib diisi" }).max(CHAT_LIMITS.maxBody * 2, `Pesan maksimal ${CHAT_LIMITS.maxBody} karakter`),
  clientMsgId: uuid,
  replyToId: uuid.optional(),
  refs: z.array(refSchema).max(CHAT_LIMITS.maxRefs, `Maksimal ${CHAT_LIMITS.maxRefs} rujukan penugasan`).optional(),
});
export const editSchema = z.object({ body: z.string({ error: "Isi pesan wajib diisi" }).max(CHAT_LIMITS.maxBody * 2, `Pesan maksimal ${CHAT_LIMITS.maxBody} karakter`) });
export const messagesQuery = z.object({
  afterSeq: z.coerce.number().int().min(0).optional(),
  beforeSeq: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(CHAT_LIMITS.pageSize).optional(),
});

function cleanBody(raw: string): string {
  const body = normalizeBody(raw);
  if (!body) throw Errors.validation("Isi pesan wajib diisi.", { body: "Wajib diisi" });
  if (body.length > CHAT_LIMITS.maxBody) throw Errors.validation(`Pesan maksimal ${CHAT_LIMITS.maxBody} karakter.`, { body: "Terlalu panjang" });
  return body;
}

async function takeSendToken(userId: string): Promise<void> {
  const key = `chat:send:${userId}`;
  const wait = await blockedSeconds(key);
  if (wait > 0) throw Errors.rateLimited(`Terlalu banyak pesan. Tunggu ${wait} detik lagi.`);
  await recordFailure(key, { max: CHAT_LIMITS.sendPerMinute, windowMs: 60_000, blockMs: 30_000 });
}

// ─────────────────────────── Rujukan penugasan (diselesaikan per pembaca) ───────────────────────────

/** Pengirim hanya boleh merujuk penugasan yang ia sendiri berhak lihat. */
async function assertRefsVisible(db: Db, who: Who, refs: ChatRef[]): Promise<void> {
  for (const r of refs) {
    const a = await subjectAccess(db, who, r.type, r.id);
    if (!a.canView) throw Errors.validation("Rujukan penugasan tidak ditemukan atau Anda tidak berhak melihatnya.", { refs: "Tidak valid" });
  }
}

const dateId = (d: Date) => d.toISOString().slice(0, 10);

/** Ubah rujukan menjadi kartu untuk SATU pembaca; yang tidak berhak hanya melihat penanda "tidak ada akses". */
export async function resolveRefCards(db: Db, who: Who, refs: ChatRef[]): Promise<ChatRefCardDto[]> {
  const out: ChatRefCardDto[] = [];
  for (const r of refs) {
    const hidden: ChatRefCardDto = { type: r.type, id: r.id, accessible: false, title: null, subtitle: null, href: null };
    const a = await subjectAccess(db, who, r.type, r.id);
    if (!a.canView) { out.push(hidden); continue; }
    if (r.type === "ASSIGNMENT_LETTER") {
      const l = await db.assignmentLetter.findUnique({ where: { id: r.id }, select: { number: true, destination: true, startDate: true, endDate: true, status: true } });
      out.push(l ? { type: r.type, id: r.id, accessible: true, title: `Surat Tugas ${l.number}`, subtitle: `${l.destination} · ${formatDateRange(dateId(l.startDate), dateId(l.endDate))}${l.status === "CANCELLED" ? " · dibatalkan" : ""}`, href: "/surat-tugas" } : hidden);
    } else if (r.type === "TRAINING_PROJECT") {
      const p = await db.trainingProject.findUnique({ where: { id: r.id }, select: { id: true, code: true, name: true } });
      out.push(p ? { type: r.type, id: r.id, accessible: true, title: `${p.code} · ${p.name}`, subtitle: "Proyek Training", href: `/training/proyek/${p.id}` } : hidden);
    } else {
      const t = await db.trainingTask.findUnique({ where: { id: r.id }, select: { title: true, dueDate: true, project: { select: { id: true, code: true } } } });
      out.push(t ? { type: r.type, id: r.id, accessible: true, title: t.title, subtitle: `Tugas · ${t.project.code}${t.dueDate ? ` · tenggat ${formatDateShort(dateId(t.dueDate))}` : ""}`, href: `/training/proyek/${t.project.id}` } : hidden);
    }
  }
  return out;
}

/** Penugasan milik pelaku sendiri yang dapat disisipkan sebagai kartu (Surat Tugas yang menugaskannya + tugas Training miliknya). */
export async function listRefOptions(actor: Actor): Promise<ChatRefCardDto[]> {
  assertChatEnabled();
  const out: ChatRefCardDto[] = [];
  if (actor.employeeId) {
    const letters = await prisma.assignmentLetter.findMany({ where: { status: "ISSUED", assignees: { some: { employeeId: actor.employeeId } } }, orderBy: { startDate: "desc" }, take: 20, select: { id: true } });
    out.push(...(await resolveRefCards(prisma, actor, letters.map((l) => ({ type: "ASSIGNMENT_LETTER" as const, id: l.id })))));
    const tasks = await prisma.trainingTask.findMany({ where: { assigneeId: actor.employeeId, status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] } }, orderBy: { updatedAt: "desc" }, take: 20, select: { id: true } }).catch(() => []);
    out.push(...(await resolveRefCards(prisma, actor, tasks.map((t) => ({ type: "TRAINING_TASK" as const, id: t.id })))));
  }
  return out.filter((c) => c.accessible);
}

// ─────────────────────────── DTO ───────────────────────────

async function toDtos(db: Db, actor: Actor, rows: ChatMessage[]): Promise<ChatMessageDto[]> {
  if (!rows.length) return [];
  const replyIds = [...new Set(rows.map((r) => r.replyToId).filter((x): x is string => !!x))];
  const replies = replyIds.length ? await db.chatMessage.findMany({ where: { id: { in: replyIds } }, select: { id: true, senderId: true, body: true, deletedAt: true, purgedAt: true } }) : [];
  const people = await loadPeople(db, [...rows.map((r) => r.senderId), ...replies.map((r) => r.senderId)]);
  const mine = await db.chatMention.findMany({ where: { userId: actor.userId, messageId: { in: rows.map((r) => r.id) } }, select: { messageId: true } });
  const mentioned = new Set(mine.map((m) => m.messageId));
  const replyBy = new Map(replies.map((r) => [r.id, r]));
  const out: ChatMessageDto[] = [];
  for (const r of rows) {
    const deleted = !!r.deletedAt;
    const purged = !!r.purgedAt;
    const reply = r.replyToId ? replyBy.get(r.replyToId) : undefined;
    const refs = !deleted && !purged && Array.isArray(r.refs) ? await resolveRefCards(db, actor, r.refs as unknown as ChatRef[]) : [];
    out.push({
      id: r.id, seq: Number(r.seq), senderId: r.senderId, senderName: people.get(r.senderId)?.name ?? "—", kind: r.kind,
      body: deleted || purged ? null : r.body, deleted, purged, hiddenByModerator: deleted && !!r.deletedById && r.deletedById !== r.senderId,
      mine: r.senderId === actor.userId, edited: !!r.editedAt, createdAt: r.createdAt.toISOString(),
      replyTo: reply ? { id: reply.id, senderName: people.get(reply.senderId)?.name ?? "—", snippet: reply.deletedAt ? "Pesan dihapus" : reply.body ? snippet(reply.body, 60) : "—" } : null,
      refs, mentionedMe: mentioned.has(r.id),
    });
  }
  return out;
}

/** Direktur membuka japri orang lain: dicatat di Audit Log (tanpa isi pesan), paling banyak sekali per ruang per 24 jam. */
async function auditDirectorRead(actor: Actor, room: ChatRoom): Promise<void> {
  const since = new Date(Date.now() - 24 * 3_600_000);
  const recent = await prisma.auditLog.findFirst({ where: { actorId: actor.userId, action: "chat.direct_audit_read", entityId: room.id, createdAt: { gt: since } }, select: { id: true } });
  if (recent) return;
  const members = await prisma.chatMember.findMany({ where: { roomId: room.id }, select: { userId: true } });
  const people = await loadPeople(prisma, members.map((m) => m.userId));
  await writeAudit(prisma, actor, { action: "chat.direct_audit_read", entityType: "ChatRoom", entityId: room.id, summary: `Direktur membuka japri ${members.map((m) => people.get(m.userId)?.name ?? "—").join(" ↔ ")} untuk pemeriksaan` });
}

export interface MessagePage { items: ChatMessageDto[]; hasMore: boolean; lastSeq: number }

/** Delta (`afterSeq`) atau riwayat ke belakang (`beforeSeq`); tanpa kursor = pesan terbaru. Otorisasi penuh pada setiap pemanggilan. */
export async function listMessages(actor: Actor, roomId: string, raw: unknown = {}): Promise<MessagePage> {
  const q = parseInput(messagesQuery, raw);
  const limit = q.limit ?? CHAT_LIMITS.pageSize;
  const { room, access } = await loadRoom(prisma, actor, roomId);
  if (access.auditView) await auditDirectorRead(actor, room);
  else await ensureMember(prisma, room, actor.userId);
  let rows: ChatMessage[];
  let hasMore = false;
  if (q.afterSeq !== undefined) {
    rows = await prisma.chatMessage.findMany({ where: { roomId, seq: { gt: BigInt(q.afterSeq) } }, orderBy: { seq: "asc" }, take: limit + 1 });
    if (rows.length > limit) { hasMore = true; rows = rows.slice(0, limit); }
  } else {
    rows = await prisma.chatMessage.findMany({ where: { roomId, ...(q.beforeSeq !== undefined ? { seq: { lt: BigInt(q.beforeSeq) } } : {}) }, orderBy: { seq: "desc" }, take: limit + 1 });
    if (rows.length > limit) { hasMore = true; rows = rows.slice(0, limit); }
    rows.reverse();
  }
  return { items: await toDtos(prisma, actor, rows), hasMore, lastSeq: Number(room.lastSeq) };
}

// ─────────────────────────── Kirim ───────────────────────────

async function eligibleMentionIds(tx: Tx, room: ChatRoom, sender: Actor, ids: string[]): Promise<string[]> {
  const cand = ids.filter((id) => id !== sender.userId);
  if (!cand.length) return [];
  const people = [...(await loadPeople(tx, cand)).values()].filter((p) => p.isActive);
  const ok: string[] = [];
  for (const p of people) {
    if (room.kind === "CHANNEL") ok.push(p.userId);
    else if (room.kind === "DIRECT") { if (await tx.chatMember.findUnique({ where: { roomId_userId: { roomId: room.id, userId: p.userId } }, select: { userId: true } })) ok.push(p.userId); }
    else if ((await resolveAccess(tx, p, room)).canRead) ok.push(p.userId);
  }
  return ok;
}

export async function sendMessage(actor: Actor, roomId: string, raw: unknown): Promise<ChatMessageDto> {
  assertChatEnabled();
  const input = parseInput(sendSchema, raw);
  const body = cleanBody(input.body);
  const refs = dedupeRefs((input.refs ?? []) as ChatRef[]);
  const parsed = parseMentions(body);
  if (parsed.userIds.length > CHAT_LIMITS.maxMentions) throw Errors.validation(`Maksimal ${CHAT_LIMITS.maxMentions} sebutan per pesan.`, { body: "Terlalu banyak sebutan" });
  await takeSendToken(actor.userId);

  let pushed = 0;
  const msg = await transaction(async (tx) => {
    const { room } = await loadRoom(tx, actor, roomId, "post");
    if (room.kind === "CHANNEL" && parsed.all && !can(actor.role, "chat:moderate")) throw Errors.forbidden("@semua hanya dapat dipakai moderator di kanal publik.");
    const dup = await tx.chatMessage.findUnique({ where: { roomId_senderId_clientMsgId: { roomId, senderId: actor.userId, clientMsgId: input.clientMsgId } } });
    if (dup) return dup; // kirim ulang setelah jaringan putus → tidak ganda
    if (input.replyToId) {
      const target = await tx.chatMessage.findFirst({ where: { id: input.replyToId, roomId }, select: { id: true } });
      if (!target) throw Errors.validation("Pesan yang dibalas tidak ditemukan.", { replyToId: "Tidak valid" });
    }
    await assertRefsVisible(tx, actor, refs);
    await ensureMember(tx, room, actor.userId);
    // Nomor urut per ruang: baris ruang terkunci sampai commit → tanpa celah dan terlihat berurutan (kursor klien tidak melewatkan pesan).
    const rows = await tx.$queryRaw<{ seq: bigint }[]>`UPDATE chat_rooms SET "lastSeq" = "lastSeq" + 1, "rev" = "rev" + 1, "lastMessageAt" = now() WHERE id = ${roomId}::uuid RETURNING "lastSeq" AS seq`;
    const seq = rows[0]!.seq;
    const created = await tx.chatMessage.create({
      data: { roomId, seq, senderId: actor.userId, body, clientMsgId: input.clientMsgId, replyToId: input.replyToId ?? null, refs: refs.length ? (refs as unknown as Prisma.InputJsonValue) : Prisma.JsonNull },
    });
    const mentionIds = await eligibleMentionIds(tx, room, actor, parsed.userIds);
    if (mentionIds.length) await tx.chatMention.createMany({ data: mentionIds.map((userId) => ({ messageId: created.id, userId, roomId, seq })), skipDuplicates: true });
    await tx.chatMember.update({ where: { roomId_userId: { roomId, userId: actor.userId } }, data: { lastReadSeq: seq, lastActiveAt: new Date() } });
    pushed = await enqueueChatPush(tx, { ...room, lastSeq: seq }, actor, created, { mentionIds, mentionAll: parsed.all });
    return created;
  });
  // Antrean push diproses segera (best-effort); pekerja pengiriman tetap menjadi jaring pengaman.
  if (pushed > 0) void processDeliveries({ limit: 25 }).catch(() => undefined);
  return (await toDtos(prisma, actor, [msg]))[0]!;
}

// ─────────────────────────── Tandai dibaca ───────────────────────────

export async function markRead(actor: Actor, roomId: string, raw: unknown): Promise<void> {
  const { seq } = parseInput(z.object({ seq: z.coerce.number().int().min(0) }), raw);
  const { room, access } = await loadRoom(prisma, actor, roomId);
  if (access.auditView) return; // pembukaan untuk pemeriksaan tidak punya status baca
  await ensureMember(prisma, room, actor.userId);
  // Monoton, dan tidak melebihi nomor urut terakhir ruang.
  await prisma.$executeRaw`UPDATE chat_members SET "lastReadSeq" = GREATEST("lastReadSeq", LEAST(${BigInt(seq)}, ${room.lastSeq})), "lastActiveAt" = now() WHERE "roomId" = ${roomId}::uuid AND "userId" = ${actor.userId}::uuid`;
}

// ─────────────────────────── Sunting & hapus ───────────────────────────

/** Naikkan revisi ruang: bel SSE membangunkan klien walau nomor urut tidak berubah (sunting/hapus/moderasi). */
export async function bumpRev(db: Db, roomId: string): Promise<void> {
  await db.$executeRaw`UPDATE chat_rooms SET "rev" = "rev" + 1 WHERE id = ${roomId}::uuid`;
}

async function loadOwnMessage(db: Db, actor: Actor, messageId: string): Promise<{ msg: ChatMessage; room: ChatRoom }> {
  assertChatEnabled();
  assertUuidOr404(messageId, "Pesan");
  const msg = await db.chatMessage.findUnique({ where: { id: messageId } });
  if (!msg) throw Errors.notFound("Pesan");
  const { room } = await loadRoom(db, actor, msg.roomId, "read"); // tanpa hak baca → 404
  return { msg, room };
}

export async function editMessage(actor: Actor, messageId: string, raw: unknown): Promise<ChatMessageDto> {
  const input = parseInput(editSchema, raw);
  const body = cleanBody(input.body);
  const parsed = parseMentions(body);
  if (parsed.userIds.length > CHAT_LIMITS.maxMentions) throw Errors.validation(`Maksimal ${CHAT_LIMITS.maxMentions} sebutan per pesan.`, { body: "Terlalu banyak sebutan" });
  const updated = await transaction(async (tx) => {
    const { msg, room } = await loadOwnMessage(tx, actor, messageId);
    await loadRoom(tx, actor, room.id, "post"); // masih berhak menulis
    if (msg.senderId !== actor.userId) throw Errors.forbidden("Hanya pengirim yang dapat menyunting pesan.");
    if (!canEditMessage(msg, actor.userId)) throw Errors.conflict(`Pesan hanya dapat disunting ${CHAT_LIMITS.editWindowMinutes} menit setelah dikirim dan sebelum dihapus.`);
    if (msg.body === body) throw Errors.validation("Tidak ada perubahan pada pesan.", { body: "Sama dengan sebelumnya" });
    await tx.chatMessageRevision.create({ data: { messageId, body: msg.body ?? "" } });
    const u = await tx.chatMessage.update({ where: { id: messageId }, data: { body, editedAt: new Date() } });
    await tx.chatMention.deleteMany({ where: { messageId } });
    await bumpRev(tx, room.id);
    const ids = await eligibleMentionIds(tx, room, actor, parsed.userIds);
    if (ids.length) await tx.chatMention.createMany({ data: ids.map((userId) => ({ messageId, userId, roomId: room.id, seq: msg.seq })), skipDuplicates: true });
    return u;
  });
  return (await toDtos(prisma, actor, [updated]))[0]!;
}

/** Hapus pesan sendiri: disembunyikan dari semua pembaca; isi tetap tersimpan sampai retensi (bukti bila ada perselisihan). */
export async function deleteMessage(actor: Actor, messageId: string): Promise<void> {
  await transaction(async (tx) => {
    const { msg } = await loadOwnMessage(tx, actor, messageId);
    if (msg.senderId !== actor.userId) throw Errors.forbidden("Hanya pengirim yang dapat menghapus pesannya. Moderator memakai tindakan moderasi di kanal publik.");
    if (msg.deletedAt) return;
    await tx.chatMessage.update({ where: { id: messageId }, data: { deletedAt: new Date(), deletedById: actor.userId } });
    await bumpRev(tx, msg.roomId);
  });
}

export const isChatId = isUuid;
