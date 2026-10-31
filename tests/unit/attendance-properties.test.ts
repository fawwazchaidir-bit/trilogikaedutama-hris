/**
 * Uji properti (acak dengan seed tetap → dapat diulang) untuk mesin absensi Tahap 2:
 * jadwal reguler & lintas tengah malam × cuti/izin/sakit sehari penuh & setengah hari × jam check-in/out × "sekarang" acak.
 * Yang dijaga adalah INVARIAN, bukan angka tertentu.
 */
import { describe, expect, it } from "vitest";
import { deriveDay, shiftWindow, summarizeDays, totalsAreConsistent, type DayInput, type DayPart, type DayResult, type LeaveKind, type ScheduleLite } from "@/lib/attendance";
import { addDays, isoWeekday } from "@/lib/time";

const TZ = "Asia/Jakarta";

/** PRNG mulberry32 — deterministik. */
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (min: number) => `${pad(Math.floor(((min % 1440) + 1440) % 1440 / 60))}:${pad((((min % 1440) + 1440) % 1440) % 60)}`;
const instant = (date: string, minutesFromMidnight: number) => new Date(new Date(`${date}T00:00:00+07:00`).getTime() + minutesFromMidnight * 60_000);

function randomSchedule(r: () => number): ScheduleLite {
  const overnight = r() < 0.5;
  const start = Math.floor(r() * 24 * 4) * 15; // kelipatan 15 menit
  const length = overnight ? (6 + Math.floor(r() * 10)) * 60 : (4 + Math.floor(r() * 8)) * 60; // 6–15 jam malam; 4–11 jam siang
  const end = (start + length) % 1440;
  const real = overnight ? length : length;
  const tolerance = Math.floor(r() * 5) * 5;
  // batas tidak hadir: di antara (jam masuk + toleransi) dan jam pulang, selalu setelah toleransi
  const cutoffOffset = tolerance + 15 + Math.floor(r() * Math.max(1, (real - tolerance - 15) / 15)) * 15;
  const crossesDay = start + length >= 1440;
  return {
    id: "s", name: overnight || crossesDay ? "Malam" : "Reguler", workDays: [1, 2, 3, 4, 5, 6, 7].filter(() => r() < 0.8).concat(1),
    startTime: hhmm(start), endTime: hhmm(end), lateToleranceMinutes: tolerance, absentCutoffTime: hhmm(start + Math.min(cutoffOffset, real - 15)),
  };
}

