import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { checkIn, checkOut } from "@/server/services/attendance";
import { listLocationChecks, openLocationReviewCount, reviewLocationCheck, locationSummary } from "@/server/services/location";
import { listNotifications } from "@/server/services/notifications";
import { updateAttendancePolicy } from "@/server/services/settings";
import { getAdminDashboard } from "@/server/services/dashboard";
import { resetDb, seedFixtures, type Fixtures } from "../helpers/db";

let fx: Fixtures;
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };

// Titik kantor 6 desimal. Pembacaan "sah" bergeser ± 20 m dengan presisi 7 desimal.
const CENTER = { lat: -7.795612, lng: 110.369587 };
const policy = (over: Record<string, unknown> = {}) => ({
  lateMinutesAfterTolerance: false, locationEnabled: true, locationName: "Kantor Uji", locationLat: CENTER.lat, locationLng: CENTER.lng, locationRadiusMeters: 100,
  locationMaxAccuracyMeters: 150, requestBackdateDays: 7, annualLeaveQuota: 12, allowNegativeLeaveBalance: false, ...over,
});
const loc = (over: Record<string, unknown> = {}) => ({ lat: -7.7957314, lng: 110.3696221, accuracy: 8.4, timestamp: Date.now() - 1200, clientNow: Date.now(), ...over });
const ctxOf = (deviceToken: string | null = null, ip: string | null = null) => ({ ip, deviceToken });
const checks = (employeeId?: string) => prisma.locationCheck.findMany({ where: employeeId ? { employeeId } : {}, orderBy: { id: "asc" } });
const E1 = () => fx.empIds[0], E2 = () => fx.empIds[1];

beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
  await updateAttendancePolicy(fx.superAdmin, policy());
});

