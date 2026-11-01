/**
 * Tes yang memakai TANGGAL TETAP di masa lalu (mis. "Maret 2026") sambil mengikuti aturan "pengajuan mundur maks. 365 hari"
 * akan merah dengan sendirinya begitu waktu berjalan. `pinNow()` memasang titik awal `Date` yang tetap (jam tetap berjalan)
 * untuk satu berkas tes, sehingga hasilnya sama kapan pun dijalankan. Panggil di bagian atas berkas.
 * Catatan: hanya untuk berkas yang TIDAK bergantung pada jam basis data (rate limit, jendela 15 menit, dsb.).
 */
import { vi } from "vitest";

export const PINNED_NOW = "2026-11-01T03:00:00Z";

export function pinNow(iso: string = PINNED_NOW): void {
  const t = new Date(iso);
  if (vi.isFakeTimers()) vi.setSystemTime(t);
  else vi.useFakeTimers({ now: t, toFake: ["Date"], shouldAdvanceTime: true });
}
