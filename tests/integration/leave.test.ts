import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { cancelLeave, getBalance, getLedger, grantAnnualQuota, listMyLeaves, reviewLeave, setBalance, submitLeave } from "@/server/services/leave";
import { getRecap } from "@/server/services/recap";
import { updateAttendancePolicy } from "@/server/services/settings";
import { addCalendarDay } from "@/server/services/schedules";
import { listNotifications } from "@/server/services/notifications";
import { storeFile } from "@/server/services/files";
import { resetDb, seedFixtures, type Fixtures } from "../helpers/db";

let fx: Fixtures;
beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
  // Pengujian di tahun 2026 dengan kebijakan longgar untuk tanggal lampau agar deterministik.
  await updateAttendancePolicy(fx.superAdmin, {
    lateMinutesAfterTolerance: false, locationEnabled: false, locationName: null, locationLat: null, locationLng: null, locationRadiusMeters: 100,
    locationMaxAccuracyMeters: 150, requestBackdateDays: 365, annualLeaveQuota: 12, allowNegativeLeaveBalance: false,
  });
});

const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const FUTURE = { start: "2027-03-01", end: "2027-03-05" }; // Sen–Jum

describe("pengajuan", () => {
  it("menghitung hanya hari kerja terjadwal (akhir pekan & libur tidak dihitung)", async () => {
    await addCalendarDay(fx.hr, { date: "2027-03-03", kind: "HOLIDAY", name: "Libur uji" });
    // Jum 26 Feb 2027 s.d. Sel 2 Mar 2027 → Jum, (Sab, Min), Sen, Sel = 3 hari kerja
    const r = await submitLeave(fx.emp1, { type: "IZIN", startDate: "2027-02-26", endDate: "2027-03-02", reason: "Urusan keluarga" });
    expect(r.status).toBe("PENDING");
    expect(r.workingDays).toBe(3);
    // Rentang yang memuat hari libur: 1–5 Mar → 4 hari kerja
    const r2 = await submitLeave(fx.emp2, { type: "SAKIT", startDate: FUTURE.start, endDate: FUTURE.end, reason: "Demam tinggi" });
    expect(r2.workingDays).toBe(4);
  });

  it("rentang hanya akhir pekan ditolak", async () => {
    const e = await fail(submitLeave(fx.emp1, { type: "IZIN", startDate: "2027-03-06", endDate: "2027-03-07", reason: "Akhir pekan" }));
    expect(e?.message).toMatch(/hari kerja/);
  });

  it("validasi: alasan wajib, tanggal terbalik, rentang > 90 hari, tanggal terlalu lampau", async () => {
    expect((await fail(submitLeave(fx.emp1, { type: "IZIN", startDate: FUTURE.start, endDate: FUTURE.end, reason: "" })))?.code).toBe("VALIDATION");
    expect((await fail(submitLeave(fx.emp1, { type: "IZIN", startDate: FUTURE.end, endDate: FUTURE.start, reason: "Terbalik" })))?.fieldErrors?.endDate).toBeTruthy();
    expect((await fail(submitLeave(fx.emp1, { type: "CUTI", startDate: "2027-03-01", endDate: "2027-09-01", reason: "Terlalu panjang" })))?.fieldErrors?.endDate).toMatch(/90/);
    await updateAttendancePolicy(fx.superAdmin, { lateMinutesAfterTolerance: false, locationEnabled: false, locationName: null, locationLat: null, locationLng: null, locationRadiusMeters: 100, locationMaxAccuracyMeters: 150, requestBackdateDays: 7, annualLeaveQuota: 12, allowNegativeLeaveBalance: false });
    expect((await fail(submitLeave(fx.emp1, { type: "SAKIT", startDate: "2026-01-05", endDate: "2026-01-06", reason: "Sakit lampau" })))?.fieldErrors?.startDate).toBeTruthy();
  });

  it("pengajuan yang bertabrakan (menunggu/disetujui) ditolak; yang ditolak/dibatalkan tidak menghalangi", async () => {
    const a = await submitLeave(fx.emp1, { type: "IZIN", startDate: FUTURE.start, endDate: "2027-03-02", reason: "Pertama" });
    const dup = await fail(submitLeave(fx.emp1, { type: "SAKIT", startDate: "2027-03-02", endDate: "2027-03-04", reason: "Beririsan" }));
    expect(dup?.code).toBe("CONFLICT");
    await reviewLeave(fx.hr, a.id, { decision: "REJECT", note: "Dokumen belum lengkap" });
    expect(await fail(submitLeave(fx.emp1, { type: "SAKIT", startDate: "2027-03-02", endDate: "2027-03-04", reason: "Sekarang boleh" }))).toBeNull();
  });

  it("pengajuan serentak pada tanggal yang sama → hanya satu lolos", async () => {
    const r = await Promise.allSettled(Array.from({ length: 4 }, () => submitLeave(fx.emp3, { type: "IZIN", startDate: FUTURE.start, endDate: FUTURE.end, reason: "Serentak" })));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.leaveRequest.count({ where: { employeeId: fx.empIds[2] } })).toBe(1);
  });

  it("lampiran: hanya berkas milik sendiri bertipe lampiran; tipe berkas dicek dari isi", async () => {
    const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
    const f = await storeFile(fx.emp1, "LEAVE_ATTACHMENT", { name: "surat dokter.pdf", bytes: pdf });
    const ok = await submitLeave(fx.emp1, { type: "SAKIT", startDate: FUTURE.start, endDate: FUTURE.start, reason: "Surat dokter", attachmentFileId: f.id });
    expect(ok.attachmentUrl).toBe(`/api/files/${f.id}`);
    const other = await fail(submitLeave(fx.emp2, { type: "SAKIT", startDate: FUTURE.start, endDate: FUTURE.start, reason: "Pakai lampiran orang lain", attachmentFileId: f.id }));
    expect(other?.code).toBe("VALIDATION");
    expect((await fail(storeFile(fx.emp1, "LEAVE_ATTACHMENT", { name: "x.pdf", bytes: new TextEncoder().encode("<script>alert(1)</script>") })))?.code).toBe("VALIDATION");
  });

  it("karyawan melihat hanya pengajuan miliknya", async () => {
    await submitLeave(fx.emp1, { type: "IZIN", startDate: FUTURE.start, endDate: FUTURE.start, reason: "Milik Ayu" });
    await submitLeave(fx.emp2, { type: "IZIN", startDate: FUTURE.start, endDate: FUTURE.start, reason: "Milik Budi" });
    const mine = await listMyLeaves(fx.emp1);
    expect(mine).toHaveLength(1);
    expect(mine[0]!.reason).toBe("Milik Ayu");
  });
});

