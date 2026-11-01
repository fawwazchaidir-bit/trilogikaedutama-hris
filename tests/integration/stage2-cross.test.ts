/**
 * Putaran 2 — skenario LINTAS FITUR dan ADVERSARIAL untuk Tahap 2:
 * shift malam × lembur × cuti setengah hari × BPJS/PPh 21 × penggajian, kontrol akses, kebocoran rahasia, dan balapan.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { errorResponse } from "@/server/http";
import { isoToDate } from "@/server/json";
import { cancelOvertime, listMyOvertime, listOvertime, reviewOvertime, submitOvertime } from "@/server/services/overtime";
import { approveRun, createRun, getItem, getRun, issueRun, submitRun } from "@/server/services/payroll";
import { getRunPayslips } from "@/server/services/payslips";
import { reviewLeave, setBalance, submitLeave } from "@/server/services/leave";
import { getRecap, recapTable } from "@/server/services/recap";
import { addCalendarDay, createAssignment, createSchedule } from "@/server/services/schedules";
import { confirmPayrollRules, updateAttendancePolicy, updatePayrollRules, updateStatutoryConfig } from "@/server/services/settings";
import { beginTwoFactorSetup, enableTwoFactor, resetUserTwoFactor } from "@/server/services/two-factor";
import { requestPasswordReset } from "@/server/services/password-reset";
import { getAccount } from "@/server/services/account";
import { reportTable } from "@/server/services/reports";
import { toCsv } from "@/server/export";
import { setTransportsForTest } from "@/server/notify/transports";
import { defaultStatutoryConfig } from "@/lib/statutory";
import { totpAt } from "@/lib/totp";
import { addDays, isoWeekday, todayIso } from "@/lib/time";
import { addAttendance, addComponent, resetDb, seedFixtures, TEST_PASSWORD, type Fixtures } from "../helpers/db";
import { pinNow } from "../helpers/pin-now";

// Tanggal tetap di masa lalu + aturan mundur 365 hari → titik awal waktu dipatok agar tes tidak membusuk (lihat helpers/pin-now.ts).
pinNow();

let fx: Fixtures;
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const [AYU, BUDI, CITRA] = [0, 1, 2] as const;
const at = (hhmm: string, date: string) => new Date(`${date}T${hhmm}:00+07:00`);

const RULES = {
  lateMode: "NONE", lateAmount: 0, absenceMode: "NONE", absenceAmount: 0, absenceDivisor: null, izinDeductsPay: true, sakitDeductsPay: false, cutiDeductsPay: false,
  overtimeMode: "APPROVED", overtimeRatePerHour: 20_000, overtimeMinMinutes: 60, overtimeMaxMinutesPerDay: 240,
} as const;
const PERIOD = { label: "Gaji Maret 2026", periodStart: "2026-03-01", periodEnd: "2026-03-31" };
/** Hari kerja Sen–Jum Maret 2026: 22 hari (2–6, 9–13, 16–20, 23–27, 30–31). */
const MARCH_WORKDAYS = Array.from({ length: 31 }, (_, i) => `2026-03-${String(i + 1).padStart(2, "0")}`).filter((d) => isoWeekday(d) <= 5);

function workday(plus: number): string {
  let d = addDays(todayIso("Asia/Jakarta"), plus);
  while (isoWeekday(d) > 5) d = addDays(d, 1);
  return d;
}

beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
  setTransportsForTest({ email: async () => undefined, whatsapp: async () => undefined });
  await updateAttendancePolicy(fx.superAdmin, {
    lateMinutesAfterTolerance: false, locationEnabled: false, locationName: null, locationLat: null, locationLng: null, locationRadiusMeters: 100,
    locationMaxAccuracyMeters: 150, requestBackdateDays: 365, annualLeaveQuota: 12, allowNegativeLeaveBalance: false,
  });
});
afterEach(() => setTransportsForTest(null));

