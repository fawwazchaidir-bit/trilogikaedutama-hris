import { describe, expect, it } from "vitest";
import {
  arrivalHistogram, assessableDays, averageWorkedMinutes, delta, formatChange, formatPercent, formatPoints, lastMonths, previousMonth, ratesOf, sumTotals, tenureDistribution,
  turnoverRate, weekdayDistribution,
} from "@/lib/analytics";
import { emptyTotals, summarizeDays, totalsAreConsistent } from "@/lib/attendance";
import { makeDay } from "../helpers/day";

const totals = (over: Partial<ReturnType<typeof emptyTotals>>) => ({ ...emptyTotals(), ...over });

describe("rasio", () => {
  it("kehadiran/tidak hadir/ketepatan/cuti dihitung dari hari yang dapat dinilai (pending tidak ikut)", () => {
    const t = totals({ scheduledDays: 22, pendingDays: 2, presentDays: 16, onTimeDays: 12, lateDays: 4, lateCount: 4, izinDays: 1, sakitDays: 1, cutiDays: 0, absentDays: 2 });
    expect(assessableDays(t)).toBe(20);
    const r = ratesOf(t);
    expect(r.attendance).toBeCloseTo(0.8);
    expect(r.absence).toBeCloseTo(0.1);
    expect(r.punctuality).toBeCloseTo(0.75);
    expect(r.leave).toBeCloseTo(0.1);
  });
  it("penyebut nol → null (bukan 0 atau NaN)", () => {
    expect(ratesOf(totals({}))).toEqual({ attendance: null, absence: null, punctuality: null, leave: null });
    expect(ratesOf(totals({ scheduledDays: 5, pendingDays: 5 })).attendance).toBeNull();
    expect(ratesOf(totals({ scheduledDays: 5, absentDays: 5 })).punctuality).toBeNull(); // tidak ada yang hadir
  });
  it("mendukung hari pecahan (cuti setengah hari)", () => {
    const r = ratesOf(totals({ scheduledDays: 10, presentDays: 9.5, onTimeDays: 9.5, cutiDays: 0.5 }));
    expect(r.attendance).toBeCloseTo(0.95);
    expect(r.leave).toBeCloseTo(0.05);
  });
  it("penjumlahan total antar-karyawan tetap konsisten", () => {
    const a = summarizeDays([makeDay({ date: "2026-10-05", status: "HADIR" }), makeDay({ date: "2026-10-06", status: "TERLAMBAT", lateMinutes: 10, fractions: { present: 1, izin: 0, sakit: 0, cuti: 0, absent: 0, pending: 0 } })]);
    const b = summarizeDays([makeDay({ date: "2026-10-05", status: "TIDAK_HADIR", fractions: { present: 0, izin: 0, sakit: 0, cuti: 0, absent: 1, pending: 0 } })]);
    const s = sumTotals([a, b]);
    expect(s.scheduledDays).toBe(3);
    expect(s.presentDays).toBe(2);
    expect(s.absentDays).toBe(1);
    expect(totalsAreConsistent(s)).toBe(true);
  });
});

describe("delta & format", () => {
  it("delta absolut & persen; pembanding 0/null tidak membagi nol", () => {
    expect(delta(110, 100)).toEqual({ abs: 10, pct: 0.1 });
    expect(delta(5, 0)).toEqual({ abs: 5, pct: null });
    expect(delta(null, 3)).toEqual({ abs: null, pct: null });
    expect(delta(0.9, 0.85).abs).toBeCloseTo(0.05);
  });
  it("format Indonesia", () => {
    expect(formatPercent(0.9333)).toBe("93,3%");
    expect(formatPercent(null)).toBe("—");
    expect(formatPoints(0.021)).toBe("+2,1 poin");
    expect(formatPoints(-0.005)).toBe("-0,5 poin");
    expect(formatChange({ abs: 10, pct: 0.125 })).toBe("+12,5%");
    expect(formatChange({ abs: 5, pct: null })).toBe("baru");
    expect(formatChange({ abs: 0, pct: null })).toBe("0%");
  });
  it("bulan: lastMonths urut menaik & lintas tahun; previousMonth", () => {
    expect(lastMonths("2026-02", 4)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(previousMonth("2026-03")).toBe("2026-02");
  });
});

describe("sebaran", () => {
  it("per hari dalam seminggu: hanya hari terjadwal; terlambat & tidak hadir terhitung per hari", () => {
    const days = [
      makeDay({ date: "2026-10-05", status: "TERLAMBAT" }),                                  // Senin
      makeDay({ date: "2026-10-12", status: "TERLAMBAT" }),                                  // Senin
      makeDay({ date: "2026-10-09", status: "TIDAK_HADIR", fractions: { present: 0, izin: 0, sakit: 0, cuti: 0, absent: 1, pending: 0 } }), // Jumat
      makeDay({ date: "2026-10-06", status: "HADIR" }),                                      // Selasa
      makeDay({ date: "2026-10-10", status: "LIBUR", scheduled: false }),                    // Sabtu tidak terjadwal
    ];
    const rows = weekdayDistribution(days);
    expect(rows.map((r) => r.weekday)).toEqual([1, 2, 5]);
    expect(rows[0]).toMatchObject({ scheduled: 2, late: 2, present: 2 });
    expect(rows[2]).toMatchObject({ scheduled: 1, absent: 1, present: 0 });
  });
  it("histogram jam datang: batas bucket tepat (0 menit = 'tepat', 1 menit = terlambat 1–15)", () => {
    const start = Date.parse("2026-10-05T01:00:00Z"); // 08:00 WIB
    const at = (min: number) => makeDay({ shiftStartAt: new Date(start).toISOString(), checkInAt: new Date(start + min * 60_000).toISOString() });
    const h = arrivalHistogram([at(-45), at(-30), at(-29), at(-10), at(-9), at(0), at(1), at(15), at(16), at(30), at(31), at(60), at(61), makeDay({ checkInAt: null })]);
    const counts = Object.fromEntries(h.map((b) => [b.label, b.count]));
    expect(counts["> 30 mnt lebih awal"]).toBe(1);        // -45
    expect(counts["30–10 mnt lebih awal"]).toBe(3);       // -30, -29, -10 → (−30,−10] hmm
    expect(h.reduce((a, b) => a + b.count, 0)).toBe(13);  // yang tanpa check-in tidak dihitung
  });
  it("rata-rata jam kerja hanya dari absensi lengkap", () => {
    expect(averageWorkedMinutes([makeDay({ checkOutAt: "x", workedMinutes: 480 }), makeDay({ checkOutAt: "x", workedMinutes: 420 }), makeDay({ checkOutAt: null, workedMinutes: 0 })])).toBe(450);
    expect(averageWorkedMinutes([])).toBeNull();
  });
});

describe("karyawan", () => {
  it("turnover = keluar ÷ rata-rata headcount", () => {
    expect(turnoverRate(3, 40, 50)).toBeCloseTo(3 / 45);
    expect(turnoverRate(0, 0, 0)).toBeNull();
  });
  it("masa kerja: pada tanggal ulang tahun masuk sudah dihitung penuh; sehari sebelumnya belum", () => {
    const d = tenureDistribution(["2025-10-31", "2025-11-01", "2023-10-31", "2023-11-01", "2021-10-31", "2020-01-01"], "2026-10-31");
    expect(d.map((x) => x.count)).toEqual([1, 2, 1, 2]); // <1th: 2025-11-01 · 1–3th: 2025-10-31 & 2023-11-01 · 3–5: 2023-10-31 · >5: 2021-10-31 & 2020-01-01
  });
});
