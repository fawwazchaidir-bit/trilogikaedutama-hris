/**
 * Uji silang waktu: `TEST_NOW=2026-12-31T17:30:00Z npm test` membekukan titik awal `Date` (jam tetap berjalan) agar seluruh
 * suite dijalankan "seolah-olah" pada tanggal itu — mis. pergantian tahun/bulan, atau saat tanggal UTC ≠ tanggal WIB.
 * Hanya `Date` yang dipalsukan (timer asli tetap). Tanpa TEST_NOW tidak ada efek.
 */
import { vi } from "vitest";

const raw = process.env.TEST_NOW;
if (raw) {
  const t = new Date(raw);
  if (Number.isNaN(t.getTime())) throw new Error(`TEST_NOW tidak valid: ${raw}`);
  vi.useFakeTimers({ now: t, toFake: ["Date"], shouldAdvanceTime: true });
}