async function nightShiftForAyu() {
  const s = await createSchedule(fx.hr, { name: "Shift Malam", workDays: [1, 2, 3, 4, 5], startTime: "22:00", endTime: "06:00", lateToleranceMinutes: 15, absentCutoffTime: "02:00" });
  await createAssignment(fx.hr, { scheduleId: s.id, scope: "EMPLOYEE", employeeId: fx.empIds[AYU], startDate: "2026-01-01" });
}
async function night(date: string, inT: string, outT: string) {
  await prisma.attendance.create({ data: { employeeId: fx.empIds[AYU], date: isoToDate(date), checkInAt: at(inT, date), checkOutAt: at(outT, addDays(date, 1)), source: "SELF" } });
}
async function presentAllMarch(employeeIndex: 0 | 1 | 2, skip: string[] = []) {
  for (const d of MARCH_WORKDAYS) if (!skip.includes(d)) await addAttendance(fx.empIds[employeeIndex], d, "07:55", "16:05");
}

describe("shift malam × lembur × penggajian", () => {
  it("lembur shift malam dibuktikan check-out SETELAH jam pulang keesokan harinya; check-out sebelum jam pulang = tidak terbukti", async () => {
    await nightShiftForAyu();
    await updatePayrollRules(fx.superAdmin, { ...RULES });
    await confirmPayrollRules(fx.superAdmin);
    await addComponent(fx.empIds[AYU], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 5_000_000 });

    await night("2026-03-02", "21:55", "07:30"); // 90 menit setelah jam pulang 06:00
    await night("2026-03-03", "21:55", "05:50"); // pulang lebih awal: tidak ada bukti lembur
    const a = await submitOvertime(fx.emp1, { date: "2026-03-02", startTime: "06:00", minutes: 120, reason: "Serah terima shift dengan tim pagi" });
    const b = await submitOvertime(fx.emp1, { date: "2026-03-03", startTime: "06:00", minutes: 60, reason: "Menunggu pengganti shift" });
    await reviewOvertime(fx.hr, a.id, { decision: "APPROVE" });
    await reviewOvertime(fx.hr, b.id, { decision: "APPROVE" });

    const { id } = await createRun(fx.hr, PERIOD);
    const d = await getItem(fx.hr, (await getRun(fx.hr, id)).items.find((i) => i.employeeNo === "TE-001")!.id);
    expect(d.lines.find((l) => l.source === "RULE_OVERTIME")!.amount).toBe(30_000); // 90 mnt × Rp20.000/jam
    expect(d.attendance.overtime).toEqual({ approvedMinutes: 180, paidMinutes: 90, days: 1 });
    expect(d.item.warnings.join(" ")).toContain("tidak dihitung");
  });

  it("mode otomatis pada shift malam: waktu setelah jam pulang (melewati tengah malam) dihitung, maksimum per hari berlaku", async () => {
    await nightShiftForAyu();
    await updatePayrollRules(fx.superAdmin, { ...RULES, overtimeMode: "AUTO", overtimeMaxMinutesPerDay: 120 });
    await confirmPayrollRules(fx.superAdmin);
    await addComponent(fx.empIds[AYU], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 5_000_000 });
    await night("2026-03-04", "21:58", "09:00"); // 180 menit setelah 06:00 → dibatasi 120
    const { id } = await createRun(fx.hr, PERIOD);
    const d = await getItem(fx.hr, (await getRun(fx.hr, id)).items.find((i) => i.employeeNo === "TE-001")!.id);
    expect(d.lines.find((l) => l.source === "RULE_OVERTIME")!.amount).toBe(40_000); // 120 mnt × 20.000/jam
  });

  it("shift malam + cuti setengah hari pagi: masuk 02:10 dini hari tidak terlambat; rekap = hadir 0,5 + cuti 0,5, bukan tidak hadir", async () => {
    await nightShiftForAyu();
    await setBalance(fx.hr, { employeeId: fx.empIds[AYU], year: 2026, targetDays: 12, note: "Saldo" });
    const l = await submitLeave(fx.emp1, { type: "CUTI", startDate: "2026-03-09", endDate: "2026-03-09", dayPart: "MORNING", reason: "Cuti separuh pertama shift malam" });
    await reviewLeave(fx.hr, l.id, { decision: "APPROVE" });
    await prisma.attendance.create({ data: { employeeId: fx.empIds[AYU], date: isoToDate("2026-03-09"), checkInAt: at("02:10", "2026-03-10"), checkOutAt: at("06:00", "2026-03-10"), source: "SELF" } });
    const s = (await getRecap(fx.hr, { view: "kustom", from: "2026-03-09", to: "2026-03-09", employeeId: fx.empIds[AYU] })).summary;
    expect(s.scheduledDays).toBe(1);
    expect(s.presentDays).toBe(0.5);
    expect(s.cutiDays).toBe(0.5);
    expect(s.absentDays).toBe(0);
    expect(s.lateCount).toBe(0);
  });
});

