/**
 * Obrolan internal: japri, kanal publik, utas penugasan. Fokus pada yang paling berisiko jika salah: siapa boleh membaca/menulis di ruang mana
 * (anti-IDOR, 404 bukan 403), nomor urut tanpa celah, idempotensi, push yang tidak membanjiri, privasi japri (hanya Direktur, tercatat),
 * serta retensi & penjaga basis data.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import type { Actor } from "@/server/actor";
import { isoToDate } from "@/server/json";
import { addDays, todayIso } from "@/lib/time";
import { b64u, generateVapidKeys } from "@/lib/webpush";
import { resetDb, makeEmployee, makeUser } from "../helpers/db";
import { addTeam, mkProject, seedTraining, type TrainingFixtures } from "../helpers/training";
import { setTransportsForTest } from "@/server/notify/transports";
import { processDeliveries } from "@/server/notify/deliveries";
import { createAssignment, cancelAssignment } from "@/server/services/assignments";
import { endMember, listMembers } from "@/server/services/training/projects";
import { createTask } from "@/server/services/training/work";
import { getOrCreateDirect, getOrCreateSubjectRoom, getRoom, getSync, listDirectory, listRooms, updateRoomPrefs } from "@/server/services/chat/rooms";
import { deleteMessage, editMessage, listMessages, listRefOptions, markRead, sendMessage } from "@/server/services/chat/messages";
import { createChannel, healChannelMembers, listDirectRoomsForAudit, moderateMessage, reportMessage, setChannelArchived } from "@/server/services/chat/admin";
import { purgeExpiredMessages } from "@/server/services/chat/retention";
import { CHAT_LIMITS } from "@/lib/chat/types";

const vapid = generateVapidKeys();
process.env.WEB_PUSH_PUBLIC_KEY = vapid.publicKey;
process.env.WEB_PUSH_PRIVATE_KEY = vapid.privateKey;
process.env.WEB_PUSH_SUBJECT = "mailto:admin@trilogika.test";

let fx: TrainingFixtures;
const pushes: { endpoint: string; title: string; body: string; href: string; tag?: string }[] = [];
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const NOT_FOUND = { code: "NOT_FOUND" };
const FORBIDDEN = { code: "FORBIDDEN" };
const VALIDATION = { code: "VALIDATION" };
const say = (a: Actor, roomId: string, body: string, extra: Record<string, unknown> = {}) => sendMessage(a, roomId, { body, clientMsgId: randomUUID(), ...extra });
const dm = async (a: Actor, b: Actor) => (await getOrCreateDirect(a, { userId: b.userId })).id;
const general = async (a: Actor) => (await listRooms(a)).find((r) => r.kind === "CHANNEL" && r.title === "Umum")!.id;
const subscribe = (a: Actor, n = 1) => {
  const k = generateVapidKeys();
  return prisma.pushSubscription.create({ data: { userId: a.userId, endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}-${a.userId}-${"x".repeat(20)}`, p256dh: k.publicKey, auth: b64u.enc(Buffer.alloc(16, 5)) } });
};
/** JSON.stringify yang tahan BigInt (nomor urut/ID notifikasi). */
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));

beforeEach(async () => {
  await resetDb();
  fx = await seedTraining();
  pushes.length = 0;
  setTransportsForTest({ push: async (t, m) => { pushes.push({ endpoint: t.endpoint, ...m }); } });
});
afterEach(() => { setTransportsForTest(null); vi.useRealTimers(); });

describe("direktori ringkas", () => {
  it("hanya nama, jabatan, divisi; tanpa diri sendiri dan akun nonaktif; dapat dicari", async () => {
    const all = await listDirectory(fx.emp1);
    expect(all.find((e) => e.userId === fx.emp1.userId)).toBeUndefined();
    expect(Object.keys(all[0]!).sort()).toEqual(["division", "name", "position", "userId"]);
    expect(JSON.stringify(all)).not.toContain("@uji.test");
    await prisma.user.update({ where: { id: fx.loner.userId }, data: { isActive: false } });
    expect((await listDirectory(fx.emp1)).some((e) => e.userId === fx.loner.userId)).toBe(false);
    const q = await listDirectory(fx.emp1, { q: "maya" });
    expect(q.map((e) => e.name)).toEqual(["Maya Manajer"]);
  });
});

