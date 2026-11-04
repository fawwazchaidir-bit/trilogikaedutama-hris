/** Notifikasi push desktop (Web Push): langganan per perangkat, antrean PUSH pada outbox, pengiriman, pembersihan, dan pesan uji. */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import type { Actor } from "@/server/actor";
import { PushGoneError, b64u, generateVapidKeys } from "@/lib/webpush";
import { resetDb } from "../helpers/db";
import { seedTraining, type TrainingFixtures } from "../helpers/training";
import { setTransportsForTest } from "@/server/notify/transports";
import { processDeliveries } from "@/server/notify/deliveries";
import { notifyUsers } from "@/server/services/notifications";
import { getPushStatus, MAX_PUSH_DEVICES, deviceLabel, removePushDevice, subscribePush, unsubscribePush } from "@/server/services/push";
import { sendTestNotification } from "@/server/services/account";

const vapid = generateVapidKeys();
process.env.WEB_PUSH_PUBLIC_KEY = vapid.publicKey;
process.env.WEB_PUSH_PRIVATE_KEY = vapid.privateKey;
process.env.WEB_PUSH_SUBJECT = "mailto:admin@trilogika.test";

const sent: { endpoint: string; title: string; body: string; href: string; tag?: string }[] = [];
let mode: "ok" | "gone" | "fail" = "ok";
let fx: TrainingFixtures;
beforeEach(async () => {
  await resetDb();
  fx = await seedTraining();
  sent.length = 0; mode = "ok";
  setTransportsForTest({
    push: async (t, m) => { if (mode === "gone") throw new PushGoneError(410); if (mode === "fail") throw new Error("HTTP 503: gangguan"); sent.push({ endpoint: t.endpoint, ...m }); },
  });
});
afterEach(() => setTransportsForTest(null));

const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const ua = (a: Actor, agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36"): Actor => ({ ...a, userAgent: agent });
const keys = () => { const k = generateVapidKeys(); return { p256dh: k.publicKey, auth: b64u.enc(Buffer.alloc(16, 5)) }; };
const sub = (n: number, host = "https://fcm.googleapis.com") => ({ endpoint: `${host}/fcm/send/device-${n}-${"x".repeat(30)}`, keys: keys() });

describe("langganan perangkat", () => {
  it("terdaftar dengan label dari User-Agent; status memuat kunci publik & perangkat milik sendiri saja", async () => {
    const e = sub(1);
    await subscribePush(ua(fx.emp1), e);
    await subscribePush(fx.emp2, sub(2));
    const st = await getPushStatus(fx.emp1);
    expect(st).toMatchObject({ available: true, publicKey: vapid.publicKey, maxDevices: MAX_PUSH_DEVICES });
    expect(st.devices).toHaveLength(1);
    expect(st.devices[0]).toMatchObject({ endpoint: e.endpoint, label: "Chrome · Windows" });
    expect(await prisma.auditLog.count({ where: { action: "account.push.subscribe" } })).toBe(2);
    expect((await prisma.auditLog.findFirst({ where: { action: "account.push.subscribe" } }))!.summary).not.toContain("fcm.googleapis.com"); // alamat langganan = rahasia, tidak dicatat
  });
  it("label perangkat dari berbagai User-Agent", () => {
    expect(deviceLabel("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17 Safari/605.1.15")).toBe("Safari · macOS");
    expect(deviceLabel("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0")).toBe("Firefox · Linux");
    expect(deviceLabel("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130 Safari/537.36 Edg/130")).toBe("Edge · Windows");
    expect(deviceLabel(null)).toBe("Peramban · Desktop");
  });
  it("alamat bukan push service resmi / kunci tak sah ditolak (anti-SSRF) dan tidak pernah disimpan", async () => {
    for (const endpoint of ["https://evil.example/x", "http://fcm.googleapis.com/x", "https://169.254.169.254/latest", "https://localhost:3000/x", "https://fcm.googleapis.com.evil.example/x"]) {
      expect((await fail(subscribePush(fx.emp1, { endpoint, keys: keys() })))?.status, endpoint).toBe(422);
    }
    const good = sub(3);
    expect((await fail(subscribePush(fx.emp1, { endpoint: good.endpoint, keys: { p256dh: "pendek", auth: good.keys.auth } })))?.status).toBe(422);
    expect((await fail(subscribePush(fx.emp1, { endpoint: good.endpoint, keys: { p256dh: good.keys.p256dh, auth: "x" } })))?.status).toBe(422);
    expect((await fail(subscribePush(fx.emp1, { endpoint: good.endpoint })))?.status).toBe(422);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });
  it("idempoten untuk peramban yang sama; peramban yang dipakai pengguna lain berpindah pemilik (komputer bersama)", async () => {
    const e = sub(4);
    await subscribePush(fx.emp1, e); await subscribePush(fx.emp1, e);
    expect(await prisma.pushSubscription.count()).toBe(1);
    await subscribePush(fx.emp2, e);
    const row = await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: e.endpoint } });
    expect(row.userId).toBe(fx.emp2.userId);
    expect((await getPushStatus(fx.emp1)).devices).toHaveLength(0);
  });
  it(`maksimal ${MAX_PUSH_DEVICES} perangkat per pengguna`, async () => {
    for (let i = 0; i < MAX_PUSH_DEVICES; i++) await subscribePush(fx.emp1, sub(100 + i));
    expect((await fail(subscribePush(fx.emp1, sub(999))))?.status).toBe(409);
    await subscribePush(fx.emp1, sub(100)); // memperbarui yang sudah ada tetap boleh
  });
  it("hanya mencabut milik sendiri: alamat/ID milik orang lain tidak berpengaruh (ID → 404)", async () => {
    const mine = sub(5), theirs = sub(6);
    await subscribePush(fx.emp1, mine); await subscribePush(fx.emp2, theirs);
    await unsubscribePush(fx.emp1, { endpoint: theirs.endpoint });
    expect(await prisma.pushSubscription.count()).toBe(2);
    const theirRow = await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: theirs.endpoint } });
    expect((await fail(removePushDevice(fx.emp1, theirRow.id)))?.status).toBe(404);
    expect((await fail(removePushDevice(fx.emp1, "bukan-uuid")))?.status).toBe(404);
    await unsubscribePush(fx.emp1, { endpoint: mine.endpoint });
    expect((await getPushStatus(fx.emp1)).devices).toHaveLength(0);
    await removePushDevice(fx.emp2, theirRow.id);
    expect(await prisma.pushSubscription.count()).toBe(0);
  });
});