describe("persetujuan & rekap", () => {
  it("disetujui → memengaruhi rekap sesuai tanggal; menunggu/ditolak tidak", async () => {
    const r = await submitLeave(fx.emp1, { type: "SAKIT", startDate: "2027-03-01", endDate: "2027-03-03", reason: "Rawat jalan" });
    const rekap = async () => (await getRecap(fx.hr, { view: "kustom", from: "2027-03-01", to: "2027-03-05", employeeId: fx.empIds[0] })).page.items[0]!.totals;
    expect((await rekap()).sakitDays).toBe(0);
    await reviewLeave(fx.hr, r.id, { decision: "APPROVE", note: "Cepat sembuh" });
    expect((await rekap()).sakitDays).toBe(3);
    // Dibatalkan HR → rekap kembali
    await cancelLeave(fx.hr, r.id, { reason: "Ternyata masuk kerja" });
    expect((await rekap()).sakitDays).toBe(0);
  });

  it("menolak wajib disertai catatan; keputusan tersimpan beserta pemutus & waktu", async () => {
    const r = await submitLeave(fx.emp1, { type: "IZIN", startDate: FUTURE.start, endDate: FUTURE.start, reason: "Keperluan" });
    expect((await fail(reviewLeave(fx.hr, r.id, { decision: "REJECT", note: "" })))?.code).toBe("VALIDATION");
    const done = await reviewLeave(fx.hr, r.id, { decision: "REJECT", note: "Bentrok dengan acara kantor" });
    expect(done.status).toBe("REJECTED");
    expect(done.reviewedBy).toBe("HR Uji");
    expect(done.reviewNote).toBe("Bentrok dengan acara kantor");
    expect((await fail(reviewLeave(fx.hr, r.id, { decision: "APPROVE" })))?.code).toBe("CONFLICT");
  });

  it("dua penyetuju bersamaan → hanya satu yang berhasil, saldo hanya dipotong sekali", async () => {
    await setBalance(fx.hr, { employeeId: fx.empIds[0], year: 2027, targetDays: 12, note: "Saldo awal uji" });
    const r = await submitLeave(fx.emp1, { type: "CUTI", startDate: FUTURE.start, endDate: FUTURE.end, reason: "Liburan" });
    const res = await Promise.allSettled([reviewLeave(fx.hr, r.id, { decision: "APPROVE" }), reviewLeave(fx.superAdmin, r.id, { decision: "APPROVE" }), reviewLeave(fx.hr, r.id, { decision: "APPROVE" })]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await getBalance(fx.hr, fx.empIds[0], 2027)).balance).toBe(12 - 5);
    expect(await prisma.leaveBalanceEntry.count({ where: { kind: "USAGE" } })).toBe(1);
  });

  it("tidak boleh memproses pengajuan sendiri (kecuali Super Admin); karyawan tidak bisa menyetujui", async () => {
    // HR yang juga karyawan
    const hrEmp = await prisma.employee.create({ data: { employeeNo: "TE-900", fullName: "HR Uji", position: "HR", employmentStatus: "PERMANENT", joinDate: new Date("2025-01-01T00:00:00Z"), userId: fx.hr.userId } });
    const hrSelf = { ...fx.hr, employeeId: hrEmp.id };
    const mine = await submitLeave(hrSelf, { type: "IZIN", startDate: FUTURE.start, endDate: FUTURE.start, reason: "Keperluan HR" });
    expect((await fail(reviewLeave(hrSelf, mine.id, { decision: "APPROVE" })))?.code).toBe("FORBIDDEN");
    expect((await reviewLeave(fx.superAdmin, mine.id, { decision: "APPROVE" })).status).toBe("APPROVED");
    const other = await submitLeave(fx.emp2, { type: "IZIN", startDate: "2027-04-05", endDate: "2027-04-05", reason: "Izin pribadi" });
    expect((await fail(reviewLeave(fx.emp1, other.id, { decision: "APPROVE" })))?.code).toBe("FORBIDDEN");
  });

  it("notifikasi: HR menerima pengajuan baru, karyawan menerima keputusan", async () => {
    const r = await submitLeave(fx.emp1, { type: "IZIN", startDate: FUTURE.start, endDate: FUTURE.start, reason: "Keperluan" });
    expect((await listNotifications(fx.hr)).items.some((n) => n.type === "leave.submitted")).toBe(true);
    expect((await listNotifications(fx.emp2)).items).toHaveLength(0);
    await reviewLeave(fx.hr, r.id, { decision: "APPROVE" });
    const n = await listNotifications(fx.emp1);
    expect(n.items[0]!.type).toBe("leave.reviewed");
    expect(n.unread).toBe(1);
  });

  it("karyawan hanya bisa membatalkan pengajuan MENUNGGU miliknya; yang disetujui hanya oleh HR dengan alasan", async () => {
    const r = await submitLeave(fx.emp1, { type: "IZIN", startDate: FUTURE.start, endDate: FUTURE.start, reason: "Keperluan" });
    expect((await fail(cancelLeave(fx.emp2, r.id, {})))?.code).toBe("FORBIDDEN");
    await reviewLeave(fx.hr, r.id, { decision: "APPROVE" });
    expect((await fail(cancelLeave(fx.emp1, r.id, { reason: "Batal" })))?.code).toBe("FORBIDDEN");
    expect((await fail(cancelLeave(fx.hr, r.id, {})))?.fieldErrors?.reason).toBeTruthy();
    expect((await cancelLeave(fx.hr, r.id, { reason: "Diminta atasan" })).status).toBe("CANCELLED");
    const p = await submitLeave(fx.emp1, { type: "IZIN", startDate: "2027-05-03", endDate: "2027-05-03", reason: "Keperluan lain" });
    expect((await cancelLeave(fx.emp1, p.id, {})).status).toBe("CANCELLED");
  });
});