describe("japri", () => {
  it("satu japri per pasangan — urutan tidak berpengaruh, dan dua orang yang memulai bersamaan tetap satu ruang", async () => {
    const [a, b] = await Promise.all([getOrCreateDirect(fx.emp1, { userId: fx.emp2.userId }), getOrCreateDirect(fx.emp2, { userId: fx.emp1.userId })]);
    expect(a.id).toBe(b.id);
    expect(await prisma.chatRoom.count({ where: { kind: "DIRECT" } })).toBe(1);
    expect(await prisma.chatMember.count({ where: { roomId: a.id } })).toBe(2);
    expect((await getOrCreateDirect(fx.emp1, { userId: fx.emp2.userId })).created).toBe(false);
  });

  it("tidak dapat japri dengan diri sendiri, akun nonaktif, atau ID acak", async () => {
    expect(await fail(getOrCreateDirect(fx.emp1, { userId: fx.emp1.userId }))).toMatchObject(VALIDATION);
    await prisma.user.update({ where: { id: fx.loner.userId }, data: { isActive: false } });
    expect(await fail(getOrCreateDirect(fx.emp1, { userId: fx.loner.userId }))).toMatchObject(NOT_FOUND);
    expect(await fail(getOrCreateDirect(fx.emp1, { userId: randomUUID() }))).toMatchObject(NOT_FOUND);
    expect(await fail(getOrCreateDirect(fx.emp1, { userId: "bukan-uuid" }))).toMatchObject(VALIDATION);
  });

  it("pihak ketiga — termasuk HR — tidak dapat membaca, menulis, atau menandai dibaca (404, keberadaan tidak bocor)", async () => {
    const room = await dm(fx.emp1, fx.emp2);
    await say(fx.emp1, room, "Rahasia berdua");
    for (const outsider of [fx.emp3, fx.hr, fx.mgr]) {
      expect(await fail(listMessages(outsider, room))).toMatchObject(NOT_FOUND);
      expect(await fail(say(outsider, room, "menyusup"))).toMatchObject(NOT_FOUND);
      expect(await fail(markRead(outsider, room, { seq: 1 }))).toMatchObject(NOT_FOUND);
      expect(await fail(getRoom(outsider, room))).toMatchObject(NOT_FOUND);
      expect((await listRooms(outsider)).some((r) => r.id === room)).toBe(false);
    }
  });

  it("Direktur boleh membaca japri orang lain (baca-saja), setiap pembukaan dicatat di Audit Log tanpa isi pesan — sekali per ruang per 24 jam", async () => {
    const room = await dm(fx.emp1, fx.emp2);
    await say(fx.emp1, room, "Isi pribadi yang tidak boleh masuk audit");
    const page = await listMessages(fx.superAdmin, room);
    expect(page.items.map((m) => m.body)).toEqual(["Isi pribadi yang tidak boleh masuk audit"]);
    expect(await fail(say(fx.superAdmin, room, "Direktur menulis"))).toMatchObject(FORBIDDEN);
    expect((await getRoom(fx.superAdmin, room)).auditView).toBe(true);
    await listMessages(fx.superAdmin, room);
    const rows = await prisma.auditLog.findMany({ where: { action: "chat.direct_audit_read" } });
    expect(rows).toHaveLength(1);
    expect(json(rows)).not.toContain("Isi pribadi");
    expect(rows[0]!.actorId).toBe(fx.superAdmin.userId);
    // Direktur membuka japri tidak mengubah status baca siapa pun & tidak membuat dirinya anggota.
    expect(await prisma.chatMember.count({ where: { roomId: room, userId: fx.superAdmin.userId } })).toBe(0);
  });

  it("daftar japri untuk pemeriksaan hanya untuk Direktur", async () => {
    const room = await dm(fx.emp1, fx.emp2);
    await say(fx.emp1, room, "halo");
    expect((await listDirectRoomsForAudit(fx.superAdmin)).map((r) => r.id)).toEqual([room]);
    expect((await listDirectRoomsForAudit(fx.superAdmin, { q: "ayu" })).length).toBe(1);
    expect((await listDirectRoomsForAudit(fx.superAdmin, { q: "zzz" })).length).toBe(0);
    expect(await fail(listDirectRoomsForAudit(fx.hr))).toMatchObject(FORBIDDEN);
    expect(await fail(listDirectRoomsForAudit(fx.emp1))).toMatchObject(FORBIDDEN);
  });

  it("lawan bicara yang dinonaktifkan: riwayat tetap terbaca, menulis ditolak (403)", async () => {
    const room = await dm(fx.emp1, fx.emp2);
    await say(fx.emp1, room, "sebelum nonaktif");
    await prisma.user.update({ where: { id: fx.emp2.userId }, data: { isActive: false } });
    expect((await listMessages(fx.emp1, room)).items).toHaveLength(1);
    expect(await fail(say(fx.emp1, room, "masih ada?"))).toMatchObject(FORBIDDEN);
    expect((await listRooms(fx.emp1)).find((r) => r.id === room)).toMatchObject({ canPost: false, subtitle: "Akun nonaktif" });
  });
});

