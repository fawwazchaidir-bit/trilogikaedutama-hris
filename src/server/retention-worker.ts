import "server-only";
import { env } from "./env";
import { purgeExpiredPhotos } from "./services/photo-retention";

const INTERVAL_MS = 6 * 3_600_000;
const g = globalThis as unknown as { __retentionWorker?: NodeJS.Timeout };

/**
 * Pekerja retensi di dalam proses aplikasi: menghapus foto absensi kedaluwarsa tiap 6 jam (dan 2 menit setelah mulai).
 * Aman di banyak instance (SKIP LOCKED). Matikan dengan RETENTION_WORKER=false bila memakai pemicu eksternal.
 */
export function startRetentionWorker(): void {
  if (g.__retentionWorker || !env().RETENTION_WORKER) return;
  const tick = () => {
    void purgeExpiredPhotos()
      .then((r) => { if (r.purged > 0) console.log(`[retensi] ${r.purged} foto absensi lebih tua dari ${r.months} bulan dihapus${r.held ? `; ${r.held} ditahan (sedang ditinjau/terkonfirmasi)` : ""}.`); })
      .catch((e) => console.error("[retensi] gagal menghapus foto kedaluwarsa:", e instanceof Error ? e.message : e));
  };
  g.__retentionWorker = setInterval(tick, INTERVAL_MS);
  g.__retentionWorker.unref?.();
  setTimeout(tick, 120_000).unref?.();
}
