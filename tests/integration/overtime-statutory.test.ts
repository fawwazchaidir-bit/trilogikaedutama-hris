import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import { cancelOvertime, listMyOvertime, listOvertime, reviewOvertime, submitOvertime } from "@/server/services/overtime";
import { listNotifications } from "@/server/services/notifications";
import { approveRun, createRun, getItem, getRun, issueRun, submitRun } from "@/server/services/payroll";
import { getRunPayslips } from "@/server/services/payslips";
import { reviewLeave, submitLeave } from "@/server/services/leave";
import { confirmPayrollRules, updateAttendancePolicy, updatePayrollRules, updateStatutoryConfig } from "@/server/services/settings";
import { updateEmployee } from "@/server/services/employees";
import { defaultStatutoryConfig } from "@/lib/statutory";
import { addDays, isoWeekday, todayIso } from "@/lib/time";
import { addAttendance, addComponent, resetDb, seedFixtures, type Fixtures } from "../helpers/db";
import { pinNow } from "../helpers/pin-now";

// Tanggal tetap di masa lalu + aturan mundur 365 hari → titik awal waktu dipatok agar tes tidak membusuk (lihat helpers/pin-now.ts).
pinNow();

let fx: Fixtures;
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const AYU = 0;

/** Hari kerja (Sen–Jum) terdekat setelah `plus` hari dari hari ini — agar tes tidak bergantung tanggal sistem. */
function workday(plus: number): string {
  let d = addDays(todayIso("Asia/Jakarta"), plus);
  while (isoWeekday(d) > 5) d = addDays(d, 1);
  return d;
}

const RULES = {
  lateMode: "NONE", lateAmount: 0, absenceMode: "NONE", absenceAmount: 0, absenceDivisor: null, izinDeductsPay: true, sakitDeductsPay: false, cutiDeductsPay: false,
  overtimeMode: "APPROVED", overtimeRatePerHour: 20_000, overtimeMinMinutes: 60, overtimeMaxMinutesPerDay: 240,
} as const;

beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
  await updateAttendancePolicy(fx.superAdmin, {
    lateMinutesAfterTolerance: false, locationEnabled: false, locationName: null, locationLat: null, locationLng: null, locationRadiusMeters: 100,
    locationMaxAccuracyMeters: 150, requestBackdateDays: 365, annualLeaveQuota: 12, allowNegativeLeaveBalance: false,
  });
});

const submit = (date: string, minutes = 120, over: Record<string, unknown> = {}) =>
  submitOvertime(fx.emp1, { date, startTime: "16:00", minutes, reason: "Menyelesaikan laporan akhir bulan", ...over });

