import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { checkIn, checkOut, correctAttendance, getTodayState } from "@/server/services/attendance";
import { cancelLeave, getBalance, getLedger, reviewLeave, setBalance, submitLeave } from "@/server/services/leave";
import { getRecap } from "@/server/services/recap";
import { createAssignment, createSchedule } from "@/server/services/schedules";
import { updateAttendancePolicy } from "@/server/services/settings";
import { isoToDate } from "@/server/json";
import { resetDb, seedFixtures, type Fixtures } from "../helpers/db";
import { pinNow } from "../helpers/pin-now";

// Tanggal tetap di masa lalu + aturan mundur 365 hari → titik awal waktu dipatok agar tes tidak membusuk (lihat helpers/pin-now.ts).
pinNow();

let fx: Fixtures;
let nightId: string;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
  await updateAttendancePolicy(fx.superAdmin, {
    lateMinutesAfterTolerance: false, locationEnabled: false, locationName: null, locationLat: null, locationLng: null, locationRadiusMeters: 100,
    locationMaxAccuracyMeters: 150, requestBackdateDays: 365, annualLeaveQuota: 12, allowNegativeLeaveBalance: false,
  });
  // emp1 bekerja shift malam 22:00 → 06:00 (Sen–Jum), batas tidak hadir 02:00 dini hari berikutnya; emp2/emp3 reguler.
  const s = await createSchedule(fx.hr, { name: "Shift Malam", workDays: [1, 2, 3, 4, 5], startTime: "22:00", endTime: "06:00", lateToleranceMinutes: 15, absentCutoffTime: "02:00" });
  nightId = s.id;
  await createAssignment(fx.hr, { scheduleId: nightId, scope: "EMPLOYEE", employeeId: fx.empIds[0], startDate: "2026-01-01" });
});

// Senin 2 Maret 2026. Jam WIB = UTC+7.
const at = (hhmm: string, date = "2026-03-02") => new Date(`${date}T${hhmm}:00+07:00`);
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const attOf = (employeeId: string) => prisma.attendance.findMany({ where: { employeeId }, orderBy: { date: "asc" } });
const dateStr = (d: Date) => d.toISOString().slice(0, 10);

