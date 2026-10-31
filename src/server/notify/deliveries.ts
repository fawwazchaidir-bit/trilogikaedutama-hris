import "server-only";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { emailAvailable, sendEmail, sendWhatsapp, whatsappAvailable } from "./transports";

type Db = Prisma.TransactionClient | typeof prisma;

export const MAX_ATTEMPTS = 5;
/** Masa sewa baris yang sedang diproses: bila pekerja mati, baris dicoba lagi setelah ini. */
const LEASE_SECONDS = 300;

export interface QueuedNotification { id: bigint; userId: string; title: string; body: string | null; href: string | null }

/** Isi pesan teks untuk email/WhatsApp — sengaja ringkas dan tanpa data sensitif (angka gaji tidak pernah dikirim). */
export function composeMessage(brand: string, n: { title: string; body: string | null; href: string | null }): { subject: string; text: string } {
  const link = n.href ? `\n\nBuka: ${env().APP_URL.replace(/\/$/, "")}${n.href}` : "";
  return { subject: `[${brand}] ${n.title}`, text: `${n.title}${n.body ? `\n${n.body}` : ""}${link}\n\n— ${brand} HRIS` };
}

/**
 * Antrekan pengiriman email/WhatsApp untuk notifikasi yang baru dibuat. Dipanggil DI DALAM transaksi yang sama dengan
 * peristiwanya (transactional outbox): bila transaksi gagal, tidak ada pesan terkirim; bila berhasil, pesan pasti masuk antrean.
 * Hanya saluran yang dikonfigurasi DAN dipilih pengguna (dan punya alamat/nomor) yang diantrekan.
 */
export async function queueDeliveries(db: Db, rows: QueuedNotification[]): Promise<number> {
  if (rows.length === 0 || (!emailAvailable() && !whatsappAvailable())) return 0;
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.userId))] }, isActive: true },
    select: { id: true, email: true, notifyEmail: true, notifyWhatsapp: true, whatsappNumber: true },
  });
  if (users.length === 0) return 0;
  const byId = new Map(users.map((u) => [u.id, u]));
  const brand = (await db.companySettings.findUnique({ where: { id: 1 }, select: { name: true } }))?.name ?? "Trilogika Edutama";
  const data: Prisma.NotificationDeliveryCreateManyInput[] = [];
  for (const r of rows) {
    const u = byId.get(r.userId);
    if (!u) continue;
    const msg = composeMessage(brand, r);
    if (emailAvailable() && u.notifyEmail && u.email) data.push({ notificationId: r.id, userId: u.id, channel: "EMAIL", toAddress: u.email, subject: msg.subject, body: msg.text });
    if (whatsappAvailable() && u.notifyWhatsapp && u.whatsappNumber) data.push({ notificationId: r.id, userId: u.id, channel: "WHATSAPP", toAddress: u.whatsappNumber, subject: null, body: msg.text });
  }
  if (data.length) await db.notificationDelivery.createMany({ data });
  return data.length;
}

export interface ProcessResult { claimed: number; sent: number; failed: number; retried: number; skipped: number }

/** Jeda percobaan ulang: 1, 2, 4, 8 menit… maksimal 1 jam. */
export function backoffSeconds(attempts: number): number {
  return Math.min(60 * 2 ** Math.max(0, attempts - 1), 3600);
}

interface Claimed { id: bigint; userId: string | null; channel: "EMAIL" | "WHATSAPP"; toAddress: string; subject: string | null; body: string; attempts: number }

/**
 * Proses antrean: klaim baris atomik (FOR UPDATE SKIP LOCKED → aman untuk beberapa instance/pekerja), kirim, lalu tandai.
 * Gagal → dicoba lagi dengan jeda bertahap sampai MAX_ATTEMPTS, kemudian FAILED (terlihat di Pengaturan).
 */
export async function processDeliveries(opts: { limit?: number } = {}): Promise<ProcessResult> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const claimed = await prisma.$queryRaw<Claimed[]>`
    UPDATE notification_deliveries SET "attempts" = "attempts" + 1, "nextAttemptAt" = now() + make_interval(secs => ${LEASE_SECONDS})
    WHERE id IN (
      SELECT id FROM notification_deliveries WHERE "status" = 'PENDING' AND "nextAttemptAt" <= now()
      ORDER BY id LIMIT ${limit} FOR UPDATE SKIP LOCKED)
    RETURNING id, "userId", channel::text AS channel, "toAddress", subject, body, attempts`;
  const result: ProcessResult = { claimed: claimed.length, sent: 0, failed: 0, retried: 0, skipped: 0 };
  for (const d of claimed) {
    // Pengguna dinonaktifkan / mematikan saluran setelah antrean dibuat → lewati.
    const u = d.userId ? await prisma.user.findUnique({ where: { id: d.userId }, select: { isActive: true, notifyEmail: true, notifyWhatsapp: true } }) : null;
    if (d.userId && (!u || !u.isActive || (d.channel === "EMAIL" ? !u.notifyEmail : !u.notifyWhatsapp))) {
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: "SKIPPED", lastError: "Pengguna nonaktif / saluran dimatikan" } });
      result.skipped++;
      continue;
    }
    try {
      if (d.channel === "EMAIL") await sendEmail({ to: d.toAddress, subject: d.subject ?? "Notifikasi", text: d.body });
      else await sendWhatsapp({ to: d.toAddress, text: d.body });
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: "SENT", sentAt: new Date(), lastError: null } });
      result.sent++;
    } catch (e) {
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      if (d.attempts >= MAX_ATTEMPTS) {
        await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: "FAILED", lastError: msg } });
        result.failed++;
      } else {
        await prisma.$executeRaw`UPDATE notification_deliveries SET "lastError" = ${msg}, "nextAttemptAt" = now() + make_interval(secs => ${backoffSeconds(d.attempts)}) WHERE id = ${d.id}`;
        result.retried++;
      }
    }
  }
  return result;
}