describe("kirim, urutan, dan belum dibaca", () => {
  it("nomor urut tanpa celah di bawah kiriman paralel; tiap pesan unik", async () => {
    const room = await dm(fx.emp1, fx.emp2);
    await Promise.all(Array.from({ length: 12 }, (_, i) => say(i % 2 ? fx.emp1 : fx.emp2, room, `pesan ${i}`)));
    const seqs = (await prisma.chatMessage.findMany({ where: { roomId: room }, orderBy: { seq: "asc" } })).map((m) => Number(m.seq));
    expect(seqs).toEqual(Array.from({ length: 12 }, (_, i) => i + 1));
    expect(Number((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room } })).lastSeq)).toBe(12);
  });

  it("idempoten: kirim ulang dengan clientMsgId yang sama tidak menggandakan pesan", async () => {
    const room = await dm(fx.emp1, fx.emp2);
    const id = randomUUID();
    const a = await sendMessage(fx.emp1, room, { body: "sekali saja", clientMsgId: id });
    const b = await sendMessage(fx.emp1, room, { body: "sekali saja", clientMsgId: id });
    expect(b.id).toBe(a.id);
    expect(await prisma.chatMessage.count({ where: { roomId: room } })).toBe(1);
  });

  it("belum dibaca dihitung dari selisih nomor urut; tandai dibaca monoton dan tidak melebihi nomor terakhir", async () => {
    const room = await dm(fx.emp1, fx.emp2);
    for (let i = 0; i < 3; i++) await say(fx.emp1, room, `p${i}`);
    expect((await listRooms(fx.emp2)).find((r) => r.id === room)).toMatchObject({ unread: 3, lastSeq: 3 });
    expect((await listRooms(fx.emp1)).find((r) => r.id === room)!.unread).toBe(0); // pengirim otomatis sudah membaca
    await markRead(fx.emp2, room, { seq: 2 });
    expect((await listRooms(fx.emp2)).find((r) => r.id === room)!.unread).toBe(1);
    await markRead(fx.emp2, room, { seq: 1 }); // tidak mundur
    expect((await listRooms(fx.emp2)).find((r) => r.id === room)!.unread).toBe(1);
    await markRead(fx.emp2, room, { seq: 999 }); // dibatasi ke nomor terakhir
    expect((await getSync(fx.emp2)).totalUnread).toBe(0);
  });

  it("delta (afterSeq) dan riwayat ke belakang (beforeSeq) berurutan, dengan penanda hasMore", async () => {
    const room = await dm(fx.emp1, fx.emp2);
    for (let i = 1; i <= 7; i++) await say(fx.emp1, room, `p${i}`);
    expect((await listMessages(fx.emp2, room, { afterSeq: 4 })).items.map((m) => m.seq)).toEqual([5, 6, 7]);
    const newest = await listMessages(fx.emp2, room, { limit: 3 });
    expect(newest.items.map((m) => m.seq)).toEqual([5, 6, 7]);
    expect(newest.hasMore).toBe(true);
    const older = await listMessages(fx.emp2, room, { beforeSeq: 5, limit: 3 });
    expect(older.items.map((m) => m.seq)).toEqual([2, 3, 4]);
    expect((await listMessages(fx.emp2, room, { beforeSeq: 2, limit: 3 })).hasMore).toBe(false);
  });

  it("isi dirapikan; kosong atau terlalu panjang ditolak; HTML tidak diubah (ditampilkan sebagai teks)", async () => {
    const room = await dm(fx.emp1, fx.emp2);
    expect(await fail(say(fx.emp1, room, "   \n  "))).toMatchObject(VALIDATION);
    expect(await fail(say(fx.emp1, room, "x".repeat(CHAT_LIMITS.maxBody + 1)))).toMatchObject(VALIDATION);
    const m = await say(fx.emp1, room, "  <img src=x onerror=alert(1)>‮  ");
    expect(m.body).toBe("<img src=x onerror=alert(1)>");
    expect(await fail(sendMessage(fx.emp1, room, { body: "x", clientMsgId: "bukan-uuid" }))).toMatchObject(VALIDATION);
  });

  it("pembatas laju: lewat batas per menit → 429", async () => {
    const room = await dm(fx.emp1, fx.emp2);
    for (let i = 0; i < CHAT_LIMITS.sendPerMinute; i++) await say(fx.emp1, room, `p${i}`);
    expect(await fail(say(fx.emp1, room, "kelebihan"))).toMatchObject({ code: "RATE_LIMITED" });
  });

  it("balasan hanya ke pesan di ruang yang sama", async () => {
    const r1 = await dm(fx.emp1, fx.emp2);
    const r2 = await dm(fx.emp1, fx.emp3);
    const m = await say(fx.emp1, r1, "asal");
    expect(await fail(say(fx.emp1, r2, "balas silang", { replyToId: m.id }))).toMatchObject(VALIDATION);
    const ok = await say(fx.emp2, r1, "balasan", { replyToId: m.id });
    expect(ok.replyTo).toMatchObject({ id: m.id, snippet: "asal" });
  });
});

