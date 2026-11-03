import { describe, expect, it } from "vitest";
import { effectiveLeavePolicy, isEntitledOn, quotaForYear, type LeaveDefaults } from "@/lib/leave-policy";
import { addMonths } from "@/lib/time";

const DEF: LeaveDefaults = { annualQuota: 12, allowNegative: false, minTenureMonths: 12 };
const none = { quotaDays: null, eligibleFrom: null, allowNegative: null, note: null };

describe("addMonths", () => {
  it("menjaga hari, memangkas ke akhir bulan, dan melewati pergantian tahun (maju/mundur)", () => {
    expect(addMonths("2025-01-01", 12)).toBe("2026-01-01");
    expect(addMonths("2025-01-31", 1)).toBe("2025-02-28");
    expect(addMonths("2024-01-31", 1)).toBe("2024-02-29"); // kabisat
    expect(addMonths("2026-12-15", 3)).toBe("2027-03-15");
    expect(addMonths("2027-03-31", -3)).toBe("2026-12-31");
    expect(addMonths("2027-05-31", -3)).toBe("2027-02-28");
    expect(addMonths("2026-01-10", -1)).toBe("2025-12-10");
    expect(addMonths("2026-11-01", 0)).toBe("2026-11-01");
  });
});

describe("kebijakan cuti efektif per karyawan", () => {
  it("tanpa kebijakan khusus → bawaan: berhak setelah masa kerja minimum", () => {
    const p = effectiveLeavePolicy("2025-03-10", none, DEF);
    expect(p).toMatchObject({ quotaDays: 12, eligibleFrom: "2026-03-10", allowNegative: false, custom: false });
    expect(p.source).toEqual({ quota: "DEFAULT", eligibleFrom: "DEFAULT", allowNegative: "DEFAULT" });
  });

  it("karyawan A (>1 tahun) berhak 12 hari; karyawan B (2 bulan) belum berhak sampai akhir tahun berjalan", () => {
    const a = effectiveLeavePolicy("2025-01-01", none, DEF);
    const b = effectiveLeavePolicy("2026-09-01", none, DEF);
    expect(isEntitledOn(a, "2026-11-01")).toBe(true);
    expect(isEntitledOn(b, "2026-11-01")).toBe(false);
    expect(quotaForYear(a, 2026)).toBe(12);
    expect(quotaForYear(b, 2026)).toBe(0); // berhak 2027-09-01 → belum ada kuota 2026
    expect(quotaForYear(b, 2027)).toBe(12); // berhak di tahun 2027 → kuota penuh 2027, tetapi baru boleh dipakai sejak 2027-09-01
    expect(isEntitledOn(b, "2027-08-31")).toBe(false);
    expect(isEntitledOn(b, "2027-09-01")).toBe(true);
  });

  it("kebijakan khusus per bidang menimpa bawaan; bidang lain tetap bawaan", () => {
    const p = effectiveLeavePolicy("2026-09-01", { quotaDays: 14, eligibleFrom: "2026-09-01", allowNegative: null, note: "Manajer" }, DEF);
    expect(p).toMatchObject({ quotaDays: 14, eligibleFrom: "2026-09-01", allowNegative: false, custom: true, note: "Manajer" });
    expect(p.source).toEqual({ quota: "CUSTOM", eligibleFrom: "CUSTOM", allowNegative: "DEFAULT" });
    expect(isEntitledOn(p, "2026-09-01")).toBe(true);
  });

  it("kuota 0 khusus = tidak mendapat cuti tahunan; masa kerja minimum 0 = langsung berhak", () => {
    expect(quotaForYear(effectiveLeavePolicy("2020-01-01", { ...none, quotaDays: 0, note: "Paruh waktu" }, DEF), 2026)).toBe(0);
    expect(effectiveLeavePolicy("2026-10-15", none, { ...DEF, minTenureMonths: 0 }).eligibleFrom).toBe("2026-10-15");
  });

  it("perubahan bawaan lembaga langsung berlaku untuk karyawan tanpa kebijakan khusus, tidak untuk yang khusus", () => {
    const custom = effectiveLeavePolicy("2026-06-01", { ...none, eligibleFrom: "2026-07-01", note: "Perjanjian" }, DEF);
    const follow = effectiveLeavePolicy("2026-06-01", none, DEF);
    const six = { ...DEF, minTenureMonths: 6 };
    expect(effectiveLeavePolicy("2026-06-01", none, six).eligibleFrom).toBe("2026-12-01");
    expect(follow.eligibleFrom).toBe("2027-06-01");
    expect(effectiveLeavePolicy("2026-06-01", { ...none, eligibleFrom: "2026-07-01", note: "Perjanjian" }, six).eligibleFrom).toBe(custom.eligibleFrom);
  });
});
