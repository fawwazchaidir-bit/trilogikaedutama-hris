/** Format tampilan tanggal/waktu/durasi Bahasa Indonesia (zona waktu bisnis). */
import { DEFAULT_TIMEZONE, localDate, localTime } from "./time";

export { DEFAULT_TIMEZONE, todayIso, currentYearMonth } from "./time";

const MONTHS_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];
const MONTHS_ID_SHORT = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
export const WEEKDAYS_ID = ["", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];
export const WEEKDAYS_ID_SHORT = ["", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"];

/** "2026-01-13" → "13/01/2026". */
export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "-";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/** "2026-01-13" → "13 Januari 2026". */
export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return "-";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)} ${MONTHS_ID[Number(m) - 1] ?? m} ${y}`;
}

/** "2026-01-13" → "Selasa, 13 Januari 2026". */
export function formatDateWithDay(iso: string | null | undefined): string {
  if (!iso) return "-";
  const wd = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay();
  return `${WEEKDAYS_ID[wd === 0 ? 7 : wd]}, ${formatDateLong(iso)}`;
}

/** "2026-01-13" → "Sel, 13 Jan". */
export function formatDateCompact(iso: string | null | undefined): string {
  if (!iso) return "-";
  const [, m, d] = iso.slice(0, 10).split("-");
  const wd = new Date(`${iso.slice(0, 10)}T00:00:00Z`).getUTCDay();
  return `${WEEKDAYS_ID_SHORT[wd === 0 ? 7 : wd]}, ${Number(d)} ${MONTHS_ID_SHORT[Number(m) - 1] ?? m}`;
}

export function monthLabel(ym: string, short = false): string {
  const [y, m] = ym.split("-");
  const names = short ? MONTHS_ID_SHORT : MONTHS_ID;
  return `${names[Number(m) - 1] ?? m} ${y}`;
}

/** Rentang tanggal ringkas: "1 – 31 Oktober 2026" atau "25 September – 24 Oktober 2026". */
export function formatDateRange(from: string, to: string): string {
  if (from === to) return formatDateLong(from);
  const [fy, fm, fd] = from.split("-");
  const [ty, tm, td] = to.split("-");
  if (fy === ty && fm === tm) return `${Number(fd)} – ${Number(td)} ${MONTHS_ID[Number(tm) - 1]} ${ty}`;
  if (fy === ty) return `${Number(fd)} ${MONTHS_ID[Number(fm) - 1]} – ${Number(td)} ${MONTHS_ID[Number(tm) - 1]} ${ty}`;
  return `${formatDateLong(from)} – ${formatDateLong(to)}`;
}

/** Timestamp → "13/01/2026 14:05" di zona waktu bisnis. */
export function formatDateTime(value: Date | string | null | undefined, timeZone: string = DEFAULT_TIMEZONE): string {
  if (!value) return "-";
  const d = typeof value === "string" ? new Date(value) : value;
  return `${formatDateShort(localDate(d, timeZone))} ${localTime(d, timeZone)}`;
}

/** Timestamp → "14:05" (WIB). */
export function formatClock(value: Date | string | null | undefined, timeZone: string = DEFAULT_TIMEZONE): string {
  if (!value) return "-";
  return localTime(typeof value === "string" ? new Date(value) : value, timeZone);
}

/** 450 → "7 j 30 m"; 0 → "0 m". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} m`;
  return r === 0 ? `${h} j` : `${h} j ${r} m`;
}

/** Jumlah hari yang boleh berpecahan 0,5: 3 → "3", 2.5 → "2,5". */
export function formatDays(n: number): string {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r).replace(".", ",");
}

/** 450 → "7,50" jam (desimal, koma Indonesia) untuk ekspor & kolom ringkas. */
export function formatHours(minutes: number): string {
  return (Math.round((minutes / 60) * 100) / 100).toFixed(2).replace(".", ",");
}

/** "08:00" → "08.00" untuk narasi (gaya Indonesia). */
export function dotTime(hhmm: string): string {
  return hhmm.replace(":", ".");
}

/** "2 jam lalu", "kemarin", "3 hari lalu" untuk umpan aktivitas. Lebih dari 30 hari → tanggal. `nowMs` untuk pengujian. */
export function timeAgo(value: Date | string, nowMs: number = Date.now()): string {
  const t = (value instanceof Date ? value : new Date(value)).getTime();
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 60) return "baru saja";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} menit lalu`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} jam lalu`;
  const d = Math.floor(h / 24);
  if (d === 1) return "kemarin";
  if (d <= 30) return `${d} hari lalu`;
  return formatDateShort(new Date(t).toISOString().slice(0, 10));
}