describe("penilaian risiko lokasi — mode TANDAI (default)", () => {
  it("pembacaan sah: diterima, skor 0, koordinat tersimpan di absensi; check-out juga dinilai & terhubung ke absensi", async () => {
    const s = await checkIn(fx.emp1, { location: loc() }, new Date(), ctxOf("dev-A-0123456789abcdef"));
    expect(s.day.checkInTime).toBeTruthy();
    const out = await checkOut(fx.emp1, { location: loc({ lat: -7.7957411, lng: 110.3696319 }) }, new Date(), ctxOf("dev-A-0123456789abcdef"));
    expect(out.canCheckOut).toBe(false);
    const rows = await checks(E1());
    expect(rows.map((r) => [r.kind, r.decision, r.riskScore])).toEqual([["CHECK_IN", "ACCEPTED", 0], ["CHECK_OUT", "ACCEPTED", 0]]);
    expect(rows.every((r) => r.reviewStatus === null && r.attendanceId)).toBe(true);
    const att = await prisma.attendance.findFirstOrThrow({ where: { employeeId: E1() } });
    expect(att.checkInDistance).toBeGreaterThan(0);
    expect(rows[0]!.deviceHash).toHaveLength(64);
    expect(rows[0]!.deviceHash).not.toContain("dev-A"); // token mentah tidak tersimpan
    expect(await openLocationReviewCount()).toBe(0);
  });

  it("pola aplikasi lokasi palsu (persis di pusat, 4 desimal, akurasi 0) → tetap diterima tetapi DITANDAI & masuk antrean; HR & Super Admin diberi tahu", async () => {
    await checkIn(fx.emp1, { location: { lat: -7.7956, lng: 110.3696, accuracy: 0, timestamp: Date.now(), clientNow: Date.now() } }, new Date(), ctxOf());
    // 4 desimal (-7.7956,110.3696) ≈ 12 m dari pusat; pusat persis diuji terpisah di bawah
    const row = (await checks(E1()))[0]!;
    expect(row.decision).toBe("FLAGGED");
    expect(row.flags).toEqual(expect.arrayContaining(["ACCURACY_PERFECT", "COORDS_LOW_PRECISION"]));
    expect(row.riskScore).toBe(55);
    expect(row.reviewStatus).toBe("OPEN");
    expect(await prisma.attendance.count({ where: { employeeId: E1() } })).toBe(1); // absensi tercatat
    expect((await listNotifications(fx.hr)).items.some((n) => n.type === "location.flagged" && n.href === "/lokasi")).toBe(true);
    expect((await listNotifications(fx.superAdmin)).items.some((n) => n.type === "location.flagged")).toBe(true);
    expect(await openLocationReviewCount()).toBe(1);
    expect((await getAdminDashboard(fx.hr)).openLocationReviews).toBe(1);
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "attendance.check_in" } })).summary).toContain("lokasi ditandai");
  });

  it("tepat di titik pusat kantor (≤ 1 m) ditandai EXACT_CENTER", async () => {
    await checkIn(fx.emp1, { location: loc({ lat: CENTER.lat, lng: CENTER.lng, accuracy: 5.2 }) }, new Date(), ctxOf());
    const row = (await checks(E1()))[0]!;
    expect(row.flags).toContain("EXACT_CENTER");
    expect(row.riskScore).toBe(40);
    expect(row.decision).toBe("ACCEPTED"); // 40 < 50: hanya satu sinyal lemah
  });

  it("pembacaan basi / tanpa data waktu / jam perangkat jauh berbeda", async () => {
    await checkIn(fx.emp1, { location: loc({ timestamp: Date.now() - 10 * 60_000, clientNow: Date.now() }) }, new Date(), ctxOf());
    expect((await checks(E1()))[0]!.flags).toContain("STALE_READING");
    await checkOut(fx.emp1, { location: { lat: -7.7957314, lng: 110.3696221, accuracy: 8.4 } }, new Date(), ctxOf());
    expect((await checks(E1()))[1]!.flags).toContain("MISSING_TELEMETRY");
  });

  it("perangkat melaporkan 'mocked' (aplikasi pembungkus) → skor 100, ditandai", async () => {
    await checkIn(fx.emp1, { location: loc({ mocked: true }) }, new Date(), ctxOf());
    const row = (await checks(E1()))[0]!;
    expect(row.flags).toContain("MOCK_REPORTED");
    expect(row.riskScore).toBe(100);
    expect(row.decision).toBe("FLAGGED");
  });

  it("teleportasi: check-out beberapa detik setelah check-in dari titik 60 km jauhnya → IMPOSSIBLE_TRAVEL", async () => {
    await updateAttendancePolicy(fx.superAdmin, policy({ locationRadiusMeters: 100_000 }));
    await checkIn(fx.emp1, { location: loc() }, new Date(), ctxOf());
    await checkOut(fx.emp1, { location: loc({ lat: -7.2571234, lng: 110.3696221 }) }, new Date(), ctxOf()); // ± 60 km ke utara
    const row = (await checks(E1()))[1]!;
    expect(row.flags).toContain("IMPOSSIBLE_TRAVEL");
    expect(row.decision).toBe("FLAGGED");
    expect((row.details as Record<string, number>).impliedKmh).toBeGreaterThan(250);
  });

  it("koordinat GPS identik dengan karyawan lain dalam 15 menit → SHARED_COORDS; posisi jaringan (akurasi 40 m) tidak dicurigai", async () => {
    await checkIn(fx.emp1, { location: loc({ lat: -7.7957314, lng: 110.3696221, accuracy: 8 }) }, new Date(), ctxOf());
    await checkIn(fx.emp2, { location: loc({ lat: -7.7957314, lng: 110.3696221, accuracy: 8 }) }, new Date(), ctxOf());
    expect((await checks(E2()))[0]!.flags).toContain("SHARED_COORDS");
    expect((await checks(E2()))[0]!.decision).toBe("FLAGGED");
    await checkIn(fx.emp3, { location: loc({ lat: -7.7957314, lng: 110.3696221, accuracy: 40 }) }, new Date(), ctxOf());
    expect((await checks(fx.empIds[2]))[0]!.flags).not.toContain("SHARED_COORDS");
  });

  it("perangkat: pertama = baseline (tanpa tanda); perangkat lain untuk karyawan sama = NEW_DEVICE; perangkat yang sama dipakai karyawan lain = SHARED_DEVICE", async () => {
    await checkIn(fx.emp1, { location: loc() }, new Date(), ctxOf("device-token-AAAAAAAAAAAAAA"));
    expect((await checks(E1()))[0]!.flags).toEqual([]);
    await checkOut(fx.emp1, { location: loc({ lat: -7.7957411 }) }, new Date(), ctxOf("device-token-BBBBBBBBBBBBBB"));
    expect((await checks(E1()))[1]!.flags).toContain("NEW_DEVICE");
    await checkIn(fx.emp2, { location: loc({ lat: -7.7957999, accuracy: 7.7 }) }, new Date(), ctxOf("device-token-AAAAAAAAAAAAAA"));
    expect((await checks(E2()))[0]!.flags).toContain("SHARED_DEVICE");
    expect((await checks(E2()))[0]!.decision).toBe("ACCEPTED"); // 45 < 50: ditandai di rincian, belum masuk antrean
  });

  it("mematikan penilaian (OFF): tidak ada catatan risiko untuk punch yang diterima, radius tetap ditegakkan", async () => {
    await updateAttendancePolicy(fx.superAdmin, policy({ locationSpoofMode: "OFF" }));
    await checkIn(fx.emp1, { location: loc({ mocked: true, accuracy: 0 }) }, new Date(), ctxOf());
    expect(await prisma.locationCheck.count()).toBe(0);
    const far = await fail(checkIn(fx.emp2, { location: loc({ lat: -7.7 }) }, new Date(), ctxOf()));
    expect(far?.message).toContain("di luar radius");
  });

  it("fitur lokasi nonaktif: tidak ada koordinat/penilaian yang disimpan (privasi)", async () => {
    await updateAttendancePolicy(fx.superAdmin, policy({ locationEnabled: false }));
    await checkIn(fx.emp1, { location: loc() }, new Date(), ctxOf("device-token-AAAAAAAAAAAAAA"));
    expect(await prisma.locationCheck.count()).toBe(0);
    expect((await prisma.attendance.findFirstOrThrow({ where: { employeeId: E1() } })).checkInLat).toBeNull();
  });
});

