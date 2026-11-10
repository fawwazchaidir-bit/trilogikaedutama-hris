import { describe, expect, it } from "vitest";
import {
  prorate, suggestLeavePayout, suggestProratedLines, totalsOf, kindOfCategory, LINE_CATEGORIES, reconcileSuggestions, possibleDuplicateCategories, prorataKey, allowanceKey, LEAVE_PAYOUT_KEY,
  type DraftLine, type ProrateComponent,
} from "@/lib/final-settlement";

const month = { start: "2026-11-01", end: "2026-11-30" };
const comp = (over: Partial<ProrateComponent> = {}): ProrateComponent => ({
  id: "c1", name: "Gaji pokok", category: "BASE_SALARY", calc: "FIXED", amount: 6_000_000n, recurrence: "RECURRING", effectiveFrom: "2025-01-01", effectiveTo: null, ...over,
});

describe("prorate", () => {
  it("nominal × dikerjakan ÷ total, half-up, dibatasi 0..total", () => {
    expect(prorate(6_000_000n, 11, 22)).toBe(3_000_000n);
    expect(prorate(1_000_000n, 1, 3)).toBe(333_333n); // 333.333,33 → turun
    expect(prorate(1_000_000n, 2, 3)).toBe(666_667n); // 666.666,67 → naik
    expect(prorate(5n, 1, 2)).toBe(3n); // 2,5 → 3 (half-up)
    expect(prorate(6_000_000n, 30, 22)).toBe(6_000_000n); // tidak melebihi nominal penuh
    expect(prorate(6_000_000n, -3, 22)).toBe(0n);
    expect(() => prorate(1n, 1, 0)).toThrow(RangeError);
  });
});

describe("suggestProratedLines", () => {
  it("memprorata komponen nominal tetap yang berlaku bulan itu, lengkap dengan rumus tertulis", () => {
    const r = suggestProratedLines({ month, worked: 11, total: 22, basisLabel: "Hari kerja terjadwal", components: [comp(), comp({ id: "c2", name: "Tunjangan makan", category: "MEAL_ALLOWANCE", amount: 440_000n })] });
    expect(r.warnings).toEqual([]);
    expect(r.lines.map((l) => [l.name, l.amount])).toEqual([["Gaji pokok (prorata)", 3_000_000n], ["Tunjangan makan (prorata)", 220_000n]]);
    expect(r.lines[0]).toMatchObject({ kind: "EARNING", category: "PRORATED_SALARY", source: "SYSTEM" });
    expect(r.lines[0]!.formula).toContain("11/22");
  });

  it("melewati komponen yang tidak berlaku (sudah berakhir/belum mulai/sekali bayar); per-hari & persen → peringatan, bukan angka", () => {
    const r = suggestProratedLines({ month, worked: 10, total: 20, basisLabel: "Hari kerja terjadwal", components: [
      comp({ id: "old", name: "Insentif lama", effectiveTo: "2026-09-30" }),
      comp({ id: "future", name: "Tunjangan baru", effectiveFrom: "2026-12-01" }),
      comp({ id: "once", name: "Bonus sekali", recurrence: "ONE_TIME", effectiveFrom: "2026-11-05" }),
      comp({ id: "pd", name: "Uang makan harian", calc: "PER_PRESENT_DAY", amount: 25_000n }),
      comp({ id: "pct", name: "Tunjangan persen", calc: "PERCENT_OF_BASE", amount: 0n }),
    ] });
    expect(r.lines).toEqual([]);
    expect(r.warnings).toHaveLength(2);
    expect(r.warnings.join(" ")).toMatch(/Uang makan harian[^]*per hari hadir/);
    expect(r.warnings.join(" ")).toMatch(/Tunjangan persen[^]*persen dari gaji pokok/);
  });

  it("komponen yang mulai/berakhir di tengah bulan diberi peringatan; tanpa hari kerja → tidak ada baris + peringatan", () => {
    const mid = suggestProratedLines({ month, worked: 10, total: 20, basisLabel: "Hari kerja terjadwal", components: [comp({ effectiveFrom: "2026-11-10" })] });
    expect(mid.lines).toHaveLength(1);
    expect(mid.warnings[0]).toMatch(/tengah bulan/);
    const none = suggestProratedLines({ month, worked: 0, total: 0, basisLabel: "Hari kerja terjadwal", components: [comp()] });
    expect(none.lines).toEqual([]);
    expect(none.warnings[0]).toMatch(/tidak dapat dihitung/);
  });
});

describe("suggestLeavePayout", () => {
  it("gaji pokok × hari ÷ pembagi (diisi HR), mendukung setengah hari, half-up", () => {
    expect(suggestLeavePayout({ baseMonthly: 6_000_000n, days: 5, divisor: 25 })?.amount).toBe(1_200_000n);
    expect(suggestLeavePayout({ baseMonthly: 6_000_000n, days: 2.5, divisor: 25 })?.amount).toBe(600_000n);
    expect(suggestLeavePayout({ baseMonthly: 1_000_000n, days: 1, divisor: 3 })?.amount).toBe(333_333n);
    expect(suggestLeavePayout({ baseMonthly: 6_000_000n, days: 5, divisor: 25 })?.formula).toContain("÷ 25");
  });
  it("tanpa sisa cuti atau tanpa gaji pokok → tidak ada baris; pembagi tidak masuk akal ditolak", () => {
    expect(suggestLeavePayout({ baseMonthly: 6_000_000n, days: 0, divisor: 25 })).toBeNull();
    expect(suggestLeavePayout({ baseMonthly: 0n, days: 5, divisor: 25 })).toBeNull();
    expect(() => suggestLeavePayout({ baseMonthly: 1n, days: 1, divisor: 0 })).toThrow(RangeError);
    expect(() => suggestLeavePayout({ baseMonthly: 1n, days: 1, divisor: 40 })).toThrow(RangeError);
    expect(() => suggestLeavePayout({ baseMonthly: 1n, days: 1, divisor: 2.5 })).toThrow(RangeError);
  });
});

