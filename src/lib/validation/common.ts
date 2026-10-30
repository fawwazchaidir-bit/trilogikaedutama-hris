import { z } from "zod";

/** Teks opsional: string kosong/spasi → null; dipangkas; dibatasi panjangnya. */
export const optionalText = (max: number, label = "Teks") =>
  z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v ?? null),
    z.string().max(max, `${label} maksimal ${max} karakter`).nullable(),
  );

export const requiredText = (min: number, max: number, label: string) =>
  z.string({ error: `${label} wajib diisi` }).trim().min(min, `${label} wajib diisi`).max(max, `${label} maksimal ${max} karakter`);

export const optionalEmail = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim().toLowerCase()) : v ?? null),
  z.string().email("Format email tidak valid").max(200).nullable(),
);

export const optionalPhone = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v ?? null),
  z.string().regex(/^[0-9+()\-\s./]{5,30}$/, "Nomor telepon tidak valid").nullable(),
);

export const uuid = z.string().uuid("ID tidak valid");

/** Tanggal kalender nyata (menolak 2026-02-30). */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Tanggal harus berformat YYYY-MM-DD")
  .refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Tanggal tidak valid");

/** Jam "HH:mm" 24 jam. */
export const hhmm = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Jam harus berformat HH:mm (00:00–23:59)");

export const rupiah = (label: string) =>
  z
    .number({ error: `${label} harus berupa angka` })
    .int(`${label} harus berupa bilangan bulat Rupiah`)
    .min(0, `${label} tidak boleh negatif`)
    .max(100_000_000_000, `${label} terlalu besar (maksimal Rp 100 miliar)`);