describe("kanal publik", () => {
  it("kanal Umum dibuat otomatis dan semua akun aktif ikut; akun baru ikut saat pertama membuka", async () => {
    const room = await general(fx.emp1);
    await say(fx.emp1, room, "Selamat pagi semua");
    for (const a of [fx.emp2, fx.hr, fx.loner]) expect((await listMessages(a, room)).items).toHaveLength(1);
    const late = await makeUser("baru@uji.test", "Karyawan Baru", "EMPLOYEE", (await makeEmployee({ employeeNo: "TE-900", fullName: "Karyawan Baru" })).id);
    expect((await listRooms(late)).some((r) => r.title === "Umum")).toBe(true);
    expect((await listRooms(late)).find((r) => r.title === "Umum")!.unread).toBe(0); // tanpa tumpukan lencana lama
  });

  it("HR membuat kanal baru (semua akun aktif jadi anggota); karyawan biasa tidak boleh membuat atau mengarsipkan", async () => {
    expect(await fail(createChannel(fx.emp1, { name: "Operasional" }))).toMatchObject(FORBIDDEN);
    const c = await createChannel(fx.hr, { name: "Operasional Lapangan" });
    expect(c.slug).toBe("operasional-lapangan");
    expect(await prisma.chatMember.count({ where: { roomId: c.id } })).toBe(await prisma.user.count({ where: { isActive: true } }));
    expect(await fail(createChannel(fx.hr, { name: "Operasional Lapangan" }))).toMatchObject(VALIDATION);
    expect(await fail(setChannelArchived(fx.emp1, c.id, { archived: true }))).toMatchObject(FORBIDDEN);
    await setChannelArchived(fx.hr, c.id, { archived: true });
    expect(await fail(say(fx.emp1, c.id, "masih bisa?"))).toMatchObject(FORBIDDEN);
    expect((await listMessages(fx.emp1, c.id)).items).toEqual([]); // arsip tetap terbaca
    const umum = await general(fx.emp1);
    expect(await fail(setChannelArchived(fx.hr, umum, { archived: true }))).toMatchObject({ code: "CONFLICT" });
  });

  it("moderator menyembunyikan pesan di kanal: Audit Log mencatat pelaku & alasan tanpa isi; karyawan biasa dan japri tidak dapat dimoderasi", async () => {
    const room = await general(fx.emp1);
    const bad = await say(fx.emp2, room, "Kata-kata kasar yang dilaporkan");
    expect(await fail(moderateMessage(fx.emp1, bad.id, { reason: "tidak pantas" }))).toMatchObject(FORBIDDEN);
    await moderateMessage(fx.hr, bad.id, { reason: "Kata kasar" });
    const seen = (await listMessages(fx.emp3, room)).items[0]!;
    expect(seen).toMatchObject({ deleted: true, body: null, hiddenByModerator: true });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "chat.message_moderate" } });
    expect(audit.reason).toBe("Kata kasar");
    expect(json(audit)).not.toContain("kasar yang dilaporkan");
    const p = await dm(fx.emp1, fx.emp2);
    const secret = await say(fx.emp1, p, "japri");
    expect(await fail(moderateMessage(fx.hr, secret.id, { reason: "coba" }))).toMatchObject(NOT_FOUND);
    expect(await fail(moderateMessage(fx.superAdmin, secret.id, { reason: "coba" }))).toMatchObject(NOT_FOUND);
  });

  it("laporan: kanal dan utas dapat dilaporkan ke HR/Direktur; japri tidak; pesan sendiri tidak", async () => {
    const room = await general(fx.emp1);
    const m = await say(fx.emp2, room, "laporkan ini");
    expect(await fail(reportMessage(fx.emp2, m.id, {}))).toMatchObject(VALIDATION);
    await reportMessage(fx.emp1, m.id, { reason: "spam" });
    const n = await prisma.notification.findMany({ where: { type: "chat.report" } });
    expect(n.map((x) => x.userId).sort()).toEqual([fx.hr.userId, fx.superAdmin.userId].sort());
    expect(json(n)).not.toContain("laporkan ini");
    const p = await dm(fx.emp1, fx.emp2);
    const secret = await say(fx.emp2, p, "japri");
    expect(await fail(reportMessage(fx.emp1, secret.id, {}))).toMatchObject(VALIDATION);
  });

  it("@semua hanya untuk moderator di kanal publik; pemulih keanggotaan idempoten", async () => {
    const room = await general(fx.emp1);
    expect(await fail(say(fx.emp1, room, "@semua rapat jam 9"))).toMatchObject(FORBIDDEN);
    await say(fx.hr, room, "@semua rapat jam 9");
    await prisma.chatMember.deleteMany({ where: { userId: fx.emp3.userId } });
    expect(await healChannelMembers()).toBeGreaterThanOrEqual(1);
    expect(await healChannelMembers()).toBe(0);
  });
});

describe("sebutan", () => {
  it("token @[Nama](uuid) menghasilkan sebutan hanya untuk yang berhak di ruang itu; menghitung sebutan belum dibaca", async () => {
    const room = await dm(fx.emp1, fx.emp2);
    const m = await say(fx.emp1, room, `Tolong cek @[Budi](${fx.emp2.userId}) dan @[Orang Luar](${fx.emp3.userId})`);
    const rows = await prisma.chatMention.findMany({ where: { messageId: m.id } });
    expect(rows.map((r) => r.userId)).toEqual([fx.emp2.userId]); // emp3 bukan peserta japri
    expect((await listRooms(fx.emp2)).find((r) => r.id === room)!.mentionUnread).toBe(1);
    expect((await listMessages(fx.emp2, room)).items[0]!.mentionedMe).toBe(true);
    await markRead(fx.emp2, room, { seq: 1 });
    expect((await listRooms(fx.emp2)).find((r) => r.id === room)!.mentionUnread).toBe(0);
  });

  it("lebih dari 10 sebutan ditolak", async () => {
    const room = await general(fx.emp1);
    const many = Array.from({ length: 11 }, () => `@[A](${randomUUID()})`).join(" ");
    expect(await fail(say(fx.emp1, room, many))).toMatchObject(VALIDATION);
  });
});

