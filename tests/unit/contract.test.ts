import { describe, expect, it } from "vitest";
import { contractPhase, daysLeft, dueReminder } from "@/lib/contract";

const base = { decided: false, renewed: false, sent: [] as string[] };

describe("fase kontrak", () => {
  it("tanpa tanggal berakhir = tanpa batas waktu; ≥ 3 bulan = aktif; ≤ 3 bulan = segera berakhir; lewat = berakhir", () => {
    expect(contractPhase(null, "2026-11-01")).toBe("NO_EXPIRY");
    expect(contractPhase("2027-03-01", "2026-11-30")).toBe("ACTIVE"); // 3 bulan sebelum = 2026-12-01
    expect(contractPhase("2027-03-01", "2026-12-01")).toBe("EXPIRING");
    expect(contractPhase("2027-03-01", "2027-03-01")).toBe("EXPIRING"); // hari terakhir masih berlaku
    expect(contractPhase("2027-03-01", "2027-03-02")).toBe("EXPIRED");
    expect(daysLeft("2027-03-01", "2027-02-15")).toBe(14);
    expect(daysLeft("2027-03-01", "2027-03-03")).toBe(-2);
  });
});

describe("pengingat kontrak ke pimpinan", () => {
  it("belum ada pengingat sebelum H-3 bulan; tepat H-3 bulan → tonggak M3", () => {
    expect(dueReminder({ ...base, endDate: "2027-03-01", today: "2026-11-30" })).toBeNull();
    const r = dueReminder({ ...base, endDate: "2027-03-01", today: "2026-12-01" });
    expect(r?.milestone.key).toBe("M3");
    expect(r?.markSent).toEqual(["M3"]);
  });

  it("tonggak yang sama tidak dikirim dua kali; tonggak berikutnya (H-1 bulan, H-14 hari) dikirim bila keputusan belum diambil", () => {
    expect(dueReminder({ ...base, endDate: "2027-03-01", today: "2026-12-20", sent: ["M3"] })).toBeNull();
    expect(dueReminder({ ...base, endDate: "2027-03-01", today: "2027-02-01", sent: ["M3"] })?.milestone.key).toBe("M1");
    expect(dueReminder({ ...base, endDate: "2027-03-01", today: "2027-02-14", sent: ["M3", "M1"] })).toBeNull(); // H-14 hari = 15 Feb
    expect(dueReminder({ ...base, endDate: "2027-03-01", today: "2027-02-15", sent: ["M3", "M1"] })?.milestone.key).toBe("D14");
    expect(dueReminder({ ...base, endDate: "2027-03-01", today: "2027-02-28", sent: ["M3", "M1", "D14"] })).toBeNull();
  });

  it("kontrak diunggah saat sudah lewat beberapa tonggak → hanya SATU pengingat (terbaru), semua tonggak lewat ditandai terkirim", () => {
    const r = dueReminder({ ...base, endDate: "2027-03-01", today: "2027-02-20" });
    expect(r?.milestone.key).toBe("D14");
    expect(r?.markSent).toEqual(["M3", "M1", "D14"]);
  });

  it("berhenti bila: keputusan sudah diambil, sudah diperpanjang, tanpa tanggal berakhir, atau kontrak sudah berakhir", () => {
    const d = { endDate: "2027-03-01", today: "2027-02-20", sent: [] as string[], decided: false, renewed: false };
    expect(dueReminder({ ...d, decided: true })).toBeNull();
    expect(dueReminder({ ...d, renewed: true })).toBeNull();
    expect(dueReminder({ ...d, endDate: null })).toBeNull();
    expect(dueReminder({ ...d, today: "2027-03-02" })).toBeNull();
    expect(dueReminder({ ...d, today: "2027-03-01" })?.milestone.key).toBe("D14"); // hari terakhir masih diingatkan
  });

  it("akhir bulan pendek: kontrak berakhir 31 Mei → H-3 bulan = 28 Feb", () => {
    expect(dueReminder({ ...base, endDate: "2027-05-31", today: "2027-02-27" })).toBeNull();
    expect(dueReminder({ ...base, endDate: "2027-05-31", today: "2027-02-28" })?.milestone.key).toBe("M3");
  });
});