describe("antrean & pengiriman", () => {
  async function ping(userIds: string[], title = "Tugas jatuh tempo besok") {
    await prisma.$transaction(async (tx) => { await notifyUsers(tx, userIds, { type: "t", title, body: "TRN-1 · Cetak sertifikat", href: "/training/tugas-saya" }); });
  }
  it("saluran lain tetap berjalan berdampingan: pengguna yang memilih email mendapat EMAIL + PUSH per perangkat", async () => {
    setTransportsForTest({ push: async () => undefined, email: async () => undefined });
    await subscribePush(fx.emp1, sub(30));
    await ping([fx.emp1.userId]);
    expect((await prisma.notificationDelivery.findMany({ orderBy: { id: "asc" } })).map((r) => r.channel)).toEqual(["EMAIL", "PUSH"]);
  });
  it("satu pengiriman PUSH per perangkat milik penerima; yang tidak berlangganan tidak diantrekan", async () => {
    await subscribePush(fx.emp1, sub(10)); await subscribePush(fx.emp1, sub(11)); await subscribePush(fx.emp2, sub(12));
    await ping([fx.emp1.userId, fx.emp3.userId]);
    const rows = await prisma.notificationDelivery.findMany({ orderBy: { id: "asc" } });
    expect(rows.map((r) => [r.channel, r.userId])).toEqual([["PUSH", fx.emp1.userId], ["PUSH", fx.emp1.userId]]);
    expect(rows.every((r) => r.status === "PENDING" && r.subject === "Tugas jatuh tempo besok")).toBe(true);
  });
  it("diproses: terkirim ke perangkat yang benar dengan judul, isi, tautan, dan tag; status SENT + waktu terakhir terkirim", async () => {
    const e = sub(13);
    await subscribePush(fx.emp1, e);
    await ping([fx.emp1.userId]);
    const r = await processDeliveries();
    expect(r).toMatchObject({ claimed: 1, sent: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ endpoint: e.endpoint, title: "Tugas jatuh tempo besok", body: "TRN-1 · Cetak sertifikat", href: "/training/tugas-saya" });
    expect(sent[0]!.tag).toMatch(/^n-\d+$/);
    expect((await prisma.notificationDelivery.findFirstOrThrow()).status).toBe("SENT");
    expect((await prisma.pushSubscription.findUniqueOrThrow({ where: { endpoint: e.endpoint } })).lastSuccessAt).not.toBeNull();
  });
  it("langganan kedaluwarsa (410) → langganan dihapus & pengiriman SKIPPED (bukan percobaan ulang tanpa akhir)", async () => {
    await subscribePush(fx.emp1, sub(14));
    await ping([fx.emp1.userId]);
    mode = "gone";
    expect(await processDeliveries()).toMatchObject({ skipped: 1, sent: 0, failed: 0 });
    expect(await prisma.pushSubscription.count()).toBe(0);
    expect((await prisma.notificationDelivery.findFirstOrThrow()).status).toBe("SKIPPED");
  });
  it("galat sementara → dicoba ulang dengan jeda; langganan tetap ada", async () => {
    await subscribePush(fx.emp1, sub(15));
    await ping([fx.emp1.userId]);
    mode = "fail";
    expect(await processDeliveries()).toMatchObject({ retried: 1, sent: 0 });
    expect(await prisma.pushSubscription.count()).toBe(1);
    const d = await prisma.notificationDelivery.findFirstOrThrow();
    expect(d.status).toBe("PENDING");
    expect(d.lastError).toContain("503");
  });
  it("peramban berpindah pemilik sebelum pengiriman → TIDAK dikirim (isi notifikasi pengguna lama tidak muncul di layar pengguna baru)", async () => {
    const e = sub(16);
    await subscribePush(fx.emp1, e);
    await ping([fx.emp1.userId]);
    await subscribePush(fx.emp2, e);
    expect(await processDeliveries()).toMatchObject({ skipped: 1, sent: 0 });
    expect(sent).toHaveLength(0);
  });
  it("langganan dicabut setelah diantrekan, atau pengguna dinonaktifkan → dilewati", async () => {
    await subscribePush(fx.emp1, sub(17)); await subscribePush(fx.emp2, sub(18));
    await ping([fx.emp1.userId, fx.emp2.userId]);
    await prisma.pushSubscription.deleteMany({ where: { userId: fx.emp1.userId } });
    await prisma.user.update({ where: { id: fx.emp2.userId }, data: { isActive: false } });
    expect(await processDeliveries()).toMatchObject({ skipped: 2, sent: 0 });
    expect(sent).toHaveLength(0);
  });
});

