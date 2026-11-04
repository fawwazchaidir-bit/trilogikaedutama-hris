/** Pesan banner beranda (broadcast Direktur): hanya Super Admin menulis; tampil bagi semua; append-only; notifikasi opsional dengan pembatas. */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import { addDays, todayIso } from "@/lib/time";
import { resetDb } from "../helpers/db";
import { seedTraining, type TrainingFixtures } from "../helpers/training";
import { DEFAULT_BANNER_TITLE, getBanner, listBannerHistory, resetBanner, setBanner } from "@/server/services/announcement";

let fx: TrainingFixtures;
beforeEach(async () => { await resetDb(); fx = await seedTraining(); });
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const TODAY = () => todayIso("Asia/Jakarta");

describe("banner beranda", () => {
  it("belum ada pesan → teks bawaan; Direktur memasang pesan → tampil bagi semua dengan nama & waktu pemasang", async () => {
    expect(await getBanner()).toMatchObject({ title: DEFAULT_BANNER_TITLE, isDefault: true, body: null });
    await setBanner(fx.superAdmin, { title: "Libur bersama 25 Desember", body: "Kantor tutup.\nLayanan kembali 27 Desember.", expiresAt: addDays(TODAY(), 30) });
    const b = await getBanner();
    expect(b).toMatchObject({ title: "Libur bersama 25 Desember", body: "Kantor tutup.\nLayanan kembali 27 Desember.", isDefault: false, postedByName: "Pimpinan Uji", expiresAt: addDays(TODAY(), 30) });
    expect(b.postedAt).toBeTruthy();
  });

  it("hanya Super Admin: HR, Manajer Program, Admin Program, Pemantau, dan karyawan ditolak (403); riwayat juga", async () => {
    for (const a of [fx.hr, fx.mgr, fx.adm, fx.viewer, fx.emp1]) {
      expect((await fail(setBanner(a, { title: "Coba ubah banner" })))?.status, a.email).toBe(403);
      expect((await fail(resetBanner(a)))?.status, a.email).toBe(403);
      expect((await fail(listBannerHistory(a)))?.status, a.email).toBe(403);
    }
    expect((await getBanner()).isDefault).toBe(true);
  });

  it("validasi: judul 3–120, isi ≤ 500, tanggal berakhir tidak di masa lalu dan harus tanggal sah", async () => {
    const bad = (v: Record<string, unknown>) => fail(setBanner(fx.superAdmin, { title: "Judul sah", ...v }));
    expect((await bad({ title: "ab" }))?.status).toBe(422);
    expect((await bad({ title: "x".repeat(121) }))?.status).toBe(422);
    expect((await bad({ body: "y".repeat(501) }))?.status).toBe(422);
    expect((await bad({ expiresAt: addDays(TODAY(), -1) }))?.status).toBe(422);
    expect((await bad({ expiresAt: "bukan-tanggal" }))?.status).toBe(422);
    expect(await bad({ title: "x".repeat(120), body: "y".repeat(500), expiresAt: TODAY() })).toBeNull();
  });

  it("pesan terakhir yang menang; kedaluwarsa → kembali ke bawaan (hari terakhir masih tampil)", async () => {
    await setBanner(fx.superAdmin, { title: "Pesan pertama" });
    await setBanner(fx.superAdmin, { title: "Pesan kedua" });
    expect((await getBanner()).title).toBe("Pesan kedua");
    await setBanner(fx.superAdmin, { title: "Berakhir hari ini", expiresAt: TODAY() });
    expect((await getBanner()).title).toBe("Berakhir hari ini");
    await prisma.portalAnnouncement.create({ data: { title: "Sudah lewat", expiresAt: isoToDate(addDays(TODAY(), -1)), createdById: fx.superAdmin.userId } });
    expect((await getBanner()).isDefault).toBe(true);
  });

  it("kembalikan ke bawaan = baris baru tidak aktif (riwayat utuh); tabel append-only di database", async () => {
    await setBanner(fx.superAdmin, { title: "Pesan sementara" });
    await resetBanner(fx.superAdmin);
    expect(await getBanner()).toMatchObject({ isDefault: true, title: DEFAULT_BANNER_TITLE });
    const h = await listBannerHistory(fx.superAdmin);
    expect(h.map((x) => [x.active, x.title])).toEqual([[false, DEFAULT_BANNER_TITLE], [true, "Pesan sementara"]]);
    await expect(prisma.$executeRawUnsafe(`UPDATE portal_announcements SET title = 'diubah diam-diam'`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`DELETE FROM portal_announcements`)).rejects.toThrow();
    expect(await prisma.auditLog.count({ where: { action: { in: ["portal.announcement.set", "portal.announcement.reset"] } } })).toBe(2);
  });

  it("teks disimpan apa adanya sebagai teks biasa (tidak ada HTML yang diproses)", async () => {
    await setBanner(fx.superAdmin, { title: "Awas <script>alert(1)</script>", body: "<img src=x onerror=alert(1)>" });
    expect(await getBanner()).toMatchObject({ title: "Awas <script>alert(1)</script>", body: "<img src=x onerror=alert(1)>" });
  });
});

