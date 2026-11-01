/**
 * Foto absensi bercap lokasi & waktu SERVER — menggantikan syarat jaringan kantor (Wi-Fi/IP) agar karyawan dinas luar
 * tetap dapat absen dengan bukti yang ditinjau HR.
 */
import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { checkIn, checkOut, correctAttendance, getTodayState } from "@/server/services/attendance";
import { readFileForActor } from "@/server/services/files";
import { getRecapDetail } from "@/server/services/recap";
import { listLocationChecks } from "@/server/services/location";
import { getSettingsDto, updateAttendancePolicy } from "@/server/services/settings";
import { createAssignment, createSchedule } from "@/server/services/schedules";
import { resetDb, seedFixtures, type Fixtures } from "../helpers/db";

let fx: Fixtures;
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };

const policy = (over: Record<string, unknown> = {}) => ({
  lateMinutesAfterTolerance: false, locationEnabled: false, locationName: null, locationLat: null, locationLng: null, locationRadiusMeters: 100,
  locationMaxAccuracyMeters: 150, requestBackdateDays: 365, annualLeaveQuota: 12, allowNegativeLeaveBalance: false,
  attendancePhotoMode: "REQUIRED", attendancePhotoRequireLocation: true, ...over,
});
// Senin 2 Maret 2026; jam WIB = UTC+7.
const at = (hhmm: string, date = "2026-03-02") => new Date(`${date}T${hhmm}:00+07:00`);
const photo = (w = 800, h = 600) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 230, g: 230, b: 230 } } }).jpeg().toBuffer();
const loc = (over: Record<string, unknown> = {}) => ({ lat: -7.7956, lng: 110.3695, accuracy: 12, timestamp: Date.now() - 1000, clientNow: Date.now(), ...over });
const ctx = (p: Uint8Array | null, ip: string | null = null) => ({ ip, deviceToken: null, photo: p });
const photos = (employeeId?: string) => prisma.attendancePhoto.findMany({ where: employeeId ? { employeeId } : {}, orderBy: { createdAt: "asc" } });
const E1 = () => fx.empIds[0], E2 = () => fx.empIds[1];

beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
  await updateAttendancePolicy(fx.superAdmin, policy());
});

describe("kebijakan foto absensi", () => {
  it("tersimpan, tampil di pengaturan & status hari ini; mode tak dikenal ditolak; tercatat di audit", async () => {
    const dto = (await getSettingsDto(fx.superAdmin)).attendance;
    expect([dto.photoMode, dto.photoRequireLocation]).toEqual(["REQUIRED", true]);
    expect((await getTodayState(fx.emp1, at("07:00"))).photo).toEqual({ mode: "REQUIRED", requireLocation: true });
    expect((await fail(updateAttendancePolicy(fx.superAdmin, policy({ attendancePhotoMode: "SELALU" }))))?.code).toBe("VALIDATION");
    expect(await prisma.auditLog.count({ where: { action: "settings.attendance_policy_update" } })).toBe(1); // yang ditolak tidak tercatat
    await updateAttendancePolicy(fx.superAdmin, policy({ attendancePhotoMode: "OPTIONAL" }));
    expect((await getSettingsDto(fx.superAdmin)).attendance.photoMode).toBe("OPTIONAL");
    expect(await prisma.auditLog.count({ where: { action: "settings.attendance_policy_update" } })).toBe(2);
    expect((await fail(updateAttendancePolicy(fx.hr, policy())))?.code).toBe("FORBIDDEN");
  });

  it("default untuk basis data baru: foto MATI (perilaku lama tidak berubah)", async () => {
    await resetDb();
    await seedFixtures();
    const s = await prisma.companySettings.findUniqueOrThrow({ where: { id: 1 } });
    expect([s.attendancePhotoMode, s.attendancePhotoRequireLocation]).toEqual(["OFF", true]);
  });
});

