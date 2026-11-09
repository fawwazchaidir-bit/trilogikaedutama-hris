import "server-only";
import { z } from "zod";
import { Prisma, type ChatRoom } from "@prisma/client";
import { prisma } from "../../db";
import { Errors } from "../../errors";
import { parseInput } from "../../validate";
import type { Actor } from "../../actor";
import { blockedSeconds, recordFailure } from "../../auth/rate-limit";
import { uuid } from "@/lib/validation/common";
import { CHAT_LIMITS, CHAT_NOTIFY_MODES, CHAT_SUBJECT_TYPES, type ChatDirectoryEntry, type ChatRoomDto, type ChatSyncDto } from "@/lib/chat/types";
import { defaultNotifyMode, directKey, snippet, unreadOf } from "@/lib/chat/logic";
import { assertChatEnabled, ensureMember, loadPeople, loadRoom, resolveAccess, subjectAccess, subjectTitles, type Db } from "./shared";

/** Ruang obrolan: daftar, japri, utas penugasan, direktori ringkas, preferensi. Rancangan: docs/OBROLAN.md §4–§7. */

const isUniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
export const GENERAL_SLUG = "umum";

/** Pastikan kanal bawaan "Umum" ada dan akun ini menjadi anggota semua kanal publik (idempoten, aman bila dipanggil bersamaan). */
export async function joinPublicChannels(db: Db, userId: string): Promise<void> {
  let channels = await db.chatRoom.findMany({ where: { kind: "CHANNEL", archivedAt: null }, select: { id: true, kind: true, lastSeq: true } });
  const general = await db.chatRoom.findUnique({ where: { slug: GENERAL_SLUG }, select: { id: true } });
  if (!general) {
    try {
      const made = await db.chatRoom.create({ data: { kind: "CHANNEL", name: "Umum", slug: GENERAL_SLUG, createdById: userId }, select: { id: true, kind: true, lastSeq: true } });
      channels.push(made);
    } catch (e) {
      if (!isUniqueViolation(e)) throw e; // dibuat bersamaan oleh akun lain
      channels = await db.chatRoom.findMany({ where: { kind: "CHANNEL", archivedAt: null }, select: { id: true, kind: true, lastSeq: true } });
    }
  }
  if (!channels.length) return;
  await db.chatMember.createMany({
    data: channels.map((c) => ({ roomId: c.id, userId, lastReadSeq: c.lastSeq, notifyMode: defaultNotifyMode("CHANNEL") })),
    skipDuplicates: true,
  });
}

interface Membership { room: ChatRoom; lastReadSeq: bigint; lastActiveAt: Date | null; notifyMode: (typeof CHAT_NOTIFY_MODES)[number]; mutedUntil: Date | null }

/** Ruang milik pelaku yang MASIH lolos gerbang (utas penugasan dihitung ulang; baris anggota saja tidak cukup). */
export async function accessibleMemberships(db: Db, actor: Actor): Promise<Membership[]> {
  const rows = await db.chatMember.findMany({
    where: { userId: actor.userId, room: { archivedAt: null } },
    select: { lastReadSeq: true, lastActiveAt: true, notifyMode: true, mutedUntil: true, room: true },
  });
  const checked = await Promise.all(rows.map(async (r) => {
    if (r.room.kind !== "SUBJECT") return r;
    const a = await resolveAccess(db, actor, r.room);
    return a.canRead ? r : null;
  }));
  return checked.filter((r): r is NonNullable<typeof r> => r !== null).map((r) => ({ room: r.room, lastReadSeq: r.lastReadSeq, lastActiveAt: r.lastActiveAt, notifyMode: r.notifyMode, mutedUntil: r.mutedUntil }));
}

/** Ringkasan sinkronisasi: nomor urut terakhir & belum dibaca per ruang. Dipakai polling cadangan dan lencana. */
export async function getSync(actor: Actor): Promise<ChatSyncDto> {
  assertChatEnabled();
  await joinPublicChannels(prisma, actor.userId);
  const ms = await accessibleMemberships(prisma, actor);
  const rooms = ms.map((m) => ({ id: m.room.id, lastSeq: Number(m.room.lastSeq), rev: Number(m.room.rev), unread: unreadOf(m.room.lastSeq, m.lastReadSeq) }));
  return { rooms, totalUnread: rooms.reduce((s, r) => s + r.unread, 0) };
}