describe("pengajuan lembur — alur & aturan", () => {
  it("diajukan → HR menerima notifikasi; karyawan melihat statusnya; jam selesai dihitung (melewati tengah malam ditandai)", async () => {
    const o = await submit("2026-03-03", 120);
    expect(o.status).toBe("PENDING");
    expect(o.endTime).toBe("18:00");
    expect(o.endsNextDay).toBe(false);
    const late = await submitOvertime(fx.emp1, { date: "2026-03-04", startTime: "22:00", minutes: 180, reason: "Migrasi sistem malam hari" });
    expect(late.endTime).toBe("01:00");
    expect(late.endsNextDay).toBe(true);
    expect((await listNotifications(fx.hr)).items.some((n) => n.type === "overtime.submitted")).toBe(true);
    expect((await listNotifications(fx.superAdmin)).items.some((n) => n.type === "overtime.submitted")).toBe(true);
    expect((await listMyOvertime(fx.emp1))).toHaveLength(2);
    expect((await listMyOvertime(fx.emp2))).toHaveLength(0);
  });

  it("validasi: durasi < 15 / > 12 jam, tanggal terlalu lampau/jauh, alasan wajib, format jam", async () => {
    expect((await fail(submit("2026-03-03", 10)))?.fieldErrors?.minutes).toMatch(/15 menit/);
    expect((await fail(submit("2026-03-03", 721)))?.fieldErrors?.minutes).toMatch(/12 jam/);
    expect((await fail(submit("2026-03-03", 60, { reason: "" })))?.code).toBe("VALIDATION");
    expect((await fail(submit("2026-03-03", 60, { startTime: "25:00" })))?.fieldErrors?.startTime).toBeTruthy();
    await updateAttendancePolicy(fx.superAdmin, { lateMinutesAfterTolerance: false, locationEnabled: false, locationName: null, locationLat: null, locationLng: null, locationRadiusMeters: 100, locationMaxAccuracyMeters: 150, requestBackdateDays: 7, annualLeaveQuota: 12, allowNegativeLeaveBalance: false });
    expect((await fail(submit("2026-03-03", 60)))?.fieldErrors?.date).toBeTruthy(); // lampau
    expect((await fail(submit("2030-01-01", 60)))?.fieldErrors?.date).toBeTruthy(); // > 30 hari ke depan
  });

  it("satu pengajuan terbuka per tanggal (juga saat serentak); yang ditolak/dibatalkan tidak menghalangi", async () => {
    const r = await Promise.allSettled(Array.from({ length: 4 }, () => submit("2026-03-05")));
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(r.filter((x) => x.status === "rejected").every((x) => (x as PromiseRejectedResult).reason.code === "CONFLICT")).toBe(true);
    const only = (await listMyOvertime(fx.emp1))[0]!;
    await reviewOvertime(fx.hr, only.id, { decision: "REJECT", note: "Tidak diperlukan" });
    expect(await fail(submit("2026-03-05"))).toBeNull();
  });

  it("tanggal di hari cuti/izin sehari penuh yang disetujui ditolak; setengah hari boleh", async () => {
    const d1 = workday(5), d2 = workday(8) === d1 ? workday(9) : workday(8);
    const l = await submitLeave(fx.emp1, { type: "IZIN", startDate: d1, endDate: d1, reason: "Izin seharian penuh" });
    await reviewLeave(fx.hr, l.id, { decision: "APPROVE" });
    expect((await fail(submit(d1)))?.code).toBe("CONFLICT");
    const half = await submitLeave(fx.emp1, { type: "IZIN", startDate: d2, endDate: d2, dayPart: "MORNING", reason: "Izin pagi hari saja" });
    await reviewLeave(fx.hr, half.id, { decision: "APPROVE" });
    expect(await fail(submit(d2))).toBeNull();
  });

  it("persetujuan: menit disetujui boleh lebih kecil, tidak boleh lebih besar; menolak wajib catatan", async () => {
    const o = await submit("2026-03-03", 120);
    expect((await fail(reviewOvertime(fx.hr, o.id, { decision: "APPROVE", approvedMinutes: 121 })))?.fieldErrors?.approvedMinutes).toBeTruthy();
    expect((await fail(reviewOvertime(fx.hr, o.id, { decision: "REJECT" })))?.fieldErrors?.note).toBeTruthy();
    const r = await reviewOvertime(fx.hr, o.id, { decision: "APPROVE", approvedMinutes: 90, note: "Disetujui 1,5 jam" });
    expect(r.overtime.status).toBe("APPROVED");
    expect(r.overtime.approvedMinutes).toBe(90);
    expect((await listNotifications(fx.emp1)).items.some((n) => n.type === "overtime.reviewed" && n.body?.includes("1 j 30 m"))).toBe(true);
    // tidak dapat diproses dua kali
    expect((await fail(reviewOvertime(fx.hr, o.id, { decision: "REJECT", note: "Terlambat" })))?.code).toBe("CONFLICT");
  });

  it("persetujuan serentak oleh dua pemroses → hanya satu yang menang", async () => {
    const o = await submit("2026-03-03", 120);
    const r = await Promise.allSettled([reviewOvertime(fx.hr, o.id, { decision: "APPROVE" }), reviewOvertime(fx.superAdmin, o.id, { decision: "APPROVE" }), reviewOvertime(fx.hr, o.id, { decision: "REJECT", note: "Tidak" })]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  });

  it("izin: karyawan tidak dapat memproses; HR tidak dapat memproses lemburnya sendiri (Super Admin boleh); karyawan lain tidak dapat membatalkan", async () => {
    const o = await submit("2026-03-03", 120);
    expect((await fail(reviewOvertime(fx.emp2, o.id, { decision: "APPROVE" })))?.code).toBe("FORBIDDEN");
    expect((await fail(listOvertime(fx.emp1)))?.code).toBe("FORBIDDEN");
    expect((await fail(cancelOvertime(fx.emp2, o.id, {})))?.code).toBe("FORBIDDEN");
    // HR yang juga karyawan
    const hrEmp = await prisma.employee.create({ data: { employeeNo: "TE-HR", fullName: "HR Uji", position: "HR", employmentStatus: "PERMANENT", joinDate: isoToDate("2025-01-01"), userId: fx.hr.userId } });
    const hrActor = { ...fx.hr, employeeId: hrEmp.id };
    const own = await submitOvertime(hrActor, { date: "2026-03-03", startTime: "16:00", minutes: 60, reason: "Lembur HR sendiri" });
    expect((await fail(reviewOvertime(hrActor, own.id, { decision: "APPROVE" })))?.message).toContain("sendiri");
    expect((await reviewOvertime(fx.superAdmin, own.id, { decision: "APPROVE" })).overtime.status).toBe("APPROVED");
  });

  it("pembatalan: karyawan hanya yang menunggu; yang disetujui hanya HR dengan alasan; riwayat tidak bisa diubah langsung di database", async () => {
    const o = await submit("2026-03-03", 120);
    const c = await cancelOvertime(fx.emp1, o.id, {});
    expect(c.overtime.status).toBe("CANCELLED");
    const o2 = await submit("2026-03-04", 120);
    await reviewOvertime(fx.hr, o2.id, { decision: "APPROVE" });
    expect((await fail(cancelOvertime(fx.emp1, o2.id, {})))?.code).toBe("FORBIDDEN");
    expect((await fail(cancelOvertime(fx.hr, o2.id, {})))?.fieldErrors?.reason).toBeTruthy();
    expect((await cancelOvertime(fx.hr, o2.id, { reason: "Pekerjaan batal" })).overtime.status).toBe("CANCELLED");
    // guard trigger: isi pengajuan yang sudah diputuskan beku
    const o3 = await submit("2026-03-05", 120);
    await reviewOvertime(fx.hr, o3.id, { decision: "APPROVE", approvedMinutes: 60 });
    await expect(prisma.$executeRaw`UPDATE overtime_requests SET "approvedMinutes" = 120 WHERE id = ${o3.id}::uuid`).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.$executeRaw`DELETE FROM overtime_requests WHERE id = ${o3.id}::uuid`).rejects.toThrow(/HRIS-GUARD/);
  });
});