describe("sunting dan hapus", () => {
  it("sunting dalam 15 menit menyimpan revisi; setelah itu ditolak; bukan pengirim ditolak", async () => {
    const room = await dm(fx.emp1, fx.emp2);
    const m = await say(fx.emp1, room, "versi satu");
    expect(await fail(editMessage(fx.emp2, m.id, { body: "dibajak" }))).toMatchObject(FORBIDDEN);
    const e = await editMessage(fx.emp1, m.id, { body: "versi dua" });
    expect(e).toMatchObject({ body: "versi dua", edited: true });
    expect((await prisma.chatMessageRevision.findMany({ where: { messageId: m.id } })).map((r) => r.body)).toEqual(["versi satu"]);
    expect(await fail(editMessage(fx.emp1, m.id, { body: "versi dua" }))).toMatchObject(VALIDATION);
    expect(Number((await prisma.chatRoom.findUniqueOrThrow({ where: { id: room } })).rev)).toBeGreaterThan(1); // bel SSE berbunyi
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.now() + (CHAT_LIMITS.editWindowMinutes + 1) * 60_000);
    expect(await fail(editMessage(fx.emp1, m.id, { body: "terlambat" }))).toMatchObject({ code: "CONFLICT" });
  });

  it("hapus oleh pengirim menyembunyikan isi dari semua pembaca; orang lain tidak dapat menghapus pesan orang", async () => {
    const room = await dm(fx.emp1, fx.emp2);
    const m = await say(fx.emp1, room, "akan dihapus");
    expect(await fail(deleteMessage(fx.emp2, m.id))).toMatchObject(FORBIDDEN);
    await deleteMessage(fx.emp1, m.id);
    expect((await listMessages(fx.emp2, room)).items[0]).toMatchObject({ deleted: true, body: null });
    expect(await fail(editMessage(fx.emp1, m.id, { body: "hidup lagi" }))).toBeTruthy();
    expect((await prisma.chatMessage.findUniqueOrThrow({ where: { id: m.id } })).body).toBe("akan dihapus"); // tetap tersimpan sampai retensi
  });

  it("pihak luar tidak dapat menyunting/menghapus lewat ID pesan (404)", async () => {
    const room = await dm(fx.emp1, fx.emp2);
    const m = await say(fx.emp1, room, "milik berdua");
    expect(await fail(editMessage(fx.emp3, m.id, { body: "x" }))).toMatchObject(NOT_FOUND);
    expect(await fail(deleteMessage(fx.emp3, m.id))).toMatchObject(NOT_FOUND);
    expect(await fail(deleteMessage(fx.emp3, "bukan-uuid"))).toMatchObject(NOT_FOUND);
  });
});

