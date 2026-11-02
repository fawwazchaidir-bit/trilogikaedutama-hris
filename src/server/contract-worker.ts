import "server-only";
import { env } from "./env";
import { runContractReminders } from "./services/documents";

const INTERVAL_MS = 6 * 3_600_000;
const g = globalThis as unknown as { __contractWorker?: NodeJS.Timeout };

/**
 * Pekerja pengingat kontrak di dalam proses aplikasi: memeriksa kontrak yang mendekati berakhir tiap 6 jam (dan 3 menit setelah mulai)
 * lalu mengirim pengingat yang jatuh tempo ke pimpinan. Idempoten & aman di banyak instance. Matikan dengan CONTRACT_REMINDER_WORKER=false
 * bila memakai pemicu eksternal /api/internal/contract-reminders.
 */
export function startContractWorker(): void {
  if (g.__contractWorker || !env().CONTRACT_REMINDER_WORKER) return;
  const tick = () => {
    void runContractReminders()
      .then((r) => { if (r.sent > 0) console.log(`[kontrak] ${r.sent} pengingat kontrak berakhir dikirim ke pimpinan (${r.checked} kontrak diperiksa).`); })
      .catch((e) => console.error("[kontrak] gagal memeriksa pengingat kontrak:", e instanceof Error ? e.message : e));
  };
  g.__contractWorker = setInterval(tick, INTERVAL_MS);
  g.__contractWorker.unref?.();
  setTimeout(tick, 180_000).unref?.();
}