describe("cuti setengah hari × penggajian", () => {
  it("izin setengah hari memotong 0,5 hari (bukan 1) pada potongan ketidakhadiran; perubahan setelah dihitung → 'data berubah'", async () => {
    await updatePayrollRules(fx.superAdmin, { ...RULES, overtimeMode: "MANUAL", absenceMode: "FIXED_PER_DAY", absenceAmount: 100_000 });
    await confirmPayrollRules(fx.superAdmin);
    await addComponent(fx.empIds[BUDI], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 5_000_000 });
    await presentAllMarch(BUDI, ["2026-03-18"]);
    await addAttendance(fx.empIds[BUDI], "2026-03-18", "08:00", "12:00"); // hanya pagi
    const iz = await submitLeave(fx.emp2, { type: "IZIN", startDate: "2026-03-18", endDate: "2026-03-18", dayPart: "AFTERNOON", reason: "Izin siang mengurus dokumen" });
    await reviewLeave(fx.hr, iz.id, { decision: "APPROVE" });

    const { id } = await createRun(fx.hr, PERIOD);
    const item = (await getRun(fx.hr, id)).items.find((i) => i.employeeNo === "TE-002")!;
    const d = await getItem(fx.hr, item.id);
    const cut = d.lines.find((l) => l.source === "RULE_ABSENCE")!;
    expect(cut.amount).toBe(50_000);
    expect(cut.formula).toContain("0,5");
    expect(d.item.netPay).toBe(5_000_000 - 50_000);
    expect(d.attendance.totals.presentDays).toBe(21.5);
    expect(d.attendance.totals.izinDays).toBe(0.5);
    expect(d.attendance.totals.absentDays).toBe(0);

    // Izin setengah hari kedua disetujui setelah periode dihitung → ditandai berubah dan tidak dapat diajukan sampai dihitung ulang.
    const iz2 = await submitLeave(fx.emp2, { type: "IZIN", startDate: "2026-03-25", endDate: "2026-03-25", dayPart: "MORNING", reason: "Izin pagi urusan keluarga" });
    await reviewLeave(fx.hr, iz2.id, { decision: "APPROVE" });
    expect((await getRun(fx.hr, id)).staleCount).toBe(1);
    expect((await fail(submitRun(fx.hr, id)))?.message).toMatch(/berubah/);
  });

  it("cuti setengah hari pada hari libur nasional ditolak; pada hari kerja pengganti (Sabtu) diterima dihitung 0,5", async () => {
    await addCalendarDay(fx.hr, { date: workday(14), kind: "HOLIDAY", name: "Libur Uji" });
    const holiday = await fail(submitLeave(fx.emp3, { type: "CUTI", startDate: workday(14), endDate: workday(14), dayPart: "MORNING", reason: "Cuti di hari libur nasional" }));
    expect(holiday?.message).toMatch(/hari kerja/);

    let sat = addDays(todayIso("Asia/Jakarta"), 20);
    while (isoWeekday(sat) !== 6) sat = addDays(sat, 1);
    await addCalendarDay(fx.hr, { date: sat, kind: "SPECIAL_WORKDAY", name: "Kerja Pengganti Uji" });
    const ok = await submitLeave(fx.emp3, { type: "IZIN", startDate: sat, endDate: sat, dayPart: "AFTERNOON", reason: "Izin siang di hari kerja pengganti" });
    expect(ok.workingDays).toBe(0.5);
  });
});