/** Total belum dibaca (untuk lencana menu). 0 bila fitur mati. */
export async function chatUnreadTotal(actor: Actor): Promise<number> {
  try { return (await getSync(actor)).totalUnread; } catch { return 0; }
}

export async function listRooms(actor: Actor): Promise<ChatRoomDto[]> {
  assertChatEnabled();
  await joinPublicChannels(prisma, actor.userId);
  const ms = await accessibleMemberships(prisma, actor);
  if (!ms.length) return [];
  const roomIds = ms.map((m) => m.room.id);

  // Lawan bicara japri.
  const directIds = ms.filter((m) => m.room.kind === "DIRECT").map((m) => m.room.id);
  const others = directIds.length ? await prisma.chatMember.findMany({ where: { roomId: { in: directIds }, userId: { not: actor.userId } }, select: { roomId: true, userId: true } }) : [];
  const people = await loadPeople(prisma, others.map((o) => o.userId));
  const otherByRoom = new Map(others.map((o) => [o.roomId, o.userId]));
  const titles = await subjectTitles(prisma, ms.filter((m) => m.room.kind === "SUBJECT").map((m) => m.room));

  // Pesan terakhir tiap ruang + sebutan yang belum dibaca (dua kueri untuk semua ruang).
  const last = await prisma.$queryRaw<{ roomId: string; senderId: string; body: string | null; deletedAt: Date | null; purgedAt: Date | null }[]>`
    SELECT DISTINCT ON ("roomId") "roomId", "senderId", "body", "deletedAt", "purgedAt" FROM chat_messages
    WHERE "roomId" IN (${Prisma.join(roomIds.map((id) => Prisma.sql`${id}::uuid`))}) ORDER BY "roomId", "seq" DESC`;
  const mentions = await prisma.$queryRaw<{ roomId: string; n: bigint }[]>`
    SELECT mn."roomId", count(*) AS n FROM chat_mentions mn JOIN chat_members m ON m."roomId" = mn."roomId" AND m."userId" = mn."userId"
    WHERE mn."userId" = ${actor.userId}::uuid AND mn."seq" > m."lastReadSeq" GROUP BY mn."roomId"`;
  const mentionBy = new Map(mentions.map((m) => [m.roomId, Number(m.n)]));
  const senders = await loadPeople(prisma, last.map((l) => l.senderId));
  const lastBy = new Map(last.map((l) => [l.roomId, l]));

  const out: ChatRoomDto[] = [];
  for (const m of ms) {
    const r = m.room;
    const lm = lastBy.get(r.id);
    const preview = lm ? { senderName: lm.senderId === actor.userId ? "Anda" : senders.get(lm.senderId)?.name ?? "—", text: lm.deletedAt ? "Pesan dihapus" : lm.body ? snippet(lm.body, 70) : "Pesan telah dibersihkan" } : null;
    let title = r.name ?? "Obrolan"; let subtitle: string | null = null; let subject: ChatRoomDto["subject"] = null;
    if (r.kind === "DIRECT") { const o = people.get(otherByRoom.get(r.id) ?? ""); title = o?.name ?? "Pengguna"; subtitle = o && !o.isActive ? "Akun nonaktif" : null; }
    if (r.kind === "SUBJECT") { const t = titles.get(r.id); title = t?.title ?? "Utas penugasan"; subtitle = t?.subtitle ?? null; subject = r.subjectType && r.subjectId ? { type: r.subjectType, id: r.subjectId, href: t?.href ?? null } : null; }
    const access = await resolveAccess(prisma, actor, r);
    out.push({
      id: r.id, kind: r.kind, title, subtitle, subject, lastSeq: Number(r.lastSeq), rev: Number(r.rev), lastMessageAt: r.lastMessageAt?.toISOString() ?? null, preview,
      unread: unreadOf(r.lastSeq, m.lastReadSeq), mentionUnread: mentionBy.get(r.id) ?? 0, notifyMode: m.notifyMode, mutedUntil: m.mutedUntil?.toISOString() ?? null,
      canPost: access.canPost, archived: !!r.archivedAt, auditView: false,
    });
  }
  return out.sort((a, b) => (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? "") || a.title.localeCompare(b.title));
}