describe("shift lintas tengah malam — absensi", () => {
  it("check-in malam, check-out pagi berikutnya menutup shift yang SAMA (satu baris, tanggal = tanggal mulai)", async () => {
    const s1 = await checkIn(fx.emp1, {}, at("21:50"));
    expect(s1.workDate).toBe("2026-03-02");
    expect(s1.day.status).toBe("HADIR");

    // Dini hari Selasa: tanggal kalender sudah berganti, tetapi tanggal KERJA masih Senin dan tombol check-out aktif.
    const mid = await getTodayState(fx.emp1, at("03:00", "2026-03-03"));
    expect(mid.today).toBe("2026-03-03");
    expect(mid.workDate).toBe("2026-03-02");
    expect(mid.canCheckOut).toBe(true);
    expect(mid.canCheckIn).toBe(false);
    expect(mid.day.incomplete).toBe(false); // shift sedang berjalan

    const s2 = await checkOut(fx.emp1, {}, at("06:05", "2026-03-03"));
    expect(s2.day.checkOutNextDay).toBe(true);
    expect(s2.day.workedMinutes).toBe(8 * 60 + 15);
    expect(s2.day.afterEndMinutes).toBe(5);
    const rows = await attOf(fx.empIds[0]);
    expect(rows).toHaveLength(1);
    expect(dateStr(rows[0]!.date)).toBe("2026-03-02");
  });

  it("setelah shift selesai & check-out, siang harinya tanggal kerja = hari ini (Belum absen untuk shift malam berikutnya)", async () => {
    await checkIn(fx.emp1, {}, at("22:00"));
    await checkOut(fx.emp1, {}, at("06:00", "2026-03-03"));
    const s = await getTodayState(fx.emp1, at("10:00", "2026-03-03"));
    expect(s.workDate).toBe("2026-03-03");
    expect(s.canCheckIn).toBe(true);
    expect(s.day.status).toBe("BELUM_ABSEN");
  });

  it("check-in terlambat DINI HARI (01:30) masuk ke shift yang berjalan (Senin), terlambat 210 menit", async () => {
    const s = await checkIn(fx.emp1, {}, at("01:30", "2026-03-03"));
    expect(s.workDate).toBe("2026-03-02");
    expect(s.day.status).toBe("TERLAMBAT");
    expect(s.day.lateMinutes).toBe(210);
    expect(s.day.checkInNextDay).toBe(true);
    expect(dateStr((await attOf(fx.empIds[0]))[0]!.date)).toBe("2026-03-02");
    // check-out tetap dalam shift itu
    const out = await checkOut(fx.emp1, {}, at("06:10", "2026-03-03"));
    expect(out.day.missingCheckout).toBe(false);
  });

  it("pukul 03:00 sebelum check-in: status shift berjalan = Belum absen / lewat batas 02:00 = Tidak hadir, tetapi check-in tetap diizinkan", async () => {
    const s = await getTodayState(fx.emp1, at("03:00", "2026-03-03"));
    expect(s.workDate).toBe("2026-03-02");
    expect(s.day.status).toBe("TIDAK_HADIR");
    expect(s.canCheckIn).toBe(true);
    const r = await checkIn(fx.emp1, {}, at("03:00", "2026-03-03"));
    expect(r.day.status).toBe("TERLAMBAT"); // kehadiran nyata menggantikan status tidak hadir
  });

  it("lupa check-out: lewat masa tenggang (06:00 + 6 jam) punch berikutnya adalah check-in HARI BARU; shift lama tetap belum lengkap", async () => {
    await checkIn(fx.emp1, {}, at("21:58"));
    const late = await getTodayState(fx.emp1, at("13:00", "2026-03-03"));
    expect(late.workDate).toBe("2026-03-03");
    expect(late.canCheckOut).toBe(false);
    const e = await fail(checkOut(fx.emp1, {}, at("13:00", "2026-03-03")));
    expect(e?.message).toContain("belum check-in");
    const r = await checkIn(fx.emp1, {}, at("21:59", "2026-03-03"));
    expect(r.workDate).toBe("2026-03-03");
    expect(await attOf(fx.empIds[0])).toHaveLength(2);
    const recap = await getRecap(fx.hr, { view: "kustom", from: "2026-03-02", to: "2026-03-02", employeeId: fx.empIds[0] });
    expect(recap.summary.incompleteCount).toBe(1);
  });

  it("check-out di dalam masa tenggang (11:30) masih menutup shift kemarin", async () => {
    await checkIn(fx.emp1, {}, at("21:58"));
    const s = await getTodayState(fx.emp1, at("11:30", "2026-03-03"));
    expect(s.workDate).toBe("2026-03-02");
    expect(s.canCheckOut).toBe(true);
  });

  it("karyawan berjadwal reguler tidak terpengaruh: dini hari = hari ini", async () => {
    const s = await getTodayState(fx.emp2, at("01:00", "2026-03-03"));
    expect(s.workDate).toBe("2026-03-03");
    expect(s.day.status).toBe("BELUM_ABSEN");
  });

  it("klik ganda bersamaan saat check-out dini hari → hanya satu yang berhasil", async () => {
    await checkIn(fx.emp1, {}, at("22:00"));
    const r = await Promise.allSettled(Array.from({ length: 5 }, () => checkOut(fx.emp1, {}, at("06:00", "2026-03-03"))));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });

  it("rekap satu minggu shift malam: tiap malam = 1 hari kerja; jam kerja melewati tengah malam terhitung penuh", async () => {
    for (const [d, next] of [["2026-03-02", "2026-03-03"], ["2026-03-03", "2026-03-04"]] as const) {
      await prisma.attendance.create({ data: { employeeId: fx.empIds[0], date: isoToDate(d), checkInAt: at("21:55", d), checkOutAt: at("06:05", next), source: "SELF" } });
    }
    const recap = await getRecap(fx.hr, { view: "kustom", from: "2026-03-02", to: "2026-03-06", employeeId: fx.empIds[0] });
    expect(recap.summary.scheduledDays).toBe(5);
    expect(recap.summary.presentDays).toBe(2);
    expect(recap.summary.absentDays).toBe(3);
    expect(recap.summary.workedMinutes).toBe(2 * (8 * 60 + 10));
  });
});