describe("check-in / check-out dengan foto — cap dari SERVER", () => {
  it("wajib: tanpa foto ditolak dan TIDAK ada absensi tercatat; dengan foto: tercatat bersama fotonya (satu transaksi)", async () => {
    const e = await fail(checkIn(fx.emp1, { location: loc() }, at("07:58"), ctx(null)));
    expect(e?.code).toBe("VALIDATION");
    expect(e?.fieldErrors?.photo).toBeTruthy();
    expect(await prisma.attendance.count()).toBe(0);

    const s = await checkIn(fx.emp1, { location: loc() }, at("07:58"), ctx(await photo()));
    expect(s.day.checkInTime).toBe("07:58");
    const [p] = await photos();
    expect(p).toMatchObject({ employeeId: E1(), kind: "CHECK_IN", lat: -7.7956, lng: 110.3695, accuracy: 12 });
    const att = await prisma.attendance.findFirstOrThrow();
    expect(p!.attendanceId).toBe(att.id);
    expect(p!.capturedAt.toISOString()).toBe(att.checkInAt.toISOString()); // waktu pada foto = waktu check-in yang dicatat
    expect(p!.stamp).toBe(["02/03/2026 07:58:00 WIB", "-7.795600, 110.369500 (±12 m)", "MASUK · Ayu Lestari (TE-001)", `Waktu server · ID ${p!.id.slice(0, 8).toUpperCase()}`].join("\n"));
  });

  it("file tersimpan: JPEG, kind ATTENDANCE_PHOTO, hash sesuai, EXIF dibuang, pita cap benar-benar tergambar", async () => {
    await checkIn(fx.emp1, { location: loc() }, at("07:58"), ctx(await photo()));
    const p = (await photos())[0]!;
    const f = await prisma.storedFile.findUniqueOrThrow({ where: { id: p.fileId! } });
    expect(f.kind).toBe("ATTENDANCE_PHOTO");
    expect(f.mimeType).toBe("image/jpeg");
    expect(f.size).toBe(f.data.length);
    const m = await sharp(f.data).metadata();
    expect([m.format, m.exif]).toEqual(["jpeg", undefined]);
    const band = await sharp(f.data).extract({ left: 0, top: m.height! - 60, width: m.width!, height: 60 }).greyscale().raw().toBuffer();
    expect(band.reduce((a, b) => a + b, 0) / band.length).toBeLessThan(150); // foto asli rata 230 → pita gelap ada
  });

  it("check-out: foto kedua (PULANG) memakai waktu check-out; keduanya terhubung ke baris absensi yang sama", async () => {
    await checkIn(fx.emp1, { location: loc() }, at("07:58"), ctx(await photo()));
    await checkOut(fx.emp1, { location: loc({ lat: -7.8, lng: 110.4 }) }, at("17:03"), ctx(await photo(640, 480)));
    const rows = await photos();
    expect(rows.map((r) => r.kind)).toEqual(["CHECK_IN", "CHECK_OUT"]);
    expect(rows[1]!.stamp.split("\n")[0]).toBe("02/03/2026 17:03:00 WIB");
    expect(rows[1]!.stamp).toContain("PULANG");
    expect(new Set(rows.map((r) => r.attendanceId)).size).toBe(1);
  });

  it("waktu pada cap = waktu SERVER: bidang waktu/lokasi palsu buatan klien diabaikan; tak ada cara menyetel waktu cap dari klien", async () => {
    await checkIn(fx.emp1, { location: loc(), capturedAt: "2020-01-01T00:00:00Z", stamp: "00/00/0000", time: "03:00" } as never, at("08:05"), ctx(await photo()));
    const p = (await photos())[0]!;
    expect(p.stamp.split("\n")[0]).toBe("02/03/2026 08:05:00 WIB");
    expect(p.capturedAt.toISOString()).toBe(at("08:05").toISOString());
  });

  it("shift malam: check-out dini hari keesokan harinya dicap tanggal & jam sebenarnya (melewati tengah malam)", async () => {
    const s = await createSchedule(fx.hr, { name: "Shift Malam", workDays: [1, 2, 3, 4, 5], startTime: "22:00", endTime: "06:00", lateToleranceMinutes: 15, absentCutoffTime: "02:00" });
    await createAssignment(fx.hr, { scheduleId: s.id, scope: "EMPLOYEE", employeeId: E1(), startDate: "2026-01-01" });
    await checkIn(fx.emp1, { location: loc() }, at("21:55"), ctx(await photo()));
    await checkOut(fx.emp1, { location: loc() }, at("06:04", "2026-03-03"), ctx(await photo()));
    const rows = await photos();
    expect(rows[0]!.stamp.split("\n")[0]).toBe("02/03/2026 21:55:00 WIB");
    expect(rows[1]!.stamp.split("\n")[0]).toBe("03/03/2026 06:04:00 WIB");
  });
});

