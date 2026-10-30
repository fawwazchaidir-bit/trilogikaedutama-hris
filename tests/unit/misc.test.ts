import { describe, expect, it } from "vitest";
import { distanceMeters, evaluateGeofence, type GeoPolicy } from "@/lib/geo";
import { can, manageableRoles, ROLE_PERMISSIONS, visibleNav, PERMISSIONS, type Role } from "@/lib/permissions";
import { formatRupiah, parseRupiahInput, roundDivHalfUp } from "@/lib/money";
import { formatDateLong, formatDateRange, formatDuration, formatHours } from "@/lib/format";

const OFFICE = { lat: -7.7956, lng: 110.3695 }; // titik contoh (Yogyakarta)
const POLICY: GeoPolicy = { enabled: true, name: "Kantor", center: OFFICE, radiusMeters: 100, maxAccuracyMeters: 150 };

describe("geofence", () => {
  it("jarak haversine: ±111 m per 0,001° lintang", () => {
    const d = distanceMeters(OFFICE, { lat: OFFICE.lat + 0.001, lng: OFFICE.lng });
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(117);
    expect(distanceMeters(OFFICE, OFFICE)).toBe(0);
  });
  it("fitur nonaktif → selalu lolos tanpa koordinat", () => {
    expect(evaluateGeofence({ ...POLICY, enabled: false }, null)).toEqual({ ok: true, distance: null });
  });
  it("aktif tanpa izin lokasi → pesan jelas", () => {
    const v = evaluateGeofence(POLICY, null);
    expect(v.ok).toBe(false);
    if (!v.ok) { expect(v.code).toBe("LOCATION_REQUIRED"); expect(v.message).toContain("lokasi"); }
  });
  it("di dalam radius lolos; di luar radius ditolak dengan jarak", () => {
    expect(evaluateGeofence(POLICY, { lat: OFFICE.lat + 0.0005, lng: OFFICE.lng, accuracy: 20 })).toMatchObject({ ok: true });
    const out = evaluateGeofence(POLICY, { lat: OFFICE.lat + 0.01, lng: OFFICE.lng, accuracy: 20 });
    expect(out.ok).toBe(false);
    if (!out.ok) { expect(out.code).toBe("LOCATION_OUTSIDE"); expect(out.message).toMatch(/\d+ m dari titik lokasi/); }
  });
  it("akurasi buruk ditolak; koordinat tidak valid ditolak", () => {
    const bad = evaluateGeofence(POLICY, { lat: OFFICE.lat, lng: OFFICE.lng, accuracy: 900 });
    expect(bad.ok === false && bad.code).toBe("LOCATION_INACCURATE");
    expect(evaluateGeofence(POLICY, { lat: 123, lng: 0, accuracy: 5 }).ok).toBe(false);
    expect(evaluateGeofence(POLICY, { lat: Number.NaN, lng: 0, accuracy: 5 }).ok).toBe(false);
  });
});

describe("matriks izin akses", () => {
  const sa: Role = "SUPER_ADMIN", hr: Role = "HR_ADMIN", emp: Role = "EMPLOYEE";
  it("Super Admin memiliki seluruh izin", () => {
    for (const p of PERMISSIONS) expect(can(sa, p)).toBe(true);
  });
  it("Karyawan tidak memiliki izin administratif apa pun", () => {
    expect(ROLE_PERMISSIONS[emp].size).toBe(0);
    expect(can(emp, "employee:view")).toBe(false);
    expect(can(emp, "payroll:view")).toBe(false);
  });
  it("HR: operasional ya; persetujuan gaji, aturan gaji, audit, kebijakan tidak", () => {
    for (const p of ["employee:manage", "schedule:manage", "attendance:correct", "leave:review", "payroll:prepare", "payroll:components", "recap:export"] as const) expect(can(hr, p)).toBe(true);
    for (const p of ["payroll:approve", "payroll:revoke", "payroll:rules", "audit:view", "settings:manage", "user:manage"] as const) expect(can(hr, p)).toBe(false);
  });
  it("pengelolaan akun: HR hanya akun Karyawan", () => {
    expect(manageableRoles(sa)).toEqual(["SUPER_ADMIN", "HR_ADMIN", "EMPLOYEE"]);
    expect(manageableRoles(hr)).toEqual(["EMPLOYEE"]);
    expect(manageableRoles(emp)).toEqual([]);
  });
  it("menu: karyawan hanya layanan mandiri; admin tanpa data karyawan tidak melihat menu mandiri", () => {
    const empNav = visibleNav(emp, true).map((i) => i.href);
    expect(empNav).toContain("/absensi-saya");
    expect(empNav).not.toContain("/karyawan");
    expect(empNav).not.toContain("/penggajian");
    expect(visibleNav(hr, false).map((i) => i.href)).not.toContain("/absensi-saya");
    expect(visibleNav(hr, true).map((i) => i.href)).toContain("/absensi-saya");
    expect(visibleNav(hr, false).map((i) => i.href)).not.toContain("/audit-log");
    expect(visibleNav(sa, false).map((i) => i.href)).toContain("/audit-log");
  });
});

describe("uang & format", () => {
  it("format Rupiah", () => {
    expect(formatRupiah(1_234_567)).toBe("Rp 1.234.567");
    expect(formatRupiah(0)).toBe("Rp 0");
    expect(formatRupiah(-5000)).toBe("-Rp 5.000");
  });
  it("parse input Rupiah", () => {
    expect(parseRupiahInput("Rp 1.500.000")).toBe(1_500_000);
    expect(parseRupiahInput("1500000")).toBe(1_500_000);
    expect(parseRupiahInput("12,5")).toBeNull();
    expect(parseRupiahInput("abc")).toBeNull();
  });
  it("pembulatan half-up", () => {
    expect(roundDivHalfUp(5n, 2n)).toBe(3n);
    expect(roundDivHalfUp(4n, 3n)).toBe(1n);
    expect(roundDivHalfUp(10_000_000n, 22n)).toBe(454_545n);
  });
  it("tanggal Indonesia", () => {
    expect(formatDateLong("2026-10-30")).toBe("30 Oktober 2026");
    expect(formatDateRange("2026-10-01", "2026-10-31")).toBe("1 – 31 Oktober 2026");
    expect(formatDateRange("2026-09-26", "2026-10-25")).toBe("26 September – 25 Oktober 2026");
    expect(formatDateRange("2026-12-20", "2027-01-05")).toBe("20 Desember 2026 – 5 Januari 2027");
  });
  it("durasi", () => {
    expect(formatDuration(0)).toBe("0 m");
    expect(formatDuration(75)).toBe("1 j 15 m");
    expect(formatDuration(480)).toBe("8 j");
    expect(formatHours(450)).toBe("7,50");
  });
});
