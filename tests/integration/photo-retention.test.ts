/**
 * Retensi foto absensi: foto lebih tua dari N bulan (bawaan 6) dihapus permanen; jejak teks cap tetap; yang sedang ditinjau /
 * terkonfirmasi dikecualikan; setiap penghapusan masuk audit log dengan jumlahnya.
 */
import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { checkIn, checkOut, correctAttendance } from "@/server/services/attendance";
import { readFileForActor } from "@/server/services/files";
import { getRecapDetail } from "@/server/services/recap";
import { listLocationChecks } from "@/server/services/location";
import { purgeExpiredPhotos } from "@/server/services/photo-retention";
import { getSettingsDto, updateAttendancePolicy } from "@/server/services/settings";
import { isoToDate } from "@/server/json";
import { resetDb, seedFixtures, type Fixtures } from "../helpers/db";

let fx: Fixtures;
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };

const policy = (over: Record<string, unknown> = {}) => ({
  lateMinutesAfterTolerance: false, locationEnabled: false, locationName: null, locationLat: null, locationLng: null, locationRadiusMeters: 100,
  locationMaxAccuracyMeters: 150, requestBackdateDays: 365, annualLeaveQuota: 12, allowNegativeLeaveBalance: false,
  attendancePhotoMode: "REQUIRED", attendancePhotoRequireLocation: true, ...over,
});
/** Waktu WIB (UTC+7) tanggal tertentu; `hms` boleh berdetik untuk uji batas. */
const at = (date: string, hms = "08:00:00") => new Date(`${date}T${hms.length === 5 ? `${hms}:00` : hms}+07:00`);
const NOW = new Date("2026-11-01T03:00:00Z"); // batas 6 bulan = 2026-05-01T03:00:00Z
let jpegBuf: Buffer;
const loc = () => ({ lat: -7.7956, lng: 110.3695, accuracy: 12, timestamp: Date.now() - 1000, clientNow: Date.now() });
const ctx = () => ({ ip: null, deviceToken: null, photo: jpegBuf });
const [A, B, C] = ["emp1", "emp2", "emp3"] as const;
const punchIn = (who: (typeof A | typeof B | typeof C), date: string, hms = "08:00:00") => checkIn(fx[who], { location: loc() }, at(date, hms), ctx());
const punchOut = (who: (typeof A | typeof B | typeof C), date: string, hms = "17:00:00") => checkOut(fx[who], { location: loc() }, at(date, hms), ctx());
const photos = () => prisma.attendancePhoto.findMany({ orderBy: { capturedAt: "asc" } });
const files = () => prisma.storedFile.count({ where: { kind: "ATTENDANCE_PHOTO" } });
const purgeAudits = () => prisma.auditLog.findMany({ where: { action: "attendance_photo.purge" }, orderBy: { id: "asc" } });
const setMonths = (m: number) => updateAttendancePolicy(fx.superAdmin, policy({ attendancePhotoRetentionMonths: m }));

beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
  await updateAttendancePolicy(fx.superAdmin, policy());
  jpegBuf = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 200, g: 210, b: 220 } } }).jpeg().toBuffer();
});

describe("pengaturan masa simpan", () => {
  it("bawaan 6 bulan; Super Admin dapat mengubah; nilai tak sah ditolak; HR tidak boleh", async () => {
    expect((await getSettingsDto(fx.superAdmin)).attendance.photoRetentionMonths).toBe(6);
    await setMonths(3);
    expect((await getSettingsDto(fx.superAdmin)).attendance.photoRetentionMonths).toBe(3);
    await setMonths(0);
    expect((await getSettingsDto(fx.superAdmin)).attendance.photoRetentionMonths).toBe(0);
    for (const bad of [-1, 121, 2.5, "6"]) {
      const e = await fail(updateAttendancePolicy(fx.superAdmin, policy({ attendancePhotoRetentionMonths: bad })));
      expect(e?.code, String(bad)).toBe("VALIDATION");
      expect(e?.fieldErrors?.attendancePhotoRetentionMonths, String(bad)).toBeTruthy();
    }
    expect((await fail(updateAttendancePolicy(fx.hr, policy({ attendancePhotoRetentionMonths: 1 }))))?.code).toBe("FORBIDDEN");
    // Tanpa mengirim bidang ini, nilai tersimpan tidak berubah (pemanggil lama tetap valid).
    await setMonths(9);
    await updateAttendancePolicy(fx.superAdmin, policy());
    expect((await getSettingsDto(fx.superAdmin)).attendance.photoRetentionMonths).toBe(9);
  });

  it("basis data menolak masa simpan di luar 0–120 walau service dilewati", async () => {
    await expect(prisma.$executeRaw`UPDATE company_settings SET "attendancePhotoRetentionMonths" = 121`).rejects.toThrow(/check constraint|company_settings_photo_retention/i);
    await expect(prisma.$executeRaw`UPDATE company_settings SET "attendancePhotoRetentionMonths" = -1`).rejects.toThrow(/check constraint|company_settings_photo_retention/i);
  });
});