/** Satu ruang untuk pelaku (termasuk Direktur membuka japri orang lain: `auditView`). */
export async function getRoom(actor: Actor, roomId: string): Promise<ChatRoomDto> {
  const { room, access } = await loadRoom(prisma, actor, roomId);
  if (access.auditView) {
    const members = await prisma.chatMember.findMany({ where: { roomId }, select: { userId: true } });
    const people = await loadPeople(prisma, members.map((m) => m.userId));
    return { id: room.id, kind: room.kind, title: members.map((m) => people.get(m.userId)?.name ?? "—").join(" ↔ "), subtitle: "Japri karyawan (pemeriksaan Direktur)", subject: null, lastSeq: Number(room.lastSeq), rev: Number(room.rev), lastMessageAt: room.lastMessageAt?.toISOString() ?? null, preview: null, unread: 0, mentionUnread: 0, notifyMode: "NONE", mutedUntil: null, canPost: false, archived: !!room.archivedAt, auditView: true };
  }
  const rooms = await listRooms(actor);
  const found = rooms.find((r) => r.id === roomId);
  if (!found) throw Errors.notFound("Ruang obrolan");
  return found;
}

async function takeNewDirectToken(userId: string): Promise<void> {
  const key = `chat:direct:${userId}`;
  const wait = await blockedSeconds(key);
  if (wait > 0) throw Errors.rateLimited(`Terlalu banyak percakapan baru. Coba lagi ${wait} detik lagi.`);
  await recordFailure(key, { max: CHAT_LIMITS.newDirectPerMinute, windowMs: 60_000, blockMs: 60_000 });
}

/** Dapatkan atau buat japri dengan `userId`. Aman terhadap dua orang yang saling memulai bersamaan (kunci unik pasangan). */
export async function getOrCreateDirect(actor: Actor, raw: unknown): Promise<{ id: string; created: boolean }> {
  assertChatEnabled();
  const input = parseInput(z.object({ userId: uuid }), raw);
  if (input.userId === actor.userId) throw Errors.validation("Tidak dapat memulai japri dengan diri sendiri.", { userId: "Tidak valid" });
  const other = await prisma.user.findFirst({ where: { id: input.userId, isActive: true }, select: { id: true } });
  if (!other) throw Errors.notFound("Pengguna");
  const key = directKey(actor.userId, other.id);
  let room = await prisma.chatRoom.findUnique({ where: { directKey: key } });
  let created = false;
  if (!room) {
    await takeNewDirectToken(actor.userId);
    try { room = await prisma.chatRoom.create({ data: { kind: "DIRECT", directKey: key, createdById: actor.userId } }); created = true; }
    catch (e) { if (!isUniqueViolation(e)) throw e; room = await prisma.chatRoom.findUniqueOrThrow({ where: { directKey: key } }); }
  }
  await prisma.chatMember.createMany({ data: [actor.userId, other.id].map((userId) => ({ roomId: room!.id, userId, lastReadSeq: room!.lastSeq, notifyMode: defaultNotifyMode("DIRECT") })), skipDuplicates: true });
  return { id: room.id, created };
}

const subjectSchema = z.object({ type: z.enum(CHAT_SUBJECT_TYPES, { error: "Jenis penugasan tidak valid" }), id: uuid });

/** Pengguna aktif yang berhak atas utas penugasan saat ini (untuk baris anggota awal: lencana & preferensi, BUKAN izin). */
async function subjectParticipants(db: Db, type: z.infer<typeof subjectSchema>["type"], id: string): Promise<string[]> {
  if (type === "ASSIGNMENT_LETTER") {
    const a = await db.assignmentAssignee.findMany({ where: { letterId: id }, select: { employee: { select: { userId: true } } } });
    return a.map((x) => x.employee.userId).filter((u): u is string => !!u);
  }
  let projectId = id;
  const extra: string[] = [];
  if (type === "TRAINING_TASK") {
    const t = await db.trainingTask.findUnique({ where: { id }, select: { projectId: true, assignee: { select: { userId: true } } } });
    if (!t) return [];
    projectId = t.projectId;
    if (t.assignee?.userId) extra.push(t.assignee.userId);
  }
  const m = await db.trainingProjectMember.findMany({ where: { projectId, endedAt: null }, select: { employee: { select: { userId: true } } } });
  return [...extra, ...m.map((x) => x.employee.userId).filter((u): u is string => !!u)];
}

