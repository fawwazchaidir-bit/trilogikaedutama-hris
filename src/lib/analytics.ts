/**
 * Analitik SDM — FUNGSI MURNI di atas hasil harian (`DayResult`) dan total rekap (`RecapTotals`) yang sama dengan rekap & gaji,
 * sehingga angka laporan selalu konsisten dengan angka di layar lain. Rasio memakai hari kerja yang SUDAH DAPAT DINILAI
 * (hari terjadwal dikurangi hari yang belum berlalu), dan mengembalikan `null` (bukan 0) bila penyebutnya nol.
 */
import type { DayResult, RecapTotals } from "./attendance";
import { addDays, isoWeekday } from "./time";

export interface Rates {
  /** Hadir ÷ hari kerja yang dapat dinilai. */
  attendance: number | null;
  /** Tidak hadir (tanpa keterangan) ÷ hari kerja yang dapat dinilai. */
  absence: number | null;
  /** Hadir tepat waktu ÷ hadir. */
  punctuality: number | null;
  /** Izin + sakit + cuti ÷ hari kerja yang dapat dinilai. */
  leave: number | null;
}

const ratio = (n: number, d: number): number | null => (d > 0 ? n / d : null);

/** Hari kerja yang sudah dapat dinilai = terjadwal − belum berlalu/belum absen. */
export const assessableDays = (t: RecapTotals): number => Math.max(0, t.scheduledDays - t.pendingDays);

export function ratesOf(t: RecapTotals): Rates {
  const due = assessableDays(t);
  return {
    attendance: ratio(t.presentDays, due),
    absence: ratio(t.absentDays, due),
    punctuality: ratio(t.onTimeDays, t.presentDays),
    leave: ratio(t.izinDays + t.sakitDays + t.cutiDays, due),
  };
}

export interface Delta { abs: number | null; pct: number | null }

/** Selisih terhadap pembanding. `pct` null bila pembanding 0/null (tidak ada dasar persentase). */
export function delta(cur: number | null, prev: number | null): Delta {
  if (cur === null || prev === null) return { abs: null, pct: null };
  return { abs: cur - prev, pct: prev === 0 ? null : (cur - prev) / Math.abs(prev) };
}

/** Jumlahkan beberapa total rekap (mis. per divisi). */
export function sumTotals(list: RecapTotals[]): RecapTotals {
  const out: RecapTotals = {
    scheduledDays: 0, presentDays: 0, onTimeDays: 0, lateDays: 0, lateCount: 0, lateMinutes: 0, izinDays: 0, sakitDays: 0, cutiDays: 0,
    absentDays: 0, pendingDays: 0, incompleteCount: 0, workedMinutes: 0, offDayAttendance: 0, offDays: 0,
  };
  for (const t of list) for (const k of Object.keys(out) as (keyof RecapTotals)[]) out[k] += t[k] ?? 0;
  return out;
}

export interface WeekdayRow { weekday: number; scheduled: number; present: number; late: number; absent: number }

/** Sebaran per hari dalam seminggu (hanya hari terjadwal): di mana keterlambatan/ketidakhadiran menumpuk (mis. Senin/Jumat). */
export function weekdayDistribution(days: DayResult[]): WeekdayRow[] {
  const rows: WeekdayRow[] = [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, scheduled: 0, present: 0, late: 0, absent: 0 }));
  for (const d of days) {
    if (!d.scheduled || d.status === "DI_LUAR_MASA_KERJA") continue;
    const r = rows[isoWeekday(d.date) - 1]!;
    r.scheduled += 1;
    r.present += d.fractions.present;
    if (d.status === "TERLAMBAT") r.late += 1;
    r.absent += d.fractions.absent;
  }
  return rows.filter((r) => r.scheduled > 0);
}

export interface Bucket { label: string; from: number | null; to: number | null; count: number }

