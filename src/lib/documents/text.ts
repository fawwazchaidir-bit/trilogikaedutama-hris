/** Teks bantu persuratan: nomor surat, tanggal/waktu Indonesia, "1 (satu) halaman", label diktum & daftar. Murni (tanpa basis data). */

export const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"] as const;
export const romanMonth = (month1to12: number): string => ROMAN[month1to12] ?? "";

export type DocSeries = "EKS" | "INT";

/** Format master: `001/TE-EKS/003/I/2026` = urut / TE-seri / kode jenis (3 digit) / bulan romawi (tanggal surat) / tahun. */
export function formatDocNumber(opts: { seq: number; series: DocSeries; typeCode: string; date: string }): string {
  const [y, m] = opts.date.split("-").map(Number) as [number, number];
  if (!/^\d{3}$/.test(opts.typeCode)) throw new Error("Kode jenis harus 3 digit.");
  if (!Number.isInteger(opts.seq) || opts.seq < 1) throw new Error("Nomor urut harus bilangan bulat positif.");
  return `${String(opts.seq).padStart(3, "0")}/TE-${opts.series}/${opts.typeCode}/${romanMonth(m)}/${y}`;
}
const NUMBER_RE = /^(\d{3,})\/TE-(EKS|INT)\/(\d{3})\/(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)\/(\d{4})$/;
export function parseDocNumber(n: string): { seq: number; series: DocSeries; typeCode: string; month: number; year: number } | null {
  const m = NUMBER_RE.exec(n);
  return m ? { seq: Number(m[1]), series: m[2] as DocSeries, typeCode: m[3]!, month: ROMAN.indexOf(m[4] as never), year: Number(m[5]) } : null;
}

const ONES = ["", "satu", "dua", "tiga", "empat", "lima", "enam", "tujuh", "delapan", "sembilan", "sepuluh", "sebelas"];
/** Terbilang kecil (1–999) untuk "(satu)". */
export function smallWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999) throw new Error("Di luar jangkauan.");
  if (n === 0) return "nol";
  if (n < 12) return ONES[n]!;
  if (n < 20) return `${ONES[n - 10]} belas`;
  if (n < 100) return `${ONES[Math.floor(n / 10)]} puluh${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
  const h = Math.floor(n / 100);
  return `${h === 1 ? "seratus" : `${ONES[h]} ratus`}${n % 100 ? ` ${smallWords(n % 100)}` : ""}`;
}
/** "1 (satu) halaman" — satuan dipilih pengguna (halaman/berkas/lembar). */
export const attachmentText = (n: number, unit: "halaman" | "berkas" | "lembar" = "halaman"): string => `${n} (${smallWords(n)}) ${unit}`;

const DAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const MONTHS = ["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"];
/** `2026-11-11` → "Rabu, 11 November 2026" (hari dihitung, bukan diketik). */
export function dayDate(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${d} ${MONTHS[m - 1]} ${y}`;
}
/** `2026-11-09` → "09 November 2026"; `longDate(iso, false)` → "9 November 2026". */
export function longDate(iso: string, pad = false): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return `${pad ? String(d).padStart(2, "0") : d} ${MONTHS[m - 1]} ${y}`;
}
/** ("09:00","16:00","WIB") → "09.00 – 16.00 WIB". */
export const timeRange = (from: string, to: string | null, zone = "WIB"): string => `${from.replace(":", ".")}${to ? ` – ${to.replace(":", ".")}` : ""} ${zone}`;

const DIKTUM = ["KESATU", "KEDUA", "KETIGA", "KEEMPAT", "KELIMA", "KEENAM", "KETUJUH", "KEDELAPAN", "KESEMBILAN", "KESEPULUH", "KESEBELAS", "KEDUABELAS"];
export const diktumLabel = (index0: number): string => DIKTUM[index0] ?? `KE-${index0 + 1}`;

export type ListStyle = "decimal" | "lower-alpha" | "upper-alpha" | "lower-roman";
export function listMarker(style: ListStyle, n1: number): string {
  if (style === "lower-alpha") return `${String.fromCharCode(96 + ((n1 - 1) % 26) + 1)}.`;
  if (style === "upper-alpha") return `${String.fromCharCode(64 + ((n1 - 1) % 26) + 1)}.`;
  if (style === "lower-roman") return `${(ROMAN[n1] ?? String(n1)).toLowerCase()}.`;
  return `${n1}.`;
}
