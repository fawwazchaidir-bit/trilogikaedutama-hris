import { describe, expect, it } from "vitest";
import { formatLetterNumber, LETTER_CODE, MATERAI_THRESHOLD, needsMaterai, tripDays } from "@/lib/assignment";

describe("penomoran & aturan surat tugas / uang harian", () => {
  it("nomor: urut 3 digit/kode/bulan Romawi/tahun", () => {
    expect(formatLetterNumber(1, LETTER_CODE.ASSIGNMENT, "2026-11-01")).toBe("001/ST/XI/2026");
    expect(formatLetterNumber(42, LETTER_CODE.RECEIPT, "2027-01-31")).toBe("042/BPUH/I/2027");
    expect(formatLetterNumber(1234, LETTER_CODE.ASSIGNMENT, "2026-12-05")).toBe("1234/ST/XII/2026");
  });
  it("lama perjalanan = hari kalender inklusif", () => {
    expect(tripDays("2026-11-02", "2026-11-02")).toBe(1);
    expect(tripDays("2026-11-02", "2026-11-06")).toBe(5);
    expect(tripDays("2026-12-30", "2027-01-02")).toBe(4);
  });
  it("penanda meterai: hanya di atas Rp 5.000.000", () => {
    expect(needsMaterai(MATERAI_THRESHOLD)).toBe(false);
    expect(needsMaterai(MATERAI_THRESHOLD + 1)).toBe(true);
    expect(needsMaterai(750_000)).toBe(false);
  });
});
