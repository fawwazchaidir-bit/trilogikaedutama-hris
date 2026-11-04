import "server-only";
import { prisma, transaction } from "../db";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import type { Actor } from "../actor";
import { writeAudit } from "../audit";
import { dateToIso, isoToDate } from "../json";
import { todayIso } from "@/lib/time";
import { env } from "../env";
import { bannerSchema } from "@/lib/validation/portal";
import { notifyUsers } from "./notifications";

/** Teks banner bawaan (dipakai bila Direktur belum menulis pesan, pesan sudah kedaluwarsa, atau dikembalikan ke bawaan). */
export const DEFAULT_BANNER_TITLE = "Bersama Membangun Talenta Unggul untuk Indonesia";
/** Jarak minimum antar pesan yang juga dikirim sebagai notifikasi — mencegah tekan-ulang yang membanjiri seluruh karyawan. */
const NOTIFY_COOLDOWN_MINUTES = 10;

export interface BannerDto {
  title: string; body: string | null; isDefault: boolean; expiresAt: string | null;
  postedByName: string | null; postedAt: string | null;
}
export interface BannerHistoryDto { id: string; title: string; body: string | null; active: boolean; expiresAt: string | null; notifiedCount: number; byName: string | null; at: string }

const today = () => todayIso(env().APP_TIMEZONE);

/** Banner yang tampil bagi semua pengguna masuk: pesan terakhir bila aktif dan belum kedaluwarsa; selain itu bawaan. */
export async function getBanner(): Promise<BannerDto> {
  const row = await prisma.portalAnnouncement.findFirst({ orderBy: { seq: "desc" } });
  const expired = !!row?.expiresAt && dateToIso(row.expiresAt) < today();
  if (!row || !row.active || expired) return { title: DEFAULT_BANNER_TITLE, body: null, isDefault: true, expiresAt: null, postedByName: null, postedAt: null };
  const by = await prisma.user.findUnique({ where: { id: row.createdById }, select: { name: true } });
  return { title: row.title, body: row.body, isDefault: false, expiresAt: row.expiresAt ? dateToIso(row.expiresAt) : null, postedByName: by?.name ?? null, postedAt: row.createdAt.toISOString() };
}

function assertDirector(actor: Actor): void {
  if (actor.role !== "SUPER_ADMIN") throw Errors.forbidden("Hanya Direktur (Super Admin) yang dapat mengubah pesan banner.");
}

export async function listBannerHistory(actor: Actor, limit = 8): Promise<BannerHistoryDto[]> {
  assertDirector(actor);
  const rows = await prisma.portalAnnouncement.findMany({ orderBy: { seq: "desc" }, take: Math.min(limit, 50) });
  const users = rows.length ? await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ id: r.id, title: r.title, body: r.body, active: r.active, expiresAt: r.expiresAt ? dateToIso(r.expiresAt) : null, notifiedCount: r.notifiedCount, byName: name.get(r.createdById) ?? null, at: r.createdAt.toISOString() }));
}

/**
 * Pasang pesan baru di banner (Direktur). Teks ditampilkan sebagai teks biasa (bukan HTML). `notify` juga membuat notifikasi untuk seluruh akun
 * aktif — dalam aplikasi selalu; email/WhatsApp hanya bagi yang memilihnya dan bila dikonfigurasi (mekanisme outbox yang sama dengan notifikasi lain).
 */
export async function setBanner(actor: Actor, raw: unknown): Promise<{ id: string; notified: number }> {
  assertDirector(actor);
  const input = parseInput(bannerSchema, raw);
  if (input.expiresAt && input.expiresAt < today()) throw Errors.validation("Tanggal berakhir tidak boleh di masa lalu.", { expiresAt: "Di masa lalu" });
  return transaction(async (tx) => {
    // Serialkan agar dua Direktur yang menyimpan bersamaan tidak melewati pembatas notifikasi.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('portal:announcement'))`;
    if (input.notify) {
      const recent = await tx.portalAnnouncement.findFirst({ where: { notifiedCount: { gt: 0 }, createdAt: { gt: new Date(Date.now() - NOTIFY_COOLDOWN_MINUTES * 60_000) } }, select: { id: true } });
      if (recent) throw Errors.conflict(`Pesan broadcast terakhir baru dikirim kurang dari ${NOTIFY_COOLDOWN_MINUTES} menit lalu. Simpan tanpa notifikasi, atau tunggu sebentar.`);
    }
    const recipients = input.notify ? (await tx.user.findMany({ where: { isActive: true, id: { not: actor.userId } }, select: { id: true } })).map((u) => u.id) : [];
    const row = await tx.portalAnnouncement.create({ data: { title: input.title, body: input.body, active: true, expiresAt: input.expiresAt ? isoToDate(input.expiresAt) : null, notifiedCount: recipients.length, createdById: actor.userId } });
    if (recipients.length) await notifyUsers(tx, recipients, { type: "announcement", title: `Pesan dari Direktur: ${input.title}`, body: input.body, href: "/dashboard" });
    await writeAudit(tx, actor, {
      action: "portal.announcement.set", entityType: "PortalAnnouncement", entityId: row.id,
      summary: `Pesan banner beranda diganti: "${input.title}"${recipients.length ? ` (juga dikirim sebagai notifikasi ke ${recipients.length} akun)` : ""}`,
      after: { title: input.title, expiresAt: input.expiresAt, notified: recipients.length },
    });
    return { id: row.id, notified: recipients.length };
  });
}

/** Kembalikan banner ke teks bawaan. Riwayat pesan tidak dihapus (baris baru bertanda tidak aktif). */
export async function resetBanner(actor: Actor): Promise<void> {
  assertDirector(actor);
  await transaction(async (tx) => {
    const row = await tx.portalAnnouncement.create({ data: { title: DEFAULT_BANNER_TITLE, body: null, active: false, createdById: actor.userId } });
    await writeAudit(tx, actor, { action: "portal.announcement.reset", entityType: "PortalAnnouncement", entityId: row.id, summary: "Banner beranda dikembalikan ke teks bawaan" });
  });
}