describe("BPJS & PPh 21 × semua fitur — invarian angka", () => {
  it("gaji bersih = Σ pendapatan − Σ potongan untuk SETIAP karyawan; total slip = total item; beban perusahaan tidak mengurangi gaji; aturan manual menang", async () => {
    await nightShiftForAyu();
    await updatePayrollRules(fx.superAdmin, { ...RULES, absenceMode: "FIXED_PER_DAY", absenceAmount: 100_000 });
    const sc = defaultStatutoryConfig();
    sc.bpjs.enabled = true; sc.pph21.enabled = true;
    await updateStatutoryConfig(fx.superAdmin, sc);
    await confirmPayrollRules(fx.superAdmin);
    await addComponent(fx.empIds[AYU], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 8_000_000 });
    await addComponent(fx.empIds[BUDI], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 6_000_000 });
    await addComponent(fx.empIds[BUDI], fx.hr.userId, { category: "BPJS", name: "BPJS manual", amount: 60_000 });
    await addComponent(fx.empIds[CITRA], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 12_000_000 });
    await addComponent(fx.empIds[CITRA], fx.hr.userId, { category: "TRANSPORT_ALLOWANCE", name: "Transport", amount: 300_000 });

    for (const d of ["2026-03-02", "2026-03-03", "2026-03-04"]) await night(d, "21:55", "06:40");
    const o = await submitOvertime(fx.emp1, { date: "2026-03-02", startTime: "06:00", minutes: 60, reason: "Serah terima shift panjang" });
    await reviewOvertime(fx.hr, o.id, { decision: "APPROVE" });
    await presentAllMarch(BUDI, ["2026-03-12"]);
    const hs = await submitLeave(fx.emp2, { type: "IZIN", startDate: "2026-03-12", endDate: "2026-03-12", dayPart: "AFTERNOON", reason: "Izin siang keperluan keluarga" });
    await reviewLeave(fx.hr, hs.id, { decision: "APPROVE" });
    await addAttendance(fx.empIds[BUDI], "2026-03-12", "08:00", "12:00");
    await presentAllMarch(CITRA);

    const { id } = await createRun(fx.hr, PERIOD);
    const run = await getRun(fx.hr, id);
    expect(run.items).toHaveLength(3);
    for (const it of run.items) {
      const d = await getItem(fx.hr, it.id);
      const earn = d.lines.filter((l) => l.kind === "EARNING").reduce((a, l) => a + l.amount, 0);
      const ded = d.lines.filter((l) => l.kind === "DEDUCTION").reduce((a, l) => a + l.amount, 0);
      expect(d.item.totalEarnings, it.employeeNo).toBe(earn);
      expect(d.item.totalDeductions, it.employeeNo).toBe(ded);
      expect(d.item.netPay, it.employeeNo).toBe(earn - ded);
      expect(d.item.netPay, it.employeeNo).toBeGreaterThan(0);
      for (const l of d.lines) expect(Number.isInteger(l.amount) && l.amount >= 0, `${it.employeeNo}: ${l.name}`).toBe(true);
    }
    const budi = await getItem(fx.hr, run.items.find((i) => i.employeeNo === "TE-002")!.id);
    expect(budi.lines.filter((l) => l.category === "BPJS").map((l) => l.source)).toEqual(["COMPONENT"]); // otomatis tidak ganda
    const citra = await getItem(fx.hr, run.items.find((i) => i.employeeNo === "TE-003")!.id);
    expect(citra.lines.filter((l) => l.category === "BPJS").every((l) => l.source === "RULE_STATUTORY")).toBe(true);

    await submitRun(fx.hr, id);
    await approveRun(fx.superAdmin, id);
    await issueRun(fx.hr, id);
    const slips = await getRunPayslips(fx.hr, id);
    expect(slips).toHaveLength(3);
    const after = await getRun(fx.hr, id);
    for (const s of slips) {
      const it = after.items.find((i) => i.employeeNo === s.snapshot.employee.employeeNo)!;
      expect(s.snapshot.netPay).toBe(it.netPay);
      expect(s.snapshot.totalDeductions).toBe(it.totalDeductions);
    }
    expect(slips.reduce((a, s) => a + s.snapshot.netPay, 0)).toBe(after.items.reduce((a, i) => a + i.netPay, 0));
  });
});

