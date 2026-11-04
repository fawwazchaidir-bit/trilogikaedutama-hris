import { describe, expect, it } from "vitest";
import { timeAgo } from "@/lib/format";

const NOW = Date.parse("2026-11-04T10:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe("timeAgo", () => {
  it("menit, jam, kemarin, hari", () => {
    expect(timeAgo(ago(20_000), NOW)).toBe("baru saja");
    expect(timeAgo(ago(5 * 60_000), NOW)).toBe("5 menit lalu");
    expect(timeAgo(ago(3 * 3_600_000), NOW)).toBe("3 jam lalu");
    expect(timeAgo(ago(30 * 3_600_000), NOW)).toBe("kemarin");
    expect(timeAgo(ago(4 * 86_400_000), NOW)).toBe("4 hari lalu");
  });
  it("lebih dari 30 hari menjadi tanggal; waktu di masa depan tidak negatif", () => {
    expect(timeAgo(ago(45 * 86_400_000), NOW)).toMatch(/2026/);
    expect(timeAgo(new Date(NOW + 60_000), NOW)).toBe("baru saja");
  });
});