describe("penghapusan foto kedaluwarsa", () => {
  it("foto lebih tua dari 6 bulan dihapus; yang lebih muda tetap; absensi tidak tersentuh; jejak teks cap tetap", async () => {
    await punchIn(A, "2026-02-02"); await punchOut(A, "2026-02-02");
    await punchIn(A, "2026-10-26"); await punchOut(A, "2026-10-26");
    expect(await files()).toBe(4);
    const before = await photos();

    const r = await purgeExpiredPhotos({ now: NOW });
    expect(r).toMatchObject({ enabled: true, months: 6, purged: 2, held: 0, batches: 1 });
    expect(r.cutoff).toBe("2026-05-01T03:00:00.000Z");
    expect(await files()).toBe(2);

    const after = await photos();
    const [oldIn, oldOut, newIn, newOut] = after;
    for (const p of [oldIn!, oldOut!]) {
      expect(p.fileId).toBeNull();
      expect(p.purgedAt?.toISOString()).toBe(NOW.toISOString());
    }
    for (const p of [newIn!, newOut!]) { expect(p.fileId).not.toBeNull(); expect(p.purgedAt).toBeNull(); }
    // Jejak teks cap, koordinat, waktu, jenis, dan pemilik tidak berubah sedikit pun.
    for (const [i, p] of [oldIn!, oldOut!].entries()) {
      expect([p.stamp, p.lat, p.lng, p.accuracy, p.kind, p.employeeId, p.capturedAt.toISOString()])
        .toEqual([before[i]!.stamp, before[i]!.lat, before[i]!.lng, before[i]!.accuracy, before[i]!.kind, before[i]!.employeeId, before[i]!.capturedAt.toISOString()]);
    }
    expect(oldIn!.stamp.split("\n")[0]).toBe("02/02/2026 08:00:00 WIB");
    // Data absensi (jam masuk/pulang) tidak terpengaruh.
    const att = await prisma.attendance.findUniqueOrThrow({ where: { employeeId_date: { employeeId: fx.empIds[0], date: isoToDate("2026-02-02") } } });
    expect([att.checkInAt.toISOString(), att.checkOutAt?.toISOString()]).toEqual([at("2026-02-02").toISOString(), at("2026-02-02", "17:00:00").toISOString()]);
  });

  it("batas tepat: foto pada detik yang sama dengan batas DIPERTAHANKAN; satu detik lebih awal dihapus", async () => {
    await punchIn(A, "2026-05-01", "10:00:00"); // = 03:00:00Z = batas
    await punchIn(B, "2026-05-01", "09:59:59"); // 1 detik sebelum batas
    const r = await purgeExpiredPhotos({ now: NOW });
    expect(r.purged).toBe(1);
    const [early, onCutoff] = await photos();
    expect([early!.employeeId, early!.purgedAt !== null]).toEqual([fx.empIds[1], true]);
    expect([onCutoff!.employeeId, onCutoff!.purgedAt]).toEqual([fx.empIds[0], null]);
  });

  it("setiap penghapusan masuk audit log (pelaku: sistem) dengan jumlah, masa simpan, batas, dan rentang waktu; tanpa penghapusan → tanpa audit", async () => {
    expect((await purgeExpiredPhotos({ now: NOW })).purged).toBe(0);
    expect(await purgeAudits()).toHaveLength(0);
    await punchIn(A, "2026-01-05"); await punchIn(B, "2026-02-09");
    await purgeExpiredPhotos({ now: NOW });
    const [a] = await purgeAudits();
    expect(a).toMatchObject({ actorId: null, entityType: "AttendancePhoto" });
    expect(a!.summary).toContain("2 foto lebih tua dari 6 bulan dihapus");
    expect(a!.after).toMatchObject({ count: 2, months: 6, cutoff: "2026-05-01T03:00:00.000Z", oldest: at("2026-01-05").toISOString(), newest: at("2026-02-09").toISOString() });
    // Dijalankan lagi: idempoten, tidak ada audit tambahan.
    expect((await purgeExpiredPhotos({ now: NOW })).purged).toBe(0);
    expect(await purgeAudits()).toHaveLength(1);
  });

  it("masa simpan mengikuti pengaturan: 0 = tidak menghapus apa pun; diperpendek = menghapus lebih banyak; diperpanjang = menahan", async () => {
    await punchIn(A, "2026-02-02"); // 9 bulan lalu
    await punchIn(B, "2026-08-03"); // 3 bulan lalu
    await setMonths(0);
    expect(await purgeExpiredPhotos({ now: NOW })).toMatchObject({ enabled: false, purged: 0, cutoff: null });
    expect(await files()).toBe(2);
    await setMonths(12);
    expect((await purgeExpiredPhotos({ now: NOW })).purged).toBe(0);
    await setMonths(6);
    expect((await purgeExpiredPhotos({ now: NOW })).purged).toBe(1);
    await setMonths(2);
    expect((await purgeExpiredPhotos({ now: NOW })).purged).toBe(1);
    expect(await files()).toBe(0);
  });
});

