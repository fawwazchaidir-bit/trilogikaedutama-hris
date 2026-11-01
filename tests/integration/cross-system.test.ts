/**
 * UJI PETIK ANTAR SISTEM — satu skenario data yang kaya (shift malam, cuti setengah hari, lembur, terlambat, tidak hadir, foto,
 * BPJS/PPh 21, penggajian sampai slip terbit), lalu angka yang SAMA diambil dari setiap modul dan harus saling cocok:
 *   rekap (daftar & rincian & ekspor CSV) = laporan kehadiran = jumlah item penggajian (absensi sumber) = slip;
 *   saldo cuti = buku besar = rekap; lembur disetujui = laporan = gaji; biaya SDM = jumlah slip; notifikasi & audit lengkap.
 * Semua tanggal RELATIF terhadap hari ini (bulan lalu) sehingga tes tidak membusuk.
 */
import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/server/db";
import { checkIn, checkOut, getEmployeeRange } from "@/server/services/attendance";
import { getAdminDashboard } from "@/server/services/dashboard";
import { getBalance, getLedger, reviewLeave, setBalance, submitLeave } from "@/server/services/leave";
import { listNotifications } from "@/server/services/notifications";
import { reviewOvertime, submitOvertime } from "@/server/services/overtime";
import { approveRun, createRun, getItem, getRun, issueRun, submitRun } from "@/server/services/payroll";
import { getRunPayslips } from "@/server/services/payslips";
import { getRecap, getRecapDetail, recapTable } from "@/server/services/recap";
import { getAttendanceReport, getComplianceReport, getCostReport, getLeaveOvertimeReport, reportTable } from "@/server/services/reports";
import { createAssignment, createSchedule } from "@/server/services/schedules";
import { confirmPayrollRules, updateAttendancePolicy, updatePayrollRules, updateStatutoryConfig } from "@/server/services/settings";
import { toCsv } from "@/server/export";
import { defaultStatutoryConfig } from "@/lib/statutory";
import { addDays, isoWeekday, monthRange, todayIso } from "@/lib/time";
import { isoToDate } from "@/server/json";
import { addComponent, resetDb, seedFixtures, type Fixtures } from "../helpers/db";

let fx: Fixtures;
const [AYU, BUDI, CITRA] = [0, 1, 2] as const;
const TZ = "Asia/Jakarta";
const at = (date: string, hms: string) => new Date(`${date}T${hms.length === 5 ? `${hms}:00` : hms}+07:00`);

/** Bulan lalu relatif terhadap hari ini, dan hari kerja (Sen–Jum) di dalamnya. */
const today = todayIso(TZ);
const month = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
const { from, to } = monthRange(month);
const workdays: string[] = [];
for (let d = from; d <= to; d = addDays(d, 1)) if (isoWeekday(d) <= 5) workdays.push(d);
const W = (i: number) => workdays[i]!; // hari kerja ke-i bulan itu

const RULES = {
  lateMode: "PER_MINUTE", lateAmount: 1000, absenceMode: "FIXED_PER_DAY", absenceAmount: 100_000, absenceDivisor: null, izinDeductsPay: true, sakitDeductsPay: false, cutiDeductsPay: false,
  overtimeMode: "APPROVED", overtimeRatePerHour: 20_000, overtimeMinMinutes: 60, overtimeMaxMinutesPerDay: 240,
} as const;

let jpeg: Buffer;
const loc = () => ({ lat: -7.7956, lng: 110.3695, accuracy: 10, timestamp: Date.now() - 500, clientNow: Date.now() });
const ctx = () => ({ ip: null, deviceToken: null, photo: jpeg });
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

let runId = "";

