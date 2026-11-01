import "server-only";
import { env } from "../env";
import { processDeliveries } from "./deliveries";

const INTERVAL_MS = 30_000;
const g = globalThis as unknown as { __deliveryWorker?: NodeJS.Timeout };

/**
 * Pekerja pengiriman di dalam proses aplikasi: memproses antrean tiap 30 detik. Aman dijalankan di banyak instance
 * (klaim baris memakai SKIP LOCKED). Matikan dengan DELIVERY_WORKER=false bila memakai pemicu eksternal (/api/internal/deliveries).
 */
export function startDeliveryWorker(): void {
  if (g.__deliveryWorker || !env().DELIVERY_WORKER) return;
  const tick = () => { void processDeliveries({ limit: 25 }).catch((e) => console.error("[deliveries] gagal memproses antrean:", e instanceof Error ? e.message : e)); };
  g.__deliveryWorker = setInterval(tick, INTERVAL_MS);
  g.__deliveryWorker.unref?.();
  setTimeout(tick, 5_000).unref?.();
}