describe("shift lintas tengah malam — koreksi admin & jadwal", () => {
  it("koreksi: jam check-out 06:00 lebih awal dari check-in 22:00 pada jadwal malam otomatis dianggap hari berikutnya", async () => {
    await correctAttendance(fx.hr, { employeeId: fx.empIds[0], date: "2026-03-02", action: "set", checkIn: "22:00", checkOut: "06:00", reason: "Lupa absen malam" });
    const a = (await attOf(fx.empIds[0]))[0]!;
    expect(a.checkInAt.toISOString()).toBe(at("22:00").toISOString());
    expect(a.checkOutAt?.toISOString()).toBe(at("06:00", "2026-03-03").toISOString());
  });

  it("koreksi pada jadwal reguler: check-out < check-in tetap ditolak, kecuali ditandai hari berikutnya secara eksplisit", async () => {
    const e = await fail(correctAttendance(fx.hr, { employeeId: fx.empIds[1], date: "2026-03-02", action: "set", checkIn: "22:00", checkOut: "06:00", reason: "Salah input" }));
    expect(e?.code).toBe("VALIDATION");
    await correctAttendance(fx.hr, { employeeId: fx.empIds[1], date: "2026-03-02", action: "set", checkIn: "22:00", checkOut: "06:00", checkOutNextDay: true, reason: "Lembur sampai pagi (disetujui)" });
    expect((await attOf(fx.empIds[1]))[0]!.checkOutAt?.toISOString()).toBe(at("06:00", "2026-03-03").toISOString());
  });

  it("durasi satu catatan > 24 jam ditolak", async () => {
    const e = await fail(correctAttendance(fx.hr, { employeeId: fx.empIds[1], date: "2026-03-02", action: "set", checkIn: "08:00", checkOut: "09:00", checkOutNextDay: true, reason: "Tes batas durasi" }));
    expect(e?.message).toContain("24 jam");
  });

  it("validasi jadwal: jam pulang = jam masuk ditolak; batas tidak hadir sesudah shift berakhir ditolak; shift > 16 jam ditolak", async () => {
    const base = { workDays: [1], lateToleranceMinutes: 0 };
    expect((await fail(createSchedule(fx.hr, { ...base, name: "Jadwal A", startTime: "08:00", endTime: "08:00", absentCutoffTime: "09:00" })))?.fieldErrors?.endTime).toBeTruthy();
    expect((await fail(createSchedule(fx.hr, { ...base, name: "Jadwal B", startTime: "22:00", endTime: "06:00", absentCutoffTime: "12:00" })))?.fieldErrors?.absentCutoffTime).toMatch(/sebelum jam pulang/);
    expect((await fail(createSchedule(fx.hr, { ...base, name: "Jadwal C", startTime: "20:00", endTime: "19:00", absentCutoffTime: "23:00" })))?.fieldErrors?.endTime).toMatch(/16 jam/);
    // jadwal reguler tetap tidak boleh punya batas sebelum jam masuk
    expect((await fail(createSchedule(fx.hr, { ...base, name: "Jadwal D", startTime: "08:00", endTime: "16:00", absentCutoffTime: "07:00" })))?.fieldErrors?.absentCutoffTime).toBeTruthy();
    // shift malam dengan batas malam yang sama valid
    expect(await fail(createSchedule(fx.hr, { ...base, name: "Jadwal E", startTime: "22:00", endTime: "06:00", absentCutoffTime: "23:30" }))).toBeNull();
  });

  it("database menolak jadwal tidak sah walau service dilewati (constraint)", async () => {
    await expect(prisma.workSchedule.create({ data: { name: "Bad", workDays: [1], startTime: "08:00", endTime: "08:00", absentCutoffTime: "09:00" } })).rejects.toThrow();
    await expect(prisma.workSchedule.create({ data: { name: "Bad2", workDays: [1], startTime: "08:00", endTime: "16:00", absentCutoffTime: "07:00" } })).rejects.toThrow();
  });
});

// ─────────────────────────── Setengah hari ───────────────────────────

