import "server-only";
import { prisma } from "../../db";
import { env } from "../../env";
import { retentionCutoff } from "@/lib/chat/logic";

/**
 * Retensi isi pesan (bawaan 6 bulan, CHAT_RETENTION_MONTHS). Pesan TIDAK dihapus: isi dikosongkan dan `purgedAt` diisi (trigger melarang DELETE);
 * riwayat sunting pesan itu ikut dihapus (trigger mengizinkan hanya setelah induknya dibersihkan). Ruang `legalHold` ditahan.
 */
export async function purgeExpiredMessages(now: Date = new Date()): Promise<{ purged: number; months: number }> {
  const months = env().CHAT_RETENTION_MONTHS;
  const cutoff = retentionCutoff(now, months);
  const purged = await prisma.$executeRaw`
    UPDATE chat_messages SET "body" = NULL, "purgedAt" = ${now}
    WHERE "createdAt" < ${cutoff} AND "purgedAt" IS NULL AND "body" IS NOT NULL
      AND "roomId" NOT IN (SELECT id FROM chat_rooms WHERE "legalHold")`;
  await prisma.$executeRaw`DELETE FROM chat_message_revisions r USING chat_messages m WHERE m.id = r."messageId" AND m."purgedAt" IS NOT NULL`;
  return { purged: Number(purged), months };
}
