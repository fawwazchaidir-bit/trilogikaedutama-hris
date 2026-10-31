/**
 * Alamat IP klien dari header proxy. IP hanya dicatat sebagai informasi (audit & pembatasan percobaan masuk) dan TIDAK
 * dipakai untuk memutuskan absensi: karyawan dinas luar memang tidak berada di jaringan kantor.
 */

/**
 * Alamat klien dari header X-Forwarded-For. Klien dapat mengirim header ini sendiri, dan proxy hanya MENAMBAHKAN
 * alamat yang ia lihat di ujung kanan — jadi entri paling kiri bisa dipalsukan (mis. berpura-pura berada di jaringan kantor).
 * Yang dipercaya adalah entri ke-`hops` dari KANAN (hops = jumlah proxy tepercaya di depan aplikasi; umumnya 1).
 */
export function clientIpFromForwardedFor(header: string | null | undefined, hops = 1): string | null {
  if (!header) return null;
  const parts = header.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const n = Number.isFinite(hops) ? Math.max(1, Math.floor(hops)) : 1;
  const ip = parts[Math.max(0, parts.length - n)] ?? null;
  return ip && ip.length <= 64 ? ip : null;
}