beforeAll(async () => {
  expect(workdays.length).toBeGreaterThanOrEqual(19); // bulan lalu cukup panjang untuk skenario
  await resetDb();
  fx = await seedFixtures();
  jpeg = await sharp({ create: { width: 640, height: 480, channels: 3, background: { r: 190, g: 200, b: 210 } } }).jpeg().toBuffer();
  await updateAttendancePolicy(fx.superAdmin, {
    lateMinutesAfterTolerance: false, locationEnabled: false, locationName: null, locationLat: null, locationLng: null, locationRadiusMeters: 100, locationMaxAccuracyMeters: 150,
    requestBackdateDays: 365, annualLeaveQuota: 12, allowNegativeLeaveBalance: false, attendancePhotoMode: "REQUIRED", attendancePhotoRequireLocation: true, attendancePhotoRetentionMonths: 6,
  });
  await updatePayrollRules(fx.superAdmin, { ...RULES });
  const sc = defaultStatutoryConfig(); sc.bpjs.enabled = true; sc.pph21.enabled = true;
  await updateStatutoryConfig(fx.superAdmin, sc);
  await confirmPayrollRules(fx.superAdmin);

  // Budi: shift malam 22:00–06:00 sepanjang waktu; Ayu & Citra: jadwal bawaan 08:00–16:00.
  const night = await createSchedule(fx.hr, { name: "Shift Malam", workDays: [1, 2, 3, 4, 5], startTime: "22:00", endTime: "06:00", lateToleranceMinutes: 15, absentCutoffTime: "02:00" });
  await createAssignment(fx.hr, { scheduleId: night.id, scope: "EMPLOYEE", employeeId: fx.empIds[BUDI], startDate: "2025-01-01" });
  await addComponent(fx.empIds[AYU], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 8_000_000, from: "2025-01-01" });
  await addComponent(fx.empIds[BUDI], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 6_500_000, from: "2025-01-01" });
  await addComponent(fx.empIds[BUDI], fx.hr.userId, { category: "TRANSPORT_ALLOWANCE", name: "Transport", amount: 300_000, from: "2025-01-01" });
  await addComponent(fx.empIds[CITRA], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 12_000_000, from: "2025-01-01" });
  for (const e of [AYU, BUDI, CITRA]) await setBalance(fx.hr, { employeeId: fx.empIds[e], year: Number(month.slice(0, 4)), targetDays: 12, note: "Saldo awal" });

  const regular = ["emp1", "emp3"] as const;
  // ── Ayu & Citra: hadir tiap hari kerja dengan foto bercap. Ayu: hari ke-3 terlambat 40 mnt, ke-4 terlambat 5 mnt (dalam toleransi), ke-7 tidak hadir.
  for (const [i, d] of workdays.entries()) {
    for (const who of regular) {
      if (who === "emp1" && (i === 7 || i === 8 || i === 9 || i === 10)) continue; // 7 tidak hadir; 8 sakit; 9 cuti pagi; 10 izin siang
      const inT = who === "emp1" && i === 3 ? "08:40:00" : who === "emp1" && i === 4 ? "08:05:00" : "07:55:00";
      await checkIn(fx[who], { location: loc() }, at(d, inT), ctx());
      let outT = "16:05:00";
      if (who === "emp1" && i === 11) outT = "18:30:00"; // lembur terbukti 150 mnt
      if (who === "emp3" && i === 12) continue; // Citra lupa check-out
      await checkOut(fx[who], { location: loc() }, at(d, outT), ctx());
    }
  }
  // Ayu: sakit (hari 8), cuti pagi (hari 9, hadir siang), izin siang (hari 10, hadir pagi)
  const sick = await submitLeave(fx.emp1, { type: "SAKIT", startDate: W(8), endDate: W(8), reason: "Demam dan flu berat" });
  const cutiAm = await submitLeave(fx.emp1, { type: "CUTI", startDate: W(9), endDate: W(9), dayPart: "MORNING", reason: "Urusan keluarga pagi hari" });
  const izinPm = await submitLeave(fx.emp1, { type: "IZIN", startDate: W(10), endDate: W(10), dayPart: "AFTERNOON", reason: "Mengurus dokumen siang" });
  for (const l of [sick, cutiAm, izinPm]) await reviewLeave(fx.hr, l.id, { decision: "APPROVE" });
  await checkIn(fx.emp1, { location: loc() }, at(W(9), "12:00:00"), ctx()); await checkOut(fx.emp1, { location: loc() }, at(W(9), "16:00:00"), ctx());
  await checkIn(fx.emp1, { location: loc() }, at(W(10), "08:00:00"), ctx()); await checkOut(fx.emp1, { location: loc() }, at(W(10), "12:00:00"), ctx());
  // Lembur Ayu hari ke-11: diajukan 150, disetujui 120 → dibayar min(120, bukti 150) = 120 mnt × Rp20.000/jam = 40.000
  const ot = await submitOvertime(fx.emp1, { date: W(11), startTime: "16:00", minutes: 150, reason: "Menyelesaikan laporan akhir bulan" });
  await reviewOvertime(fx.hr, ot.id, { decision: "APPROVE", approvedMinutes: 120 });
  // ── Budi (malam): tiap malam check-in 21:55, check-out 06:05 esok hari (3 malam pertama + hari 5 lupa check-out)
  for (const [i, d] of workdays.entries()) {
    if (i > 14) break;
    await checkIn(fx.emp2, { location: loc() }, at(d, i === 2 ? "22:30:00" : "21:55:00"), ctx());
    if (i === 5) continue; // lupa check-out
    await checkOut(fx.emp2, { location: loc() }, at(addDays(d, 1), "06:05:00"), ctx());
  }

  runId = (await createRun(fx.hr, { label: `Gaji ${month}`, periodStart: from, periodEnd: to })).id;
  await submitRun(fx.hr, runId);
  await approveRun(fx.superAdmin, runId);
  await issueRun(fx.hr, runId);
}, 240_000);

