/**
 * BPJS & PPh 21 otomatis — FUNGSI MURNI. Semua tarif, batas upah, tabel TER, PTKP, dan lapisan tarif berasal dari
 * `StatutoryConfig` (disimpan di Pengaturan, dikonfirmasi Super Admin). Nilai bawaan di `defaultStatutoryConfig()` adalah
 * titik awal berdasarkan ketentuan yang diketahui saat pengembangan dan WAJIB diverifikasi (mis. batas upah JP berubah tiap tahun,
 * tabel TER mengikuti PMK 168/2023). Fitur nonaktif secara bawaan.
 *
 * Satuan: Rupiah bulat; tarif dalam basis point (1 bp = 0,01%; 100 bp = 1%). Pembulatan satu-satunya: half-up di akhir tiap komponen.
 *
 * Metode PPh 21 (PP 58/2023 & PMK 168/2023):
 *  - Masa pajak Januari–November (dan setiap masa non-final): tarif efektif rata-rata (TER) × penghasilan bruto bulan itu.
 *  - Masa pajak terakhir (Desember, atau karyawan berhenti pada periode itu): dihitung setahun dengan tarif Pasal 17,
 *    dikurangi PPh 21 yang sudah dipotong pada masa sebelumnya (true-up). Hasil negatif dipotong nol dan diberi peringatan.
 *  - Penghasilan bruto = pendapatan kena pajak + premi yang dibayar pemberi kerja (BPJS Kesehatan, JKK, JKM) bila dikonfigurasi.
 *
 * Penggantian manual: bila karyawan punya komponen potongan berkategori BPJS / Pajak, bagian otomatis yang bersangkutan DILEWATI
 * (aturan manual menang) dan diberi peringatan.
 */
import { formatRupiah, roundDivHalfUp } from "./money";

export type TaxStatus = "TK0" | "TK1" | "TK2" | "TK3" | "K0" | "K1" | "K2" | "K3";
export type TerCategory = "A" | "B" | "C";
export const TAX_STATUSES: readonly TaxStatus[] = ["TK0", "TK1", "TK2", "TK3", "K0", "K1", "K2", "K3"];
export const TAX_STATUS_LABEL: Record<TaxStatus, string> = {
  TK0: "TK/0 — tidak kawin, 0 tanggungan", TK1: "TK/1 — tidak kawin, 1 tanggungan", TK2: "TK/2 — tidak kawin, 2 tanggungan", TK3: "TK/3 — tidak kawin, 3 tanggungan",
  K0: "K/0 — kawin, 0 tanggungan", K1: "K/1 — kawin, 1 tanggungan", K2: "K/2 — kawin, 2 tanggungan", K3: "K/3 — kawin, 3 tanggungan",
};

export interface Bracket {
  /** Batas atas (termasuk). null = tanpa batas. */
  upTo: number | null;
  /** Tarif basis point dari nilai (TER: 25 = 0,25%; Pasal 17: 500 = 5%). */
  rateBp: number;
}

export interface BpjsConfig {
  enabled: boolean;
  healthEmployeeBp: number;
  healthEmployerBp: number;
  /** Batas atas upah untuk iuran Kesehatan. */
  healthWageCap: number;
  jhtEmployeeBp: number;
  jhtEmployerBp: number;
  jpEmployeeBp: number;
  jpEmployerBp: number;
  /** Batas atas upah JP (diperbarui tiap tahun oleh BPJS Ketenagakerjaan). */
  jpWageCap: number;
  jkkEmployerBp: number;
  jkmEmployerBp: number;
}

