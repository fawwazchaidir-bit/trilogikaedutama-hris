/** Aliran SSE "bel": hanya memberi tahu ruang mana yang berubah (tanpa isi pesan), menghormati sesi, dan membatasi jumlah aliran per pengguna. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/server/db";
import type { SessionUser } from "@/server/auth/session";
import { createSession, isSessionAlive } from "@/server/auth/session";
import { resetDb } from "../helpers/db";
import { seedTraining, type TrainingFixtures } from "../helpers/training";
import { getOrCreateDirect } from "@/server/services/chat/rooms";
import { editMessage, sendMessage } from "@/server/services/chat/messages";
import { openChatStream, openStreamCount } from "@/server/services/chat/stream";

let fx: TrainingFixtures;
const open: AbortController[] = [];
beforeEach(async () => { await resetDb(); fx = await seedTraining(); });
afterEach(() => { for (const c of open.splice(0)) c.abort(); });

async function asStream(actor: typeof fx.emp1) {
  await createSession(actor.userId, null, null);
  const s = await prisma.session.findFirstOrThrow({ where: { userId: actor.userId }, orderBy: { createdAt: "desc" } });
  const user = { ...actor, sessionId: s.id, mustChangePassword: false, twoFactorEnabled: false, mustSetupTwoFactor: false, isDemo: false } as SessionUser;
  const ac = new AbortController(); open.push(ac);
  const res = openChatStream(new Request("http://localhost/api/chat/stream", { signal: ac.signal }), user);
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  /** Baca sampai peristiwa bernama `name` muncul (atau habis waktu). Satu pembacaan tertunda dipertahankan agar tidak ada potongan yang hilang. */
  async function next(name: string, ms = 6000): Promise<{ rooms: { id: string; lastSeq: number; rev: number }[] }> {
    const until = Date.now() + ms;
    for (;;) {
      const m = buf.match(new RegExp(`event: ${name}\\ndata: (.*)\\n\\n`));
      if (m) { buf = buf.slice(buf.indexOf(m[0]) + m[0].length); return JSON.parse(m[1]!); }
      if (Date.now() > until) throw new Error(`peristiwa ${name} tidak datang; buffer: ${buf}`);
      pending ??= reader.read();
      const r = await Promise.race([pending, new Promise<null>((ok) => setTimeout(() => ok(null), 300))]);
      if (r === null) continue; // belum ada data; pembacaan yang sama tetap menunggu
      pending = null;
      if (r.done) throw new Error(`aliran ditutup; buffer: ${buf}`);
      buf += dec.decode(r.value);
    }
  }
  return { res, next, abort: () => ac.abort(), reader, user };
}

describe("aliran SSE", () => {
  it("header streaming benar; 'hello' memuat ruang milik pengguna; pesan baru memicu 'sync' berisi nomor urut — tanpa isi pesan", async () => {
    const room = (await getOrCreateDirect(fx.emp1, { userId: fx.emp2.userId })).id;
    const s = await asStream(fx.emp2);
    expect(s.res.headers.get("content-type")).toContain("text/event-stream");
    expect(s.res.headers.get("cache-control")).toContain("no-transform");
    expect(s.res.headers.get("x-accel-buffering")).toBe("no");
    const hello = await s.next("hello");
    expect(hello.rooms.some((r) => r.id === room && r.lastSeq === 0)).toBe(true);
    const t0 = Date.now();
    await sendMessage(fx.emp1, room, { body: "RAHASIA bukan untuk bel", clientMsgId: randomUUID() });
    const sync = await s.next("sync");
    expect(sync.rooms.find((r) => r.id === room)).toMatchObject({ lastSeq: 1 });
    expect(Date.now() - t0).toBeLessThan(5000);
    expect(JSON.stringify(sync)).not.toContain("RAHASIA");
  });

  it("japri yang baru dimulai orang lain setelah aliran terbuka langsung membunyikan bel (tanpa menunggu penyegaran akses)", async () => {
    const s = await asStream(fx.emp2);
    await s.next("hello");
    const room = (await getOrCreateDirect(fx.emp1, { userId: fx.emp2.userId })).id;
    await sendMessage(fx.emp1, room, { body: "halo, ruang baru", clientMsgId: randomUUID() });
    const sync = await s.next("sync");
    expect(sync.rooms.find((r) => r.id === room)).toMatchObject({ lastSeq: 1 });
  });

  it("sunting pesan membunyikan bel (rev naik) walau nomor urut tidak berubah", async () => {
    const room = (await getOrCreateDirect(fx.emp1, { userId: fx.emp2.userId })).id;
    const m = await sendMessage(fx.emp1, room, { body: "awal", clientMsgId: randomUUID() });
    const s = await asStream(fx.emp2);
    await s.next("hello");
    await editMessage(fx.emp1, m.id, { body: "diedit" });
    const sync = await s.next("sync");
    expect(sync.rooms.find((r) => r.id === room)).toMatchObject({ lastSeq: 1 });
  });

  it("ruang yang bukan milik pengguna tidak pernah muncul di bel", async () => {
    const other = (await getOrCreateDirect(fx.emp1, { userId: fx.emp3.userId })).id;
    const s = await asStream(fx.emp2);
    const hello = await s.next("hello");
    expect(hello.rooms.some((r) => r.id === other)).toBe(false);
    await sendMessage(fx.emp1, other, { body: "bukan untuk emp2", clientMsgId: randomUUID() });
    await expect(s.next("sync", 3500)).rejects.toThrow();
  });

  it("maksimal 3 aliran per pengguna: yang tertua ditutup; abort melepas pencatatan", async () => {
    const a = await asStream(fx.emp1); await a.next("hello");
    const b = await asStream(fx.emp1); await b.next("hello");
    const c = await asStream(fx.emp1); await c.next("hello");
    expect(openStreamCount(fx.emp1.userId)).toBe(3);
    const d = await asStream(fx.emp1); await d.next("hello");
    expect(openStreamCount(fx.emp1.userId)).toBe(3);
    await expect(a.next("tidak-akan-ada", 2500)).rejects.toThrow(/ditutup/); // yang tertua ditutup server
    d.abort(); c.abort(); b.abort();
    await new Promise((r) => setTimeout(r, 100));
    expect(openStreamCount(fx.emp1.userId)).toBe(0);
  });

  it("pemeriksaan sesi hanya-baca: sesi dicabut atau pengguna dinonaktifkan → tidak hidup; tidak menggeser jendela idle", async () => {
    await createSession(fx.emp1.userId, null, null);
    const s = await prisma.session.findFirstOrThrow({ where: { userId: fx.emp1.userId } });
    const old = new Date(Date.now() - 3 * 3_600_000);
    await prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: old } });
    expect(await isSessionAlive(s.id)).toBe(true);
    expect((await prisma.session.findUniqueOrThrow({ where: { id: s.id } })).lastSeenAt.getTime()).toBe(old.getTime()); // tidak digeser
    await prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date(Date.now() - 9 * 3_600_000) } });
    expect(await isSessionAlive(s.id)).toBe(false); // idle > 8 jam
    await prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date(), revokedAt: new Date() } });
    expect(await isSessionAlive(s.id)).toBe(false);
    expect(await isSessionAlive(randomUUID())).toBe(false);
  });
});