describe("pengecualian: foto yang sedang ditinjau atau terkonfirmasi", () => {
  /** Catatan tinjauan lokasi untuk punch tertentu (menyerupai punch yang ditandai). */
  async function review(who: 0 | 1 | 2, kind: "CHECK_IN" | "CHECK_OUT", status: "OPEN" | "CLEARED" | "CONFIRMED", date: string) {
    const att = await prisma.attendance.findFirstOrThrow({ where: { employeeId: fx.empIds[who], date: isoToDate(date) } });
    await prisma.locationCheck.create({
      data: {
        employeeId: fx.empIds[who], attendanceId: att.id, kind, date: isoToDate(date), decision: "FLAGGED", riskScore: 60, flags: ["EXACT_CENTER"], reviewStatus: status,
        ...(status === "OPEN" ? {} : { reviewedById: fx.hr.userId, reviewedAt: new Date(), reviewNote: "Sudah diperiksa HR" }),
      },
    });
  }

  it("OPEN dan CONFIRMED ditahan; CLEARED (alarm palsu) dihapus; dihitung pada hasil sebagai 'held'", async () => {
    for (const w of [A, B, C]) await punchIn(w, "2026-01-12");
    await review(0, "CHECK_IN", "OPEN", "2026-01-12");
    await review(1, "CHECK_IN", "CONFIRMED", "2026-01-12");
    await review(2, "CHECK_IN", "CLEARED", "2026-01-12");
    const r = await purgeExpiredPhotos({ now: NOW });
    expect(r).toMatchObject({ purged: 1, held: 2 });
    const rows = await photos();
    expect(rows.map((p) => [p.employeeId, p.purgedAt !== null])).toEqual(
      expect.arrayContaining([[fx.empIds[0], false], [fx.empIds[1], false], [fx.empIds[2], true]]),
    );
    expect(await files()).toBe(2);
  });

  it("pengecualian per punch: tinjauan check-in tidak menahan foto check-out hari yang sama", async () => {
    await punchIn(A, "2026-01-12"); await punchOut(A, "2026-01-12");
    await review(0, "CHECK_IN", "OPEN", "2026-01-12");
    expect((await purgeExpiredPhotos({ now: NOW })).purged).toBe(1);
    const rows = await photos();
    expect(rows.map((p) => [p.kind, p.purgedAt !== null])).toEqual([["CHECK_IN", false], ["CHECK_OUT", true]]);
  });

  it("begitu tinjauan selesai (CLEARED), foto yang tadinya ditahan ikut dihapus pada pengecekan berikutnya", async () => {
    await punchIn(A, "2026-01-12");
    await review(0, "CHECK_IN", "OPEN", "2026-01-12");
    expect((await purgeExpiredPhotos({ now: NOW })).held).toBe(1);
    await prisma.locationCheck.updateMany({ data: { reviewStatus: "CLEARED", reviewedById: fx.hr.userId, reviewedAt: new Date(), reviewNote: "Wajar, dinas luar" } });
    expect(await purgeExpiredPhotos({ now: NOW })).toMatchObject({ purged: 1, held: 0 });
  });
});

