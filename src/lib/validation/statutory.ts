import { z } from "zod";
import { TAX_STATUSES, type StatutoryConfig, type TaxStatus } from "../statutory";

const rupiah = (label: string) => z.number({ error: `${label} harus berupa angka` }).int(`${label} harus bilangan bulat Rupiah`).min(0, `${label} tidak boleh negatif`).max(100_000_000_000_000, `${label} terlalu besar`);
/** Tarif basis point (100 = 1%). */
const bp = (label: string, max: number) => z.number({ error: `${label} harus berupa angka` }).int(`${label} harus bilangan bulat (basis point)`).min(0, `${label} tidak boleh negatif`).max(max, `${label} terlalu besar (maks ${max / 100}%)`);

/** Lapisan harus naik tegas, tarifnya tidak menurun, dan ditutup lapisan tanpa batas (`upTo: null`). */
function bracketsSchema(label: string, maxRateBp: number) {
  return z.array(z.object({ upTo: z.number().int().min(0).nullable(), rateBp: bp(`Tarif ${label}`, maxRateBp) }))
    .min(2, `${label}: minimal 2 lapisan`).max(100, `${label}: maksimal 100 lapisan`)
    .superRefine((rows, ctx) => {
      rows.forEach((r, i) => {
        const last = i === rows.length - 1;
        if (last && r.upTo !== null) ctx.addIssue({ code: "custom", path: [i, "upTo"], message: `${label}: lapisan terakhir harus tanpa batas atas (null)` });
        if (!last && r.upTo === null) ctx.addIssue({ code: "custom", path: [i, "upTo"], message: `${label}: hanya lapisan terakhir yang boleh tanpa batas atas` });
        if (i > 0 && !last && rows[i - 1]!.upTo !== null && r.upTo !== null && r.upTo <= rows[i - 1]!.upTo!) ctx.addIssue({ code: "custom", path: [i, "upTo"], message: `${label}: batas atas harus naik (baris ${i + 1})` });
        if (i > 0 && r.rateBp < rows[i - 1]!.rateBp) ctx.addIssue({ code: "custom", path: [i, "rateBp"], message: `${label}: tarif tidak boleh turun (baris ${i + 1})` });
      });
    });
}

const taxRecord = <T extends z.ZodTypeAny>(item: T) =>
  z.object(Object.fromEntries(TAX_STATUSES.map((s) => [s, item])) as Record<TaxStatus, T>);

export const statutoryConfigSchema = z.object({
  version: z.literal(1),
  bpjs: z.object({
    enabled: z.boolean(),
    healthEmployeeBp: bp("Kesehatan (karyawan)", 2_000), healthEmployerBp: bp("Kesehatan (perusahaan)", 2_000), healthWageCap: rupiah("Batas upah Kesehatan"),
    jhtEmployeeBp: bp("JHT (karyawan)", 2_000), jhtEmployerBp: bp("JHT (perusahaan)", 2_000),
    jpEmployeeBp: bp("JP (karyawan)", 2_000), jpEmployerBp: bp("JP (perusahaan)", 2_000), jpWageCap: rupiah("Batas upah JP"),
    jkkEmployerBp: bp("JKK", 1_000), jkmEmployerBp: bp("JKM", 1_000),
  }),
  pph21: z.object({
    enabled: z.boolean(),
    ptkp: taxRecord(rupiah("PTKP")),
    terCategoryOf: taxRecord(z.enum(["A", "B", "C"], { error: "Kategori TER harus A, B, atau C" })),
    ter: z.object({ A: bracketsSchema("Tabel TER A", 5_000), B: bracketsSchema("Tabel TER B", 5_000), C: bracketsSchema("Tabel TER C", 5_000) }),
    brackets: bracketsSchema("Lapisan Pasal 17", 5_000),
    biayaJabatanBp: bp("Biaya jabatan", 2_000), biayaJabatanMonthlyCap: rupiah("Batas biaya jabatan per bulan"),
    noNpwpMultiplierBp: z.number().int().min(10_000, "Pengali tanpa NPWP minimal 100% (10000)").max(30_000, "Pengali tanpa NPWP maksimal 300%"),
    employerInsuranceInGross: z.boolean(),
  }),
}) satisfies z.ZodType<StatutoryConfig>;