describe("mode TOLAK", () => {
  beforeEach(async () => { await updateAttendancePolicy(fx.superAdmin, policy({ locationSpoofMode: "BLOCK" })); });

  it("risiko ≥ 70 ditolak tanpa absensi; dicatat sebagai BLOCKED untuk tinjauan; pesan jelas tanpa membocorkan skor/ambang", async () => {
    const e = await fail(checkIn(fx.emp1, { location: loc({ mocked: true }) }, new Date(), ctxOf()));
    expect(e?.code).toBe("VALIDATION");
    expect(e?.message).toContain("tidak dapat dipercaya");
    expect(e?.message).toContain("lokasi tiruan");
    expect(e?.message).not.toMatch(/skor|\b70\b|\b100\b/i);
    expect(await prisma.attendance.count({ where: { employeeId: E1() } })).toBe(0);
    const row = (await checks(E1()))[0]!;
    expect([row.decision, row.reviewStatus, row.attendanceId]).toEqual(["BLOCKED", "OPEN", null]);
    expect((await listNotifications(fx.hr)).items.some((n) => n.type === "location.flagged" && n.title.includes("ditolak"))).toBe(true);
    // setelah memperbaiki kondisi, check-in berhasil
    expect(await fail(checkIn(fx.emp1, { location: loc() }, new Date(), ctxOf()))).toBeNull();
  });

  it("risiko sedang (50–69) hanya ditandai, tidak ditolak", async () => {
    await checkIn(fx.emp1, { location: { lat: -7.7956, lng: 110.3696, accuracy: 0, timestamp: Date.now(), clientNow: Date.now() } }, new Date(), ctxOf()); // skor 55
    expect((await checks(E1()))[0]!.decision).toBe("FLAGGED");
  });

  it("beberapa sinyal sekaligus (titik pusat + 4 desimal + akurasi 0) = 95 → ditolak", async () => {
    const e = await fail(checkIn(fx.emp1, { location: { lat: CENTER.lat, lng: CENTER.lng, accuracy: 0, timestamp: Date.now(), clientNow: Date.now() } }, new Date(), ctxOf()));
    expect(e?.code).toBe("VALIDATION");
    expect((await checks(E1()))[0]!.flags).toEqual(expect.arrayContaining(["EXACT_CENTER", "ACCURACY_PERFECT"]));
  });
});