const D1 = "2027-03-01"; // Senin
describe("cuti setengah hari", () => {
  it("diajukan setengah hari = 0,5 hari kerja; saldo dicadangkan 0,5", async () => {
    await setBalance(fx.hr, { employeeId: fx.empIds[1], year: 2027, targetDays: 12, note: "Saldo awal" });
    const r = await submitLeave(fx.emp2, { type: "CUTI", startDate: D1, endDate: D1, dayPart: "MORNING", reason: "Urus dokumen pagi hari" });
    expect(r.dayPart).toBe("MORNING");
    expect(r.workingDays).toBe(0.5);
    const b = await getBalance(fx.emp2, fx.empIds[1], 2027);
    expect(b.reserved).toBe(0.5);
    expect(b.available).toBe(11.5);
  });

  it("setengah hari hanya untuk satu hari; pada akhir pekan ditolak", async () => {
    const multi = await fail(submitLeave(fx.emp2, { type: "CUTI", startDate: D1, endDate: "2027-03-02", dayPart: "AFTERNOON", reason: "Dua hari setengah" }));
    expect(multi?.fieldErrors?.dayPart).toMatch(/satu hari/);
    const weekend = await fail(submitLeave(fx.emp2, { type: "IZIN", startDate: "2027-03-06", endDate: "2027-03-06", dayPart: "MORNING", reason: "Sabtu" }));
    expect(weekend?.message).toMatch(/hari kerja/);
  });

  it("disetujui memotong 0,5 (bukan 1) → saldo 11,5; dibatalkan HR → dikembalikan 0,5; buku saldo tetap benar", async () => {
    await setBalance(fx.hr, { employeeId: fx.empIds[1], year: 2027, targetDays: 12, note: "Saldo awal" });
    const r = await submitLeave(fx.emp2, { type: "CUTI", startDate: D1, endDate: D1, dayPart: "AFTERNOON", reason: "Kontrol dokter siang" });
    await reviewLeave(fx.hr, r.id, { decision: "APPROVE" });
    expect((await getBalance(fx.emp2, fx.empIds[1], 2027)).balance).toBe(11.5);
    await cancelLeave(fx.hr, r.id, { reason: "Batal ke dokter" });
    expect((await getBalance(fx.emp2, fx.empIds[1], 2027)).balance).toBe(12);
    const kinds = (await getLedger(fx.hr, fx.empIds[1], 2027)).map((l) => `${l.kind}:${l.days}`).reverse();
    expect(kinds).toEqual(["GRANT:12", "USAGE:-0.5", "RESTORE:0.5"]);
  });

  it("saldo 0,5 cukup untuk setengah hari tetapi tidak untuk sehari penuh", async () => {
    await setBalance(fx.hr, { employeeId: fx.empIds[1], year: 2027, targetDays: 0.5, note: "Sisa setengah hari" });
    const full = await fail(submitLeave(fx.emp2, { type: "CUTI", startDate: D1, endDate: D1, reason: "Sehari penuh" }));
    expect(full?.message).toContain("tidak cukup");
    expect(await fail(submitLeave(fx.emp2, { type: "CUTI", startDate: D1, endDate: D1, dayPart: "MORNING", reason: "Setengah hari saja" }))).toBeNull();
  });

  it("atur saldo hanya kelipatan 0,5", async () => {
    expect((await fail(setBalance(fx.hr, { employeeId: fx.empIds[1], year: 2027, targetDays: 10.3, note: "Salah ketik" })))?.fieldErrors?.targetDays).toMatch(/0,5/);
    expect((await setBalance(fx.hr, { employeeId: fx.empIds[1], year: 2027, targetDays: 10.5, note: "Setengah hari" })).balance).toBe(10.5);
  });

  it("pengajuan lain di tanggal yang sama (sehari penuh / setengah hari lain) ditolak — satu pengajuan terbuka per tanggal", async () => {
    await submitLeave(fx.emp2, { type: "IZIN", startDate: D1, endDate: D1, dayPart: "MORNING", reason: "Izin pagi hari" });
    expect((await fail(submitLeave(fx.emp2, { type: "SAKIT", startDate: D1, endDate: D1, dayPart: "AFTERNOON", reason: "Sakit siang" })))?.code).toBe("CONFLICT");
    expect((await fail(submitLeave(fx.emp2, { type: "CUTI", startDate: D1, endDate: "2027-03-02", reason: "Dua hari" })))?.code).toBe("CONFLICT");
  });

  it("hari setengah-cuti: check-in DIIZINKAN; cuti sehari penuh memblokir check-in", async () => {
    const half = await submitLeave(fx.emp2, { type: "IZIN", startDate: D1, endDate: D1, dayPart: "MORNING", reason: "Izin pagi hari" });
    await reviewLeave(fx.hr, half.id, { decision: "APPROVE" });
    const full = await submitLeave(fx.emp3, { type: "IZIN", startDate: D1, endDate: D1, reason: "Izin seharian" });
    await reviewLeave(fx.hr, full.id, { decision: "APPROVE" });

    const nowH = at("12:05", D1);
    const sHalf = await getTodayState(fx.emp2, nowH);
    expect(sHalf.canCheckIn).toBe(true);
    expect(sHalf.blockedReason).toBeNull();
    const done = await checkIn(fx.emp2, {}, nowH);
    expect(done.day.status).toBe("HADIR"); // jam masuk efektif 12:00, 12:05 masih dalam toleransi
    expect(done.day.fractions.present).toBe(0.5);
    expect(done.day.fractions.izin).toBe(0.5);

    const sFull = await getTodayState(fx.emp3, nowH);
    expect(sFull.canCheckIn).toBe(false);
    expect((await fail(checkIn(fx.emp3, {}, nowH)))?.message).toContain("disetujui");
  });

  it("rekap 2 hari: cuti pagi + hadir siang, izin siang tanpa check-in → hadir 0,5, cuti 0,5, izin 0,5, tidak hadir 0,5", async () => {
    // Tahun 2026 (lampau) agar semua hari final: Sen 9 Mar cuti pagi + hadir siang; Sel 10 Mar izin siang tanpa check-in.
    await setBalance(fx.hr, { employeeId: fx.empIds[1], year: 2026, targetDays: 12, note: "Saldo" });
    const a = await submitLeave(fx.emp2, { type: "CUTI", startDate: "2026-03-09", endDate: "2026-03-09", dayPart: "MORNING", reason: "Cuti pagi untuk keperluan" });
    const b = await submitLeave(fx.emp2, { type: "IZIN", startDate: "2026-03-10", endDate: "2026-03-10", dayPart: "AFTERNOON", reason: "Izin siang untuk keperluan" });
    await reviewLeave(fx.hr, a.id, { decision: "APPROVE" });
    await reviewLeave(fx.hr, b.id, { decision: "APPROVE" });
    await prisma.attendance.create({ data: { employeeId: fx.empIds[1], date: isoToDate("2026-03-09"), checkInAt: at("12:00", "2026-03-09"), checkOutAt: at("16:00", "2026-03-09"), source: "SELF" } });
    const recap = await getRecap(fx.hr, { view: "kustom", from: "2026-03-09", to: "2026-03-10", employeeId: fx.empIds[1] });
    const s = recap.summary;
    expect(s.scheduledDays).toBe(2);
    expect(s.presentDays).toBe(0.5);
    expect(s.cutiDays).toBe(0.5);
    expect(s.izinDays).toBe(0.5);
    expect(s.absentDays).toBe(0.5); // hanya hari 10: izin siang 0,5 + separuh pagi tanpa check-in = tidak hadir 0,5
  });

  it("database menolak dayPart setengah hari pada rentang > 1 hari dan working_days bukan kelipatan 0,5", async () => {
    const base = { employeeId: fx.empIds[1], type: "IZIN" as const, reason: "x" };
    await expect(prisma.leaveRequest.create({ data: { ...base, startDate: isoToDate("2027-03-01"), endDate: isoToDate("2027-03-02"), dayPart: "MORNING" } })).rejects.toThrow();
    await expect(prisma.leaveRequest.create({ data: { ...base, startDate: isoToDate("2027-03-01"), endDate: isoToDate("2027-03-01"), workingDays: 0.3 } })).rejects.toThrow();
  });
});