describe("notifikasi uji", () => {
  it("mengirim ke semua perangkat milik sendiri saja; tanpa perangkat → 422; dibatasi 5/jam", async () => {
    expect((await fail(sendTestNotification(fx.emp1, { channel: "PUSH" })))?.status).toBe(422);
    await subscribePush(fx.emp1, sub(20)); await subscribePush(fx.emp1, sub(21)); await subscribePush(fx.emp2, sub(22));
    await sendTestNotification(fx.emp1, { channel: "PUSH" });
    expect(sent).toHaveLength(2);
    expect(sent.every((s) => s.title.includes("Uji notifikasi desktop") && s.href === "/akun")).toBe(true);
    for (let i = 0; i < 3; i++) await sendTestNotification(fx.emp1, { channel: "PUSH" });
    expect((await fail(sendTestNotification(fx.emp1, { channel: "PUSH" })))?.status).toBe(429);
  });
  it("semua perangkat kedaluwarsa → langganan dibersihkan dan pengguna diberi tahu untuk mengaktifkan ulang", async () => {
    await subscribePush(fx.emp1, sub(23));
    mode = "gone";
    const e = await fail(sendTestNotification(fx.emp1, { channel: "PUSH" }));
    expect(e?.status).toBe(422);
    expect(e?.message).toContain("aktifkan ulang");
    expect(await prisma.pushSubscription.count()).toBe(0);
  });
  it("galat pengiriman lain ditampilkan jelas (bukan 500)", async () => {
    await subscribePush(fx.emp1, sub(24));
    mode = "fail";
    expect((await fail(sendTestNotification(fx.emp1, { channel: "PUSH" })))?.message).toContain("503");
  });
});
