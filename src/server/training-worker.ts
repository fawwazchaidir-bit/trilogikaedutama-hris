import "server-only";
import { env, trainingEnabled } from "./env";
import { runTrainingDailyJob } from "./services/training/automation";

const INTERVAL_MS = 3_600_000;
const g = globalThis as unknown as { __trainingWorker?: NodeJS.Timeout };

/**
 * Pekerja Training & Operations di dalam proses aplikasi: tiap jam membuat snapshot status program, mengirim eskalasi otomatis, dan
 * pengingat tenggat H-1/hari-H (5 menit setelah mulai untuk pertama kali). Idempoten & aman di banyak instance (kunci dedupe di database).
 * Hanya bekerja bila modul menyala; matikan dengan TRAINING_WORKER=false bila memakai pemicu eksternal /api/internal/training-daily.
 */
export function startTrainingWorker(): void {
  if (g.__trainingWorker || !trainingEnabled() || !env().TRAINING_WORKER) return;
  const tick = () => {
    void runTrainingDailyJob()
      .then((r) => { if (r.reminders + r.escalations > 0) console.log(`[training] ${r.escalations} eskalasi dan ${r.reminders} pengingat dikirim (${r.snapshots} snapshot status).`); })
      .catch((e) => console.error("[training] pekerja harian gagal:", e instanceof Error ? e.message : e));
  };
  g.__trainingWorker = setInterval(tick, INTERVAL_MS);
  g.__trainingWorker.unref?.();
  setTimeout(tick, 300_000).unref?.();
}