describe("kirim sebagai notifikasi", () => {
  it("hanya bila dicentang: seluruh akun AKTIF kecuali pengirim mendapat notifikasi dalam aplikasi; yang nonaktif tidak", async () => {
    await prisma.user.update({ where: { id: fx.emp3.userId }, data: { isActive: false } });
    const activeOthers = await prisma.user.count({ where: { isActive: true, id: { not: fx.superAdmin.userId } } });
    const quiet = await setBanner(fx.superAdmin, { title: "Tanpa notifikasi" });
    expect(quiet.notified).toBe(0);
    expect(await prisma.notification.count({ where: { type: "announcement" } })).toBe(0);

    const sent = await setBanner(fx.superAdmin, { title: "Rapat akbar Senin", body: "Pukul 09.00 di aula.", notify: true });
    expect(sent.notified).toBe(activeOthers);
    const rows = await prisma.notification.findMany({ where: { type: "announcement" } });
    expect(rows).toHaveLength(activeOthers);
    expect(rows.every((r) => r.title === "Pesan dari Direktur: Rapat akbar Senin" && r.body === "Pukul 09.00 di aula." && r.href === "/dashboard")).toBe(true);
    expect(rows.some((r) => r.userId === fx.superAdmin.userId)).toBe(false);
    expect(rows.some((r) => r.userId === fx.emp3.userId)).toBe(false);
    expect((await listBannerHistory(fx.superAdmin))[0]!.notifiedCount).toBe(activeOthers);
  });

  it("pembatas: broadcast kedua dalam 10 menit ditolak (409); menyimpan tanpa notifikasi tetap boleh", async () => {
    await setBanner(fx.superAdmin, { title: "Broadcast pertama", notify: true });
    const second = await fail(setBanner(fx.superAdmin, { title: "Broadcast kedua", notify: true }));
    expect(second?.status).toBe(409);
    expect(second?.message).toContain("10 menit");
    await setBanner(fx.superAdmin, { title: "Hanya banner" });
    expect((await getBanner()).title).toBe("Hanya banner");
    expect(await prisma.notification.count({ where: { title: { contains: "Broadcast kedua" } } })).toBe(0);
    // lewat 10 menit → boleh lagi
    await prisma.$executeRawUnsafe(`ALTER TABLE portal_announcements DISABLE TRIGGER portal_announcements_append_only`);
    await prisma.$executeRawUnsafe(`UPDATE portal_announcements SET "createdAt" = now() - interval '11 minutes'`);
    await prisma.$executeRawUnsafe(`ALTER TABLE portal_announcements ENABLE TRIGGER portal_announcements_append_only`);
    expect((await setBanner(fx.superAdmin, { title: "Broadcast ketiga", notify: true })).notified).toBeGreaterThan(0);
  });
});
