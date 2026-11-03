/**
 * Aturan kontrak kerja & pengingat (murni, tanpa database — mudah diuji).
 *
 * Pengingat ke pimpinan: H-3 bulan sebelum kontrak berakhir (kunci "M3"), lalu penegasan H-1 bulan ("M1") dan H-14 hari ("D14")
 * SELAMA keputusan lanjut/tidak belum diambil. Tiap tonggak dikirim paling banyak sekali. Bila kontrak baru diunggah ketika sudah
 * melewati beberapa tonggak, yang dikirim hanya SATU (yang terbaru) dan tonggak sebelumnya ditandai terkirim — tidak membanjiri.
 */
import { addDays, addMonths, diffDays } from "./time";

export interface ReminderMilestone { key: "M3" | "M1" | "D14"; label: string; dueOn: (endDate: string) => string }

export const REMINDER_MILESTONES: readonly ReminderMilestone[] = [
  { key: "M3", label: "3 bulan", dueOn: (e) => addMonths(e, -3) },
  { key: "M1", label: "1 bulan", dueOn: (e) => addMonths(e, -1) },
  { key: "D14", label: "14 hari", dueOn: (e) => addDays(e, -14) },
];

/** Jendela peringatan awal: mulai H-3 bulan. */
export const REMINDER_LEAD_MONTHS = 3;

export type ContractPhase = "NO_EXPIRY" | "ACTIVE" | "EXPIRING" | "EXPIRED";

export function contractPhase(endDate: string | null, today: string): ContractPhase {
  if (!endDate) return "NO_EXPIRY";
  if (today > endDate) return "EXPIRED";
  if (today >= addMonths(endDate, -REMINDER_LEAD_MONTHS)) return "EXPIRING";
  return "ACTIVE";
}

/** Sisa hari sampai tanggal berakhir (negatif = sudah lewat). */
export function daysLeft(endDate: string, today: string): number {
  return diffDays(endDate, today);
}

export interface DueReminder { milestone: ReminderMilestone; /** Semua tonggak yang sudah jatuh tempo (termasuk yang dikirim sekarang) → ditandai terkirim. */ markSent: string[] }

/**
 * Pengingat yang harus dikirim sekarang, atau null. Tidak ada pengingat bila: kontrak tanpa tanggal berakhir, sudah berakhir,
 * keputusan sudah diambil, kontrak sudah diperpanjang, atau tidak ada tonggak baru yang jatuh tempo.
 */
export function dueReminder(opts: { endDate: string | null; today: string; sent: readonly string[]; decided: boolean; renewed: boolean }): DueReminder | null {
  const { endDate, today, sent, decided, renewed } = opts;
  if (!endDate || decided || renewed || today > endDate) return null;
  const reached = REMINDER_MILESTONES.filter((m) => m.dueOn(endDate) <= today);
  if (reached.length === 0) return null;
  const latest = reached[reached.length - 1]!;
  if (sent.includes(latest.key)) return null;
  return { milestone: latest, markSent: reached.map((m) => m.key) };
}