describe("totalsOf & kategori", () => {
  it("bersih = pendapatan − potongan; bisa negatif (dicegah saat diajukan)", () => {
    expect(totalsOf([{ kind: "EARNING", amount: 5_000_000n }, { kind: "DEDUCTION", amount: 1_500_000n }, { kind: "EARNING", amount: 250_000n }])).toEqual({ earnings: 5_250_000n, deductions: 1_500_000n, net: 3_750_000n });
    expect(totalsOf([{ kind: "EARNING", amount: 1n }, { kind: "DEDUCTION", amount: 5n }]).net).toBe(-4n);
    expect(totalsOf([])).toEqual({ earnings: 0n, deductions: 0n, net: 0n });
  });
  it("setiap kategori punya jenis; pajak/BPJS/kasbon/aset/potongan lain adalah potongan", () => {
    expect(LINE_CATEGORIES).toHaveLength(13);
    expect(kindOfCategory("SEVERANCE")).toBe("EARNING");
    expect(kindOfCategory("TAX")).toBe("DEDUCTION");
    expect(kindOfCategory("ASSET")).toBe("DEDUCTION");
  });
});

describe("identitas sumber & rekonsiliasi usulan (satu sumber satu kali)", () => {
  const line = (sourceKey: string | null, name = "x", amount = 100n): DraftLine => ({ kind: "EARNING", category: "PRORATED_SALARY", name, amount, formula: null, source: "SYSTEM", note: null, sourceKey });

  it("setiap usulan sistem membawa kunci sumber yang tetap: komponen gaji, uang cuti, uang harian", () => {
    const r = suggestProratedLines({ month, worked: 11, total: 22, basisLabel: "Hari kerja terjadwal", components: [comp({ id: "A1" }), comp({ id: "B2", name: "Makan", amount: 440_000n })] });
    expect(r.lines.map((l) => l.sourceKey)).toEqual([prorataKey("A1"), prorataKey("B2")]);
    expect(r.lines.map((l) => l.sourceKey)).toEqual(["PRORATA:A1", "PRORATA:B2"]);
    expect(suggestLeavePayout({ baseMonthly: 6_000_000n, days: 5, divisor: 25 })?.sourceKey).toBe(LEAVE_PAYOUT_KEY);
    expect(allowanceKey("T9")).toBe("ALLOWANCE:T9");
    // kunci sama untuk perhitungan ulang dengan nominal berbeda (identitas = sumber, bukan angka)
    const again = suggestProratedLines({ month, worked: 5, total: 22, basisLabel: "x", components: [comp({ id: "A1" })] });
    expect(again.lines[0]!.sourceKey).toBe("PRORATA:A1");
  });

  it("sumber yang dipegang baris manual dilewati (digantikan); yang dikecualikan dilewati permanen; sisanya dibuat", () => {
    const sug = [line("PRORATA:A", "gaji"), line("PRORATA:B", "makan"), line("LEAVE_PAYOUT", "cuti")];
    const r = reconcileSuggestions(sug, ["PRORATA:A"], ["PRORATA:B"]);
    expect(r.create.map((l) => l.name)).toEqual(["cuti"]);
    expect(r.replaced.map((l) => l.name)).toEqual(["gaji"]);
    expect(r.excluded.map((l) => l.name)).toEqual(["makan"]);
  });

  it("sumber ganda di dalam usulan hanya dihitung sekali; usulan tanpa kunci tidak bisa dicocokkan sehingga tetap dibuat", () => {
    const r = reconcileSuggestions([line("K"), line("K", "dobel"), line(null, "tanpa-1"), line(null, "tanpa-2")], [], []);
    expect(r.create.map((l) => l.name)).toEqual(["x", "tanpa-1", "tanpa-2"]);
  });

  it("tanpa baris manual berkunci & tanpa pengecualian, semua usulan dibuat", () => {
    const sug = [line("A"), line("B")];
    expect(reconcileSuggestions(sug, [], []).create).toEqual(sug);
  });

  it("data lama: baris manual tanpa kunci + baris sistem sekategori (yang diusulkan sistem) ditandai mungkin ganda; kategori lain tidak", () => {
    const L = (category: DraftLine["category"], source: DraftLine["source"], sourceKey: string | null) => ({ category, source, sourceKey });
    expect(possibleDuplicateCategories([L("PRORATED_SALARY", "SYSTEM", null), L("PRORATED_SALARY", "MANUAL", null)])).toEqual(["PRORATED_SALARY"]);
    expect(possibleDuplicateCategories([L("PRORATED_SALARY", "SYSTEM", "PRORATA:A"), L("PRORATED_SALARY", "MANUAL", "PRORATA:B")])).toEqual([]); // manual berkunci = pengganti sah
    expect(possibleDuplicateCategories([L("SEVERANCE", "MANUAL", null), L("PRORATED_SALARY", "SYSTEM", "PRORATA:A")])).toEqual([]);
    expect(possibleDuplicateCategories([L("LEAVE_PAYOUT", "SYSTEM", null), L("LEAVE_PAYOUT", "MANUAL", null), L("UNPAID_ALLOWANCE", "SYSTEM", null), L("UNPAID_ALLOWANCE", "MANUAL", null)])).toEqual(["LEAVE_PAYOUT", "UNPAID_ALLOWANCE"]);
  });
});