export interface Pph21Config {
  enabled: boolean;
  ptkp: Record<TaxStatus, number>;
  terCategoryOf: Record<TaxStatus, TerCategory>;
  ter: Record<TerCategory, Bracket[]>;
  /** Lapisan tarif Pasal 17 (untuk masa pajak terakhir). */
  brackets: Bracket[];
  biayaJabatanBp: number;
  biayaJabatanMonthlyCap: number;
  /** Pengali bila tanpa NPWP (12000 = 120%). */
  noNpwpMultiplierBp: number;
  /** Premi Kesehatan/JKK/JKM yang dibayar perusahaan ikut penghasilan bruto. */
  employerInsuranceInGross: boolean;
}

export interface StatutoryConfig {
  version: 1;
  bpjs: BpjsConfig;
  pph21: Pph21Config;
}

const b = (rows: [number | null, number][]): Bracket[] => rows.map(([upTo, rateBp]) => ({ upTo, rateBp }));

const TER_A = b([
  [5_400_000, 0], [5_650_000, 25], [5_950_000, 50], [6_300_000, 75], [6_750_000, 100], [7_500_000, 125], [8_550_000, 150], [9_650_000, 175],
  [10_050_000, 200], [10_350_000, 225], [10_700_000, 250], [11_050_000, 300], [11_600_000, 350], [12_500_000, 400], [13_750_000, 500],
  [15_100_000, 600], [16_950_000, 700], [19_750_000, 800], [24_150_000, 900], [26_450_000, 1000], [28_000_000, 1100], [30_050_000, 1200],
  [32_400_000, 1300], [35_400_000, 1400], [39_100_000, 1500], [43_850_000, 1600], [47_800_000, 1700], [51_400_000, 1800], [56_300_000, 1900],
  [62_200_000, 2000], [68_600_000, 2100], [77_500_000, 2200], [89_000_000, 2300], [103_000_000, 2400], [125_000_000, 2500], [157_000_000, 2600],
  [206_000_000, 2700], [337_000_000, 2800], [454_000_000, 2900], [550_000_000, 3000], [695_000_000, 3100], [910_000_000, 3200],
  [1_400_000_000, 3300], [null, 3400],
]);
const TER_B = b([
  [6_200_000, 0], [6_500_000, 25], [6_850_000, 50], [7_300_000, 75], [9_200_000, 100], [10_750_000, 150], [11_250_000, 200], [11_600_000, 250],
  [12_600_000, 300], [13_600_000, 400], [14_950_000, 500], [16_400_000, 600], [18_450_000, 700], [21_850_000, 800], [26_000_000, 900],
  [27_700_000, 1000], [29_350_000, 1100], [31_450_000, 1200], [33_950_000, 1300], [37_100_000, 1400], [41_100_000, 1500], [45_800_000, 1600],
  [49_500_000, 1700], [53_800_000, 1800], [58_500_000, 1900], [64_000_000, 2000], [71_000_000, 2100], [80_000_000, 2200], [93_000_000, 2300],
  [109_000_000, 2400], [129_000_000, 2500], [163_000_000, 2600], [211_000_000, 2700], [374_000_000, 2800], [459_000_000, 2900],
  [555_000_000, 3000], [704_000_000, 3100], [957_000_000, 3200], [1_405_000_000, 3300], [null, 3400],
]);
const TER_C = b([
  [6_600_000, 0], [6_950_000, 25], [7_350_000, 50], [7_800_000, 75], [8_850_000, 100], [9_800_000, 125], [10_950_000, 150], [11_200_000, 175],
  [12_050_000, 200], [12_950_000, 300], [14_150_000, 400], [15_550_000, 500], [17_050_000, 600], [19_500_000, 700], [22_700_000, 800],
  [26_600_000, 900], [28_100_000, 1000], [30_100_000, 1100], [32_600_000, 1200], [35_400_000, 1300], [38_900_000, 1400], [43_000_000, 1500],
  [47_400_000, 1600], [51_200_000, 1700], [55_800_000, 1800], [60_400_000, 1900], [66_700_000, 2000], [74_500_000, 2100], [83_200_000, 2200],
  [95_600_000, 2300], [110_000_000, 2400], [134_000_000, 2500], [169_000_000, 2600], [221_000_000, 2700], [390_000_000, 2800],
  [463_000_000, 2900], [561_000_000, 3000], [709_000_000, 3100], [965_000_000, 3200], [1_419_000_000, 3300], [null, 3400],
]);

