import { describe, expect, it } from "vitest";
import {
  addDays, diffDays, eachDate, endOfIsoWeek, isoWeekday, isValidIsoDate, localDate, localMinutes, localTime, monthRange,
  rangesOverlap, startOfIsoWeek, timeToMinutes, zonedInstant,
} from "@/lib/time";

describe("zona waktu WIB", () => {
  it("tanggal lokal melewati tengah malam UTC", () => {
    expect(localDate(new Date("2026-10-30T16:59:00Z"))).toBe("2026-10-30");
    expect(localDate(new Date("2026-10-30T17:00:00Z"))).toBe("2026-10-31"); // 00:00 WIB
  });
  it("menit & jam lokal", () => {
    const d = new Date("2026-10-30T01:21:45Z"); // 08:21:45 WIB
    expect(localMinutes(d)).toBe(8 * 60 + 21);
    expect(localTime(d)).toBe("08:21");
  });
  it("zonedInstant WIB = UTC+7", () => {
    expect(zonedInstant("2026-10-30", "08:00").toISOString()).toBe("2026-10-30T01:00:00.000Z");
    expect(zonedInstant("2026-10-30", "00:00").toISOString()).toBe("2026-10-29T17:00:00.000Z");
  });
  it("zonedInstant benar untuk zona ber-DST", () => {
    expect(zonedInstant("2026-03-08", "12:00", "America/New_York").toISOString()).toBe("2026-03-08T16:00:00.000Z"); // EDT
    expect(zonedInstant("2026-03-07", "12:00", "America/New_York").toISOString()).toBe("2026-03-07T17:00:00.000Z"); // EST
  });
  it("timeToMinutes", () => {
    expect(timeToMinutes("08:15")).toBe(495);
    expect(timeToMinutes("00:00")).toBe(0);
  });
});

describe("aritmetika tanggal", () => {
  it("addDays lintas bulan/tahun/kabisat", () => {
    expect(addDays("2026-10-30", 2)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("hari dalam minggu ISO (Senin = 1, Minggu = 7)", () => {
    expect(isoWeekday("2026-10-26")).toBe(1);
    expect(isoWeekday("2026-10-30")).toBe(5);
    expect(isoWeekday("2026-11-01")).toBe(7);
  });
  it("awal/akhir minggu", () => {
    expect(startOfIsoWeek("2026-10-30")).toBe("2026-10-26");
    expect(endOfIsoWeek("2026-10-30")).toBe("2026-11-01");
    expect(startOfIsoWeek("2026-11-01")).toBe("2026-10-26");
  });
  it("rentang bulan & eachDate", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02").to).toBe("2028-02-29");
    expect(eachDate("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    expect(eachDate("2026-11-02", "2026-10-30")).toEqual([]);
    expect(() => eachDate("2020-01-01", "2026-01-01")).toThrow();
    expect(diffDays("2026-11-01", "2026-10-30")).toBe(2);
  });
  it("validasi tanggal nyata", () => {
    expect(isValidIsoDate("2026-02-29")).toBe(false);
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2026-13-01")).toBe(false);
    expect(isValidIsoDate("26-01-01")).toBe(false);
  });
  it("irisan rentang", () => {
    expect(rangesOverlap("2026-10-01", "2026-10-10", "2026-10-10", "2026-10-20")).toBe(true);
    expect(rangesOverlap("2026-10-01", "2026-10-09", "2026-10-10", "2026-10-20")).toBe(false);
    expect(rangesOverlap("2026-10-01", null, "2027-01-01", null)).toBe(true);
    expect(rangesOverlap("2026-10-01", "2026-10-05", "2026-09-01", "2026-09-30")).toBe(false);
  });
});