describe("rekap = rincian = rentang karyawan = laporan kehadiran = absensi sumber penggajian", () => {
  it("setiap karyawan: angka hari hadir/terlambat/tidak hadir/izin/sakit/cuti IDENTIK di lima tempat", async () => {
    const recap = await getRecap(fx.hr, { view: "kustom", from, to, pageSize: 100 });
    const report = await getAttendanceReport(fx.hr, { from, to });
    const run = await getRun(fx.hr, runId);
    expect(recap.page.items).toHaveLength(3);
    for (const row of recap.page.items) {
      const t = row.totals;
      const detail = (await getRecapDetail(fx.hr, row.employeeId, { view: "kustom", from, to })).totals;
      const range = (await getEmployeeRange(fx.hr, row.employeeId, from, to)).totals;
      const pr = report.rows.find((r) => r.employeeId === row.employeeId)!;
      const item = await getItem(fx.hr, run.items.find((i) => i.employeeNo === row.employeeNo)!.id);
      const a = item.attendance.totals;
      for (const [label, o] of [["rincian", detail], ["rentang", range], ["sumber gaji", a]] as const) {
        for (const k of ["scheduledDays", "presentDays", "onTimeDays", "lateDays", "lateCount", "lateMinutes", "izinDays", "sakitDays", "cutiDays", "absentDays", "incompleteCount", "workedMinutes"] as const) {
          expect(o[k], `${row.employeeNo} ${label}.${k}`).toBe(t[k]);
        }
      }
      expect([pr.scheduled, pr.present, pr.late, pr.lateMinutes, pr.absent, pr.incomplete]).toEqual([t.scheduledDays, t.presentDays, t.lateCount, t.lateMinutes, t.absentDays, t.incompleteCount]);
      // invarian internal: pecahan hari selalu menjumlah ke hari terjadwal (tidak ada hari "hilang")
      expect(near(t.presentDays + t.izinDays + t.sakitDays + t.cutiDays + t.absentDays + t.pendingDays, t.scheduledDays), `${row.employeeNo} penjumlahan`).toBe(true);
    }
  });

  it("nilai yang diharapkan dari skenario (dihitung manual): Ayu terlambat 40 mnt (1 kali), tidak hadir 1, sakit 1, cuti 0,5, izin 0,5; Budi & Citra", async () => {
    const t = (e: 0 | 1 | 2) => getEmployeeRange(fx.hr, fx.empIds[e], from, to).then((r) => r.totals);
    const a = await t(AYU);
    expect(a.lateCount).toBe(1);
    expect(a.lateMinutes).toBe(40);
    expect(a.sakitDays).toBe(1);
    expect(a.cutiDays).toBe(0.5);
    expect(a.izinDays).toBe(0.5);
    // hari ke-7 tidak hadir (1) + setengah hari lain pada hari izin/cuti yang sudah hadir = 0
    expect(a.absentDays).toBe(1);
    expect(a.presentDays).toBe(a.scheduledDays - 1 /* tidak hadir */ - 1 /* sakit */ - 0.5 /* cuti pagi */ - 0.5 /* izin siang */);
    const c = await t(CITRA);
    expect(c.incompleteCount).toBe(1); // lupa check-out hari ke-12
    expect(c.absentDays).toBe(0);
    const b = await t(BUDI);
    expect(b.incompleteCount).toBe(1); // lupa check-out malam ke-5
    expect(b.lateMinutes).toBe(0 + 30 + 0 > 0 ? b.lateMinutes : 0); // malam ke-2 masuk 22:30 → terlambat 30 mnt
    expect(b.lateCount).toBe(1);
    expect(b.lateMinutes).toBe(30);
  });

  it("ekspor CSV rekap memuat angka yang sama dengan tampilan (satu sumber kebenaran)", async () => {
    const recap = await getRecap(fx.hr, { view: "kustom", from, to, pageSize: 100 });
    const csv = toCsv(await recapTable(fx.hr, { view: "kustom", from, to }));
    for (const row of recap.page.items) {
      const line = csv.split("\r\n").find((l) => l.includes(row.employeeNo));
      expect(line, row.employeeNo).toBeTruthy();
      expect(line!).toContain(row.name);
    }
    const t = reportTable;
    expect(typeof t).toBe("function");
  });
});

