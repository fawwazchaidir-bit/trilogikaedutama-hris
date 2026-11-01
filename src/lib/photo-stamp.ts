/**
 * Teks cap foto absensi — FUNGSI MURNI (tanpa I/O) agar mudah diuji. Server yang mencetaknya ke foto (lihat server/photo/stamp.ts).
 */

const KIND_LABEL = { CHECK_IN: "MASUK", CHECK_OUT: "PULANG" } as const;

/** "31/10/2026 09:15:42 WIB" — zona waktu bisnis; WIB/WITA/WIT untuk Indonesia, selain itu "GMT+x". */
export function stampTime(at: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("id-ID", {
    timeZone, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "short",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}:${get("second")} ${get("timeZoneName")}`;
}

export interface StampArgs {
  at: Date; timeZone: string; kind: "CHECK_IN" | "CHECK_OUT"; employeeName: string; employeeNo: string; photoId: string;
  location: { lat: number; lng: number; accuracy: number | null } | null;
}

/** Baris teks yang dicetak pada foto (fungsi murni → mudah diuji). */
export function stampLines(a: StampArgs): string[] {
  const where = a.location
    ? `${a.location.lat.toFixed(6)}, ${a.location.lng.toFixed(6)}${a.location.accuracy !== null ? ` (±${Math.round(a.location.accuracy)} m)` : ""}`
    : "Lokasi: tidak tersedia";
  return [
    stampTime(a.at, a.timeZone),
    where,
    `${KIND_LABEL[a.kind]} · ${a.employeeName} (${a.employeeNo})`,
    `Waktu server · ID ${a.photoId.slice(0, 8).toUpperCase()}`,
  ];
}
