import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { checkIn, checkOut, correctAttendance, getTodayState, listCorrections } from "@/server/services/attendance";
import { getRecap } from "@/server/services/recap";
import { updateAttendancePolicy } from "@/server/services/settings";
import { addCalendarDay } from "@/server/services/schedules";
import { isoToDate } from "@/server/json";
import { resetDb, seedFixtures, type Fixtures } from "../helpers/db";

let fx: Fixtures;
beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
});

// Selasa 3 Maret 2026. Jam WIB = UTC+7.
const at = (hhmm: string, date = "2026-03-03") => new Date(`${date}T${hhmm}:00+07:00`);
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };

describe("check-in / check-out", () => {
  it("check-in tepat waktu → Hadir; waktu = jam SERVER; check-out menutup hari", async () => {
    const s0 = await getTodayState(fx.emp1, at("07:30"));
    expect(s0.canCheckIn).toBe(true);
    expect(s0.day.status).toBe("BELUM_ABSEN");

    const s1 = await checkIn(fx.emp1, { note: "Berangkat" }, at("07:58"));
    expect(s1.day.status).toBe("HADIR");
    expect(s1.checkInNote).toBe("Berangkat");
    expect(s1.canCheckIn).toBe(false);
    expect(s1.canCheckOut).toBe(true);
    expect(s1.day.checkInTime).toBe("07:58");

    const s2 = await checkOut(fx.emp1, {}, at("16:05"));
    expect(s2.canCheckOut).toBe(false);
    expect(s2.day.workedMinutes).toBe(8 * 60 + 7);
    expect(s2.day.missingCheckout).toBe(false);
  });

  it("terlambat melewati toleransi 15 menit", async () => {
    const s = await checkIn(fx.emp2, {}, at("08:31"));
    expect(s.day.status).toBe("TERLAMBAT");
    expect(s.day.lateMinutes).toBe(31);
  });

  it("check-in ganda ditolak dengan pesan jelas; baris tetap satu", async () => {
    await checkIn(fx.emp1, {}, at("08:00"));
    const e = await fail(checkIn(fx.emp1, {}, at("08:05")));
    expect(e?.code).toBe("CONFLICT");
    expect(e?.message).toContain("sudah check-in");
    expect(await prisma.attendance.count({ where: { employeeId: fx.empIds[0] } })).toBe(1);
  });

  it("klik ganda bersamaan (balapan) → tepat satu check-in tersimpan", async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => checkIn(fx.emp3, {}, at("08:00"))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.attendance.count({ where: { employeeId: fx.empIds[2] } })).toBe(1);
  });

  it("check-out ganda & check-out tanpa check-in ditolak", async () => {
    expect((await fail(checkOut(fx.emp1, {}, at("16:00"))))?.code).toBe("VALIDATION");
    await checkIn(fx.emp1, {}, at("08:00"));
    await checkOut(fx.emp1, {}, at("16:00"));
    expect((await fail(checkOut(fx.emp1, {}, at("16:30"))))?.code).toBe("CONFLICT");
    const row = await prisma.attendance.findFirstOrThrow({ where: { employeeId: fx.empIds[0] } });
    expect(row.checkOutAt?.toISOString()).toBe(at("16:00").toISOString());
  });

  it("check-out balapan → hanya satu yang tercatat", async () => {
    await checkIn(fx.emp1, {}, at("08:00"));
    const r = await Promise.allSettled(Array.from({ length: 5 }, () => checkOut(fx.emp1, {}, at("16:00"))));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });

  it("catatan tersimpan; karyawan tanpa tautan akun tidak bisa absen", async () => {
    expect((await fail(checkIn(fx.hr, {}, at("08:00"))))?.code).toBe("FORBIDDEN");
  });

  it("tidak dapat check-in di hari izin/cuti yang sudah disetujui", async () => {
    await prisma.leaveRequest.create({
      data: { employeeId: fx.empIds[1], type: "CUTI", startDate: isoToDate("2026-03-03"), endDate: isoToDate("2026-03-03"), reason: "Acara keluarga", status: "APPROVED", workingDays: 1, reviewedById: fx.hr.userId, reviewedAt: new Date() },
    });
    const s = await getTodayState(fx.emp2, at("08:00"));
    expect(s.canCheckIn).toBe(false);
    expect(s.blockedReason).toContain("cuti");
    expect((await fail(checkIn(fx.emp2, {}, at("08:00"))))?.code).toBe("VALIDATION");
  });

  it("hari libur: check-in tetap diizinkan dan tercatat sebagai kehadiran non-kerja", async () => {
    await addCalendarDay(fx.hr, { date: "2026-03-03", kind: "HOLIDAY", name: "Libur uji" });
    const s = await checkIn(fx.emp1, {}, at("09:00"));
    expect(s.day.status).toBe("HADIR");
    expect(s.day.scheduled).toBe(false);
  });

  it("karyawan nonaktif tidak dapat absen", async () => {
    await prisma.employee.update({ where: { id: fx.empIds[0] }, data: { isActive: false, endDate: isoToDate("2026-03-02") } });
    expect((await fail(checkIn(fx.emp1, {}, at("08:00"))))?.code).toBe("FORBIDDEN");
  });
});