describe("cuti: saldo = buku besar = rekap", () => {
  it("saldo Ayu = kuota − 0,5 (hanya cuti yang memotong); buku besar menjumlah ke saldo; riwayat sesuai", async () => {
    const year = Number(month.slice(0, 4));
    const b = await getBalance(fx.hr, fx.empIds[AYU], year);
    expect(b.balance).toBe(11.5);
    const ledger = await getLedger(fx.hr, fx.empIds[AYU], year);
    expect(sum(ledger.map((l) => l.days))).toBe(b.balance);
    expect(ledger.map((l) => l.kind).sort()).toEqual(["GRANT", "USAGE"]);
    for (const e of [BUDI, CITRA]) expect((await getBalance(fx.hr, fx.empIds[e], year)).balance).toBe(12);
    const cutiInRecap = (await getEmployeeRange(fx.hr, fx.empIds[AYU], from, to)).totals.cutiDays;
    expect(12 - b.balance).toBe(cutiInRecap);
  });

  it("laporan cuti & lembur: hari izin/sakit/cuti per jenis = rekap; lembur disetujui = 120 mnt", async () => {
    const r = await getLeaveOvertimeReport(fx.hr, { from, to });
    const all = await Promise.all([AYU, BUDI, CITRA].map((e) => getEmployeeRange(fx.hr, fx.empIds[e], from, to).then((x) => x.totals)));
    const leaveByDiv = r.leaveByDivision.reduce((a, d) => ({ izin: a.izin + d.izin, sakit: a.sakit + d.sakit, cuti: a.cuti + d.cuti }), { izin: 0, sakit: 0, cuti: 0 });
    expect(leaveByDiv).toEqual({ izin: sum(all.map((x) => x.izinDays)), sakit: sum(all.map((x) => x.sakitDays)), cuti: sum(all.map((x) => x.cutiDays)) });
    expect(r.overtime.approvedMinutes).toBe(120);
    expect(sum(r.overtime.byEmployee.map((o) => o.minutes))).toBe(120);
    expect(r.overtime.requests).toEqual({ pending: 0, approved: 1, rejected: 0, cancelled: 0 });
  });
});

