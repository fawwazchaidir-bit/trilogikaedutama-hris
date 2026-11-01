import "server-only";
import { transaction, prisma } from "../db";
import { writeAudit } from "../audit";
import { retentionCutoff } from "@/lib/retention";
import { getSettings } from "./settings";

/**
 * Retensi foto absensi: foto yang lebih tua dari `attendancePhotoRetentionMonths` bulan dihapus PERMANEN; jejak teks cap
 * (waktu, koordinat, nama, ID foto) tetap tersimpan pada `attendance_photos` (fileId kosong, purgedAt terisi).
 *
 * Dikecualikan (tidak dihapus): foto yang punch-nya sedang ditinjau (OPEN) atau terkonfirmasi manipulasi (CONFIRMED) di antrean
 * Tinjauan Lokasi. Aman dijalankan di banyak instance sekaligus (FOR UPDATE SKIP LOCKED). Tiap batch = satu transaksi
 * (penandaan, penghapusan berkas, dan audit log bersama-sama; tidak ada penghapusan tanpa jejak audit).
 * Catatan: cadangan basis data yang sudah ada tetap memuat foto sampai cadangan itu sendiri kedaluwarsa (BACKUP_KEEP_DAYS).
 */
export interface RetentionResult {
  /** false = retensi 0 bulan (simpan selamanya) → tidak ada yang dihapus. */
  enabled: boolean;
  months: number;
  cutoff: string | null;
  purged: number;
  /** Foto yang sebenarnya sudah melewati batas tetapi ditahan karena sedang/pernah terkonfirmasi ditinjau. */
  held: number;
  batches: number;
}

interface Row { id: string; fileId: string; capturedAt: Date }

export async function purgeExpiredPhotos(opts: { now?: Date; batchSize?: number; maxBatches?: number } = {}): Promise<RetentionResult> {
  const now = opts.now ?? new Date();
  const batchSize = Math.max(1, opts.batchSize ?? 200);
  const maxBatches = Math.max(1, opts.maxBatches ?? 50);
  const months = (await getSettings()).attendancePhotoRetentionMonths;
  const cutoff = retentionCutoff(now, months);
  if (!cutoff) return { enabled: false, months, cutoff: null, purged: 0, held: 0, batches: 0 };

  let purged = 0, batches = 0;
  while (batches < maxBatches) {
    const n = await transaction(async (tx) => {
      const rows = await tx.$queryRaw<Row[]>`
        SELECT p.id, p."fileId", p."capturedAt" FROM attendance_photos p
        WHERE p."purgedAt" IS NULL AND p."fileId" IS NOT NULL AND p."capturedAt" < ${cutoff}
          AND NOT EXISTS (SELECT 1 FROM location_checks c WHERE c."attendanceId" = p."attendanceId" AND c.kind = p.kind AND c."reviewStatus" IN ('OPEN', 'CONFIRMED'))
        ORDER BY p."capturedAt" LIMIT ${batchSize} FOR UPDATE OF p SKIP LOCKED`;
      if (rows.length === 0) return 0;
      const ids = rows.map((r) => r.id), fileIds = rows.map((r) => r.fileId);
      await tx.$executeRaw`UPDATE attendance_photos SET "fileId" = NULL, "purgedAt" = ${now} WHERE id = ANY(${ids}::uuid[])`;
      await tx.$executeRaw`DELETE FROM stored_files WHERE id = ANY(${fileIds}::uuid[]) AND kind = 'ATTENDANCE_PHOTO'`;
      await writeAudit(tx, null, {
        action: "attendance_photo.purge", entityType: "AttendancePhoto",
        summary: `Retensi foto absensi: ${rows.length} foto lebih tua dari ${months} bulan dihapus (sebelum ${cutoff.toISOString().slice(0, 10)}); jejak teks cap dipertahankan`,
        after: { count: rows.length, months, cutoff: cutoff.toISOString(), oldest: rows[0]!.capturedAt.toISOString(), newest: rows[rows.length - 1]!.capturedAt.toISOString() },
      });
      return rows.length;
    });
    if (n === 0) break;
    purged += n; batches++;
    if (n < batchSize) break;
  }

  const heldRows = await prisma.$queryRaw<{ held: bigint }[]>`
    SELECT COUNT(*) AS held FROM attendance_photos p
    WHERE p."purgedAt" IS NULL AND p."fileId" IS NOT NULL AND p."capturedAt" < ${cutoff}
      AND EXISTS (SELECT 1 FROM location_checks c WHERE c."attendanceId" = p."attendanceId" AND c.kind = p.kind AND c."reviewStatus" IN ('OPEN', 'CONFIRMED'))`;
  return { enabled: true, months, cutoff: cutoff.toISOString(), purged, held: Number(heldRows[0]?.held ?? 0), batches };
}