// ─────────────────────────── Lembur → penggajian ───────────────────────────

async function seedPayroll(over: { components?: boolean } = {}) {
  await updatePayrollRules(fx.superAdmin, { ...RULES });
  await confirmPayrollRules(fx.superAdmin);
  if (over.components !== false) await addComponent(fx.empIds[AYU], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 5_000_000 });
}
const PERIOD = { label: "Gaji Maret 2026", periodStart: "2026-03-01", periodEnd: "2026-03-31" };

describe("lembur disetujui → gaji", () => {
  it("dibayar sesuai bukti absensi; di bawah ambang/tanpa bukti tidak dibayar; perubahan persetujuan setelah dihitung = 'data berubah'", async () => {
    await seedPayroll();
    // Selasa 3 Mar: pulang 18:10 (130 mnt setelah jam pulang); Rabu 4 Mar: pulang 16:20 (20 mnt); Kamis 5 Mar: tanpa check-out
    await addAttendance(fx.empIds[AYU], "2026-03-03", "08:00", "18:10");
    await addAttendance(fx.empIds[AYU], "2026-03-04", "08:00", "16:20");
    await addAttendance(fx.empIds[AYU], "2026-03-05", "08:00", null);
    const a = await submit("2026-03-03", 120), b = await submit("2026-03-04", 120), c = await submit("2026-03-05", 120);
    for (const o of [a, b, c]) await reviewOvertime(fx.hr, o.id, { decision: "APPROVE" });

    const { id } = await createRun(fx.hr, PERIOD);
    const item = (await getRun(fx.hr, id)).items.find((i) => i.employeeNo === "TE-001")!;
    const detail = await getItem(fx.hr, item.id);
    const ot = detail.lines.find((l) => l.source === "RULE_OVERTIME")!;
    expect(ot.amount).toBe(40_000); // hanya 2 jam pada 3 Mar
    expect(ot.name).toBe("Lembur (disetujui)");
    expect(detail.item.warnings.join(" ")).toContain("tidak dihitung");
    expect(detail.attendance.overtime).toEqual({ approvedMinutes: 360, paidMinutes: 120, days: 1 });
    expect(item.stale).toBe(false);

    // Persetujuan baru setelah dihitung → periode ditandai berubah dan pengajuan diblokir.
    const d = await submit("2026-03-06", 60);
    await reviewOvertime(fx.hr, d.id, { decision: "APPROVE" });
    const run2 = await getRun(fx.hr, id);
    expect(run2.staleCount).toBe(1);
    expect((await fail(submitRun(fx.hr, id)))?.message).toMatch(/berubah/);
  });

  it("jam mulai lembur dinilai: check-out 17:00 untuk lembur 18:00–19:00 tidak dibayar; check-in setelah jam pulang tidak dihitung dari jam pulang", async () => {
    await seedPayroll();
    await addAttendance(fx.empIds[AYU], "2026-03-03", "08:00", "17:00"); // pulang 16:00, check-out 17:00, lembur disetujui 18:00–19:00
    await addAttendance(fx.empIds[AYU], "2026-03-04", "17:30", "19:00"); // baru check-in setelah jam pulang; lembur disetujui 17:00–19:00
    const a = await submit("2026-03-03", 60, { startTime: "18:00" });
    const b = await submit("2026-03-04", 120, { startTime: "17:00" });
    for (const o of [a, b]) await reviewOvertime(fx.hr, o.id, { decision: "APPROVE" });

    const { id } = await createRun(fx.hr, PERIOD);
    const d = await getItem(fx.hr, (await getRun(fx.hr, id)).items.find((i) => i.employeeNo === "TE-001")!.id);
    expect(d.lines.find((l) => l.source === "RULE_OVERTIME")!.amount).toBe(30_000); // hanya 90 mnt (17:30–19:00) pada 4 Mar
    expect(d.attendance.overtime).toEqual({ approvedMinutes: 180, paidMinutes: 90, days: 1 });
    const w = d.item.warnings.join(" ");
    expect(w).toContain("03/03/2026");
    expect(w).toContain("18:00–19:00");
    expect(w).toContain("tidak terbukti di absensi");
  });

  it("pembatalan lembur disetujui memicu 'data berubah' dan memberi catatan periode gaji yang terdampak", async () => {
    await seedPayroll();
    await addAttendance(fx.empIds[AYU], "2026-03-03", "08:00", "18:10");
    const a = await submit("2026-03-03", 120);
    await reviewOvertime(fx.hr, a.id, { decision: "APPROVE" });
    const { id } = await createRun(fx.hr, PERIOD);
    await submitRun(fx.hr, id);
    const r = await cancelOvertime(fx.hr, a.id, { reason: "Salah input" });
    expect(r.payrollNotices.some((n) => n.includes("Gaji Maret 2026") && n.includes("menunggu persetujuan"))).toBe(true);
    expect((await getRun(fx.hr, id)).staleCount).toBe(1);
    expect((await fail(approveRun(fx.superAdmin, id)))?.message).toMatch(/berubah/);
  });

  it("mode MANUAL: lembur disetujui tidak dibayar otomatis (peringatan)", async () => {
    await updatePayrollRules(fx.superAdmin, { ...RULES, overtimeMode: "MANUAL" });
    await addComponent(fx.empIds[AYU], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 5_000_000 });
    await addAttendance(fx.empIds[AYU], "2026-03-03", "08:00", "18:10");
    const a = await submit("2026-03-03", 120);
    await reviewOvertime(fx.hr, a.id, { decision: "APPROVE" });
    const { id } = await createRun(fx.hr, PERIOD);
    const item = (await getRun(fx.hr, id)).items[0]!;
    const d = await getItem(fx.hr, item.id);
    expect(d.lines.some((l) => l.source === "RULE_OVERTIME")).toBe(false);
    expect(d.item.warnings.join(" ")).toContain("lembur disetujui");
  });

  it("aturan: tarif dari gaji pokok ÷ 173 dengan pengali 1,5×/2× tersimpan & dipakai", async () => {
    await updatePayrollRules(fx.superAdmin, { ...RULES, overtimeRatePerHour: 0, overtimeRateMode: "SALARY_DIVISOR", overtimeSalaryDivisor: 173, overtimeFirstHourBp: 15_000, overtimeNextHoursBp: 20_000 });
    await addComponent(fx.empIds[AYU], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 17_300_000 });
    await addAttendance(fx.empIds[AYU], "2026-03-03", "08:00", "18:30"); // 150 menit setelah jam pulang
    const a = await submit("2026-03-03", 150);
    await reviewOvertime(fx.hr, a.id, { decision: "APPROVE" });
    const { id } = await createRun(fx.hr, PERIOD);
    const d = await getItem(fx.hr, (await getRun(fx.hr, id)).items[0]!.id);
    // 100.000/jam × (60 mnt × 1,5 + 90 mnt × 2) / 60 = 100.000 × 270 / 60 = 450.000
    expect(d.lines.find((l) => l.source === "RULE_OVERTIME")!.amount).toBe(450_000);
    expect(d.lines.find((l) => l.source === "RULE_OVERTIME")!.formula).toContain("÷ 173");
  });

  it("validasi aturan: mode otomatis tanpa tarif ditolak; max < min ditolak; pengali < 1× ditolak", async () => {
    expect((await fail(updatePayrollRules(fx.superAdmin, { ...RULES, overtimeRatePerHour: 0 })))?.fieldErrors?.overtimeRatePerHour).toBeTruthy();
    expect((await fail(updatePayrollRules(fx.superAdmin, { ...RULES, overtimeMinMinutes: 120, overtimeMaxMinutesPerDay: 60 })))?.fieldErrors?.overtimeMaxMinutesPerDay).toBeTruthy();
    expect((await fail(updatePayrollRules(fx.superAdmin, { ...RULES, overtimeFirstHourBp: 5000 })))?.fieldErrors?.overtimeFirstHourBp).toBeTruthy();
    expect(await fail(updatePayrollRules(fx.superAdmin, { ...RULES, overtimeRatePerHour: 0, overtimeRateMode: "SALARY_DIVISOR" }))).toBeNull();
  });
});

