/**
 * Utilitas tanggal & waktu BISNIS. Seluruh "hari" di sistem ini adalah hari kalender di zona waktu perusahaan
 * (APP_TIMEZONE, default Asia/Jakarta = WIB). Tanggal disimpan/dioper sebagai string "YYYY-MM-DD",
 * jam kerja sebagai "HH:mm". Waktu absensi selalu berasal dari jam SERVER, bukan perangkat karyawan.
 */

export const DEFAULT_TIMEZONE = "Asia/Jakarta";

const MS_DAY = 86_400_000;

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    dtfCache.set(timeZone, f);
  }
  return f;
}

interface Parts { y: number; mo: number; d: number; h: number; mi: number; s: number }

function partsOf(instant: Date, timeZone: string): Parts {
  const out: Record<string, number> = {};
  for (const p of dtf(timeZone).formatToParts(instant)) if (p.type !== "literal") out[p.type] = Number(p.value);
  return { y: out.year!, mo: out.month!, d: out.day!, h: out.hour! % 24, mi: out.minute!, s: out.second! };
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** Tanggal lokal "YYYY-MM-DD" dari sebuah instan waktu. */
export function localDate(instant: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const p = partsOf(instant, timeZone);
  return `${pad(p.y, 4)}-${pad(p.mo)}-${pad(p.d)}`;
}

/** Menit sejak tengah malam lokal (detik dibuang). */
export function localMinutes(instant: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  const p = partsOf(instant, timeZone);
  return p.h * 60 + p.mi;
}

/** "HH:mm" lokal dari sebuah instan. */
export function localTime(instant: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const p = partsOf(instant, timeZone);
  return `${pad(p.h)}:${pad(p.mi)}`;
}

/** "HH:mm" → menit sejak tengah malam. */
export function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":");
  return Number(h) * 60 + Number(m);
}

export function minutesToTime(min: number): string {
  const m = Math.max(0, Math.min(min, 24 * 60 - 1));
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

/** Instan UTC dari tanggal+jam LOKAL di zona tertentu (mendukung zona ber-DST lewat iterasi offset). */
export function zonedInstant(date: string, hhmm: string, timeZone: string = DEFAULT_TIMEZONE): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = hhmm.split(":").map(Number);
  const wanted = Date.UTC(y!, mo! - 1, d!, h!, mi!, 0);
  let guess = wanted;
  for (let i = 0; i < 3; i++) {
    const p = partsOf(new Date(guess), timeZone);
    const shown = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s);
    const diff = wanted - shown;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

/** Awal hari lokal (00:00) sebagai instan; dipakai untuk rentang query timestamp. */
export function startOfLocalDay(date: string, timeZone: string = DEFAULT_TIMEZONE): Date {
  return zonedInstant(date, "00:00", timeZone);
}

export function todayIso(timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  return localDate(now, timeZone);
}

export function currentYearMonth(timeZone: string = DEFAULT_TIMEZONE, now: Date = new Date()): string {
  return todayIso(timeZone, now).slice(0, 7);
}

// ─────────────────────────── Aritmetika tanggal kalender (bebas zona waktu) ───────────────────────────

const toMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const fromMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(iso: string, n: number): string {
  return fromMs(toMs(iso) + n * MS_DAY);
}

/**
 * Tambah `n` bulan kalender (boleh negatif). Hari dipertahankan; bila bulan tujuan lebih pendek, dipangkas ke hari terakhir
 * bulan itu (31 Jan + 1 bln = 28/29 Feb). Dipakai untuk "berhak cuti setelah N bulan" dan pengingat kontrak "H-3 bulan".
 */
export function addMonths(iso: string, n: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const idx = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(idx / 12);
  const nm = idx - ny * 12; // 0..11
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate();
  return `${String(ny).padStart(4, "0")}-${String(nm + 1).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

export function diffDays(a: string, b: string): number {
  return Math.round((toMs(a) - toMs(b)) / MS_DAY);
}

/** Hari dalam seminggu ISO: 1 = Senin … 7 = Minggu. */
export function isoWeekday(iso: string): number {
  const d = new Date(toMs(iso)).getUTCDay();
  return d === 0 ? 7 : d;
}

/** Semua tanggal dari `from` sampai `to` (inklusif). Dibatasi agar tidak meledak pada input salah. */
export function eachDate(from: string, to: string, max = 400): string[] {
  const n = diffDays(to, from) + 1;
  if (n <= 0) return [];
  if (n > max) throw new RangeError(`Rentang tanggal terlalu panjang (maksimal ${max} hari)`);
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(addDays(from, i));
  return out;
}

/** Senin pada minggu yang memuat `iso`. */
export function startOfIsoWeek(iso: string): string {
  return addDays(iso, -(isoWeekday(iso) - 1));
}

export function endOfIsoWeek(iso: string): string {
  return addDays(startOfIsoWeek(iso), 6);
}

/** "2026-10" → { from: "2026-10-01", to: "2026-10-31" }. */
export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split("-").map(Number);
  const last = new Date(Date.UTC(y!, m!, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${pad(last)}` };
}

export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const ms = toMs(s);
  return !Number.isNaN(ms) && fromMs(ms) === s;
}

export function isValidYearMonth(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
}

/** Rentang [a1,a2] dan [b1,b2] saling beririsan? (b2 null = tak terbatas). */
export function rangesOverlap(a1: string, a2: string | null, b1: string, b2: string | null): boolean {
  const aEndsBeforeB = a2 !== null && a2 < b1;
  const bEndsBeforeA = b2 !== null && b2 < a1;
  return !aEndsBeforeB && !bEndsBeforeA;
}