describe("kontrol akses lembur (adversarial)", () => {
  it("karyawan lain tidak dapat melihat/membatalkan/memutuskan lembur orang lain; karyawan tidak bisa membuka antrean; status final tidak dapat diputuskan ulang", async () => {
    const o = await submitOvertime(fx.emp1, { date: "2026-03-03", startTime: "16:00", minutes: 120, reason: "Menyelesaikan laporan akhir bulan" });
    expect((await listMyOvertime(fx.emp2)).map((x) => x.id)).not.toContain(o.id);
    expect((await fail(listOvertime(fx.emp2)))?.code).toBe("FORBIDDEN");
    expect((await fail(cancelOvertime(fx.emp2, o.id, { reason: "iseng" })))?.code).toBe("FORBIDDEN");
    expect((await fail(reviewOvertime(fx.emp2, o.id, { decision: "APPROVE" })))?.code).toBe("FORBIDDEN");
    expect((await fail(reviewOvertime(fx.emp1, o.id, { decision: "APPROVE" })))?.code).toBe("FORBIDDEN");
    expect((await fail(reviewOvertime(fx.hr, "00000000-0000-4000-8000-000000000000", { decision: "APPROVE" })))?.code).toBe("NOT_FOUND");
    // Id ngawur di URL → 404 yang rapi (bukan 500 dari galat UUID database).
    for (const id of ["bukan-uuid", "1", "' OR 1=1 --"]) {
      let caught: unknown = null;
      try { await reviewOvertime(fx.hr, id, { decision: "APPROVE" }); } catch (e) { caught = e; }
      expect(caught, id).not.toBeNull();
      const res = errorResponse(caught);
      expect(res.status, id).toBe(404);
      expect((await res.json()).error.code).toBe("NOT_FOUND");
    }

    await reviewOvertime(fx.hr, o.id, { decision: "APPROVE", approvedMinutes: 60 });
    expect((await fail(reviewOvertime(fx.hr, o.id, { decision: "REJECT", note: "Ralat" })))?.code).toBe("CONFLICT");
    expect((await fail(cancelOvertime(fx.emp1, o.id, { reason: "batal" })))?.code).toBe("FORBIDDEN"); // pemilik tidak boleh menarik lembur yang sudah disetujui
    expect((await fail(reviewOvertime(fx.hr, o.id, { decision: "APPROVE", approvedMinutes: 0 })))).not.toBeNull();
  });

  it("batas durasi tepat: 15 dan 720 menit diterima; 14 dan 721 ditolak; menit pecahan/negatif/NaN ditolak", async () => {
    expect(await fail(submitOvertime(fx.emp1, { date: "2026-03-03", startTime: "16:00", minutes: 15, reason: "Batas bawah durasi lembur" }))).toBeNull();
    expect(await fail(submitOvertime(fx.emp1, { date: "2026-03-04", startTime: "08:00", minutes: 720, reason: "Batas atas durasi lembur" }))).toBeNull();
    for (const [i, m] of [14, 721, -60, 90.5, Number.NaN, "abc"].entries()) {
      const e = await fail(submitOvertime(fx.emp1, { date: `2026-03-1${i}`, startTime: "16:00", minutes: m, reason: "Durasi tidak valid" }));
      expect(e?.code, String(m)).toBe("VALIDATION");
    }
  });
});

