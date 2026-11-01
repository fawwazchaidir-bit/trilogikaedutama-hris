import { describe, expect, it } from "vitest";
import {
  bpOf, bracketRate, computeBpjs, computeStatutory, defaultStatutoryConfig, employerContributionLines, progressiveTax,
  type StatutoryConfig, type StatutoryInput,
} from "@/lib/statutory";

const cfg = (over: { bpjs?: boolean; pph?: boolean } = {}): StatutoryConfig => {
  const c = defaultStatutoryConfig();
  c.bpjs.enabled = over.bpjs ?? true;
  c.pph21.enabled = over.pph ?? true;
  return c;
};
const EMP = { taxStatus: "TK0" as const, hasNpwp: true, healthEnrolled: true, employmentEnrolled: true };
const input = (over: Partial<StatutoryInput> = {}): StatutoryInput => ({
  config: cfg(), employee: EMP, bpjsWage: 5_000_000, taxableEarnings: 5_000_000, taxMonth: 3, finalPeriod: false, ytd: null, priorMonthsExpected: 0,
  skipBpjs: false, skipPph21: false, ...over,
});

describe("pembulatan & lapisan", () => {
  it("bpOf: half-up dan tanpa floating point", () => {
    expect(bpOf(5_000_000, 100)).toBe(50_000);
    expect(bpOf(5_000_000, 370)).toBe(185_000);
    expect(bpOf(1_234_567, 370)).toBe(45_679); // 45.679,0 → 45.679
    expect(bpOf(10, 5)).toBe(0); // 0,005 → 0
    expect(bpOf(1000, 5)).toBe(1); // 0,5 → naik
    expect(bpOf(0, 100)).toBe(0);
  });
  it("bracketRate: batas atas termasuk (5.400.000 → 0%, 5.400.001 → 0,25%)", () => {
    const ter = defaultStatutoryConfig().pph21.ter.A;
    expect(bracketRate(5_400_000, ter)).toBe(0);
    expect(bracketRate(5_400_001, ter)).toBe(25);
    expect(bracketRate(2_000_000_000, ter)).toBe(3400);
  });
  it("progressiveTax: lapisan 5/15/25/30/35%", () => {
    const br = defaultStatutoryConfig().pph21.brackets;
    expect(progressiveTax(0, br)).toBe(0);
    expect(progressiveTax(60_000_000, br)).toBe(3_000_000);
    expect(progressiveTax(250_000_000, br)).toBe(3_000_000 + 28_500_000);
    expect(progressiveTax(600_000_000, br)).toBe(3_000_000 + 28_500_000 + 62_500_000 + 30_000_000);
    expect(progressiveTax(6_000_000_000, br)).toBe(3_000_000 + 28_500_000 + 62_500_000 + 1_350_000_000 + 350_000_000);
  });
  it("tabel TER: tiap kategori naik monoton, berakhir null; jumlah lapisan A/B/C = 44/40/41", () => {
    const d = defaultStatutoryConfig().pph21;
    for (const k of ["A", "B", "C"] as const) {
      const t = d.ter[k];
      expect(t.length).toBe({ A: 44, B: 40, C: 41 }[k]);
      for (let i = 1; i < t.length - 1; i++) {
        expect(t[i]!.upTo!).toBeGreaterThan(t[i - 1]!.upTo!);
        expect(t[i]!.rateBp).toBeGreaterThanOrEqual(t[i - 1]!.rateBp);
      }
      expect(t[t.length - 1]!.upTo).toBeNull();
      expect(t[t.length - 1]!.rateBp).toBe(3400);
    }
  });
});

describe("BPJS", () => {
  it("upah Rp 5.000.000: porsi karyawan & perusahaan sesuai tarif konfigurasi", () => {
    const r = computeBpjs(5_000_000, cfg().bpjs, EMP);
    expect(r.employee).toEqual({ health: 50_000, jht: 100_000, jp: 50_000 });
    expect(r.employer).toEqual({ health: 200_000, jht: 185_000, jp: 100_000, jkk: 12_000, jkm: 15_000 });
    expect(r.employeeTotal).toBe(200_000);
    expect(r.employerTotal).toBe(512_000);
  });
  it("batas upah: Kesehatan 12 juta, JP sesuai konfigurasi; JHT tanpa batas", () => {
    const r = computeBpjs(15_000_000, cfg().bpjs, EMP);
    expect(r.healthWage).toBe(12_000_000);
    expect(r.employee.health).toBe(120_000);
    expect(r.employer.health).toBe(480_000);
    expect(r.jpWage).toBe(10_547_400);
    expect(r.employee.jp).toBe(105_474);
    expect(r.employer.jp).toBe(210_948);
    expect(r.employee.jht).toBe(300_000);
  });
  it("bukan peserta: iuran 0 untuk bagian yang tidak diikuti", () => {
    const noHealth = computeBpjs(5_000_000, cfg().bpjs, { healthEnrolled: false, employmentEnrolled: true });
    expect(noHealth.employee.health).toBe(0);
    expect(noHealth.employee.jht).toBe(100_000);
    const noEmp = computeBpjs(5_000_000, cfg().bpjs, { healthEnrolled: true, employmentEnrolled: false });
    expect(noEmp.employee.jht + noEmp.employee.jp + noEmp.employer.jkk + noEmp.employer.jkm).toBe(0);
    expect(noEmp.employee.health).toBe(50_000);
  });
  it("tarif mengikuti konfigurasi (mis. JKK kelas risiko lebih tinggi)", () => {
    const c = cfg().bpjs;
    c.jkkEmployerBp = 174;
    expect(computeBpjs(5_000_000, c, EMP).employer.jkk).toBe(87_000);
  });
});

