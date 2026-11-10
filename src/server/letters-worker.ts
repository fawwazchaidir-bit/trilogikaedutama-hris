import "server-only";
import { env } from "./env";
import { runFollowUpReminders } from "./services/letters/commercial";

const INTERVAL_MS = 3_600_000;
const g = globalThis as unknown as { __lettersWorker?: NodeJS.Timeout };

/** Pengingat follow-up penawaran: tiap jam memeriksa jadwal yang jatuh tempo/terlambat dan mengirim notifikasi (sekali per hari per surat; kunci dedupe di database). */
export function startLettersWorker(): void {
  if (g.__lettersWorker || !env().LETTERS_MODULE_ENABLED || !env().LETTERS_WORKER) return;
  const tick = () => {
    void runFollowUpReminders()
      .then((r) => { if (r.sent > 0) console.log(`[surat] ${r.sent} pengingat follow-up penawaran dikirim.`); })
      .catch((e) => console.error("[surat] gagal mengirim pengingat follow-up:", e instanceof Error ? e.message : e));
  };
  g.__lettersWorker = setInterval(tick, INTERVAL_MS);
  g.__lettersWorker.unref?.();
  setTimeout(tick, 300_000).unref?.();
}
