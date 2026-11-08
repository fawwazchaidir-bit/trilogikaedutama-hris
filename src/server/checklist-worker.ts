import "server-only";
import { env } from "./env";
import { runChecklistReminders } from "./services/employee-checklists";

const INTERVAL_MS = 3_600_000;
const g = globalThis as unknown as { __checklistWorker?: NodeJS.Timeout };

/**
 * Pekerja pengingat checklist masuk/berhenti di dalam proses aplikasi: tiap jam (dan 4 menit setelah mulai) mengirim pengingat butir yang jatuh tempo besok,
 * hari ini, atau terlambat. Idempoten & aman di banyak instance (kunci dedupe di database). Matikan dengan CHECKLIST_REMINDER_WORKER=false
 * bila memakai pemicu eksternal /api/internal/checklist-reminders.
 */
export function startChecklistWorker(): void {
  if (g.__checklistWorker || !env().CHECKLIST_REMINDER_WORKER) return;
  const tick = () => {
    void runChecklistReminders()
      .then((r) => { if (r.sent > 0) console.log(`[checklist] ${r.sent} pengingat butir checklist dikirim (${r.checked} butir diperiksa).`); })
      .catch((e) => console.error("[checklist] gagal mengirim pengingat:", e instanceof Error ? e.message : e));
  };
  g.__checklistWorker = setInterval(tick, INTERVAL_MS);
  g.__checklistWorker.unref?.();
  setTimeout(tick, 240_000).unref?.();
}