describe("PPh 21 — TER (masa non-final)", () => {
  const pph = (gross: number, status: StatutoryInput["employee"]["taxStatus"] = "TK0", hasNpwp = true) =>
    computeStatutory(input({ config: cfg({ bpjs: false }), employee: { ...EMP, taxStatus: status, hasNpwp }, taxableEarnings: gross })).pph21!;

  it("kategori A: di bawah/ pada batas bebas pajak → 0; Rp 10.000.000 → 2% = 200.000", () => {
    expect(pph(5_400_000).amount).toBe(0);
    expect(pph(10_000_000).amount).toBe(200_000);
    expect(pph(9_650_000).amount).toBe(168_875); // 1,75%
  });
  it("kategori ditentukan status PTKP: TK1/K0 → A; K1/K2/TK2/TK3 → B; K3 → C", () => {
    expect(pph(10_000_000, "TK1").category).toBe("A");
    expect(pph(10_000_000, "K0").category).toBe("A");
    expect(pph(10_000_000, "K1").category).toBe("B");
    expect(pph(10_000_000, "K1").amount).toBe(150_000); // B: ≤ 10.750.000 → 1,5%
    expect(pph(10_000_000, "K3").category).toBe("C");
    expect(pph(10_000_000, "K3").amount).toBe(150_000); // C: ≤ 10.950.000 → 1,5%
    expect(pph(10_000_000, "TK3").category).toBe("B");
  });
  it("tanpa NPWP: tarif × 120%", () => {
    expect(pph(10_000_000, "TK0", false).amount).toBe(240_000);
  });
  it("premi perusahaan (Kesehatan 4% + JKK + JKM) masuk penghasilan bruto", () => {
    const r = computeStatutory(input({ bpjsWage: 8_000_000, taxableEarnings: 8_000_000 }));
    expect(r.bpjs!.employer.health + r.bpjs!.employer.jkk + r.bpjs!.employer.jkm).toBe(363_200);
    expect(r.pph21!.gross).toBe(8_363_200);
    expect(r.pph21!.amount).toBe(125_448); // 1,5% × 8.363.200
  });
  it("employerInsuranceInGross=false → bruto hanya pendapatan", () => {
    const c = cfg();
    c.pph21.employerInsuranceInGross = false;
    expect(computeStatutory(input({ config: c, bpjsWage: 8_000_000, taxableEarnings: 8_000_000 })).pph21!.gross).toBe(8_000_000);
  });
});

