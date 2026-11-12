/**
 * Penanda tugas operasional pada peta beban (logika murni): definisi terbuka/terlambat/menunggu pemeriksaan dan aturan "Perlu dicek".
 */
import { describe, expect, it } from "vitest";
import { countOperational, operationalMarker } from "@/lib/training/operational-load";
import { defaultIndicatorConfig, indicatorConfigSchema } from "@/lib/training/indicators/config";
import type { TaskStatus } from "@/lib/training/types";

const TODAY = "2027-03-15";
const t = (status: TaskStatus, dueDate: string | null = null) => ({ status, dueDate });
const TH = { openMin: 5, overdueMin: 1 };

describe("hitungan tugas operasional", () => {
  it("terbuka = Belum + Proses + Menunggu pemeriksaan; Selesai & Dibatalkan tidak dihitung", () => {
    const c = countOperational([t("TODO"), t("IN_PROGRESS"), t("IN_REVIEW"), t("DONE"), t("CANCELLED")], TODAY);
    expect(c).toEqual({ open: 3, overdue: 0, inReview: 1 });
  });

  it("terlambat adalah BAGIAN dari terbuka (bukan tambahan); tenggat hari ini belum terlambat; tanpa tenggat tidak terlambat; Selesai yang lewat tenggat tidak terlambat", () => {
    const c = countOperational([t("TODO", "2027-03-14"), t("IN_PROGRESS", TODAY), t("TODO", null), t("DONE", "2027-03-01"), t("CANCELLED", "2027-03-01")], TODAY);
    expect(c).toEqual({ open: 3, overdue: 1, inReview: 0 });
    expect(c.overdue).toBeLessThanOrEqual(c.open);
  });

  it("menunggu pemeriksaan juga bagian dari terbuka (satu kali), dan bila lewat tenggat ikut terlambat — tidak dihitung dua kali sebagai terbuka", () => {
    const c = countOperational([t("IN_REVIEW", "2027-03-10"), t("IN_REVIEW", "2027-03-20")], TODAY);
    expect(c).toEqual({ open: 2, overdue: 1, inReview: 2 });
  });

  it("daftar kosong → semua nol", () => { expect(countOperational([], TODAY)).toEqual({ open: 0, overdue: 0, inReview: 0 }); });
});

describe("penanda 'Perlu dicek'", () => {
  const roomy = (open: number, overdue: number) => operationalMarker("ROOMY", { open, overdue, inReview: 0 }, TH);

  it("beban jam masih longgar + ≥ 5 tugas terbuka → Perlu dicek; 4 → tidak", () => {
    expect(roomy(5, 0)).toMatchObject({ needsCheck: true });
    expect(roomy(4, 0)).toEqual({ needsCheck: false, reason: null });
  });

  it("beban jam masih longgar + ≥ 1 tugas terlambat → Perlu dicek (walau tugas sedikit)", () => {
    expect(roomy(1, 1)).toMatchObject({ needsCheck: true });
    expect(roomy(1, 1).reason).toMatch(/1 tugas terlambat \(batas 1\)/);
  });

  it("alasan menyebut angka dan batas; kedua kondisi digabung dalam satu kalimat", () => {
    const r = roomy(7, 2);
    expect(r.needsCheck).toBe(true);
    expect(r.reason).toBe("Beban jam standar minggu ini masih longgar, tetapi ada 7 tugas terbuka (batas 5) dan 2 tugas terlambat (batas 1).");
  });

  it("HANYA saat beban jam 'Ada ruang': pita lain (Ideal/Padat/Overload) tidak ditandai walau tugas banyak — beban sudah terlihat di peta", () => {
    for (const band of ["IDEAL", "BUSY", "OVERLOAD"] as const) {
      expect(operationalMarker(band, { open: 20, overdue: 9, inReview: 3 }, TH)).toEqual({ needsCheck: false, reason: null });
    }
  });

  it("ambang dapat disesuaikan", () => {
    expect(operationalMarker("ROOMY", { open: 3, overdue: 0, inReview: 0 }, { openMin: 3, overdueMin: 5 }).needsCheck).toBe(true);
    expect(operationalMarker("ROOMY", { open: 2, overdue: 4, inReview: 0 }, { openMin: 3, overdueMin: 5 }).needsCheck).toBe(false);
    expect(operationalMarker("ROOMY", { open: 2, overdue: 5, inReview: 0 }, { openMin: 3, overdueMin: 5 }).needsCheck).toBe(true);
  });

  it("menunggu pemeriksaan tidak menambah apa pun: hanya 'terbuka' & 'terlambat' yang menentukan", () => {
    expect(operationalMarker("ROOMY", { open: 2, overdue: 0, inReview: 2 }, TH).needsCheck).toBe(false);
  });
});

describe("ambang di konfigurasi", () => {
  it("bawaan 5 terbuka / 1 terlambat", () => { expect(defaultIndicatorConfig().thresholds.operational).toEqual({ openMin: 5, overdueMin: 1 }); });

  it("konfigurasi LAMA tanpa bagian ini tetap sah dan memakai nilai bawaan (tidak dianggap rusak)", () => {
    const legacy = JSON.parse(JSON.stringify(defaultIndicatorConfig())) as { thresholds: Record<string, unknown> };
    delete legacy.thresholds.operational;
    const r = indicatorConfigSchema.safeParse(legacy);
    expect(r.success).toBe(true);
    expect(r.success && r.data.thresholds.operational).toEqual({ openMin: 5, overdueMin: 1 });
  });

  it("nilai tidak sah ditolak (nol, pecahan, di luar batas)", () => {
    for (const bad of [{ openMin: 0, overdueMin: 1 }, { openMin: 5, overdueMin: 0 }, { openMin: 2.5, overdueMin: 1 }, { openMin: 101, overdueMin: 1 }]) {
      const c = JSON.parse(JSON.stringify(defaultIndicatorConfig())) as { thresholds: { operational: unknown } };
      c.thresholds.operational = bad;
      expect(indicatorConfigSchema.safeParse(c).success, JSON.stringify(bad)).toBe(false);
    }
  });
});