describe("keamanan & ketahanan penghapusan", () => {
  it("batch: 5 foto dengan ukuran batch 2 → 3 transaksi, 3 audit (2+2+1), semuanya terhapus", async () => {
    for (const [i, w] of [A, B, C].entries()) await punchIn(w, "2026-01-12", `${String(8 + i).padStart(2, "0")}:00:00`);
    await punchOut(A, "2026-01-12"); await punchOut(B, "2026-01-12");
    const r = await purgeExpiredPhotos({ now: NOW, batchSize: 2 });
    expect(r).toMatchObject({ purged: 5, batches: 3 });
    expect((await purgeAudits()).map((a) => (a.after as { count: number }).count)).toEqual([2, 2, 1]);
    expect(await files()).toBe(0);
  });

  it("tiga pekerja serentak (beberapa instance): tiap foto dihapus TEPAT sekali; jumlah audit = jumlah foto; tidak ada galat", async () => {
    for (const w of [A, B, C]) { await punchIn(w, "2026-01-12"); await punchOut(w, "2026-01-12"); }
    const rs = await Promise.all([1, 2, 3].map(() => purgeExpiredPhotos({ now: NOW, batchSize: 2 })));
    expect(rs.reduce((a, r) => a + r.purged, 0)).toBe(6);
    expect((await purgeAudits()).reduce((a, x) => a + (x.after as { count: number }).count, 0)).toBe(6);
    expect((await photos()).every((p) => p.fileId === null && p.purgedAt !== null)).toBe(true);
    expect(await files()).toBe(0);
  });

  it("berkas jenis lain (lampiran cuti, foto karyawan, logo) TIDAK pernah tersentuh walau sangat lama", async () => {
    const old = new Date("2020-01-01T00:00:00Z");
    for (const kind of ["LEAVE_ATTACHMENT", "EMPLOYEE_PHOTO", "LOGO"] as const) {
      await prisma.storedFile.create({ data: { kind, originalName: "x.png", mimeType: "image/png", size: 4, sha256: "0".repeat(64), data: Buffer.from([1, 2, 3, 4]), uploadedById: fx.hr.userId, createdAt: old } });
    }
    await punchIn(A, "2026-01-12");
    await purgeExpiredPhotos({ now: NOW });
    expect(await prisma.storedFile.count()).toBe(3);
  });

  it("basis data: jejak yang sudah dihapus tidak dapat diubah, dipulihkan, atau dihapus; baris hidup tidak dapat 'dihapus berkasnya' tanpa penanda", async () => {
    await punchIn(A, "2026-01-12"); await punchIn(B, "2026-10-20");
    await purgeExpiredPhotos({ now: NOW });
    const [gone, live] = await photos();
    await expect(prisma.$executeRaw`UPDATE attendance_photos SET stamp = 'palsu' WHERE id = ${gone!.id}::uuid`).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.$executeRaw`UPDATE attendance_photos SET "purgedAt" = NULL WHERE id = ${gone!.id}::uuid`).rejects.toThrow(/purge_state|check constraint|HRIS-GUARD/i);
    await expect(prisma.$executeRaw`UPDATE attendance_photos SET "purgedAt" = now() WHERE id = ${gone!.id}::uuid`).rejects.toThrow(/HRIS-GUARD/); // tidak boleh ganti waktu
    await expect(prisma.$executeRaw`UPDATE attendance_photos SET "fileId" = ${live!.fileId}::uuid WHERE id = ${gone!.id}::uuid`).rejects.toThrow();
    await expect(prisma.$executeRaw`DELETE FROM attendance_photos WHERE id = ${gone!.id}::uuid`).rejects.toThrow(/HRIS-GUARD/);
    // Baris hidup: mengosongkan fileId tanpa purgedAt melanggar konstruksi (berkas hilang tanpa catatan).
    await expect(prisma.$executeRaw`UPDATE attendance_photos SET "fileId" = NULL WHERE id = ${live!.id}::uuid`).rejects.toThrow(/purge_state|check constraint/i);
    // Teks cap baris hidup tetap tidak bisa diubah.
    await expect(prisma.$executeRaw`UPDATE attendance_photos SET stamp = 'palsu' WHERE id = ${live!.id}::uuid`).rejects.toThrow(/HRIS-GUARD/);
  });
});