/** Sebaran jam datang terhadap jam masuk terjadwal (menit; negatif = lebih awal). Hanya hari hadir pada hari terjadwal. */
export const ARRIVAL_BUCKETS: Omit<Bucket, "count">[] = [
  { label: "> 30 mnt lebih awal", from: null, to: -31 },
  { label: "30–10 mnt lebih awal", from: -31, to: -10 },
  { label: "10 mnt awal – tepat", from: -10, to: 0 },
  { label: "Terlambat 1–15 mnt", from: 0, to: 15 },
  { label: "Terlambat 16–30 mnt", from: 15, to: 30 },
  { label: "Terlambat 31–60 mnt", from: 30, to: 60 },
  { label: "Terlambat > 60 mnt", from: 60, to: null },
];

export function arrivalHistogram(days: DayResult[]): Bucket[] {
  const out: Bucket[] = ARRIVAL_BUCKETS.map((b) => ({ ...b, count: 0 }));
  for (const d of days) {
    if (!d.scheduled || !d.checkInAt || !d.shiftStartAt) continue;
    const offset = Math.floor((Date.parse(d.checkInAt) - Date.parse(d.shiftStartAt)) / 60_000);
    // Lapisan: (from, to] — kecuali yang pertama (−∞, to) dan "tepat" yang memuat 0.
    const b = out.find((x) => (x.from === null || offset > x.from) && (x.to === null || offset <= x.to));
    if (b) b.count++;
  }
  return out;
}

/** Rata-rata menit kerja per hari yang punya check-in DAN check-out (absensi lengkap). */
export function averageWorkedMinutes(days: DayResult[]): number | null {
  const done = days.filter((d) => d.checkOutAt && d.workedMinutes > 0);
  return done.length ? done.reduce((a, d) => a + d.workedMinutes, 0) / done.length : null;
}

/** Turnover = karyawan keluar ÷ rata-rata headcount awal & akhir. */
export function turnoverRate(leavers: number, headcountStart: number, headcountEnd: number): number | null {
  return ratio(leavers, (headcountStart + headcountEnd) / 2);
}

export const TENURE_BUCKETS = ["< 1 tahun", "1–3 tahun", "3–5 tahun", "> 5 tahun"] as const;

/** Masa kerja pada `asOf` ("YYYY-MM-DD"). Tahun dihitung per tahun kalender penuh (ulang tahun masuk). */
export function tenureDistribution(joinDates: string[], asOf: string): { label: (typeof TENURE_BUCKETS)[number]; count: number }[] {
  const counts = [0, 0, 0, 0];
  for (const j of joinDates) {
    let years = Number(asOf.slice(0, 4)) - Number(j.slice(0, 4));
    if (asOf.slice(5) < j.slice(5)) years -= 1;
    counts[years < 1 ? 0 : years < 3 ? 1 : years < 5 ? 2 : 3]!++;
  }
  return TENURE_BUCKETS.map((label, i) => ({ label, count: counts[i]! }));
}

/** Bulan ("YYYY-MM") sejumlah `n` mundur dari `ym` (n=0 → ym itu sendiri), urut menaik. */
export function lastMonths(ym: string, n: number): string[] {
  const out: string[] = [];
  let cur = `${ym}-01`;
  for (let i = 0; i < n; i++) { out.unshift(cur.slice(0, 7)); cur = addDays(cur, -1).slice(0, 7) + "-01"; }
  return out;
}

export function previousMonth(ym: string): string {
  return addDays(`${ym}-01`, -1).slice(0, 7);
}

/** Persentase untuk tampilan: 0.9333 → "93,3%"; null → "—". */
export function formatPercent(v: number | null, digits = 1): string {
  return v === null ? "—" : `${(v * 100).toFixed(digits).replace(".", ",")}%`;
}

/** Perubahan dalam poin persentase (untuk rasio) — "+2,1 poin". */
export function formatPoints(d: number | null): string {
  if (d === null) return "—";
  const v = (d * 100).toFixed(1).replace(".", ",");
  return `${d > 0 ? "+" : ""}${v} poin`;
}

/** Perubahan relatif untuk besaran (jumlah/uang) — "+12,5%". */
export function formatChange(d: Delta): string {
  if (d.pct === null) return d.abs === null ? "—" : d.abs === 0 ? "0%" : "baru";
  const v = (d.pct * 100).toFixed(1).replace(".", ",");
  return `${d.pct > 0 ? "+" : ""}${v}%`;
}