describe("dinas luar — tanpa syarat Wi-Fi/jaringan kantor", () => {
  it("jauh dari kantor, IP apa pun (juga tak diketahui): diterima selama ada foto bercap; koordinat tempat tugas tercetak", async () => {
    // Kantor di Yogyakarta, karyawan dinas di Surabaya; geofence MATI (disarankan untuk tenaga lapangan).
    await checkIn(fx.emp1, { location: loc({ lat: -7.2575, lng: 112.7521, accuracy: 9 }) }, at("08:00"), ctx(await photo(), "198.51.100.77"));
    await checkIn(fx.emp2, { location: loc({ lat: -6.2088, lng: 106.8456, accuracy: 20 }) }, at("08:10"), ctx(await photo(), null));
    expect((await photos(E1()))[0]!.stamp).toContain("-7.257500, 112.752100 (±9 m)");
    expect((await photos(E2()))[0]!.stamp).toContain("-6.208800, 106.845600 (±20 m)");
    expect(await prisma.locationCheck.count()).toBe(0); // geofence mati → tidak ada catatan penilaian lokasi
  });

  it("geofence tetap bisa dipakai bersama foto: di luar radius ditolak (karena itu pengaturan memperingatkan dinas luar)", async () => {
    await updateAttendancePolicy(fx.superAdmin, policy({ locationEnabled: true, locationName: "Kantor", locationLat: -7.795612, locationLng: 110.369587 }));
    const e = await fail(checkIn(fx.emp1, { location: loc({ lat: -7.2575, lng: 112.7521 }) }, at("08:00"), ctx(await photo())));
    expect(e?.message).toContain("di luar radius");
    expect(await photos()).toHaveLength(0);
    expect(await prisma.attendance.count()).toBe(0);
  });
});

describe("opsional & lokasi", () => {
  it("OPSIONAL: tanpa foto diterima; dengan foto disimpan", async () => {
    await updateAttendancePolicy(fx.superAdmin, policy({ attendancePhotoMode: "OPTIONAL" }));
    await checkIn(fx.emp1, {}, at("08:00"), ctx(null));
    await checkIn(fx.emp2, { location: loc() }, at("08:01"), ctx(await photo()));
    expect((await photos()).map((p) => p.employeeId)).toEqual([E2()]);
    expect(await prisma.attendance.count()).toBe(2);
  });

  it("MATI: foto yang tetap dikirim diabaikan (tidak disimpan, tidak error)", async () => {
    await updateAttendancePolicy(fx.superAdmin, policy({ attendancePhotoMode: "OFF" }));
    await checkIn(fx.emp1, { location: loc() }, at("08:00"), ctx(await photo()));
    expect(await photos()).toHaveLength(0);
    expect(await prisma.storedFile.count({ where: { kind: "ATTENDANCE_PHOTO" } })).toBe(0);
  });

  it("foto wajib bercap lokasi: tanpa koordinat ditolak; bila syarat lokasi dimatikan, cap menulis 'Lokasi: tidak tersedia'", async () => {
    const e = await fail(checkIn(fx.emp1, {}, at("08:00"), ctx(await photo())));
    expect(e?.fieldErrors?.photo).toContain("Lokasi");
    expect(await prisma.attendance.count()).toBe(0);
    await updateAttendancePolicy(fx.superAdmin, policy({ attendancePhotoRequireLocation: false }));
    await checkIn(fx.emp1, {}, at("08:00"), ctx(await photo()));
    const p = (await photos())[0]!;
    expect([p.lat, p.lng]).toEqual([null, null]);
    expect(p.stamp.split("\n")[1]).toBe("Lokasi: tidak tersedia");
  });
});