describe("balapan (concurrency)", () => {
  it("persetujuan vs pembatalan pemilik serentak: tepat satu pemenang, keadaan akhir konsisten", async () => {
    for (let i = 0; i < 5; i++) {
      const date = `2026-03-${String(10 + i).padStart(2, "0")}`;
      const o = await submitOvertime(fx.emp1, { date, startTime: "16:00", minutes: 120, reason: "Balapan persetujuan dan pembatalan" });
      const r = await Promise.allSettled([reviewOvertime(fx.hr, o.id, { decision: "APPROVE", approvedMinutes: 90 }), cancelOvertime(fx.emp1, o.id, { reason: "Tidak jadi lembur" })]);
      expect(r.some((x) => x.status === "fulfilled"), `iterasi ${i}`).toBe(true);
      const row = await prisma.overtimeRequest.findUniqueOrThrow({ where: { id: o.id } });
      expect(["APPROVED", "CANCELLED"]).toContain(row.status);
      if (row.status === "APPROVED") expect(row.approvedMinutes).toBe(90);
      else expect(row.approvedMinutes).toBeNull();
      // Bila pembatalan menang, persetujuan harus gagal (dan sebaliknya: pemilik tidak dapat menarik yang sudah disetujui).
      expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    }
  });

  it("dua persetujuan serentak dengan menit berbeda: satu menang, menit sesuai pemenang", async () => {
    const o = await submitOvertime(fx.emp1, { date: "2026-03-03", startTime: "16:00", minutes: 120, reason: "Dua reviewer menyetujui serentak" });
    const r = await Promise.allSettled([
      reviewOvertime(fx.hr, o.id, { decision: "APPROVE", approvedMinutes: 60 }),
      reviewOvertime(fx.superAdmin, o.id, { decision: "APPROVE", approvedMinutes: 90 }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const row = await prisma.overtimeRequest.findUniqueOrThrow({ where: { id: o.id } });
    const winner = r.findIndex((x) => x.status === "fulfilled");
    expect(row.approvedMinutes).toBe(winner === 0 ? 60 : 90);
    expect(await prisma.notification.count({ where: { type: "overtime.reviewed" } })).toBe(1);
  });
});

describe("kebocoran rahasia (adversarial)", () => {
  it("rahasia TOTP, kode pemulihan, token reset, dan password tidak muncul di audit log, notifikasi, antrean pesan, atau DTO akun", async () => {
    const setup = await beginTwoFactorSetup(fx.emp1, { password: TEST_PASSWORD });
    const { recoveryCodes } = await enableTwoFactor(fx.emp1, { code: totpAt(setup.secret, Date.now()) });
    await requestPasswordReset({ email: "budi@uji.test" }, { ip: "10.0.0.9", userAgent: "vitest" });
    const emails: string[] = [];
    setTransportsForTest({ email: async (m) => { emails.push(m.text); }, whatsapp: async () => undefined });
    await requestPasswordReset({ email: "citra@uji.test" }, { ip: "10.0.0.10", userAgent: "vitest" });
    for (let i = 0; i < 100 && emails.length < 1; i++) await new Promise((r) => setTimeout(r, 10));
    const token = /token=([\w-]+)/.exec(emails[0] ?? "")?.[1];
    expect(token).toBeTruthy();
    await resetUserTwoFactor(fx.superAdmin, fx.emp1.userId);

    const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x));
    const dump = json([
      await prisma.auditLog.findMany(), await prisma.notification.findMany(), await prisma.notificationDelivery.findMany(),
      await prisma.passwordResetToken.findMany(), await getAccount(fx.emp1),
    ]);
    const secrets = [setup.secret, token!, TEST_PASSWORD, ...recoveryCodes, ...recoveryCodes.map((c) => c.replace("-", ""))];
    for (const s of secrets) expect(dump.includes(s), `bocor: ${s.slice(0, 4)}…`).toBe(false);
  });
});

describe("ekspor — injeksi formula (adversarial)", () => {
  it("nama karyawan/divisi berawalan = + - @ dinetralkan (awalan ') di rekap dan laporan yang memuat nama", async () => {
    const evil = ['=HYPERLINK("http://jahat.test","klik")', "+cmd|' /C calc'!A0", "-2+3+cmd", "@SUM(1+1)"];
    for (const [i, name] of evil.slice(0, 3).entries()) await prisma.employee.update({ where: { id: fx.empIds[i as 0 | 1 | 2] }, data: { fullName: name } });
    await prisma.division.update({ where: { id: fx.divisionA }, data: { name: evil[3]! } });
    const tables = [
      await recapTable(fx.hr, { view: "kustom", from: "2026-01-01", to: "2026-01-31" }),
      await reportTable(fx.hr, "kehadiran", { from: "2026-01-01", to: "2026-01-31" }),
      await reportTable(fx.hr, "karyawan", { year: 2026 }),
    ];
    let seen = 0;
    for (const t of tables) {
      const csv = toCsv(t);
      for (const bad of ["=HYPERLINK", "+cmd", "-2+3+cmd", "@SUM"]) {
        if (!csv.includes(bad)) continue;
        seen++;
        expect(csv, bad).toContain(`'${bad}`);
        expect(csv.includes(`,${bad}`) || csv.includes(`,"${bad}`) || csv.includes(`\r\n${bad}`) || csv.includes(`\r\n"${bad}`), `${bad} tampil tanpa awalan`).toBe(false);
      }
    }
    expect(seen).toBeGreaterThan(0); // nama benar-benar ada pada ekspor (uji tidak kosong)
  });
});
