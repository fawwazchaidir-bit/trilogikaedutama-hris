/**
 * Data DEMONSTRASI (fiktif) untuk menguji seluruh alur aplikasi. Dipakai oleh `seed-dev.ts` (CLI) dan E2E.
 * Semua nama, nomor rekening, dan nominal di sini FIKTIF. Akun yang dibuat ditandai `isDemo` (banner peringatan di UI).
 * Rentang data dihitung relatif terhadap "hari ini", sehingga selalu tampak segar.
 */
import { PrismaClient, type Role } from "@prisma/client";
import { hashPassword } from "../src/server/auth/password";
import { encryptField } from "../src/server/crypto";
import type { Actor } from "../src/server/actor";
import { confirmPayrollRules, updateAttendancePolicy, updatePayrollRules } from "../src/server/services/settings";
import { createRun, approveRun, issueRun, submitRun } from "../src/server/services/payroll";
import { reviewLeave, submitLeave } from "../src/server/services/leave";
import { addDays, isoWeekday, monthRange, todayIso, localMinutes } from "../src/lib/time";
import { monthLabel } from "../src/lib/format";

const D = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const WIB = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+07:00`);
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;

function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIVISIONS = ["Operasional", "Pemasaran", "Keuangan & Admin", "Akademik"] as const;

type Seedling = { no: string; name: string; div: (typeof DIVISIONS)[number]; pos: string; status: "PERMANENT" | "CONTRACT" | "INTERN"; join: string; base: number; allowance?: number };
const STAFF: Seedling[] = [
  { no: "DEMO-001", name: "Ayu Lestari", div: "Operasional", pos: "Staf Operasional", status: "PERMANENT", join: "2024-03-04", base: 5_500_000 },
  { no: "DEMO-002", name: "Budi Santoso", div: "Operasional", pos: "Koordinator Pelatihan", status: "PERMANENT", join: "2023-07-10", base: 7_000_000, allowance: 500_000 },
  { no: "DEMO-003", name: "Citra Dewi", div: "Pemasaran", pos: "Staf Pemasaran Digital", status: "CONTRACT", join: "2025-02-03", base: 5_000_000 },
  { no: "DEMO-004", name: "Dimas Prakoso", div: "Pemasaran", pos: "Account Executive", status: "PERMANENT", join: "2022-11-14", base: 6_500_000, allowance: 500_000 },
  { no: "DEMO-005", name: "Eka Putri", div: "Keuangan & Admin", pos: "Staf Administrasi", status: "PERMANENT", join: "2024-08-19", base: 5_000_000 },
  { no: "DEMO-006", name: "Fajar Nugroho", div: "Keuangan & Admin", pos: "Staf Keuangan", status: "CONTRACT", join: "2025-05-05", base: 5_800_000 },
  { no: "DEMO-007", name: "Gita Maharani", div: "Akademik", pos: "Instruktur", status: "PERMANENT", join: "2023-01-16", base: 7_500_000, allowance: 500_000 },
  { no: "DEMO-008", name: "Hendra Wijaya", div: "Akademik", pos: "Asesor Kompetensi", status: "PERMANENT", join: "2022-06-01", base: 8_500_000, allowance: 1_000_000 },
  { no: "DEMO-009", name: "Intan Permata", div: "Akademik", pos: "Staf Kurikulum", status: "CONTRACT", join: "2025-09-01", base: 5_200_000 },
  { no: "DEMO-010", name: "Joko Susilo", div: "Operasional", pos: "Staf Logistik (Magang)", status: "INTERN", join: "2026-06-01", base: 2_500_000 },
  { no: "DEMO-011", name: "Kirana Ayu", div: "Pemasaran", pos: "Desainer Grafis", status: "CONTRACT", join: "2025-10-06", base: 5_300_000 },
  { no: "DEMO-012", name: "Lukman Hakim", div: "Operasional", pos: "Staf Umum", status: "PERMANENT", join: "2021-02-01", base: 4_800_000 },
];

export const DEMO_ACCOUNTS = {
  pimpinan: "pimpinan@demo.hris.test",
  hr: "hr@demo.hris.test",
  ayu: "ayu@demo.hris.test",
  budi: "budi@demo.hris.test",
  citra: "citra@demo.hris.test",
} as const;

export async function seedDemo(prisma: PrismaClient, opts: { password: string; now?: Date }) {
  const now = opts.now ?? new Date();
  const tz = process.env.APP_TIMEZONE ?? "Asia/Jakarta";
  const today = todayIso(tz, now);
  const R = rng(20260101);
  const passwordHash = await hashPassword(opts.password);

  // ── Lembaga & kebijakan ──
  await prisma.companySettings.upsert({
    where: { id: 1 }, update: {},
    create: { id: 1, name: "Trilogika Edutama (Demo)", tagline: "Light & Insight", address: "Jl. Contoh No. 1, Sleman, D.I. Yogyakarta (alamat fiktif)", phone: "0274-000000", email: "hr@demo.hris.test", slipFooterNote: "Slip gaji DEMO — data fiktif untuk pengujian." },
  });
  const sched = (await prisma.workSchedule.findFirst({ where: { isDefault: true } })) ?? await prisma.workSchedule.create({
    data: { name: "Reguler", description: "Contoh: Senin–Jumat 08.00–16.00 WIB", workDays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "16:00", lateToleranceMinutes: 15, absentCutoffTime: "12:00", isDefault: true },
  });
  const ramadan = await prisma.workSchedule.upsert({
    where: { id: "00000000-0000-0000-0000-00000000aaaa" }, update: {},
    create: { id: "00000000-0000-0000-0000-00000000aaaa", name: "Ramadan (contoh)", description: "Contoh jadwal sementara — tanggal penugasan hanya ilustrasi, sesuaikan", workDays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "15:00", lateToleranceMinutes: 15, absentCutoffTime: "11:00" },
  });
  void sched; void ramadan;

  const divs = new Map<string, string>();
  for (const name of DIVISIONS) divs.set(name, (await prisma.division.create({ data: { name } })).id);

  // ── Karyawan & akun ──
  const make = async (s: Seedling, i: number) => {
    const acct = `70000000${100 + i}`.slice(0, 13);
    return prisma.employee.create({
      data: {
        employeeNo: s.no, fullName: s.name, divisionId: divs.get(s.div)!, position: s.pos, employmentStatus: s.status, joinDate: D(s.join),
        phone: `0812-0000-${String(1000 + i).slice(-4)}`, email: `${s.name.split(" ")[0]!.toLowerCase()}@demo.hris.test`, address: "Alamat fiktif untuk demonstrasi",
        bankName: "Bank Contoh", bankAccountEnc: encryptField(acct), bankAccountLast4: acct.slice(-4), bankAccountHolder: s.name,
      },
    });
  };
  const emps = [];
  for (let i = 0; i < STAFF.length; i++) emps.push(await make(STAFF[i]!, i + 1));
  const hrEmp = await prisma.employee.create({ data: { employeeNo: "DEMO-900", fullName: "Maya Anggraini", divisionId: divs.get("Keuangan & Admin")!, position: "Admin HR", employmentStatus: "PERMANENT", joinDate: D("2022-01-03"), email: DEMO_ACCOUNTS.hr } });
  const bossEmp = await prisma.employee.create({ data: { employeeNo: "DEMO-901", fullName: "Rudi Hartono", position: "Pimpinan (Demo)", employmentStatus: "PERMANENT", joinDate: D("2020-01-02"), email: DEMO_ACCOUNTS.pimpinan } });

  const mkUser = async (email: string, name: string, role: Role, employeeId: string) => {
    const u = await prisma.user.create({ data: { email, name, role, passwordHash, isDemo: true } });
    await prisma.employee.update({ where: { id: employeeId }, data: { userId: u.id } });
    return { userId: u.id, email, name, role, employeeId, ip: null, userAgent: "seed-demo" } satisfies Actor;
  };
  const sa = await mkUser(DEMO_ACCOUNTS.pimpinan, bossEmp.fullName, "SUPER_ADMIN", bossEmp.id);
  const hr = await mkUser(DEMO_ACCOUNTS.hr, hrEmp.fullName, "HR_ADMIN", hrEmp.id);
  const ayu = await mkUser(DEMO_ACCOUNTS.ayu, emps[0]!.fullName, "EMPLOYEE", emps[0]!.id);
  const budi = await mkUser(DEMO_ACCOUNTS.budi, emps[1]!.fullName, "EMPLOYEE", emps[1]!.id);
  const citra = await mkUser(DEMO_ACCOUNTS.citra, emps[2]!.fullName, "EMPLOYEE", emps[2]!.id);

  // ── Rentang data: awal bulan-2 s.d. kemarin ──
  const thisMonthStart = `${today.slice(0, 7)}-01`;
  const m1 = addDays(thisMonthStart, -1).slice(0, 7);
  const m2 = addDays(`${m1}-01`, -1).slice(0, 7);
  const rangeStart = `${m2}-01`;
  const yesterday = addDays(today, -1);

  // Kalender: hari libur nasional BERTANGGAL TETAP (contoh; admin wajib melengkapi libur lain sesuai SKB).
  const fixed = [["01-01", "Tahun Baru Masehi"], ["05-01", "Hari Buruh Internasional"], ["06-01", "Hari Lahir Pancasila"], ["08-17", "Hari Kemerdekaan RI"], ["12-25", "Hari Raya Natal"]] as const;
  const years = [...new Set([rangeStart.slice(0, 4), today.slice(0, 4), String(Number(today.slice(0, 4)) + 1)])];
  const holidays = new Set<string>();
  for (const y of years) for (const [md, name] of fixed) {
    await prisma.calendarDay.create({ data: { date: D(`${y}-${md}`), kind: "HOLIDAY", name: `${name} (contoh — verifikasi)`, createdById: hr.userId } });
    holidays.add(`${y}-${md}`);
  }
  await prisma.scheduleAssignment.create({
    data: { scheduleId: ramadan.id, scope: "ALL", startDate: D(`${Number(today.slice(0, 4)) + 1}-02-08`), endDate: D(`${Number(today.slice(0, 4)) + 1}-03-09`), note: "CONTOH tanggal Ramadan — ganti sesuai kalender resmi", createdById: hr.userId },
  });

  const isWork = (d: string) => isoWeekday(d) <= 5 && !holidays.has(d);
  const workdays: string[] = [];
  for (let d = rangeStart; d <= yesterday; d = addDays(d, 1)) if (isWork(d)) workdays.push(d);

  // Pengajuan disetujui (riwayat) — dipilih acak tanpa tumpang tindih.
  const leaveDays = new Map<string, Set<string>>();
  const grantYears = new Set([Number(rangeStart.slice(0, 4)), Number(today.slice(0, 4))]);
  for (const e of emps) for (const y of grantYears) {
    await prisma.leaveBalanceEntry.create({ data: { employeeId: e.id, year: y, kind: "GRANT", days: 12, note: `Kuota cuti tahunan ${y} (demo)`, createdById: hr.userId } });
  }
  const types: ("SAKIT" | "IZIN" | "CUTI")[] = ["SAKIT", "IZIN", "CUTI", "CUTI", "SAKIT"];
  for (let i = 0; i < emps.length; i++) {
    if (i === 0) continue; // Ayu: dibiarkan bersih agar alur pengajuan dapat dicoba
    const type = types[i % types.length]!;
    const span = type === "CUTI" ? 2 + Math.floor(R() * 2) : 1 + Math.floor(R() * 2);
    const startIdx = 2 + Math.floor(R() * Math.max(1, workdays.length - 8));
    const days = workdays.slice(startIdx, startIdx + span);
    if (days.length === 0) continue;
    const taken = leaveDays.get(emps[i]!.id) ?? new Set<string>();
    if (days.some((d) => taken.has(d))) continue;
    days.forEach((d) => taken.add(d)); leaveDays.set(emps[i]!.id, taken);
    const req = await prisma.leaveRequest.create({
      data: { employeeId: emps[i]!.id, type, startDate: D(days[0]!), endDate: D(days[days.length - 1]!), reason: type === "SAKIT" ? "Demam dan flu (demo)" : type === "IZIN" ? "Keperluan keluarga (demo)" : "Cuti tahunan (demo)",
        status: "APPROVED", workingDays: days.length, reviewedById: hr.userId, reviewedAt: new Date(`${days[0]!}T01:00:00Z`), reviewNote: "Disetujui (data demo)" },
    });
    if (type === "CUTI") await prisma.leaveBalanceEntry.create({ data: { employeeId: emps[i]!.id, year: Number(days[0]!.slice(0, 4)), kind: "USAGE", days: -days.length, requestId: req.id, note: "Cuti (demo)", createdById: hr.userId } });
  }

  // ── Absensi riwayat ──
  const att: { employeeId: string; date: Date; checkInAt: Date; checkOutAt: Date | null; source: string }[] = [];
  for (let i = 0; i < emps.length; i++) {
    const e = emps[i]!;
    for (const d of workdays) {
      if (d < STAFF[i]!.join) continue;
      if (leaveDays.get(e.id)?.has(d)) continue;
      const r = R();
      if (r < 0.035) continue; // tidak hadir
      const late = R() < 0.18;
      const inMin = late ? 8 * 60 + 16 + Math.floor(R() * 40) : 7 * 60 + 38 + Math.floor(R() * 36);
      const outMin = 16 * 60 + Math.floor(R() * 55);
      const missingOut = R() < 0.025;
      att.push({ employeeId: e.id, date: D(d), checkInAt: WIB(d, hhmm(inMin)), checkOutAt: missingOut ? null : WIB(d, hhmm(outMin)), source: "SELF" });
    }
  }
  await prisma.attendance.createMany({ data: att });

  // Hari ini: sebagian sudah check-in (Ayu/Budi/Citra sengaja belum, agar dapat dicoba).
  if (isWork(today) && localMinutes(now, tz) >= 8 * 60 + 30) {
    const todays = emps.slice(3).filter((_, k) => k % 3 !== 2).map((e) => ({ employeeId: e.id, date: D(today), checkInAt: WIB(today, hhmm(7 * 60 + 40 + Math.floor(R() * 45))), checkOutAt: null, source: "SELF" }));
    await prisma.attendance.createMany({ data: todays });
  }

  // ── Komponen gaji (nominal fiktif; BPJS/pajak = CONTOH persen, bukan tarif) ──
  for (let i = 0; i < STAFF.length; i++) {
    const s = STAFF[i]!; const id = emps[i]!.id;
    const c = (data: { category: "BASE_SALARY" | "POSITION_ALLOWANCE" | "TRANSPORT_ALLOWANCE" | "MEAL_ALLOWANCE" | "INCENTIVE" | "BPJS" | "LOAN"; name: string; amount?: number; calc?: "FIXED" | "PER_PRESENT_DAY" | "PERCENT_OF_BASE"; percentBp?: number; from?: string; to?: string | null; once?: boolean; description?: string }) =>
      prisma.salaryComponent.create({
        data: {
          employeeId: id, kind: data.category === "BPJS" || data.category === "LOAN" ? "DEDUCTION" : "EARNING", category: data.category, name: data.name, calc: data.calc ?? "FIXED",
          amount: BigInt(data.calc === "PERCENT_OF_BASE" ? 0 : data.amount ?? 0), percentBp: data.calc === "PERCENT_OF_BASE" ? data.percentBp ?? 0 : null,
          recurrence: data.once ? "ONE_TIME" : "RECURRING", effectiveFrom: D(data.from ?? "2025-01-01"), effectiveTo: data.once ? D(data.from!) : data.to ? D(data.to) : null, description: data.description ?? null, createdById: hr.userId,
        },
      });
    await c({ category: "BASE_SALARY", name: "Gaji pokok", amount: s.base, from: s.join < "2025-01-01" ? "2025-01-01" : s.join });
    if (s.allowance) await c({ category: "POSITION_ALLOWANCE", name: "Tunjangan jabatan", amount: s.allowance });
    if (s.status !== "INTERN") {
      await c({ category: "TRANSPORT_ALLOWANCE", name: "Tunjangan transportasi", calc: "PER_PRESENT_DAY", amount: 15_000 });
      await c({ category: "MEAL_ALLOWANCE", name: "Tunjangan makan", calc: "PER_PRESENT_DAY", amount: 20_000 });
      await c({ category: "BPJS", name: "BPJS (CONTOH 1% — isi sesuai ketentuan)", calc: "PERCENT_OF_BASE", percentBp: 100, description: "Contoh demo, bukan tarif resmi" });
    }
    if (s.no === "DEMO-006") await c({ category: "LOAN", name: "Cicilan kasbon", amount: 250_000, from: `${m2}-01`, to: monthRange(m1).to });
    if (s.no === "DEMO-004") await c({ category: "INCENTIVE", name: "Insentif penjualan (contoh)", amount: 750_000, from: `${m2}-15`, once: true });
  }

  // ── Kebijakan & aturan (nilai DEMO) ──
  await updateAttendancePolicy(sa, {
    lateMinutesAfterTolerance: false, locationEnabled: false, locationName: null, locationLat: null, locationLng: null, locationRadiusMeters: 100, locationMaxAccuracyMeters: 150,
    requestBackdateDays: 7, annualLeaveQuota: 12, allowNegativeLeaveBalance: false,
  });
  await updatePayrollRules(sa, {
    lateMode: "PER_MINUTE", lateAmount: 1000, absenceMode: "FIXED_PER_DAY", absenceAmount: 100_000, absenceDivisor: null, izinDeductsPay: true, sakitDeductsPay: false, cutiDeductsPay: false,
    overtimeMode: "MANUAL", overtimeRatePerHour: 0, overtimeMinMinutes: 60, overtimeMaxMinutesPerDay: 240,
  });
  await confirmPayrollRules(sa);

  // ── Penggajian: bulan-2 DITERBITKAN, bulan-1 MENUNGGU PERSETUJUAN ──
  const r2 = monthRange(m2), r1 = monthRange(m1);
  const run2 = await createRun(hr, { label: `Gaji ${monthLabel(m2)}`, periodStart: r2.from, periodEnd: r2.to });
  await submitRun(hr, run2.id); await approveRun(sa, run2.id, { note: "Disetujui (demo)" }); await issueRun(hr, run2.id, { issueDate: addDays(r2.to, 1) });
  const run1 = await createRun(hr, { label: `Gaji ${monthLabel(m1)}`, periodStart: r1.from, periodEnd: r1.to });
  await submitRun(hr, run1.id);

  // ── Pengajuan berjalan lewat service (alur nyata) ──
  const nextWork = (from: string, n: number) => { let d = from, k = 0; while (k < n) { d = addDays(d, 1); if (isWork(d)) k++; } return d; };
  const w1 = nextWork(today, 6), w2 = nextWork(today, 7), w3 = nextWork(today, 12);
  await submitLeave(ayu, { type: "CUTI", startDate: w1, endDate: w2, reason: "Cuti keluarga (pengajuan demo, menunggu persetujuan)" });
  await submitLeave(citra, { type: "IZIN", startDate: w3, endDate: w3, reason: "Mengurus dokumen pribadi (pengajuan demo)" });
  const future = await submitLeave(budi, { type: "CUTI", startDate: nextWork(today, 20), endDate: nextWork(today, 21), reason: "Liburan (demo, sudah disetujui)" });
  await reviewLeave(hr, future.id, { decision: "APPROVE", note: "Disetujui" });

  return { today, months: { issued: m2, pending: m1 }, accounts: DEMO_ACCOUNTS, employees: emps.length + 2 };
}