describe("utas penugasan — Surat Tugas", () => {
  const D = () => addDays(todayIso("Asia/Jakarta"), 3);
  const letter = async (who: number[]) => (await createAssignment(fx.hr, { purpose: "Pendampingan uji", destination: "Surakarta", startDate: D(), endDate: D(), assignees: who.map((i) => ({ employeeId: fx.empIds[i]!, dailyRate: 300_000 })) })).id;

  it("penerima tugas dan HR dapat membuka utas; karyawan lain 404 di semua pintu", async () => {
    const id = await letter([0, 1]);
    const room = (await getOrCreateSubjectRoom(fx.emp1, { type: "ASSIGNMENT_LETTER", id })).id;
    expect(await fail(getOrCreateSubjectRoom(fx.emp3, { type: "ASSIGNMENT_LETTER", id }))).toMatchObject(NOT_FOUND);
    expect((await getOrCreateSubjectRoom(fx.emp2, { type: "ASSIGNMENT_LETTER", id })).id).toBe(room); // satu utas per penugasan
    await say(fx.emp1, room, "Berangkat jam berapa?");
    await say(fx.emp2, room, "Jam 7 dari kantor");
    expect((await listMessages(fx.hr, room)).items).toHaveLength(2);
    expect(await fail(listMessages(fx.emp3, room))).toMatchObject(NOT_FOUND);
    expect(await fail(say(fx.emp3, room, "menyusup"))).toMatchObject(NOT_FOUND);
    expect((await listRooms(fx.emp3)).some((r) => r.id === room)).toBe(false);
    expect((await listRooms(fx.emp1)).find((r) => r.id === room)).toMatchObject({ kind: "SUBJECT", unread: 1 });
    expect((await listRooms(fx.emp1)).find((r) => r.id === room)!.title).toMatch(/^Surat Tugas \d+\/ST\//);
  });

  it("surat dibatalkan → utas baca-saja; ID penugasan acak atau bukan-UUID → 404", async () => {
    const id = await letter([0, 1]);
    const room = (await getOrCreateSubjectRoom(fx.emp1, { type: "ASSIGNMENT_LETTER", id })).id;
    await cancelAssignment(fx.hr, id, { reason: "Kegiatan dibatalkan klien" });
    expect(await fail(say(fx.emp1, room, "masih bisa?"))).toMatchObject(FORBIDDEN);
    expect((await listMessages(fx.emp1, room)).items).toEqual([]);
    expect(await fail(getOrCreateSubjectRoom(fx.emp1, { type: "ASSIGNMENT_LETTER", id: randomUUID() }))).toMatchObject(NOT_FOUND);
    expect(await fail(getOrCreateSubjectRoom(fx.emp1, { type: "ASSIGNMENT_LETTER", id: "xyz" }))).toMatchObject(VALIDATION);
  });
});

describe("utas penugasan — proyek & tugas Training", () => {
  let projectId: string;
  beforeEach(async () => {
    projectId = await mkProject(fx.mgr);
    await addTeam(fx.mgr, projectId, [[fx.empIds[0]!, "PROJECT_MANAGER"], [fx.empIds[1]!, "STAFF"]]);
  });

  it("anggota proyek dan pemegang kelola menulis; Pemantau hanya membaca; karyawan di luar proyek 404", async () => {
    const room = (await getOrCreateSubjectRoom(fx.emp1, { type: "TRAINING_PROJECT", id: projectId })).id;
    await say(fx.emp2, room, "Materi sudah siap");
    await say(fx.mgr, room, "Terima kasih");
    expect((await listMessages(fx.viewer, room)).items).toHaveLength(2); // Pemantau melihat semua proyek
    expect(await fail(say(fx.viewer, room, "saya pantau"))).toMatchObject(FORBIDDEN);
    expect(await fail(listMessages(fx.loner, room))).toMatchObject(NOT_FOUND);
    expect(await fail(getOrCreateSubjectRoom(fx.loner, { type: "TRAINING_PROJECT", id: projectId }))).toMatchObject(NOT_FOUND);
  });

  it("anggota yang diakhiri penugasannya kehilangan akses seketika walau baris anggota obrolan masih ada (izin dihitung, bukan disimpan)", async () => {
    const room = (await getOrCreateSubjectRoom(fx.emp2, { type: "TRAINING_PROJECT", id: projectId })).id;
    await say(fx.emp2, room, "halo tim");
    const m = (await listMembers(fx.mgr, projectId)).find((x) => x.employeeId === fx.empIds[1])!;
    await endMember(fx.mgr, projectId, m.id);
    expect(await prisma.chatMember.count({ where: { roomId: room, userId: fx.emp2.userId } })).toBe(1);
    expect(await fail(listMessages(fx.emp2, room))).toMatchObject(NOT_FOUND);
    expect(await fail(say(fx.emp2, room, "masih di sini?"))).toMatchObject(NOT_FOUND);
    expect((await listRooms(fx.emp2)).some((r) => r.id === room)).toBe(false);
    expect((await getSync(fx.emp2)).rooms.some((r) => r.id === room)).toBe(false);
  });

  it("utas tugas mengikuti proyek induknya", async () => {
    const t = await createTask(fx.emp1, projectId, { title: "Siapkan modul", assigneeId: fx.empIds[1] });
    const room = (await getOrCreateSubjectRoom(fx.emp2, { type: "TRAINING_TASK", id: t.id })).id;
    await say(fx.emp2, room, "Mulai dikerjakan");
    expect((await listRooms(fx.emp2)).find((r) => r.id === room)!.title).toBe("Siapkan modul");
    expect(await fail(listMessages(fx.loner, room))).toMatchObject(NOT_FOUND);
    expect(await fail(getOrCreateSubjectRoom(fx.emp2, { type: "TRAINING_TASK", id: randomUUID() }))).toMatchObject(NOT_FOUND);
  });
});

describe("kartu rujukan penugasan — diselesaikan per pembaca", () => {
  it("pembaca yang berhak melihat judul; yang tidak berhak hanya melihat penanda tanpa data; pengirim tidak dapat merujuk yang tak boleh ia lihat", async () => {
    const D = addDays(todayIso("Asia/Jakarta"), 3);
    const l = await createAssignment(fx.hr, { purpose: "Rahasia klien", destination: "Surakarta", startDate: D, endDate: D, assignees: [{ employeeId: fx.empIds[0]!, dailyRate: 300_000 }] });
    const general1 = await general(fx.emp1);
    const m = await say(fx.emp1, general1, "Lihat penugasan saya", { refs: [{ type: "ASSIGNMENT_LETTER", id: l.id }] });
    expect(m.refs[0]).toMatchObject({ accessible: true });
    expect(m.refs[0]!.title).toMatch(/^Surat Tugas/);
    const forOutsider = (await listMessages(fx.emp3, general1)).items[0]!;
    expect(forOutsider.refs[0]).toEqual({ type: "ASSIGNMENT_LETTER", id: l.id, accessible: false, title: null, subtitle: null, href: null });
    expect(JSON.stringify(forOutsider)).not.toContain("Surakarta");
    expect((await listMessages(fx.hr, general1)).items[0]!.refs[0]!.accessible).toBe(true);
    expect(await fail(say(fx.emp3, general1, "pinjam", { refs: [{ type: "ASSIGNMENT_LETTER", id: l.id }] }))).toMatchObject(VALIDATION);
    expect(await fail(say(fx.emp1, general1, "terlalu banyak", { refs: Array.from({ length: 4 }, () => ({ type: "ASSIGNMENT_LETTER", id: l.id })) }))).toMatchObject(VALIDATION);
    expect((await listRefOptions(fx.emp1)).map((c) => c.id)).toEqual([l.id]);
    expect(await listRefOptions(fx.emp3)).toEqual([]);
  });
});

describe("push desktop — tidak membanjiri", () => {
  it("japri: push dengan tautan & tag ruang; pesan kedua dalam 60 detik tidak diberi push; disebut menembus jeda; isi pesan tidak ikut", async () => {
    await subscribe(fx.emp2);
    const room = await dm(fx.emp1, fx.emp2);
    await say(fx.emp1, room, "ISI RAHASIA pertama");
    await vi.waitFor(() => expect(pushes).toHaveLength(1)); // pengiriman diproses segera di latar (best-effort) setelah commit
    await processDeliveries({ limit: 50 });
    expect(pushes[0]).toMatchObject({ title: "Pesan baru dari Ayu Lestari", href: `/obrolan?room=${room}`, tag: `chat-${room}` });
    expect(JSON.stringify(pushes)).not.toContain("RAHASIA");
    await say(fx.emp1, room, "kedua langsung");
    await processDeliveries({ limit: 50 });
    expect(pushes).toHaveLength(1);
    await say(fx.emp1, room, `@[Budi](${fx.emp2.userId}) penting`);
    await vi.waitFor(() => expect(pushes).toHaveLength(2));
    expect(pushes[1]!.body).toContain("Anda disebut");
  });

  it("tidak ada push bila penerima baru saja melihat ruang, dibisukan, atau memilih NONE; tidak ada baris Notification atau email/WhatsApp", async () => {
    await subscribe(fx.emp2);
    const room = await dm(fx.emp1, fx.emp2);
    await markRead(fx.emp2, room, { seq: 0 }); // sedang membuka ruang
    await say(fx.emp1, room, "satu");
    expect(await prisma.notificationDelivery.count({ where: { channel: "PUSH" } })).toBe(0);
    await prisma.chatMember.update({ where: { roomId_userId: { roomId: room, userId: fx.emp2.userId } }, data: { lastActiveAt: null } });
    await updateRoomPrefs(fx.emp2, room, { mutedUntil: new Date(Date.now() + 3_600_000).toISOString() });
    await say(fx.emp1, room, "dua");
    expect(await prisma.notificationDelivery.count({ where: { channel: "PUSH" } })).toBe(0);
    await updateRoomPrefs(fx.emp2, room, { mutedUntil: null, notifyMode: "NONE" });
    await say(fx.emp1, room, "tiga");
    expect(await prisma.notificationDelivery.count()).toBe(0);
    expect(await prisma.notification.count({ where: { userId: fx.emp2.userId } })).toBe(0);
  });

  it("kanal: pesan biasa tidak memicu push, sebutan memicu; anggota utas yang sudah kehilangan akses tidak diberi push", async () => {
    await subscribe(fx.emp2); await subscribe(fx.emp3);
    const room = await general(fx.emp1);
    await general(fx.emp2); await general(fx.emp3);
    await say(fx.emp1, room, "biasa saja");
    expect(await prisma.notificationDelivery.count({ where: { channel: "PUSH" } })).toBe(0);
    await say(fx.emp1, room, `halo @[Budi](${fx.emp2.userId})`);
    const rows = await prisma.notificationDelivery.findMany({ where: { channel: "PUSH" } });
    expect(rows.map((r) => r.userId)).toEqual([fx.emp2.userId]);

    const projectId = await mkProject(fx.mgr);
    await addTeam(fx.mgr, projectId, [[fx.empIds[0]!, "PROJECT_MANAGER"], [fx.empIds[1]!, "STAFF"]]);
    const thread = (await getOrCreateSubjectRoom(fx.emp2, { type: "TRAINING_PROJECT", id: projectId })).id;
    await prisma.notificationDelivery.deleteMany({});
    const m = (await listMembers(fx.mgr, projectId)).find((x) => x.employeeId === fx.empIds[1])!;
    await endMember(fx.mgr, projectId, m.id);
    await say(fx.mgr, thread, "Rapat besok");
    expect(await prisma.notificationDelivery.count({ where: { channel: "PUSH" } })).toBe(0);
  });
});

describe("retensi dan penjaga basis data", () => {
  it("isi pesan lebih tua dari batas dibersihkan (baris tetap, riwayat sunting ikut hilang); ruang legalHold ditahan", async () => {
    const room = await dm(fx.emp1, fx.emp2);
    const hold = await dm(fx.emp1, fx.emp3);
    await prisma.chatRoom.update({ where: { id: hold }, data: { legalHold: true } });
    const old = new Date(Date.now() - 200 * 86_400_000);
    const mk = (roomId: string, seq: number, createdAt: Date) => prisma.chatMessage.create({ data: { roomId, seq: BigInt(seq), senderId: fx.emp1.userId, body: `isi ${seq}`, clientMsgId: randomUUID(), createdAt } });
    const oldMsg = await mk(room, 1, old);
    await mk(room, 2, new Date());
    await mk(hold, 1, old);
    await prisma.chatMessageRevision.create({ data: { messageId: oldMsg.id, body: "isi lama sebelum sunting" } });
    const r = await purgeExpiredMessages();
    expect(r).toMatchObject({ purged: 1, months: 6 });
    const after = await prisma.chatMessage.findMany({ where: { roomId: room }, orderBy: { seq: "asc" } });
    expect(after[0]).toMatchObject({ body: null });
    expect(after[0]!.purgedAt).toBeTruthy();
    expect(after[1]!.body).toBe("isi 2");
    expect(await prisma.chatMessageRevision.count()).toBe(0);
    expect((await prisma.chatMessage.findFirstOrThrow({ where: { roomId: hold } })).body).toBe("isi 1"); // ditahan
    expect((await listMessages(fx.emp2, room)).items[0]).toMatchObject({ purged: true, body: null });
    expect((await purgeExpiredMessages()).purged).toBe(0); // idempoten
  });

  it("trigger: pesan tidak boleh di-DELETE; identitas terkunci; isi hanya berubah lewat sunting/retensi; yang dibersihkan tak dapat dipulihkan; revisi tambah-saja", async () => {
    const room = await dm(fx.emp1, fx.emp2);
    const m = await say(fx.emp1, room, "tetap");
    await expect(prisma.chatMessage.delete({ where: { id: m.id } })).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.chatMessage.update({ where: { id: m.id }, data: { senderId: fx.emp2.userId } })).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.chatMessage.update({ where: { id: m.id }, data: { body: "diam-diam diubah" } })).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.chatMessage.update({ where: { id: m.id }, data: { refs: [{ type: "TRAINING_TASK", id: randomUUID() }] } })).rejects.toThrow(/HRIS-GUARD/);
    await prisma.chatMessage.update({ where: { id: m.id }, data: { body: null, purgedAt: new Date() } });
    await expect(prisma.chatMessage.update({ where: { id: m.id }, data: { body: "pulih" } })).rejects.toThrow(/HRIS-GUARD/);
    const rev = await prisma.chatMessageRevision.create({ data: { messageId: m.id, body: "x" } });
    await expect(prisma.chatMessageRevision.update({ where: { id: rev.id }, data: { body: "y" } })).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.chatMessageRevision.delete({ where: { id: rev.id } })).resolves.toBeTruthy(); // induk sudah dibersihkan → boleh
  });

  it("bentuk ruang dijaga basis data (japri/kanal/utas tidak boleh bercampur) dan panjang pesan ≤ 4000", async () => {
    await expect(prisma.chatRoom.create({ data: { kind: "DIRECT", createdById: fx.emp1.userId } })).rejects.toThrow(/chat_rooms_shape/);
    await expect(prisma.chatRoom.create({ data: { kind: "CHANNEL", name: "x", slug: "x-y", directKey: "a:b", createdById: fx.emp1.userId } })).rejects.toThrow(/chat_rooms_shape/);
    await expect(prisma.chatRoom.create({ data: { kind: "SUBJECT", createdById: fx.emp1.userId } })).rejects.toThrow(/chat_rooms_shape/);
    const room = await dm(fx.emp1, fx.emp2);
    await expect(prisma.chatMessage.create({ data: { roomId: room, seq: BigInt(1), senderId: fx.emp1.userId, body: "x".repeat(4001), clientMsgId: randomUUID() } })).rejects.toThrow(/chat_messages_body_len/);
  });
});

describe("Magang", () => {
  it("Magang boleh japri dan kanal publik seperti karyawan lain", async () => {
    const e = await prisma.employee.create({ data: { employeeNo: "TE-990", fullName: "Mira Magang", position: "Magang", employmentStatus: "INTERN", joinDate: isoToDate("2026-01-05") } });
    const mira = await makeUser("mira@uji.test", "Mira Magang", "EMPLOYEE", e.id);
    const room = await dm(mira, fx.emp1);
    await say(mira, room, "Selamat pagi, Kak");
    expect((await listMessages(fx.emp1, room)).items).toHaveLength(1);
    await say(mira, await general(mira), "Halo semua");
  });
});