/**
 * Nilai bawaan (nonaktif). Perlu diverifikasi sebelum dipakai — lihat catatan di kepala berkas.
 * Selalu mengembalikan SALINAN DALAM: tabel adalah konstanta modul, dan pemanggil (UI/tes) boleh mengubah hasilnya.
 */
export function defaultStatutoryConfig(): StatutoryConfig {
  return structuredClone(DEFAULTS);
}

const DEFAULTS: StatutoryConfig = (() => {
  return {
    version: 1,
    bpjs: {
      enabled: false,
      healthEmployeeBp: 100, healthEmployerBp: 400, healthWageCap: 12_000_000,
      jhtEmployeeBp: 200, jhtEmployerBp: 370,
      jpEmployeeBp: 100, jpEmployerBp: 200, jpWageCap: 10_547_400,
      jkkEmployerBp: 24, jkmEmployerBp: 30,
    },
    pph21: {
      enabled: false,
      ptkp: { TK0: 54_000_000, TK1: 58_500_000, TK2: 63_000_000, TK3: 67_500_000, K0: 58_500_000, K1: 63_000_000, K2: 67_500_000, K3: 72_000_000 },
      terCategoryOf: { TK0: "A", TK1: "A", K0: "A", TK2: "B", TK3: "B", K1: "B", K2: "B", K3: "C" },
      ter: { A: TER_A, B: TER_B, C: TER_C },
      brackets: b([[60_000_000, 500], [250_000_000, 1500], [500_000_000, 2500], [5_000_000_000, 3000], [null, 3500]]),
      biayaJabatanBp: 500, biayaJabatanMonthlyCap: 500_000,
      noNpwpMultiplierBp: 12_000,
      employerInsuranceInGross: true,
    },
  };
})();

// ─────────────────────────── Fungsi dasar ───────────────────────────

const rp = (n: number) => formatRupiah(n, "PLAIN");
const pct = (bp: number) => `${(bp / 100).toString().replace(".", ",")}%`;

/** nominal × bp ÷ 10.000, dibulatkan half-up. */
export function bpOf(amount: number, bp: number): number {
  if (amount <= 0 || bp <= 0) return 0;
  return Number(roundDivHalfUp(BigInt(amount) * BigInt(bp), 10_000n));
}

/** Tarif pada lapisan pertama yang batas atasnya ≥ nilai. */
export function bracketRate(value: number, brackets: Bracket[]): number {
  for (const br of brackets) if (br.upTo === null || value <= br.upTo) return br.rateBp;
  return brackets[brackets.length - 1]?.rateBp ?? 0;
}

/** Pajak progresif (Pasal 17): jumlah tiap lapisan × tarif, dibulatkan sekali di akhir. */
export function progressiveTax(pkp: number, brackets: Bracket[]): number {
  if (pkp <= 0) return 0;
  let prev = 0;
  let numerator = 0n;
  for (const br of brackets) {
    const top = br.upTo ?? Number.POSITIVE_INFINITY;
    const slice = Math.min(pkp, top) - prev;
    if (slice > 0) numerator += BigInt(slice) * BigInt(br.rateBp);
    if (pkp <= top) break;
    prev = top;
  }
  return Number(roundDivHalfUp(numerator, 10_000n));
}

// ─────────────────────────── BPJS ───────────────────────────

export interface BpjsResult {
  /** Dasar upah (gaji pokok + tunjangan tetap). */
  wage: number;
  healthWage: number;
  jpWage: number;
  employee: { health: number; jht: number; jp: number };
  employer: { health: number; jht: number; jp: number; jkk: number; jkm: number };
  employeeTotal: number;
  employerTotal: number;
}