describe("absensi berbasis lokasi (opsional)", () => {
  const policy = (over: Record<string, unknown> = {}) => ({
    lateMinutesAfterTolerance: false, locationEnabled: true, locationName: "Kantor Uji", locationLat: -7.7956, locationLng: 110.3695,
    locationRadiusMeters: 100, locationMaxAccuracyMeters: 100, requestBackdateDays: 7, annualLeaveQuota: 12, allowNegativeLeaveBalance: false, ...over,
  });

  it("nonaktif (default): koordinat tidak diperlukan dan tidak disimpan", async () => {
    await checkIn(fx.emp1, { location: { lat: 10, lng: 10, accuracy: 5 } }, at("08:00"));
    const row = await prisma.attendance.findFirstOrThrow({ where: { employeeId: fx.empIds[0] } });
    expect(row.checkInLat).toBeNull();
  });

  it("aktif: tanpa izin lokasi → pesan jelas; di luar radius → ditolak; di dalam → tersimpan + jarak", async () => {
    await updateAttendancePolicy(fx.superAdmin, policy());
    const none = await fail(checkIn(fx.emp1, {}, at("08:00")));
    expect(none?.code).toBe("VALIDATION");
    expect(none?.message).toContain("lokasi");

    const far = await fail(checkIn(fx.emp1, { location: { lat: -7.7956 + 0.02, lng: 110.3695, accuracy: 10 } }, at("08:00")));
    expect(far?.message).toMatch(/di luar radius/i);

    const bad = await fail(checkIn(fx.emp1, { location: { lat: -7.7956, lng: 110.3695, accuracy: 500 } }, at("08:00")));
    expect(bad?.message).toMatch(/akurasi/i);
    expect(await prisma.attendance.count()).toBe(0);

    await checkIn(fx.emp1, { location: { lat: -7.7956 + 0.0003, lng: 110.3695, accuracy: 12 } }, at("08:00"));
    const row = await prisma.attendance.findFirstOrThrow();
    expect(row.checkInDistance).toBeGreaterThan(20);
    expect(row.checkInDistance).toBeLessThan(50);
    expect(row.checkInLat).not.toBeNull();
  });

  it("tidak boleh mengaktifkan lokasi tanpa titik koordinat", async () => {
    const e = await fail(updateAttendancePolicy(fx.superAdmin, policy({ locationLat: null, locationLng: null })));
    expect(e?.code).toBe("VALIDATION");
  });
});