describe("saldo cuti", () => {
  it("cuti melebihi saldo ditolak; menunggu persetujuan mencadangkan saldo", async () => {
    await setBalance(fx.hr, { employeeId: fx.empIds[0], year: 2027, targetDays: 6, note: "Saldo awal" });
    const first = await submitLeave(fx.emp1, { type: "CUTI", startDate: "2027-03-01", endDate: "2027-03-05", reason: "Liburan" }); // 5 hari
    const b = await getBalance(fx.emp1, fx.empIds[0], 2027);
    expect(b).toMatchObject({ balance: 6, reserved: 5, available: 1 });
    const e = await fail(submitLeave(fx.emp1, { type: "CUTI", startDate: "2027-04-05", endDate: "2027-04-06", reason: "Tambahan" }));
    expect(e?.message).toMatch(/Saldo cuti 2027 tidak cukup/);
    await cancelLeave(fx.emp1, first.id, {});
    expect(await fail(submitLeave(fx.emp1, { type: "CUTI", startDate: "2027-04-05", endDate: "2027-04-06", reason: "Tambahan" }))).toBeNull();
  });

  it("izin & sakit tidak memotong saldo cuti", async () => {
    await setBalance(fx.hr, { employeeId: fx.empIds[0], year: 2027, targetDays: 12, note: "Saldo awal" });
    const a = await submitLeave(fx.emp1, { type: "SAKIT", startDate: FUTURE.start, endDate: FUTURE.end, reason: "Sakit" });
    await reviewLeave(fx.hr, a.id, { decision: "APPROVE" });
    expect((await getBalance(fx.hr, fx.empIds[0], 2027)).balance).toBe(12);
  });

  it("persetujuan memotong (USAGE), pembatalan mengembalikan (RESTORE), riwayat tercatat", async () => {
    await setBalance(fx.hr, { employeeId: fx.empIds[1], year: 2027, targetDays: 12, note: "Saldo awal" });
    const r = await submitLeave(fx.emp2, { type: "CUTI", startDate: FUTURE.start, endDate: FUTURE.end, reason: "Cuti tahunan" });
    await reviewLeave(fx.hr, r.id, { decision: "APPROVE" });
    expect((await getBalance(fx.emp2, fx.empIds[1], 2027)).balance).toBe(7);
    await cancelLeave(fx.hr, r.id, { reason: "Proyek mendesak" });
    expect((await getBalance(fx.emp2, fx.empIds[1], 2027)).balance).toBe(12);
    const ledger = await getLedger(fx.emp2, fx.empIds[1], 2027);
    expect(ledger.map((l) => l.kind).sort()).toEqual(["GRANT", "RESTORE", "USAGE"]);
    expect(ledger.find((l) => l.kind === "USAGE")!.days).toBe(-5);
    // Pembatalan dua kali tidak menggandakan pengembalian
    expect((await fail(cancelLeave(fx.hr, r.id, { reason: "Ulang" })))?.code).toBe("CONFLICT");
    expect(await prisma.leaveBalanceEntry.count({ where: { kind: "RESTORE" } })).toBe(1);
  });

  it("cuti lintas tahun dipotong per tahun", async () => {
    await setBalance(fx.hr, { employeeId: fx.empIds[2], year: 2026, targetDays: 5, note: "Saldo 2026" });
    await setBalance(fx.hr, { employeeId: fx.empIds[2], year: 2027, targetDays: 5, note: "Saldo 2027" });
    // 30 Des 2026 (Rab) – 4 Jan 2027 (Sen) = 4 hari kerja (30, 31 Des; 1 Jan?; 4 Jan) → 1 Jan Jumat kerja juga; 2026: 2, 2027: 2
    const r = await submitLeave(fx.emp3, { type: "CUTI", startDate: "2026-12-30", endDate: "2027-01-04", reason: "Akhir tahun" });
    await reviewLeave(fx.hr, r.id, { decision: "APPROVE" });
    expect((await getBalance(fx.hr, fx.empIds[2], 2026)).balance).toBe(5 - 2);
    expect((await getBalance(fx.hr, fx.empIds[2], 2027)).balance).toBe(5 - 2);
  });

  it("cuti lintas tahun yang MENUNGGU dicadangkan per tahun (2 hari 2026 + 2 hari 2027), bukan seluruhnya di tahun mulai", async () => {
    await setBalance(fx.hr, { employeeId: fx.empIds[2], year: 2026, targetDays: 5, note: "Saldo 2026" });
    await setBalance(fx.hr, { employeeId: fx.empIds[2], year: 2027, targetDays: 5, note: "Saldo 2027" });
    const r = await submitLeave(fx.emp3, { type: "CUTI", startDate: "2026-12-30", endDate: "2027-01-04", reason: "Akhir tahun" }); // 30, 31 Des | 1, 4 Jan
    expect(r.workingDays).toBe(4);
    expect(await getBalance(fx.emp3, fx.empIds[2], 2026)).toMatchObject({ balance: 5, reserved: 2, available: 3 });
    expect(await getBalance(fx.emp3, fx.empIds[2], 2027)).toMatchObject({ balance: 5, reserved: 2, available: 3 });
    expect((await getBalance(fx.emp3, fx.empIds[2], 2028)).reserved).toBe(0);
    // sesudah disetujui, cadangan berpindah menjadi pemotongan per tahun yang sama
    await reviewLeave(fx.hr, r.id, { decision: "APPROVE" });
    expect(await getBalance(fx.emp3, fx.empIds[2], 2026)).toMatchObject({ balance: 3, reserved: 0, available: 3 });
    expect(await getBalance(fx.emp3, fx.empIds[2], 2027)).toMatchObject({ balance: 3, reserved: 0, available: 3 });
  });

  it("cadangan per tahun menentukan pengajuan lain: tahun 2027 tidak lolos melewati saldo, tahun 2026 tidak ditolak keliru", async () => {
    await setBalance(fx.hr, { employeeId: fx.empIds[2], year: 2026, targetDays: 5, note: "Saldo 2026" });
    await setBalance(fx.hr, { employeeId: fx.empIds[2], year: 2027, targetDays: 3, note: "Saldo 2027" });
    await submitLeave(fx.emp3, { type: "CUTI", startDate: "2026-12-30", endDate: "2027-01-04", reason: "Akhir tahun" }); // cadangan: 2026 = 2, 2027 = 2
    // 2027: tersedia 3 − 2 = 1, diminta 2 (11–12 Jan) → ditolak saat diajukan (dulu lolos karena cadangan 2027 dianggap 0, lalu gagal saat persetujuan)
    const over = await fail(submitLeave(fx.emp3, { type: "CUTI", startDate: "2027-01-11", endDate: "2027-01-12", reason: "Tambahan Januari" }));
    expect(over?.message).toMatch(/Saldo cuti 2027 tidak cukup: tersedia 1 hari/);
    // 2026: tersedia 5 − 2 = 3, diminta 3 (21–23 Des) → diterima (dulu ditolak keliru karena cadangan 2026 dianggap 4)
    expect(await fail(submitLeave(fx.emp3, { type: "CUTI", startDate: "2026-12-21", endDate: "2026-12-23", reason: "Sebelum akhir tahun" }))).toBeNull();
  });

  it("atur saldo: pertama GRANT, selanjutnya ADJUSTMENT selisih; catatan wajib; sama = ditolak", async () => {
    await setBalance(fx.hr, { employeeId: fx.empIds[0], year: 2027, targetDays: 10, note: "Saldo awal" });
    await setBalance(fx.hr, { employeeId: fx.empIds[0], year: 2027, targetDays: 8, note: "Koreksi 2 hari" });
    const kinds = (await getLedger(fx.hr, fx.empIds[0], 2027)).map((l) => `${l.kind}:${l.days}`).sort();
    expect(kinds).toEqual(["ADJUSTMENT:-2", "GRANT:10"]);
    expect((await fail(setBalance(fx.hr, { employeeId: fx.empIds[0], year: 2027, targetDays: 8, note: "Sama" })))?.code).toBe("VALIDATION");
    expect((await fail(setBalance(fx.hr, { employeeId: fx.empIds[0], year: 2027, targetDays: 9, note: "" })))?.code).toBe("VALIDATION");
    await expect(prisma.$executeRawUnsafe(`UPDATE leave_balance_entries SET days = 99`)).rejects.toThrow(/append-only/);
  });

  it("kuota tahunan: diterapkan sekali ke karyawan aktif tanpa saldo awal (idempoten)", async () => {
    await setBalance(fx.hr, { employeeId: fx.empIds[0], year: 2027, targetDays: 3, note: "Saldo khusus" });
    const r1 = await grantAnnualQuota(fx.hr, { year: 2027 });
    expect(r1).toMatchObject({ granted: 2, quota: 12 }); // emp1 sudah punya GRANT
    const r2 = await grantAnnualQuota(fx.hr, { year: 2027 });
    expect(r2.granted).toBe(0);
    expect((await getBalance(fx.hr, fx.empIds[0], 2027)).balance).toBe(3);
    expect((await getBalance(fx.hr, fx.empIds[1], 2027)).balance).toBe(12);
  });

  it("saldo negatif diizinkan hanya bila kebijakan mengizinkan", async () => {
    const policy = { lateMinutesAfterTolerance: false, locationEnabled: false, locationName: null, locationLat: null, locationLng: null, locationRadiusMeters: 100, locationMaxAccuracyMeters: 150, requestBackdateDays: 365, annualLeaveQuota: 12 };
    await setBalance(fx.hr, { employeeId: fx.empIds[0], year: 2027, targetDays: 1, note: "Saldo kecil" });
    await updateAttendancePolicy(fx.superAdmin, { ...policy, allowNegativeLeaveBalance: true });
    const r = await submitLeave(fx.emp1, { type: "CUTI", startDate: FUTURE.start, endDate: FUTURE.end, reason: "Boleh minus" });
    await reviewLeave(fx.hr, r.id, { decision: "APPROVE" });
    expect((await getBalance(fx.hr, fx.empIds[0], 2027)).balance).toBe(-4);
  });
});