describe("jaringan kantor", () => {
  const setNets = (nets: string[], require = false) => prisma.companySettings.update({ where: { id: 1 }, data: { officeNetworks: nets, locationRequireOfficeNetwork: require } });

  it("dari jaringan kantor menurunkan skor (mengimbangi sinyal lemah); di luar jaringan menambah risiko", async () => {
    await setNets(["203.0.113.0/24"]);
    await checkIn(fx.emp1, { location: loc({ lat: -7.7956, lng: 110.3696 }) }, new Date(), ctxOf(null, "203.0.113.50")); // 4 desimal (+25) − 30 → 0
    const inside = (await checks(E1()))[0]!;
    expect(inside.flags).toEqual(expect.arrayContaining(["COORDS_LOW_PRECISION", "INSIDE_OFFICE_NETWORK"]));
    expect(inside.riskScore).toBe(0);
    await checkIn(fx.emp2, { location: loc() }, new Date(), ctxOf(null, "198.51.100.9"));
    const outside = (await checks(E2()))[0]!;
    expect(outside.flags).toContain("OUTSIDE_OFFICE_NETWORK");
    expect(outside.riskScore).toBe(25);
    expect(inside.ip).toBe("203.0.113.50");
  });

  it("jaringan kantor WAJIB: di luar jaringan ditolak (dicatat, tidak masuk antrean); IP tidak diketahui → pesan khusus; di dalam → diterima", async () => {
    await setNets(["203.0.113.0/24", "2001:db8::/32"], true);
    const out = await fail(checkIn(fx.emp1, { location: loc() }, new Date(), ctxOf(null, "198.51.100.9")));
    expect(out?.message).toContain("jaringan kantor");
    const noIp = await fail(checkIn(fx.emp1, { location: loc() }, new Date(), ctxOf(null, null)));
    expect(noIp?.message).toContain("tidak dapat ditentukan");
    const rows = await checks(E1());
    expect(rows.map((r) => [r.decision, r.flags[0], r.reviewStatus])).toEqual([["BLOCKED", "NETWORK_REQUIRED", null], ["BLOCKED", "NETWORK_REQUIRED", null]]);
    expect(await openLocationReviewCount()).toBe(0);
    expect(await fail(checkIn(fx.emp1, { location: loc() }, new Date(), ctxOf(null, "2001:db8:1::7")))).toBeNull();
  });

  it("pengaturan: jaringan tak valid ditolak; mewajibkan tanpa jaringan ditolak; butuh TRUST_PROXY", async () => {
    expect((await fail(updateAttendancePolicy(fx.superAdmin, policy({ officeNetworks: ["bukan-ip"] }))))?.fieldErrors?.["officeNetworks.0"]).toContain("tidak valid");
    expect((await fail(updateAttendancePolicy(fx.superAdmin, policy({ officeNetworks: [], locationRequireOfficeNetwork: true }))))?.fieldErrors?.officeNetworks).toContain("minimal satu");
    // TRUST_PROXY=false pada lingkungan uji → daftar jaringan ditolak dengan alasan jelas
    expect((await fail(updateAttendancePolicy(fx.superAdmin, policy({ officeNetworks: ["203.0.113.0/24"] }))))?.fieldErrors?.officeNetworks).toContain("TRUST_PROXY");
    expect(await fail(updateAttendancePolicy(fx.superAdmin, policy({ officeNetworks: [] })))).toBeNull();
  });
});

