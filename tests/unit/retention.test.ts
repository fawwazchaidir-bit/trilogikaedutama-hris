import { describe, expect, it } from "vitest";
import { retentionCutoff } from "@/lib/retention";

const iso = (d: Date | null) => d?.toISOString() ?? null;

describe("retentionCutoff — batas retensi dalam bulan kalender", () => {
  it("mengurangi bulan kalender dengan jam yang sama (bukan 30 hari × n)", () => {
    expect(iso(retentionCutoff(new Date("2026-11-01T03:00:00Z"), 6))).toBe("2026-05-01T03:00:00.000Z");
    expect(iso(retentionCutoff(new Date("2026-11-15T10:20:30.123Z"), 3))).toBe("2026-08-15T10:20:30.123Z");
    expect(iso(retentionCutoff(new Date("2026-11-15T10:20:30Z"), 1))).toBe("2026-10-15T10:20:30.000Z");
  });
  it("hari yang tidak ada di bulan tujuan dipotong ke hari terakhir bulan itu (tahun kabisat benar)", () => {
    expect(iso(retentionCutoff(new Date("2026-05-31T00:00:00Z"), 3))).toBe("2026-02-28T00:00:00.000Z");
    expect(iso(retentionCutoff(new Date("2028-05-31T00:00:00Z"), 3))).toBe("2028-02-29T00:00:00.000Z");
    expect(iso(retentionCutoff(new Date("2026-03-31T12:00:00Z"), 1))).toBe("2026-02-28T12:00:00.000Z");
    expect(iso(retentionCutoff(new Date("2026-10-31T12:00:00Z"), 4))).toBe("2026-06-30T12:00:00.000Z");
  });
  it("melewati pergantian tahun dan beberapa tahun", () => {
    expect(iso(retentionCutoff(new Date("2026-02-10T00:00:00Z"), 6))).toBe("2025-08-10T00:00:00.000Z");
    expect(iso(retentionCutoff(new Date("2026-01-31T00:00:00Z"), 12))).toBe("2025-01-31T00:00:00.000Z");
    expect(iso(retentionCutoff(new Date("2026-06-15T00:00:00Z"), 36))).toBe("2023-06-15T00:00:00.000Z");
    expect(iso(retentionCutoff(new Date("2026-01-01T00:00:00Z"), 1))).toBe("2025-12-01T00:00:00.000Z");
  });
  it("0, negatif, atau bukan angka → null (simpan selamanya / tidak menghapus apa pun)", () => {
    for (const m of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) expect(retentionCutoff(new Date("2026-11-01T00:00:00Z"), m)).toBeNull();
  });
  it("bulan pecahan dibulatkan ke bawah (lebih lama menyimpan, bukan lebih cepat menghapus)", () => {
    expect(iso(retentionCutoff(new Date("2026-11-01T00:00:00Z"), 6.9))).toBe("2026-05-01T00:00:00.000Z");
  });
  it("tidak mengubah objek Date masukan", () => {
    const now = new Date("2026-11-01T03:00:00Z");
    retentionCutoff(now, 6);
    expect(now.toISOString()).toBe("2026-11-01T03:00:00.000Z");
  });
});