describe("keamanan: foto tidak valid & atomisitas", () => {
  it("bukan gambar / GIF / terlalu kecil / terlalu besar → ditolak, absensi TIDAK tercatat", async () => {
    const gif = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#fff" } }).gif().toBuffer();
    for (const bad of [Buffer.from("bukan gambar"), gif, await photo(100, 100), new Uint8Array(4 * 1024 * 1024).fill(7)]) {
      const e = await fail(checkIn(fx.emp1, { location: loc() }, at("08:00"), ctx(bad)));
      expect(e?.code).toBe("VALIDATION");
      expect(e?.fieldErrors?.photo).toBeTruthy();
    }
    expect(await prisma.attendance.count()).toBe(0);
    expect(await prisma.storedFile.count()).toBe(0);
  });

  it("klik ganda serentak dengan foto: tepat satu absensi dan satu foto; tidak ada berkas yatim", async () => {
    const buf = await photo();
    const r = await Promise.allSettled(Array.from({ length: 4 }, () => checkIn(fx.emp1, { location: loc() }, at("08:00"), ctx(buf))));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected").every((x) => (x as PromiseRejectedResult).reason.code === "CONFLICT")).toBe(true);
    expect(await prisma.attendance.count()).toBe(1);
    expect(await photos()).toHaveLength(1);
    expect(await prisma.storedFile.count({ where: { kind: "ATTENDANCE_PHOTO" } })).toBe(1);
  });

  it("bukti tidak dapat diubah/dihapus walau lewat SQL; menghapus catatan absensi (koreksi HR) melepas tautan tetapi foto TETAP ada", async () => {
    await checkIn(fx.emp1, { location: loc() }, at("08:00"), ctx(await photo()));
    const p = (await photos())[0]!;
    await expect(prisma.$executeRaw`UPDATE attendance_photos SET stamp = 'palsu' WHERE id = ${p.id}::uuid`).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.$executeRaw`UPDATE attendance_photos SET "capturedAt" = now() WHERE id = ${p.id}::uuid`).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.$executeRaw`DELETE FROM attendance_photos WHERE id = ${p.id}::uuid`).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.$executeRaw`UPDATE attendance_photos SET lat = 91, lng = 0 WHERE id = ${p.id}::uuid`).rejects.toThrow();

    await correctAttendance(fx.hr, { employeeId: E1(), date: "2026-03-02", action: "remove", reason: "Check-in salah tanggal" });
    const kept = await prisma.attendancePhoto.findUniqueOrThrow({ where: { id: p.id } });
    expect(kept.attendanceId).toBeNull();
    expect(kept.stamp).toBe(p.stamp);
    // Absen ulang pada hari itu → foto baru, foto lama tetap sebagai jejak.
    await checkIn(fx.emp1, { location: loc() }, at("08:20"), ctx(await photo()));
    expect(await photos()).toHaveLength(2);
  });
});

describe("akses foto", () => {
  async function seeded() {
    await checkIn(fx.emp1, { location: loc() }, at("08:00"), ctx(await photo()));
    return (await photos())[0]!;
  }

  it("pemilik & HR/Super Admin boleh membuka; karyawan lain DITOLAK; pembukaan oleh peninjau dicatat di audit", async () => {
    const p = await seeded();
    expect((await readFileForActor(fx.emp1, p.fileId!)).kind).toBe("ATTENDANCE_PHOTO");
    expect((await fail(readFileForActor(fx.emp2, p.fileId!)))?.code).toBe("FORBIDDEN");
    expect((await readFileForActor(fx.hr, p.fileId!)).id).toBe(p.fileId);
    expect((await readFileForActor(fx.superAdmin, p.fileId!)).id).toBe(p.fileId);
    expect(await prisma.auditLog.count({ where: { action: "file.view", entityId: p.fileId! } })).toBe(2); // HR + Super Admin (bukan pemilik)
  });

  it("tampil di rincian rekap untuk HR dan pemiliknya; karyawan lain tidak dapat melihat rincian itu", async () => {
    await seeded();
    await checkOut(fx.emp1, { location: loc() }, at("17:00"), ctx(await photo()));
    for (const actor of [fx.hr, fx.emp1]) {
      const d = await getRecapDetail(actor, E1(), { view: "kustom", from: "2026-03-02", to: "2026-03-02" });
      expect(d.photos["2026-03-02"]!.map((x) => [x.kind, x.mapUrl?.includes("openstreetmap")])).toEqual([["CHECK_IN", true], ["CHECK_OUT", true]]);
      expect(d.photos["2026-03-02"]![0]!.url).toMatch(/^\/api\/files\/[0-9a-f-]{36}$/);
    }
    expect((await fail(getRecapDetail(fx.emp2, E1(), { view: "kustom", from: "2026-03-02", to: "2026-03-02" })))?.code).toBe("FORBIDDEN");
  });

  it("antrean Tinjauan Lokasi menautkan foto absensi untuk punch yang ditandai", async () => {
    await updateAttendancePolicy(fx.superAdmin, policy({ locationEnabled: true, locationName: "Kantor", locationLat: -7.795612, locationLng: 110.369587, locationRadiusMeters: 100_000 }));
    // pembacaan "persis di pusat + akurasi 0 + presisi rendah" → ditandai
    await checkIn(fx.emp1, { location: loc({ lat: -7.795612, lng: 110.369587, accuracy: 0 }) }, at("08:00"), ctx(await photo()));
    const rows = (await listLocationChecks(fx.hr, { status: "ALL" })).items;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.photoUrl).toMatch(/^\/api\/files\//);
  });
});