export function computeBpjs(wage: number, cfg: BpjsConfig, emp: { healthEnrolled: boolean; employmentEnrolled: boolean }): BpjsResult {
  const healthWage = Math.min(wage, cfg.healthWageCap);
  const jpWage = Math.min(wage, cfg.jpWageCap);
  const he = emp.healthEnrolled, ee = emp.employmentEnrolled;
  const employee = {
    health: he ? bpOf(healthWage, cfg.healthEmployeeBp) : 0,
    jht: ee ? bpOf(wage, cfg.jhtEmployeeBp) : 0,
    jp: ee ? bpOf(jpWage, cfg.jpEmployeeBp) : 0,
  };
  const employer = {
    health: he ? bpOf(healthWage, cfg.healthEmployerBp) : 0,
    jht: ee ? bpOf(wage, cfg.jhtEmployerBp) : 0,
    jp: ee ? bpOf(jpWage, cfg.jpEmployerBp) : 0,
    jkk: ee ? bpOf(wage, cfg.jkkEmployerBp) : 0,
    jkm: ee ? bpOf(wage, cfg.jkmEmployerBp) : 0,
  };
  return {
    wage, healthWage, jpWage, employee, employer,
    employeeTotal: employee.health + employee.jht + employee.jp,
    employerTotal: employer.health + employer.jht + employer.jp + employer.jkk + employer.jkm,
  };
}

// ─────────────────────────── PPh 21 ───────────────────────────

export interface YtdInput {
  /** Jumlah masa pajak sebelumnya (pada tahun pajak yang sama) yang tercatat di sistem. */
  months: number;
  /** Σ penghasilan bruto kena pajak masa sebelumnya. */
  gross: number;
  /** Σ PPh 21 yang sudah dipotong. */
  withheld: number;
  /** Σ iuran JHT + JP karyawan (pengurang penghasilan). */
  jhtJpEmployee: number;
}

export interface Pph21Result {
  method: "TER" | "ANNUAL";
  category: TerCategory | null;
  /** Penghasilan bruto masa ini (dasar TER / bagian dari setahun). */
  gross: number;
  rateBp: number | null;
  amount: number;
  /** Rincian langkah hitung untuk ditampilkan pada rumus. */
  detail: string;
}

function terTax(gross: number, status: TaxStatus, hasNpwp: boolean, cfg: Pph21Config): Pph21Result {
  const category = cfg.terCategoryOf[status];
  const rateBp = bracketRate(gross, cfg.ter[category]);
  const multiplier = hasNpwp ? 10_000 : cfg.noNpwpMultiplierBp;
  const amount = gross <= 0 || rateBp === 0 ? 0 : Number(roundDivHalfUp(BigInt(gross) * BigInt(rateBp) * BigInt(multiplier), 100_000_000n));
  return {
    method: "TER", category, gross, rateBp, amount,
    detail: `TER kategori ${category} (${status}): ${pct(rateBp)} × bruto ${rp(gross)}${hasNpwp ? "" : ` × ${pct(cfg.noNpwpMultiplierBp)} (tanpa NPWP)`}`,
  };
}