describe("mesin absensi — properti acak", () => {
  it("5.000 kombinasi: tidak pernah error; pecahan hari selalu berjumlah 1 pada hari terjadwal & 0 di luar itu; kolom turunan konsisten", () => {
    const r = rng(20261031);
    const results: DayResult[] = [];
    let scheduledSeen = 0, halfSeen = 0, overnightSeen = 0, lateSeen = 0, absentSeen = 0;
    for (let i = 0; i < 5000; i++) {
      const schedule = randomSchedule(r);
      const date = addDays("2026-03-02", Math.floor(r() * 60));
      const win = shiftWindow(date, schedule, TZ);
      const parts: DayPart[] = ["FULL", "MORNING", "AFTERNOON"];
      const leave = r() < 0.4 ? { type: (["IZIN", "SAKIT", "CUTI"] as LeaveKind[])[Math.floor(r() * 3)]!, requestId: "l", dayPart: parts[Math.floor(r() * 3)]! } : null;
      const hasAtt = r() < 0.7;
      const inAt = new Date(win.start.getTime() + (Math.floor(r() * 24 * 4) - 12) * 15 * 60_000); // −3 jam … +21 jam dari jam masuk
      const outAt = r() < 0.75 ? new Date(inAt.getTime() + Math.floor(r() * 16 * 4) * 15 * 60_000) : null;
      const now = new Date(win.start.getTime() + (Math.floor(r() * 24 * 6) - 24) * 10 * 60_000 + Math.floor(r() * 3) * 86_400_000);
      const input: DayInput = {
        date, now, timeZone: TZ, join: "2026-01-01", end: null, schedule,
        calendar: r() < 0.05 ? { kind: "HOLIDAY", name: "Libur uji" } : r() < 0.03 ? { kind: "SPECIAL_WORKDAY", name: "Pengganti" } : null,
        leave, attendance: hasAtt ? { checkInAt: inAt, checkOutAt: outAt } : null, lateAfterTolerance: r() < 0.5,
      };
      const d = deriveDay(input);
      results.push(d);

      const f = d.fractions;
      const sum = f.present + f.izin + f.sakit + f.cuti + f.absent + f.pending;
      if (d.scheduled) {
        scheduledSeen++;
        expect(sum, `#${i} ${JSON.stringify(input)}`).toBe(1);
        for (const v of Object.values(f)) expect([0, 0.5, 1], `#${i} pecahan`).toContain(v);
      } else {
        expect(sum, `#${i} tidak terjadwal`).toBe(0);
      }
      if (d.dayPart && d.dayPart !== "FULL") halfSeen++;
      if (d.endsNextDay && d.scheduled) overnightSeen++;
      if (d.late) lateSeen++;
      if (f.absent > 0) absentSeen++;

      expect(d.workedMinutes).toBeGreaterThanOrEqual(0);
      expect(d.afterEndMinutes).toBeGreaterThanOrEqual(0);
      expect(d.lateMinutes).toBeGreaterThanOrEqual(0);
      expect(d.late, `#${i}`).toBe(d.status === "TERLAMBAT");
      expect(d.lateMinutes > 0, `#${i}`).toBe(d.late);
      if (!d.checkInAt) { expect(d.workedMinutes).toBe(0); expect(f.present).toBe(0); }
      if (d.checkInAt && d.scheduled) expect(f.present, `#${i} hadir tercatat`).toBeGreaterThan(0);
      if (d.checkInAt && d.scheduled && d.dayPart === "FULL") expect(f.present).toBe(1);
      if (d.checkOutAt) expect(d.missingCheckout).toBe(false);
      if (!d.checkOutAt && d.checkInAt) expect(d.missingCheckout).toBe(true);
      if (d.incomplete) expect(d.missingCheckout).toBe(true);
      expect(d.explain.length, `#${i} penjelasan`).toBeGreaterThan(0);
      // Hari non-kerja tidak pernah dihitung tidak hadir / pending.
      if (!d.scheduled) { expect(f.absent).toBe(0); expect(f.pending).toBe(0); }
      // Deterministik: hasil yang sama untuk masukan yang sama.
      expect(deriveDay(input)).toEqual(d);
    }
    // Uji tidak kosong: semua jenis kasus benar-benar terambil.
    expect(scheduledSeen).toBeGreaterThan(2500);
    expect(halfSeen).toBeGreaterThan(300);
    expect(overnightSeen).toBeGreaterThan(300);
    expect(lateSeen).toBeGreaterThan(100);
    expect(absentSeen).toBeGreaterThan(100);

    // Agregasi: untuk sembarang himpunan hari, jumlah pecahan = hari terjadwal (diurutkan menurut tanggal tidak penting).
    for (let k = 0; k < 50; k++) {
      const slice = results.slice(k * 100, k * 100 + 100);
      const t = summarizeDays(slice);
      expect(totalsAreConsistent(t), `agregat ${k}`).toBe(true);
    }
  });

  it("jendela shift: akhir > awal; titik tengah di antara; batas tidak hadir di dalam shift; penutupan setelah akhir + masa tenggang — untuk 3.000 jadwal acak", () => {
    const r = rng(7);
    for (let i = 0; i < 3000; i++) {
      const s = randomSchedule(r);
      const date = addDays("2026-03-02", Math.floor(r() * 400));
      const w = shiftWindow(date, s, TZ);
      expect(w.end.getTime(), JSON.stringify(s)).toBeGreaterThan(w.start.getTime());
      expect(w.mid.getTime()).toBeGreaterThan(w.start.getTime());
      expect(w.mid.getTime()).toBeLessThan(w.end.getTime());
      expect(w.cutoff.getTime()).toBeGreaterThan(w.start.getTime());
      expect(w.cutoff.getTime(), `batas tidak hadir ${JSON.stringify(s)}`).toBeLessThanOrEqual(w.end.getTime());
      expect(w.closeAt.getTime()).toBeGreaterThanOrEqual(w.end.getTime());
      expect(w.end.getTime() - w.start.getTime()).toBeLessThanOrEqual(16 * 3_600_000);
      expect(isoWeekday(date)).toBeGreaterThanOrEqual(1);
    }
  });

  it("tanggal sekitar pergantian jam/hari: shift melewati tengah malam di akhir bulan & tahun tetap menjadi milik tanggal MULAI", () => {
    const night: ScheduleLite = { id: "n", name: "Malam", workDays: [1, 2, 3, 4, 5, 6, 7], startTime: "22:00", endTime: "06:00", lateToleranceMinutes: 15, absentCutoffTime: "02:00" };
    for (const date of ["2026-12-31", "2026-02-28", "2028-02-28", "2026-03-31"]) {
      const d = deriveDay({
        date, now: instant(addDays(date, 1), 7 * 60), timeZone: TZ, join: "2020-01-01", end: null, schedule: night, calendar: null, leave: null,
        attendance: { checkInAt: instant(date, 22 * 60 - 5), checkOutAt: instant(addDays(date, 1), 6 * 60 + 10) },
      });
      expect(d.date).toBe(date);
      expect(d.status).toBe("HADIR");
      expect(d.checkOutNextDay).toBe(true);
      expect(d.workedMinutes).toBe(8 * 60 + 15);
      expect(d.afterEndMinutes).toBe(10);
      expect(d.fractions.present).toBe(1);
    }
  });
});