describe("penolakan geofence dicatat & antrean tinjauan", () => {
  it("di luar radius / akurasi buruk / tanpa lokasi → BLOCKED tercatat (bukan antrean tinjauan)", async () => {
    expect((await fail(checkIn(fx.emp1, { location: loc({ lat: -7.78 }) }, new Date(), ctxOf())))?.message).toContain("di luar radius");
    expect((await fail(checkIn(fx.emp1, { location: loc({ accuracy: 900 }) }, new Date(), ctxOf())))?.message).toContain("Akurasi");
    expect((await fail(checkIn(fx.emp1, {}, new Date(), ctxOf())))?.message).toContain("mewajibkan lokasi");
    expect((await checks(E1())).map((r) => [r.decision, r.flags[0]])).toEqual([["BLOCKED", "OUTSIDE_RADIUS"], ["BLOCKED", "LOW_ACCURACY"], ["BLOCKED", "NO_LOCATION"]]);
    expect(await openLocationReviewCount()).toBe(0);
    expect(await prisma.attendance.count()).toBe(0);
  });

  it("peninjauan: hanya HR/Super Admin; catatan wajib; sekali saja; audit dicatat; daftar menurut status", async () => {
    await checkIn(fx.emp1, { location: loc({ mocked: true }) }, new Date(), ctxOf());
    const id = (await listLocationChecks(fx.hr)).items[0]!.id;
    expect((await fail(listLocationChecks(fx.emp1)))?.code).toBe("FORBIDDEN");
    expect((await fail(reviewLocationCheck(fx.emp1, id, { decision: "CLEARED", note: "boleh" })))?.code).toBe("FORBIDDEN");
    expect((await fail(reviewLocationCheck(fx.hr, id, { decision: "CLEARED", note: "" })))?.fieldErrors?.note).toBeTruthy();
    expect((await fail(reviewLocationCheck(fx.hr, "abc", { decision: "CLEARED", note: "catatan valid" })))?.code).toBe("NOT_FOUND");
    expect((await fail(reviewLocationCheck(fx.hr, "999999", { decision: "CLEARED", note: "catatan valid" })))?.code).toBe("NOT_FOUND");
    // DB: baris yang diputuskan wajib punya pemeriksa & catatan (diuji pada baris yang MASIH terbuka)
    await expect(prisma.$executeRaw`UPDATE location_checks SET "reviewStatus" = 'CLEARED' WHERE id = ${BigInt(id)}`).rejects.toThrow();
    await reviewLocationCheck(fx.hr, id, { decision: "CONFIRMED", note: "Atasan memastikan karyawan tidak di kantor" });
    expect((await fail(reviewLocationCheck(fx.superAdmin, id, { decision: "CLEARED", note: "ubah pikiran" })))?.code).toBe("CONFLICT");
    expect((await listLocationChecks(fx.hr)).total).toBe(0);
    const done = await listLocationChecks(fx.hr, { status: "CONFIRMED" });
    expect(done.items[0]).toMatchObject({ reviewStatus: "CONFIRMED", reviewedBy: "HR Uji" });
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "location.confirm" } })).reason).toContain("Atasan");
    expect(await openLocationReviewCount()).toBe(0);
  });

  it("ringkasan untuk laporan: jumlah ditandai/ditolak/terkonfirmasi dan sinyal teratas", async () => {
    await checkIn(fx.emp1, { location: loc({ mocked: true }) }, new Date(), ctxOf());
    await checkIn(fx.emp2, { location: loc({ lat: -7.7 }) }, new Date(), ctxOf()).catch(() => undefined);
    const today = new Date().toISOString().slice(0, 10);
    const s = await locationSummary(today, today);
    expect(s).toMatchObject({ total: 2, flagged: 1, blocked: 1 });
    expect(s.topFlags.map((f) => f.code)).toEqual(expect.arrayContaining(["MOCK_REPORTED", "OUTSIDE_RADIUS"]));
  });
});