function annualTax(args: {
  gross: number; ytd: YtdInput; currentJhtJp: number; status: TaxStatus; hasNpwp: boolean; cfg: Pph21Config; warnings: string[];
}): Pph21Result {
  const { ytd, cfg } = args;
  const months = Math.min(12, ytd.months + 1);
  const annualGross = ytd.gross + args.gross;
  const biayaJabatan = Math.min(bpOf(annualGross, cfg.biayaJabatanBp), cfg.biayaJabatanMonthlyCap * months);
  const iuran = ytd.jhtJpEmployee + args.currentJhtJp;
  const neto = Math.max(0, annualGross - biayaJabatan - iuran);
  const ptkp = Math.round((cfg.ptkp[args.status] * months) / 12);
  const pkp = Math.max(0, Math.floor((neto - ptkp) / 1000) * 1000);
  let tax = progressiveTax(pkp, cfg.brackets);
  if (!args.hasNpwp) tax = Number(roundDivHalfUp(BigInt(tax) * BigInt(cfg.noNpwpMultiplierBp), 10_000n));
  let amount = tax - ytd.withheld;
  if (amount < 0) {
    args.warnings.push(`PPh 21 setahun (${rp(tax)}) lebih kecil dari yang sudah dipotong (${rp(ytd.withheld)}): kelebihan ${rp(-amount)} tidak dikembalikan otomatis — periksa dan proses sesuai ketentuan.`);
    amount = 0;
  }
  return {
    method: "ANNUAL", category: null, gross: args.gross, rateBp: null, amount,
    detail: `Masa pajak terakhir: bruto setahun ${rp(annualGross)} − biaya jabatan ${rp(biayaJabatan)} − iuran JHT/JP ${rp(iuran)} = neto ${rp(neto)}; ` +
      `PTKP ${args.status} ${rp(ptkp)}${months < 12 ? ` (${months}/12 bulan)` : ""} → PKP ${rp(pkp)}; pajak setahun ${rp(tax)} − sudah dipotong ${rp(ytd.withheld)}`,
  };
}

// ─────────────────────────── Gabungan ───────────────────────────

export interface StatutoryInput {
  config: StatutoryConfig;
  employee: { taxStatus: TaxStatus; hasNpwp: boolean; healthEnrolled: boolean; employmentEnrolled: boolean };
  /** Dasar upah BPJS: Σ komponen pendapatan bertanda "dasar BPJS". */
  bpjsWage: number;
  /** Pendapatan kena pajak masa ini (di luar premi pemberi kerja), sudah dikurangi potongan absensi/keterlambatan. */
  taxableEarnings: number;
  /** Masa pajak (1–12) & apakah masa pajak terakhir (Desember / karyawan berhenti). */
  taxMonth: number;
  finalPeriod: boolean;
  /** Data masa sebelumnya (wajib untuk masa terakhir). */
  ytd: YtdInput | null;
  /** Jumlah masa sebelumnya yang SEHARUSNYA ada (untuk peringatan data tidak lengkap). */
  priorMonthsExpected: number;
  /** Aturan manual menang atas otomatis. */
  skipBpjs: boolean;
  skipPph21: boolean;
}

export interface StatutoryLine {
  kind: "DEDUCTION";
  category: "BPJS" | "TAX";
  name: string;
  amount: number;
  formula: string;
}

export interface StatutoryResult {
  bpjs: BpjsResult | null;
  pph21: Pph21Result | null;
  /** Potongan karyawan (BPJS porsi karyawan + PPh 21). Porsi perusahaan tidak mengurangi gaji bersih. */
  lines: StatutoryLine[];
  warnings: string[];
}