describe("tampilan setelah foto dihapus", () => {
  it("berkas tidak dapat dibuka lagi (404); rincian rekap menampilkan jejak (waktu, koordinat) tanpa tautan foto; antrean tinjauan tanpa foto", async () => {
    await punchIn(A, "2026-01-12");
    const p = (await photos())[0]!;
    const fileId = p.fileId!;
    expect((await readFileForActor(fx.hr, fileId)).id).toBe(fileId);
    await purgeExpiredPhotos({ now: NOW });
    expect((await fail(readFileForActor(fx.hr, fileId)))?.code).toBe("NOT_FOUND");
    expect((await fail(readFileForActor(fx.emp1, fileId)))?.code).toBe("NOT_FOUND");

    const d = await getRecapDetail(fx.hr, fx.empIds[0], { view: "kustom", from: "2026-01-12", to: "2026-01-12" });
    const shown = d.photos["2026-01-12"]![0]!;
    expect(shown.url).toBeNull();
    expect(shown.purgedAt).toBe(NOW.toISOString());
    expect(shown.stamp).toBe(p.stamp);
    expect(shown.mapUrl).toContain("mlat=-7.7956");
    expect(shown.kind).toBe("CHECK_IN");
    // Pemilik pun melihat jejak yang sama.
    expect((await getRecapDetail(fx.emp1, fx.empIds[0], { view: "kustom", from: "2026-01-12", to: "2026-01-12" })).photos["2026-01-12"]![0]!.url).toBeNull();
  });

  it("antrean Tinjauan Lokasi: punch ber-foto yang fotonya sudah dihapus → photoUrl null (bukan tautan rusak)", async () => {
    await punchIn(A, "2026-01-12");
    const att = await prisma.attendance.findFirstOrThrow();
    await prisma.locationCheck.create({ data: { employeeId: fx.empIds[0], attendanceId: att.id, kind: "CHECK_IN", date: isoToDate("2026-01-12"), decision: "FLAGGED", riskScore: 60, flags: ["EXACT_CENTER"], reviewStatus: "OPEN" } });
    expect((await listLocationChecks(fx.hr, { status: "ALL" })).items[0]!.photoUrl).toMatch(/^\/api\/files\//);
    await prisma.locationCheck.updateMany({ data: { reviewStatus: "CLEARED", reviewedById: fx.hr.userId, reviewedAt: new Date(), reviewNote: "Wajar, dinas luar" } });
    await purgeExpiredPhotos({ now: NOW });
    expect((await listLocationChecks(fx.hr, { status: "ALL" })).items[0]!.photoUrl).toBeNull();
  });

  it("HR menghapus catatan absensi yang fotonya sudah dihapus: tetap berhasil (jejak dilepas, tidak hilang)", async () => {
    await punchIn(A, "2026-01-12");
    await purgeExpiredPhotos({ now: NOW });
    await correctAttendance(fx.hr, { employeeId: fx.empIds[0], date: "2026-01-12", action: "remove", reason: "Check-in salah tanggal" });
    const [p] = await photos();
    expect([p!.attendanceId, p!.fileId, p!.purgedAt !== null]).toEqual([null, null, true]);
    expect(p!.stamp).toContain("MASUK");
  });

  it("foto baru setelah retensi tetap berfungsi normal (tombstone tidak mengganggu absen berikutnya)", async () => {
    await punchIn(A, "2026-01-12");
    await purgeExpiredPhotos({ now: NOW });
    await punchIn(A, "2026-10-27");
    const rows = await photos();
    expect(rows.map((p) => p.purgedAt !== null)).toEqual([true, false]);
    expect(await files()).toBe(1);
  });
});
