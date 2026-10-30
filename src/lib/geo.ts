/**
 * Absensi berbasis lokasi (opsional). Lokasi perangkat hanyalah ALAT BANTU: koordinat berasal dari browser/ponsel
 * karyawan sehingga TIDAK menjamin pencegahan manipulasi (mis. aplikasi lokasi palsu). Sistem tidak melacak lokasi
 * terus-menerus — koordinat hanya dibaca satu kali saat karyawan menekan check-in / check-out.
 */

export interface GeoPoint { lat: number; lng: number }

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Jarak lingkaran besar (haversine) dalam meter. */
export function distanceMeters(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h))));
}

export interface GeoPolicy {
  enabled: boolean;
  name: string | null;
  center: GeoPoint | null;
  radiusMeters: number;
  maxAccuracyMeters: number;
}

export interface GeoReading { lat: number; lng: number; accuracy: number | null }

export type GeoVerdict =
  | { ok: true; distance: number | null }
  | { ok: false; code: "LOCATION_REQUIRED" | "LOCATION_INVALID" | "LOCATION_INACCURATE" | "LOCATION_OUTSIDE"; message: string; distance?: number };

export function isValidReading(r: GeoReading | null | undefined): r is GeoReading {
  return !!r && Number.isFinite(r.lat) && Number.isFinite(r.lng) && Math.abs(r.lat) <= 90 && Math.abs(r.lng) <= 180
    && (r.accuracy === null || (Number.isFinite(r.accuracy) && r.accuracy >= 0));
}

/** Evaluasi pembacaan lokasi terhadap kebijakan. Bila fitur nonaktif → selalu lolos (koordinat tidak diperlukan). */
export function evaluateGeofence(policy: GeoPolicy, reading: GeoReading | null | undefined): GeoVerdict {
  if (!policy.enabled || !policy.center) return { ok: true, distance: null };
  if (!reading) {
    return {
      ok: false, code: "LOCATION_REQUIRED",
      message: "Absensi mewajibkan lokasi. Izinkan akses lokasi pada browser/ponsel Anda, lalu coba lagi.",
    };
  }
  if (!isValidReading(reading)) {
    return { ok: false, code: "LOCATION_INVALID", message: "Data lokasi dari perangkat tidak valid. Coba lagi." };
  }
  const distance = distanceMeters(policy.center, reading);
  if (reading.accuracy !== null && reading.accuracy > policy.maxAccuracyMeters) {
    return {
      ok: false, code: "LOCATION_INACCURATE", distance,
      message: `Akurasi lokasi perangkat terlalu rendah (±${Math.round(reading.accuracy)} m; maksimal ${policy.maxAccuracyMeters} m). Aktifkan GPS/lokasi presisi tinggi lalu coba lagi.`,
    };
  }
  if (distance > policy.radiusMeters) {
    return {
      ok: false, code: "LOCATION_OUTSIDE", distance,
      message: `Anda berada di luar radius absensi${policy.name ? ` ${policy.name}` : ""}: ${distance} m dari titik lokasi (maksimal ${policy.radiusMeters} m).`,
    };
  }
  return { ok: true, distance };
}