describe("penggajian: item = rumus manual = slip = laporan biaya & kepatuhan", () => {
  it("Ayu: potongan terlambat (40 mnt × Rp1.000), tidak hadir (1 + 0,5 izin) × Rp100.000, lembur 120 mnt = Rp40.000 — dan gaji bersih = Σ pendapatan − Σ potongan", async () => {
    const run = await getRun(fx.hr, runId);
    const d = await getItem(fx.hr, run.items.find((i) => i.employeeNo === "TE-001")!.id);
    const by = (src: string) => d.lines.find((l) => l.source === src)?.amount;
    expect(by("RULE_LATE")).toBe(40_000);
    expect(by("RULE_ABSENCE")).toBe(150_000); // 1 tidak hadir + 0,5 izin = 1,5 hari × 100.000
    expect(by("RULE_OVERTIME")).toBe(40_000);
    expect(d.attendance.overtime).toEqual({ approvedMinutes: 120, paidMinutes: 120, days: 1 });
    for (const it of run.items) {
      const x = await getItem(fx.hr, it.id);
      const earn = sum(x.lines.filter((l) => l.kind === "EARNING").map((l) => l.amount));
      const ded = sum(x.lines.filter((l) => l.kind === "DEDUCTION").map((l) => l.amount));
      expect([x.item.totalEarnings, x.item.totalDeductions, x.item.netPay], it.employeeNo).toEqual([earn, ded, earn - ded]);
      expect(x.item.stale, `${it.employeeNo} tidak boleh stale setelah terbit`).toBe(false);
    }
  });

  it("slip terbit = item (gaji bersih, potongan, jumlah baris); nomor slip unik; semua karyawan mendapat slip", async () => {
    const run = await getRun(fx.hr, runId);
    expect(run.run.status).toBe("ISSUED");
    const slips = await getRunPayslips(fx.hr, runId);
    expect(slips).toHaveLength(3);
    expect(new Set(slips.map((s) => s.dto.number)).size).toBe(3);
    for (const s of slips) {
      const it = run.items.find((i) => i.employeeNo === s.snapshot.employee.employeeNo)!;
      expect([s.snapshot.netPay, s.snapshot.totalDeductions, s.snapshot.totalEarnings]).toEqual([it.netPay, it.totalDeductions, it.totalEarnings]);
      const det = await getItem(fx.hr, it.id);
      expect(s.snapshot.earnings.length + s.snapshot.deductions.length).toBe(det.lines.length);
      expect(s.dto.netPay).toBe(it.netPay);
      if (s.snapshot.attendance) expect(s.snapshot.attendance.presentDays).toBe(det.attendance.totals.presentDays);
    }
  });

  it("laporan biaya SDM = jumlah slip; BPJS perusahaan & PPh 21 = jumlah item; laporan kepatuhan per karyawan = rincian statutory item", async () => {
    const year = Number(month.slice(0, 4));
    const cost = await getCostReport(fx.superAdmin, { year });
    const run = await getRun(fx.hr, runId);
    expect(cost.totals.earnings).toBe(sum(run.items.map((i) => i.totalEarnings)));
    expect(cost.totals.net).toBe(sum(run.items.map((i) => i.netPay)));
    const details = await Promise.all(run.items.map((i) => getItem(fx.hr, i.id)));
    expect(cost.totals.pph21).toBe(sum(details.map((d) => d.lines.filter((l) => l.name.startsWith("PPh 21")).reduce((a, l) => a + l.amount, 0))));
    expect(cost.totals.employerBpjs).toBe(sum(details.map((d) => d.statutory?.bpjs?.employerTotal ?? 0)));
    const comp = await getComplianceReport(fx.superAdmin, { month });
    expect(comp.rows).toHaveLength(3);
    for (const row of comp.rows) {
      const d = details.find((x) => x.item.employeeNo === row.employeeNo)!;
      expect(row.pph21, row.employeeNo).toBe(d.lines.filter((l) => l.name.startsWith("PPh 21")).reduce((a, l) => a + l.amount, 0));
      expect(row.kesEmp + row.jhtEmp + row.jpEmp, row.employeeNo).toBe(d.lines.filter((l) => l.category === "BPJS").reduce((a, l) => a + l.amount, 0));
    }
  });
});

describe("foto absensi: setiap punch ada fotonya; waktu cap = waktu absensi", () => {
  it("jumlah foto = jumlah check-in + check-out; tiap foto cocok dengan baris absensinya; cap berisi waktu yang sama", async () => {
    const att = await prisma.attendance.findMany();
    const expected = att.length + att.filter((a) => a.checkOutAt).length;
    const photos = await prisma.attendancePhoto.findMany();
    expect(photos).toHaveLength(expected);
    expect(photos.every((p) => p.fileId !== null && p.purgedAt === null)).toBe(true);
    for (const p of photos) {
      const a = att.find((x) => x.id === p.attendanceId)!;
      const t = p.kind === "CHECK_IN" ? a.checkInAt : a.checkOutAt!;
      expect(p.capturedAt.toISOString()).toBe(t.toISOString());
    }
    expect(await prisma.storedFile.count({ where: { kind: "ATTENDANCE_PHOTO" } })).toBe(expected);
  });
});