// ─────────────────────────── BPJS & PPh 21 ───────────────────────────

function statutoryOn(over: (c: ReturnType<typeof defaultStatutoryConfig>) => void = () => undefined) {
  const c = defaultStatutoryConfig();
  c.bpjs.enabled = true; c.pph21.enabled = true;
  over(c);
  return updateStatutoryConfig(fx.superAdmin, c);
}

describe("BPJS & PPh 21 otomatis — penggajian", () => {
  it("menghasilkan potongan BPJS karyawan + PPh 21 TER; beban perusahaan tersimpan; slip memuatnya; gaji bersih sesuai hitungan manual", async () => {
    await updatePayrollRules(fx.superAdmin, { ...RULES, overtimeMode: "MANUAL" });
    await statutoryOn();
    await confirmPayrollRules(fx.superAdmin);
    await addComponent(fx.empIds[AYU], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 8_000_000 });
    const { id } = await createRun(fx.hr, { label: "Gaji Februari 2026", periodStart: "2026-02-01", periodEnd: "2026-02-28" });
    const item = (await getRun(fx.hr, id)).items[0]!;
    const d = await getItem(fx.hr, item.id);
    const by = (n: string) => d.lines.find((l) => l.name.startsWith(n))!.amount;
    expect(by("BPJS Kesehatan")).toBe(80_000);
    expect(by("BPJS JHT")).toBe(160_000);
    expect(by("BPJS JP")).toBe(80_000);
    // bruto 8.000.000 + premi perusahaan (Kes 320.000 + JKK 19.200 + JKM 24.000) = 8.363.200 → TER A 1,5% = 125.448
    expect(by("PPh 21")).toBe(125_448);
    expect(d.item.netPay).toBe(8_000_000 - 320_000 - 125_448);
    expect(d.statutory!.bpjs!.employerTotal).toBe(320_000 + 296_000 + 160_000 + 19_200 + 24_000);
    expect(d.lines.filter((l) => l.source === "RULE_STATUTORY")).toHaveLength(4);

    await submitRun(fx.hr, id);
    await approveRun(fx.superAdmin, id);
    await issueRun(fx.hr, id);
    const slip = (await getRunPayslips(fx.hr, id))[0]!;
    expect(slip.snapshot.netPay).toBe(8_000_000 - 320_000 - 125_448);
    expect(slip.snapshot.employerContributions?.map((x) => x.name)).toEqual(["BPJS Kesehatan (4%)", "BPJS JHT (3,7%)", "BPJS JP (2%)", "BPJS JKK (0,24%)", "BPJS JKM (0,3%)"]);
    // beban perusahaan TIDAK mengurangi gaji bersih
    expect(slip.snapshot.totalDeductions).toBe(320_000 + 125_448);
  });

  it("mengubah konfigurasi mencabut konfirmasi aturan (gaji tidak dapat disetujui sampai dikonfirmasi ulang)", async () => {
    await updatePayrollRules(fx.superAdmin, { ...RULES, overtimeMode: "MANUAL" });
    await confirmPayrollRules(fx.superAdmin);
    await addComponent(fx.empIds[AYU], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 5_000_000 });
    const { id } = await createRun(fx.hr, { label: "Gaji Februari 2026", periodStart: "2026-02-01", periodEnd: "2026-02-28" });
    await submitRun(fx.hr, id);
    await statutoryOn();
    expect((await fail(approveRun(fx.superAdmin, id)))?.message).toContain("belum dikonfirmasi");
    await confirmPayrollRules(fx.superAdmin);
    // periode dihitung SEBELUM konfigurasi → tanpa baris statutori, snapshot aturan berisi statutory null
    expect((await getItem(fx.hr, (await getRun(fx.hr, id)).items[0]!.id)).lines.some((l) => l.source === "RULE_STATUTORY")).toBe(false);
  });

  it("hanya Super Admin dapat mengubah konfigurasi; HR ditolak; tarif/tabel tidak valid ditolak dengan pesan jelas", async () => {
    const c = defaultStatutoryConfig();
    expect((await fail(updateStatutoryConfig(fx.hr, c)))?.code).toBe("FORBIDDEN");
    const bad = defaultStatutoryConfig();
    bad.pph21.ter.A[3]!.upTo = 1000; // tidak naik
    expect((await fail(updateStatutoryConfig(fx.superAdmin, bad)))?.message).toMatch(/batas atas harus naik/);
    const bad2 = defaultStatutoryConfig();
    bad2.pph21.brackets[bad2.pph21.brackets.length - 1]!.upTo = 999;
    expect((await fail(updateStatutoryConfig(fx.superAdmin, bad2)))?.message).toMatch(/terakhir harus tanpa batas/);
    const bad3 = defaultStatutoryConfig();
    bad3.bpjs.healthEmployeeBp = 9999;
    expect((await fail(updateStatutoryConfig(fx.superAdmin, bad3)))?.message).toMatch(/terlalu besar/);
    expect((await fail(updateStatutoryConfig(fx.superAdmin, { version: 1 })))?.code).toBe("VALIDATION");
  });

  it("komponen BPJS manual menang; status PTKP & NPWP & kepesertaan karyawan dipakai", async () => {
    await updatePayrollRules(fx.superAdmin, { ...RULES, overtimeMode: "MANUAL" });
    await statutoryOn((c) => { c.pph21.employerInsuranceInGross = false; });
    const [ayu, budi, citra] = fx.empIds;
    for (const e of [ayu, budi, citra]) await addComponent(e, fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 10_000_000 });
    await addComponent(budi, fx.hr.userId, { category: "BPJS", name: "BPJS manual", calc: "PERCENT_OF_BASE", percentBp: 100 });
    // Citra: K3 (kategori C), tanpa NPWP, bukan peserta BPJS Ketenagakerjaan
    const emp = await prisma.employee.findUniqueOrThrow({ where: { id: citra } });
    await updateEmployee(fx.hr, citra, {
      employeeNo: emp.employeeNo, fullName: emp.fullName, position: emp.position, employmentStatus: emp.employmentStatus, joinDate: "2025-01-01",
      taxStatus: "K3", hasNpwp: false, bpjsEmploymentEnrolled: false,
    });
    const { id } = await createRun(fx.hr, { label: "Gaji Februari 2026", periodStart: "2026-02-01", periodEnd: "2026-02-28" });
    const items = (await getRun(fx.hr, id)).items;
    const detail = async (no: string) => getItem(fx.hr, items.find((i) => i.employeeNo === no)!.id);
    const a = await detail("TE-001"), b = await detail("TE-002"), c = await detail("TE-003");
    expect(a.lines.find((l) => l.name.startsWith("PPh 21"))!.amount).toBe(200_000); // TK0, kategori A: 10 jt → 2%
    // Budi: BPJS manual 1% (100.000) menggantikan otomatis; PPh tetap otomatis
    expect(b.lines.filter((l) => l.category === "BPJS").map((l) => [l.name, l.source])).toEqual([["BPJS manual", "COMPONENT"]]);
    expect(b.item.warnings.join(" ")).toContain("BPJS manual");
    expect(b.statutory!.bpjs).toBeNull();
    // Citra: K3 → kategori C 1,5% × 120% (tanpa NPWP) = 180.000; hanya BPJS Kesehatan
    expect(c.lines.find((l) => l.name.startsWith("PPh 21"))!.amount).toBe(180_000);
    expect(c.lines.filter((l) => l.category === "BPJS").map((l) => l.name)).toEqual(["BPJS Kesehatan (1%)"]);
  });

  it("karyawan magang baru otomatis bukan peserta BPJS (dapat diubah)", async () => {
    const { createEmployee } = await import("@/server/services/employees");
    const e = await createEmployee(fx.hr, { employeeNo: "MG-001", fullName: "Magang Uji", position: "Magang", employmentStatus: "INTERN", joinDate: "2026-01-05" });
    expect(e.bpjsHealthEnrolled).toBe(false);
    expect(e.bpjsEmploymentEnrolled).toBe(false);
    expect(e.taxStatus).toBe("TK0");
    expect(e.hasNpwp).toBe(true);
    const k = await createEmployee(fx.hr, { employeeNo: "KT-001", fullName: "Kontrak Uji", position: "Staf", employmentStatus: "CONTRACT", joinDate: "2026-01-05" });
    expect(k.bpjsHealthEnrolled).toBe(true);
  });

  it("masa pajak terakhir (Desember): true-up memakai PPh yang sudah dipotong pada periode DISETUJUI/TERBIT sebelumnya + peringatan data tidak lengkap", async () => {
    await updatePayrollRules(fx.superAdmin, { ...RULES, overtimeMode: "MANUAL" });
    await statutoryOn((c) => { c.bpjs.enabled = false; });
    await confirmPayrollRules(fx.superAdmin);
    await addComponent(fx.empIds[AYU], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 10_000_000, from: "2025-01-01" });
    // November 2025: TER A 10 jt → 2% = 200.000 → disetujui
    const nov = await createRun(fx.hr, { label: "Gaji November 2025", periodStart: "2025-11-01", periodEnd: "2025-11-30" });
    expect((await getItem(fx.hr, (await getRun(fx.hr, nov.id)).items[0]!.id)).lines.find((l) => l.name.startsWith("PPh 21"))!.amount).toBe(200_000);
    await submitRun(fx.hr, nov.id);
    await approveRun(fx.superAdmin, nov.id);
    // Desember 2025: masa terakhir. Setahun (data tercatat 2 bulan): bruto 20 jt − biaya jabatan 1 jt (5%, maks 500 rb × 2) = 19 jt
    // − PTKP TK0 54 jt × 2/12 = 9 jt → PKP 10 jt → 5% = 500.000 − 200.000 = 300.000
    const dec = await createRun(fx.hr, { label: "Gaji Desember 2025", periodStart: "2025-12-01", periodEnd: "2025-12-31" });
    const d = await getItem(fx.hr, (await getRun(fx.hr, dec.id)).items[0]!.id);
    const tax = d.lines.find((l) => l.name.startsWith("PPh 21"))!;
    expect(tax.name).toBe("PPh 21 (masa pajak terakhir)");
    expect(tax.amount).toBe(300_000);
    expect(d.statutory!.finalPeriod).toBe(true);
    expect(d.item.warnings.join(" ")).toContain("1 dari 11");
  });

  it("karyawan yang berhenti di tengah tahun → periode terakhirnya diperlakukan sebagai masa pajak terakhir", async () => {
    await updatePayrollRules(fx.superAdmin, { ...RULES, overtimeMode: "MANUAL" });
    await statutoryOn((c) => { c.bpjs.enabled = false; });
    await addComponent(fx.empIds[AYU], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 10_000_000, from: "2025-01-01" });
    await prisma.employee.update({ where: { id: fx.empIds[AYU] }, data: { isActive: false, endDate: isoToDate("2025-06-30") } });
    const run = await createRun(fx.hr, { label: "Gaji Juni 2025", periodStart: "2025-06-01", periodEnd: "2025-06-30" });
    const d = await getItem(fx.hr, (await getRun(fx.hr, run.id)).items[0]!.id);
    expect(d.statutory!.finalPeriod).toBe(true);
    expect(d.statutory!.pph21!.method).toBe("ANNUAL");
  });

  it("tanpa konfigurasi (bawaan) tidak ada baris statutori sama sekali (perilaku Tahap 1 terjaga)", async () => {
    await updatePayrollRules(fx.superAdmin, { ...RULES, overtimeMode: "MANUAL" });
    await addComponent(fx.empIds[AYU], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 5_000_000 });
    const { id } = await createRun(fx.hr, PERIOD);
    const d = await getItem(fx.hr, (await getRun(fx.hr, id)).items[0]!.id);
    expect(d.lines.some((l) => l.source === "RULE_STATUTORY")).toBe(false);
    expect(d.statutory).toBeNull();
    expect(d.item.netPay).toBe(5_000_000);
  });
});
