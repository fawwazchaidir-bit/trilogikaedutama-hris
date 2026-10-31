/**
 * Penilaian risiko lokasi palsu — FUNGSI MURNI.
 *
 * PENTING (jujur): aplikasi web TIDAK dapat memverifikasi bahwa koordinat benar-benar berasal dari GPS. Siapa pun yang
 * mengendalikan perangkat/permintaan dapat mengirim koordinat apa pun. Karena itu pendekatannya BERLAPIS: beberapa sinyal
 * independen yang masing-masing lemah, ditambah satu sinyal yang tidak bergantung pada GPS (jaringan kantor), lalu hasilnya
 * ditandai untuk tinjauan HR atau — bila diatur — ditolak. Skor adalah INDIKATOR, bukan bukti kecurangan.
 */
import type { GeoReading } from "./geo";

export type RiskFlag =
  | "MOCK_REPORTED" | "STALE_READING" | "FUTURE_READING" | "CLOCK_SKEW" | "MISSING_TELEMETRY" | "ACCURACY_PERFECT" | "COORDS_LOW_PRECISION"
  | "EXACT_CENTER" | "REPEAT_COORDS" | "SHARED_COORDS" | "IMPOSSIBLE_TRAVEL" | "NEW_DEVICE" | "SHARED_DEVICE"
  | "OUTSIDE_OFFICE_NETWORK" | "INSIDE_OFFICE_NETWORK"
  // Penolakan non-risiko (geofence / jaringan wajib) — dicatat agar pola percobaan terlihat.
  | "OUTSIDE_RADIUS" | "LOW_ACCURACY" | "NO_LOCATION" | "INVALID_LOCATION" | "NETWORK_REQUIRED";

export const RISK_FLAG_LABEL: Record<RiskFlag, string> = {
  MOCK_REPORTED: "Perangkat melaporkan lokasi tiruan",
  STALE_READING: "Pembacaan lokasi basi (bukan pembacaan baru)",
  FUTURE_READING: "Waktu pembacaan lokasi di masa depan",
  CLOCK_SKEW: "Jam perangkat berbeda jauh dari server",
  MISSING_TELEMETRY: "Data waktu pembacaan tidak dikirim (bukan dari aplikasi resmi?)",
  ACCURACY_PERFECT: "Akurasi tidak realistis (< 1 m)",
  COORDS_LOW_PRECISION: "Koordinat berpresisi rendah (≤ 4 desimal)",
  EXACT_CENTER: "Tepat di titik pusat kantor (≤ 1 m)",
  REPEAT_COORDS: "Koordinat GPS identik dengan pembacaan sebelumnya",
  SHARED_COORDS: "Koordinat GPS identik dengan karyawan lain",
  IMPOSSIBLE_TRAVEL: "Perpindahan mustahil dari lokasi sebelumnya",
  NEW_DEVICE: "Perangkat/browser berbeda dari yang biasa dipakai",
  SHARED_DEVICE: "Perangkat yang sama dipakai karyawan lain (titip absen?)",
  OUTSIDE_OFFICE_NETWORK: "Bukan dari jaringan kantor",
  INSIDE_OFFICE_NETWORK: "Dari jaringan kantor (menurunkan risiko)",
  OUTSIDE_RADIUS: "Di luar radius absensi",
  LOW_ACCURACY: "Akurasi GPS di bawah syarat",
  NO_LOCATION: "Tanpa data lokasi",
  INVALID_LOCATION: "Data lokasi tidak valid",
  NETWORK_REQUIRED: "Wajib dari jaringan kantor",
};

/** Bobot tiap sinyal. INSIDE_OFFICE_NETWORK negatif: koneksi dari jaringan kantor lebih sulit dipalsukan daripada GPS. */
export const RISK_WEIGHT: Partial<Record<RiskFlag, number>> = {
  MOCK_REPORTED: 100, IMPOSSIBLE_TRAVEL: 60, SHARED_COORDS: 50, SHARED_DEVICE: 45, EXACT_CENTER: 40, STALE_READING: 40, FUTURE_READING: 40,
  REPEAT_COORDS: 35, ACCURACY_PERFECT: 30, COORDS_LOW_PRECISION: 25, OUTSIDE_OFFICE_NETWORK: 25, NEW_DEVICE: 20, MISSING_TELEMETRY: 20,
  CLOCK_SKEW: 15, INSIDE_OFFICE_NETWORK: -30,
};

/** Skor ≥ ini → ditandai (FLAG) untuk tinjauan; ≥ BLOCK_AT → ditolak pada mode BLOCK. */
export const FLAG_AT = 50;
export const BLOCK_AT = 70;

/** Pembacaan harus baru: selisih waktu perangkat saat membaca dan saat mengirim. */
export const MAX_READING_AGE_MS = 60_000;
export const MAX_CLOCK_SKEW_MS = 5 * 60_000;
/** Kecepatan perpindahan yang dianggap mustahil (km/jam), dan jarak minimum agar dinilai. */
export const MAX_PLAUSIBLE_KMH = 250;
/** Akurasi di bawah ini dianggap setara GPS: koordinat identik berulang menjadi mencurigakan (posisi Wi-Fi/jaringan sering identik). */
export const GPS_GRADE_ACCURACY_M = 25;

export interface RiskReading extends GeoReading {
  /** `position.timestamp` (ms, jam perangkat) dan `Date.now()` perangkat saat mengirim — selisihnya = umur pembacaan. */
  timestamp?: number | null;
  clientNow?: number | null;
  /** Dilaporkan aplikasi pembungkus (mis. Capacitor `isFromMockProvider`); browser biasa tidak dapat menyediakan ini. */
  mocked?: boolean | null;
}