export function computeStatutory(input: StatutoryInput): StatutoryResult {
  const { config, employee } = input;
  const warnings: string[] = [];
  const lines: StatutoryLine[] = [];
  let bpjs: BpjsResult | null = null;
  let pph21: Pph21Result | null = null;

  if (config.bpjs.enabled) {
    if (input.skipBpjs) {
      warnings.push("BPJS otomatis dilewati: karyawan memiliki komponen potongan BPJS manual (aturan manual menang).");
    } else if (!employee.healthEnrolled && !employee.employmentEnrolled) {
      // Bukan peserta: tidak ada iuran.
    } else {
      if (input.bpjsWage <= 0) warnings.push("Dasar upah BPJS bernilai 0: tandai komponen gaji pokok/tunjangan tetap sebagai \"dasar BPJS\" pada komponen gaji karyawan.");
      bpjs = computeBpjs(input.bpjsWage, config.bpjs, employee);
      const c = config.bpjs;
      const wageNote = (cap: number, w: number) => (w < input.bpjsWage ? ` (upah dibatasi ${rp(cap)})` : "");
      if (bpjs.employee.health > 0) lines.push({ kind: "DEDUCTION", category: "BPJS", name: `BPJS Kesehatan (${pct(c.healthEmployeeBp)})`, amount: bpjs.employee.health, formula: `${pct(c.healthEmployeeBp)} × upah ${rp(bpjs.healthWage)}${wageNote(c.healthWageCap, bpjs.healthWage)}` });
      if (bpjs.employee.jht > 0) lines.push({ kind: "DEDUCTION", category: "BPJS", name: `BPJS JHT (${pct(c.jhtEmployeeBp)})`, amount: bpjs.employee.jht, formula: `${pct(c.jhtEmployeeBp)} × upah ${rp(bpjs.wage)}` });
      if (bpjs.employee.jp > 0) lines.push({ kind: "DEDUCTION", category: "BPJS", name: `BPJS JP (${pct(c.jpEmployeeBp)})`, amount: bpjs.employee.jp, formula: `${pct(c.jpEmployeeBp)} × upah ${rp(bpjs.jpWage)}${wageNote(c.jpWageCap, bpjs.jpWage)}` });
    }
  }

  if (config.pph21.enabled) {
    if (input.skipPph21) {
      warnings.push("PPh 21 otomatis dilewati: karyawan memiliki komponen potongan Pajak manual (aturan manual menang).");
    } else {
      const cfg = config.pph21;
      const employerPremium = cfg.employerInsuranceInGross && bpjs ? bpjs.employer.health + bpjs.employer.jkk + bpjs.employer.jkm : 0;
      const gross = Math.max(0, input.taxableEarnings) + employerPremium;
      if (input.finalPeriod) {
        const ytd = input.ytd ?? { months: 0, gross: 0, withheld: 0, jhtJpEmployee: 0 };
        if (ytd.months < input.priorMonthsExpected) {
          warnings.push(`PPh 21 masa pajak terakhir: hanya ${ytd.months} dari ${input.priorMonthsExpected} masa sebelumnya tercatat di sistem (penggajian disetujui/terbit). Hasil setahun bisa tidak akurat — lengkapi atau sesuaikan manual.`);
        }
        pph21 = annualTax({
          gross, ytd, currentJhtJp: bpjs ? bpjs.employee.jht + bpjs.employee.jp : 0, status: employee.taxStatus, hasNpwp: employee.hasNpwp, cfg, warnings,
        });
      } else {
        pph21 = terTax(gross, employee.taxStatus, employee.hasNpwp, cfg);
      }
      if (pph21.amount > 0) {
        lines.push({ kind: "DEDUCTION", category: "TAX", name: pph21.method === "TER" ? `PPh 21 (TER ${pph21.category})` : "PPh 21 (masa pajak terakhir)", amount: pph21.amount, formula: pph21.detail });
      }
    }
  }
  return { bpjs, pph21, lines, warnings };
}

/** Ringkasan beban perusahaan untuk slip/laporan (tidak mengurangi gaji bersih karyawan). */
export function employerContributionLines(b: BpjsResult | null, cfg: BpjsConfig | null): { name: string; amount: number }[] {
  if (!b || !cfg) return [];
  const rows: { name: string; amount: number }[] = [
    { name: `BPJS Kesehatan (${pct(cfg.healthEmployerBp)})`, amount: b.employer.health },
    { name: `BPJS JHT (${pct(cfg.jhtEmployerBp)})`, amount: b.employer.jht },
    { name: `BPJS JP (${pct(cfg.jpEmployerBp)})`, amount: b.employer.jp },
    { name: `BPJS JKK (${pct(cfg.jkkEmployerBp)})`, amount: b.employer.jkk },
    { name: `BPJS JKM (${pct(cfg.jkmEmployerBp)})`, amount: b.employer.jkm },
  ];
  return rows.filter((r) => r.amount > 0);
}
