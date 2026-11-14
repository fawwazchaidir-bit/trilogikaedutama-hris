/**
 * Kop surat: baris kontak di bawah alamat — Email, Telp, Website (urutan tetap; bagian yang kosong dilewati).
 * Murni (tanpa I/O) agar dipakai renderer, pratinjau, dan tes dengan satu aturan.
 */
export interface KopContact { email?: string | null; phone?: string | null; website?: string | null }

const NBSP = "\u00A0";
/** Rapikan spasi; spasi DI DALAM satu bagian dijadikan spasi tak-terputus supaya baris hanya patah di antara bagian ("Telp: 0274 123" tidak terpisah). */
const tidy = (v: string | null | undefined): string => (v ?? "").replace(/\s+/g, " ").trim().replace(/ /g, NBSP);

export const KOP_CONTACT_SEPARATOR = "  |  ";

/** `Email: x  |  Telp: y  |  Website: z`; null bila semuanya kosong. */
export function kopContactLine(c: KopContact): string | null {
  const parts = [
    ["Email", tidy(c.email)], ["Telp", tidy(c.phone)], ["Website", tidy(c.website)],
  ].filter(([, v]) => v !== "").map(([k, v]) => `${k}:${NBSP}${v}`);
  return parts.length ? parts.join(KOP_CONTACT_SEPARATOR) : null;
}