describe("koreksi absensi oleh admin", () => {
  it("menyimpan sebelum/sesudah, waktu, dan pelaku; rekap langsung berubah", async () => {
    const date = "2026-01-08";
    const before = await getRecap(fx.hr, { view: "harian", date, employeeId: fx.empIds[0] });
    expect(before.page.items[0]!.days![0]!.status).toBe("TIDAK_HADIR");

    await correctAttendance(fx.hr, { employeeId: fx.empIds[0], date, action: "set", checkIn: "08:10", checkOut: "16:00", reason: "Lupa absen, terverifikasi atasan" });
    const after = await getRecap(fx.hr, { view: "harian", date, employeeId: fx.empIds[0] });
    expect(after.page.items[0]!.days![0]!.status).toBe("HADIR");

    // koreksi kedua mengubah jam
    await correctAttendance(fx.hr, { employeeId: fx.empIds[0], date, action: "set", checkIn: "08:40", checkOut: "16:00", reason: "Jam sebenarnya 08:40" });
    const hist = await listCorrections(fx.hr, { employeeId: fx.empIds[0], date });
    expect(hist).toHaveLength(2);
    const [latest, first] = hist;
    expect(first!.before).toBeNull();
    expect(first!.after?.checkInAt).toBe(new Date("2026-01-08T08:10:00+07:00").toISOString());
    expect(latest!.before?.checkInAt).toBe(new Date("2026-01-08T08:10:00+07:00").toISOString());
    expect(latest!.after?.checkInAt).toBe(new Date("2026-01-08T08:40:00+07:00").toISOString());
    expect(latest!.correctedBy).toBe("HR Uji");
    expect(latest!.reason).toBe("Jam sebenarnya 08:40");
    expect(new Date(latest!.createdAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(after.page.items[0]!.days![0]!.checkInTime).toBe("08:10");

    const audit = await prisma.auditLog.findMany({ where: { action: "attendance.correct" } });
    expect(audit).toHaveLength(2);
    expect(audit[0]!.reason).toBeTruthy();
  });

  it("alasan wajib; tanggal masa depan ditolak; check-out harus setelah check-in; tanpa perubahan ditolak", async () => {
    const base = { employeeId: fx.empIds[0], date: "2026-01-08", action: "set", checkIn: "08:00", checkOut: "16:00" };
    expect((await fail(correctAttendance(fx.hr, { ...base, reason: "" })))?.code).toBe("VALIDATION");
    expect((await fail(correctAttendance(fx.hr, { ...base, reason: "x" })))?.code).toBe("VALIDATION");
    expect((await fail(correctAttendance(fx.hr, { ...base, date: "2099-01-01", reason: "Uji masa depan" })))?.message).toMatch(/masa depan/);
    expect((await fail(correctAttendance(fx.hr, { ...base, checkIn: "16:00", checkOut: "08:00", reason: "Terbalik" })))?.code).toBe("VALIDATION");
    await correctAttendance(fx.hr, { ...base, reason: "Koreksi pertama" });
    expect((await fail(correctAttendance(fx.hr, { ...base, reason: "Sama persis" })))?.message).toMatch(/Tidak ada perubahan/);
    expect(await prisma.attendanceCorrection.count()).toBe(1);
  });

  it("hapus catatan dicatat sebagai koreksi (sesudah = null)", async () => {
    await correctAttendance(fx.hr, { employeeId: fx.empIds[0], date: "2026-01-09", action: "set", checkIn: "08:00", checkOut: null, reason: "Input awal" });
    await correctAttendance(fx.hr, { employeeId: fx.empIds[0], date: "2026-01-09", action: "remove", reason: "Salah karyawan" });
    expect(await prisma.attendance.count()).toBe(0);
    const hist = await listCorrections(fx.hr, { employeeId: fx.empIds[0] });
    expect(hist[0]!.after).toBeNull();
    expect(hist[0]!.before).not.toBeNull();
  });

  it("tanggal sebelum karyawan bergabung ditolak; karyawan biasa tidak bisa mengoreksi", async () => {
    await prisma.employee.update({ where: { id: fx.empIds[0] }, data: { joinDate: isoToDate("2026-02-01") } });
    expect((await fail(correctAttendance(fx.hr, { employeeId: fx.empIds[0], date: "2026-01-08", action: "set", checkIn: "08:00", reason: "Sebelum bergabung" })))?.code).toBe("VALIDATION");
    expect((await fail(correctAttendance(fx.emp1, { employeeId: fx.empIds[0], date: "2026-02-03", action: "set", checkIn: "08:00", reason: "Koreksi sendiri" })))?.code).toBe("FORBIDDEN");
  });

  it("riwayat koreksi bersifat append-only di level database", async () => {
    await correctAttendance(fx.hr, { employeeId: fx.empIds[0], date: "2026-01-08", action: "set", checkIn: "08:00", checkOut: "16:00", reason: "Koreksi uji" });
    await expect(prisma.$executeRawUnsafe(`UPDATE attendance_corrections SET reason = 'diubah'`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM attendance_corrections`)).rejects.toThrow(/append-only/);
    await expect(prisma.$executeRawUnsafe(`UPDATE audit_logs SET summary = 'diubah'`)).rejects.toThrow(/append-only/);
  });
});