/** Dapatkan atau buat utas untuk satu penugasan, setelah lolos gerbang subjek (tanpa hak lihat → 404). */
export async function getOrCreateSubjectRoom(actor: Actor, raw: unknown): Promise<{ id: string; created: boolean }> {
  assertChatEnabled();
  const input = parseInput(subjectSchema, raw);
  const acc = await subjectAccess(prisma, actor, input.type, input.id);
  if (!acc.canView) throw Errors.notFound("Penugasan");
  let room = await prisma.chatRoom.findUnique({ where: { subjectType_subjectId: { subjectType: input.type, subjectId: input.id } } });
  let created = false;
  if (!room) {
    try { room = await prisma.chatRoom.create({ data: { kind: "SUBJECT", subjectType: input.type, subjectId: input.id, createdById: actor.userId } }); created = true; }
    catch (e) { if (!isUniqueViolation(e)) throw e; room = await prisma.chatRoom.findUniqueOrThrow({ where: { subjectType_subjectId: { subjectType: input.type, subjectId: input.id } } }); }
  }
  const users = [...new Set([actor.userId, ...(await subjectParticipants(prisma, input.type, input.id))])];
  const active = await prisma.user.findMany({ where: { id: { in: users }, isActive: true }, select: { id: true } });
  await prisma.chatMember.createMany({ data: active.map((u) => ({ roomId: room!.id, userId: u.id, lastReadSeq: room!.lastSeq, notifyMode: defaultNotifyMode("SUBJECT") })), skipDuplicates: true });
  return { id: room.id, created };
}

/** Direktori ringkas: nama, jabatan, divisi — tanpa email/telepon/NIK. Hanya akun aktif; pelaku sendiri tidak ikut. */
export async function listDirectory(actor: Actor, raw: unknown = {}): Promise<ChatDirectoryEntry[]> {
  assertChatEnabled();
  const { q } = parseInput(z.object({ q: z.string().trim().max(60).optional() }), raw);
  const rows = await prisma.user.findMany({
    where: { isActive: true, id: { not: actor.userId }, ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}) },
    select: { id: true, name: true, role: true, employee: { select: { position: true, division: { select: { name: true } } } } },
    orderBy: { name: "asc" }, take: 50,
  });
  return rows.map((u) => ({ userId: u.id, name: u.name, position: u.employee?.position ?? (u.role === "SUPER_ADMIN" ? "Direktur" : u.role === "HR_ADMIN" ? "Admin / HR" : null), division: u.employee?.division?.name ?? null }));
}

const prefsSchema = z.object({
  notifyMode: z.enum(CHAT_NOTIFY_MODES).optional(),
  /** ISO waktu; null = hentikan pembisuan. */
  mutedUntil: z.string().datetime().nullable().optional(),
});

/** Preferensi notifikasi per ruang (hanya milik pelaku sendiri). */
export async function updateRoomPrefs(actor: Actor, roomId: string, raw: unknown): Promise<void> {
  const input = parseInput(prefsSchema, raw);
  const { room, access } = await loadRoom(prisma, actor, roomId);
  if (access.auditView) throw Errors.forbidden("Pembukaan japri untuk pemeriksaan bersifat baca-saja.");
  await ensureMember(prisma, room, actor.userId);
  await prisma.chatMember.update({
    where: { roomId_userId: { roomId, userId: actor.userId } },
    data: { ...(input.notifyMode ? { notifyMode: input.notifyMode } : {}), ...(input.mutedUntil !== undefined ? { mutedUntil: input.mutedUntil ? new Date(input.mutedUntil) : null } : {}) },
  });
}
