/**
 * Batas waktu retensi: `months` bulan KALENDER sebelum `now` (UTC). Bila hari asal tidak ada di bulan tujuan, dipotong ke
 * hari terakhir bulan itu (31 Mei − 3 bulan = 28/29 Feb). `months` ≤ 0 → null (simpan selamanya, tidak ada penghapusan).
 * Fungsi murni agar mudah diuji.
 */
export function retentionCutoff(now: Date, months: number): Date | null {
  if (!Number.isFinite(months) || months <= 0) return null;
  const total = now.getUTCFullYear() * 12 + now.getUTCMonth() - Math.floor(months);
  const year = Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const d = new Date(now.getTime());
  d.setUTCDate(1);
  d.setUTCFullYear(year, month, Math.min(now.getUTCDate(), lastDay));
  return d;
}