describe("PPh 21 — masa pajak terakhir (true-up)", () => {
  const dec = (over: Partial<StatutoryInput>) => computeStatutory(input({ config: cfg({ bpjs: false }), finalPeriod: true, taxMonth: 12, ...over })).pph21!;

  it("Rp 10 juta/bulan TK0, setahun penuh: pajak setahun 3.000.000 − TER Jan–Nov 2.200.000 = 800.000", () => {
    const r = dec({ taxableEarnings: 10_000_000, priorMonthsExpected: 11, ytd: { months: 11, gross: 110_000_000, withheld: 2_200_000, jhtJpEmployee: 0 } });
    expect(r.method).toBe("ANNUAL");
    expect(r.amount).toBe(800_000);
  });
  it("Rp 20 juta/bulan TK0: pajak setahun 21.000.000 − TER 19.800.000 = 1.200.000", () => {
    const r = dec({ taxableEarnings: 20_000_000, priorMonthsExpected: 11, ytd: { months: 11, gross: 220_000_000, withheld: 19_800_000, jhtJpEmployee: 0 } });
    expect(r.amount).toBe(1_200_000);
  });
  it("karyawan masuk pertengahan tahun (6 bulan): PTKP & biaya jabatan diprorata", () => {
    const r = dec({ taxableEarnings: 10_000_000, priorMonthsExpected: 5, ytd: { months: 5, gross: 50_000_000, withheld: 1_000_000, jhtJpEmployee: 0 } });
    expect(r.amount).toBe(500_000); // PKP = 60jt − 3jt − 27jt = 30jt → 1,5jt − 1jt
  });
  it("iuran JHT/JP karyawan mengurangi penghasilan neto", () => {
    // bruto 120jt, biaya jabatan 6jt, iuran 3,6jt → neto 110,4jt − PTKP 54jt = PKP 56,4jt → 5% = 2.820.000
    const r = dec({ taxableEarnings: 10_000_000, priorMonthsExpected: 11, ytd: { months: 11, gross: 110_000_000, withheld: 0, jhtJpEmployee: 3_300_000 } });
    // (iuran bulan ini 0 karena BPJS nonaktif pada tes ini) → iuran 3,3jt: neto 110,7jt, PKP 56,7jt → 56.700.000×5% = 2.835.000
    expect(r.amount).toBe(2_835_000);
  });
  it("tanpa NPWP: pajak setahun × 120% sebelum dikurangi yang sudah dipotong", () => {
    const r = dec({ employee: { ...EMP, hasNpwp: false }, taxableEarnings: 10_000_000, priorMonthsExpected: 11, ytd: { months: 11, gross: 110_000_000, withheld: 2_200_000, jhtJpEmployee: 0 } });
    expect(r.amount).toBe(3_600_000 - 2_200_000);
  });
  it("kelebihan potong → 0 dan ada peringatan (tidak negatif)", () => {
    const res = computeStatutory(input({
      config: cfg({ bpjs: false }), finalPeriod: true, taxMonth: 12, taxableEarnings: 6_000_000, priorMonthsExpected: 11,
      ytd: { months: 11, gross: 66_000_000, withheld: 5_000_000, jhtJpEmployee: 0 },
    }));
    expect(res.pph21!.amount).toBe(0);
    expect(res.warnings.some((w) => w.includes("kelebihan"))).toBe(true);
    expect(res.lines.some((l) => l.category === "TAX")).toBe(false);
  });
  it("data bulan sebelumnya tidak lengkap → peringatan jelas", () => {
    const res = computeStatutory(input({ config: cfg({ bpjs: false }), finalPeriod: true, taxMonth: 12, taxableEarnings: 10_000_000, priorMonthsExpected: 11, ytd: { months: 4, gross: 40_000_000, withheld: 800_000, jhtJpEmployee: 0 } }));
    expect(res.warnings.some((w) => w.includes("4 dari 11"))).toBe(true);
  });
});

describe("computeStatutory — gabungan, override manual, saklar", () => {
  it("keduanya aktif: baris potongan karyawan = Kesehatan, JHT, JP, PPh 21; porsi perusahaan tidak menjadi potongan", () => {
    const r = computeStatutory(input({ bpjsWage: 8_000_000, taxableEarnings: 8_000_000 }));
    expect(r.lines.map((l) => l.name)).toEqual(["BPJS Kesehatan (1%)", "BPJS JHT (2%)", "BPJS JP (1%)", "PPh 21 (TER A)"]);
    expect(r.lines.every((l) => l.kind === "DEDUCTION")).toBe(true);
    expect(r.lines.filter((l) => l.category === "BPJS").reduce((a, l) => a + l.amount, 0)).toBe(r.bpjs!.employeeTotal);
    expect(employerContributionLines(r.bpjs, cfg().bpjs).reduce((a, l) => a + l.amount, 0)).toBe(r.bpjs!.employerTotal);
  });
  it("fitur nonaktif → tidak ada baris & hasil null", () => {
    const r = computeStatutory(input({ config: cfg({ bpjs: false, pph: false }) }));
    expect(r.lines).toEqual([]);
    expect(r.bpjs).toBeNull();
    expect(r.pph21).toBeNull();
  });
  it("komponen BPJS manual → BPJS otomatis dilewati (+ peringatan); PPh tetap dihitung tanpa premi perusahaan", () => {
    const r = computeStatutory(input({ skipBpjs: true, taxableEarnings: 8_000_000 }));
    expect(r.bpjs).toBeNull();
    expect(r.lines.some((l) => l.category === "BPJS")).toBe(false);
    expect(r.warnings.some((w) => w.includes("BPJS manual"))).toBe(true);
    expect(r.pph21!.gross).toBe(8_000_000);
  });
  it("komponen Pajak manual → PPh 21 otomatis dilewati", () => {
    const r = computeStatutory(input({ skipPph21: true }));
    expect(r.pph21).toBeNull();
    expect(r.lines.some((l) => l.category === "TAX")).toBe(false);
    expect(r.warnings.some((w) => w.includes("Pajak manual"))).toBe(true);
  });
  it("bukan peserta BPJS sama sekali → tidak ada iuran & tidak ada premi perusahaan di bruto", () => {
    const r = computeStatutory(input({ employee: { ...EMP, healthEnrolled: false, employmentEnrolled: false }, taxableEarnings: 8_000_000, bpjsWage: 8_000_000 }));
    expect(r.bpjs).toBeNull();
    expect(r.pph21!.gross).toBe(8_000_000);
  });
  it("dasar upah 0 → peringatan", () => {
    expect(computeStatutory(input({ bpjsWage: 0 })).warnings.some((w) => w.includes("Dasar upah BPJS"))).toBe(true);
  });
});