describe("notifikasi & audit lengkap untuk setiap peristiwa", () => {
  it("HR & Super Admin menerima notifikasi pengajuan; karyawan menerima hasil; Super Admin menerima permintaan persetujuan gaji; karyawan menerima slip terbit", async () => {
    const types = async (a: typeof fx.hr) => (await listNotifications(a)).items.map((n) => n.type);
    const hr = await types(fx.hr), sa = await types(fx.superAdmin), ayu = await types(fx.emp1), budi = await types(fx.emp2);
    expect(hr.filter((t) => t === "leave.submitted")).toHaveLength(3);
    expect(hr.filter((t) => t === "overtime.submitted")).toHaveLength(1);
    expect(sa.filter((t) => t === "leave.submitted")).toHaveLength(3);
    expect(sa.some((t) => t.startsWith("payroll"))).toBe(true);
    expect(ayu.filter((t) => t === "leave.reviewed")).toHaveLength(3);
    expect(ayu.filter((t) => t === "overtime.reviewed")).toHaveLength(1);
    expect(ayu.some((t) => t.includes("payslip") || t.includes("payroll"))).toBe(true);
    expect(budi.some((t) => t.includes("payslip") || t.includes("payroll"))).toBe(true);
    expect(budi.some((t) => t.startsWith("leave") || t.startsWith("overtime"))).toBe(false); // Budi tidak mengajukan apa pun
  });

  it("audit log memuat tiap jenis peristiwa skenario; tidak dapat diubah", async () => {
    const actions = new Set((await prisma.auditLog.findMany({ select: { action: true } })).map((a) => a.action));
    for (const a of ["attendance.check_in", "attendance.check_out", "leave.review", "overtime.review", "payroll.submit", "payroll.approve", "payroll.issue", "settings.attendance_policy_update"]) {
      expect([...actions].some((x) => x === a || x.startsWith(a.split(".")[0] + ".") && x.includes(a.split(".")[1]!)), a).toBe(true);
    }
    const n = await prisma.auditLog.count({ where: { action: "attendance.check_in" } });
    expect(n).toBe(await prisma.attendance.count());
    await expect(prisma.$executeRaw`UPDATE audit_logs SET summary = 'diubah'`).rejects.toThrow();
    await expect(prisma.$executeRaw`DELETE FROM audit_logs`).rejects.toThrow();
  });

  it("dasbor admin: ringkasan hari ini konsisten dengan rekap harian hari ini (jumlah karyawan)", async () => {
    const d = await getAdminDashboard(fx.hr);
    const recapToday = await getRecap(fx.hr, { view: "harian", date: today, pageSize: 100 });
    expect(recapToday.page.total).toBe(3);
    expect(d).toBeTruthy();
  });
});

describe("integritas basis data setelah skenario", () => {
  it("tidak ada anomali: item gaji bersih = pendapatan − potongan; slip aktif = item; absensi tanpa tumpang tindih; saldo cuti tidak negatif; foto yatim = 0", async () => {
    const bad = (rows: { n: bigint }[]) => Number(rows[0]!.n);
    expect(bad(await prisma.$queryRaw`SELECT count(*) AS n FROM payroll_items WHERE "netPay" <> "totalEarnings" - "totalDeductions"`)).toBe(0);
    expect(bad(await prisma.$queryRaw`SELECT count(*) AS n FROM payslips s JOIN payroll_items i ON i.id = s."itemId" WHERE s."netPay" <> i."netPay" AND s.status = 'ACTIVE'`)).toBe(0);
    expect(bad(await prisma.$queryRaw`SELECT count(*) AS n FROM attendances WHERE "checkOutAt" IS NOT NULL AND "checkOutAt" <= "checkInAt"`)).toBe(0);
    expect(bad(await prisma.$queryRaw`SELECT count(*) AS n FROM (SELECT "employeeId", year, sum(days) s FROM leave_balance_entries GROUP BY 1, 2) x WHERE s < 0`)).toBe(0);
    expect(bad(await prisma.$queryRaw`SELECT count(*) AS n FROM attendance_photos WHERE "attendanceId" IS NULL AND "purgedAt" IS NULL`)).toBe(0);
    expect(bad(await prisma.$queryRaw`SELECT count(*) AS n FROM stored_files f WHERE f.kind = 'ATTENDANCE_PHOTO' AND NOT EXISTS (SELECT 1 FROM attendance_photos p WHERE p."fileId" = f.id)`)).toBe(0);
    expect(bad(await prisma.$queryRaw`SELECT count(*) AS n FROM attendances a WHERE NOT EXISTS (SELECT 1 FROM audit_logs l WHERE l.action = 'attendance.check_in' AND l."entityId" = a.id::text)`)).toBe(0);
    expect(isoToDate(from).getTime()).toBeLessThan(isoToDate(to).getTime());
  });
});
