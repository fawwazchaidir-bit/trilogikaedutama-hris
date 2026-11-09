import "server-only";
import { env } from "./env";
import { healChannelMembers } from "./services/chat/admin";
import { purgeExpiredMessages } from "./services/chat/retention";

const INTERVAL_MS = 6 * 3_600_000;
const g = globalThis as unknown as { __chatWorker?: NodeJS.Timeout };

/**
 * Pekerja Obrolan di dalam proses aplikasi: retensi isi pesan + pemulih keanggotaan kanal publik, tiap 6 jam (dan 3 menit setelah mulai).
 * Idempoten dan aman di banyak instance. Hanya aktif bila CHAT_MODULE_ENABLED dan CHAT_WORKER.
 */
export function startChatWorker(): void {
  if (g.__chatWorker || !env().CHAT_MODULE_ENABLED || !env().CHAT_WORKER) return;
  const tick = () => {
    void (async () => {
      const r = await purgeExpiredMessages();
      if (r.purged > 0) console.log(`[obrolan] isi ${r.purged} pesan lebih tua dari ${r.months} bulan dibersihkan.`);
      await healChannelMembers();
    })().catch((e) => console.error("[obrolan] pekerja gagal:", e instanceof Error ? e.message : e));
  };
  g.__chatWorker = setInterval(tick, INTERVAL_MS);
  g.__chatWorker.unref?.();
  setTimeout(tick, 180_000).unref?.();
}