export interface RiskFacts {
  reading: RiskReading;
  serverNowMs: number;
  /** Jarak ke titik pusat kantor (m) bila ada. */
  distanceToCenter: number | null;
  /** Pembacaan terakhir karyawan yang sama (tidak ditolak) dalam 24 jam. */
  prev: { lat: number; lng: number; accuracy: number | null; atMs: number } | null;
  /** Karyawan LAIN punya koordinat (6 desimal) identik dalam 15 menit terakhir. */
  sharedCoordsWithOther: boolean;
  /** Perangkat ini dipakai karyawan LAIN dalam 24 jam terakhir. */
  sharedDeviceWithOther: boolean;
  /** true = perangkat dikenal; false = perangkat baru padahal karyawan sudah punya riwayat; null = belum ada riwayat. */
  deviceKnown: boolean | null;
  network: "INSIDE" | "OUTSIDE" | "UNKNOWN" | "NOT_CONFIGURED";
}

const decimals = (n: number) => (String(n).split(".")[1] ?? "").replace(/e.*$/i, "").length;

/** Jarak haversine (m) — salinan kecil agar modul ini mandiri dan bebas siklus impor. */
function meters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export interface RiskAssessment { score: number; flags: RiskFlag[]; details: Record<string, string | number | boolean | null> }

export function assessRisk(f: RiskFacts): RiskAssessment {
  const flags: RiskFlag[] = [];
  const details: RiskAssessment["details"] = {};
  const r = f.reading;
  const add = (flag: RiskFlag) => { if (!flags.includes(flag)) flags.push(flag); };

  if (r.mocked === true) add("MOCK_REPORTED");

  // Kesegaran pembacaan (diukur dengan jam perangkat yang SAMA → kebal terhadap jam perangkat yang salah).
  if (r.timestamp == null || r.clientNow == null) add("MISSING_TELEMETRY");
  else {
    const age = r.clientNow - r.timestamp;
    details.readingAgeMs = age;
    if (age > MAX_READING_AGE_MS) add("STALE_READING");
    else if (age < -5_000) add("FUTURE_READING");
    const skew = r.clientNow - f.serverNowMs;
    details.clockSkewMs = skew;
    if (Math.abs(skew) > MAX_CLOCK_SKEW_MS) add("CLOCK_SKEW");
  }

  if (r.accuracy !== null && r.accuracy < 1) add("ACCURACY_PERFECT");
  if (decimals(r.lat) <= 4 && decimals(r.lng) <= 4) add("COORDS_LOW_PRECISION");
  if (f.distanceToCenter !== null && f.distanceToCenter <= 1) add("EXACT_CENTER");

  const gpsGrade = r.accuracy !== null && r.accuracy < GPS_GRADE_ACCURACY_M;
  if (f.prev) {
    const hours = Math.max((f.serverNowMs - f.prev.atMs) / 3_600_000, 1 / 3600);
    const km = meters(r, f.prev) / 1000;
    details.distanceFromPreviousKm = Math.round(km * 100) / 100;
    if (km >= 1 && km / hours > MAX_PLAUSIBLE_KMH) { add("IMPOSSIBLE_TRAVEL"); details.impliedKmh = Math.round(km / hours); }
    // Koordinat GPS asli selalu bergeser sedikit; identik sampai 6 desimal dengan akurasi setara-GPS patut dicurigai.
    if (gpsGrade && Math.abs(r.lat - f.prev.lat) < 5e-7 && Math.abs(r.lng - f.prev.lng) < 5e-7) add("REPEAT_COORDS");
  }
  if (gpsGrade && f.sharedCoordsWithOther) add("SHARED_COORDS");
  if (f.sharedDeviceWithOther) add("SHARED_DEVICE");
  if (f.deviceKnown === false) add("NEW_DEVICE");
  if (f.network === "OUTSIDE") add("OUTSIDE_OFFICE_NETWORK");
  else if (f.network === "INSIDE") add("INSIDE_OFFICE_NETWORK");

  const raw = flags.reduce((s, fl) => s + (RISK_WEIGHT[fl] ?? 0), 0);
  return { score: Math.max(0, Math.min(100, raw)), flags, details };
}

export type PolicyMode = "OFF" | "FLAG" | "BLOCK";
export type Decision = "ACCEPTED" | "FLAGGED" | "BLOCKED";

/** Keputusan dari skor & mode kebijakan. OFF selalu menerima (tanpa penilaian). */
export function decide(mode: PolicyMode, score: number): Decision {
  if (mode === "OFF") return "ACCEPTED";
  if (mode === "BLOCK" && score >= BLOCK_AT) return "BLOCKED";
  return score >= FLAG_AT ? "FLAGGED" : "ACCEPTED";
}

/** Pesan untuk karyawan saat ditolak: jelas, tidak mengajarkan cara mengakali. */
export function blockedMessage(flags: RiskFlag[]): string {
  const notes = flags.filter((f) => (RISK_WEIGHT[f] ?? 0) > 0).slice(0, 2).map((f) => RISK_FLAG_LABEL[f].toLowerCase());
  return `Absensi ditolak karena data lokasi tidak dapat dipercaya${notes.length ? ` (${notes.join("; ")})` : ""}. Matikan aplikasi lokasi palsu/pengembang, nyalakan GPS presisi tinggi, lalu coba lagi. Bila tetap terjadi, hubungi Admin/HR.`;
}
