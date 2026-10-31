import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, transaction } from "../db";
import { env } from "../env";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import { actorCan, assertCan, requireSelf, type Actor } from "../actor";
import { writeAudit } from "../audit";
import { dateToIso, isoToDate } from "../json";
import { computeEmployeePeriod, employeeLite, loadRangeContext } from "./context";
import { geoPolicyOf, getSettings } from "./settings";
import { evaluatePunchLocation, locationSchema, persistLocationCheck, type PunchContext } from "./location";
import { persistPunchPhoto, photoPolicyOf, preparePunchPhoto, type PhotoPolicy } from "./attendance-photo";
import { isOvernight, OVERNIGHT_CHECKOUT_GRACE_MINUTES, resolveSchedule, shiftWindow, type DayResult, type ScheduleLite } from "@/lib/attendance";
import { formatClock } from "@/lib/format";
import { hhmm, isoDate, optionalText, requiredText, uuid } from "@/lib/validation/common";
import { addDays, monthRange, todayIso, zonedInstant } from "@/lib/time";

export const punchSchema = z.object({
  note: optionalText(200, "Catatan"),
  location: locationSchema,
});

export interface TodayState {
  /** Waktu server (ISO) saat state dibuat — dasar jam yang ditampilkan di layar. */
  serverNow: string;
  /** Tanggal kalender hari ini (zona waktu bisnis). */
  today: string;
  /**
   * Tanggal KERJA yang sedang berlaku untuk absensi. Sama dengan `today`, kecuali shift malam kemarin masih berjalan
   * (mis. check-out pukul 06:00 menutup shift yang dimulai kemarin malam).
   */
  workDate: string;
  timeZone: string;
  schedule: ScheduleLite | null;
  day: DayResult;
  checkInAt: string | null;
  checkOutAt: string | null;
  checkInNote: string | null;
  checkOutNote: string | null;
  canCheckIn: boolean;
  canCheckOut: boolean;
  /** Alasan tombol tidak aktif (ditampilkan ke karyawan). */
  blockedReason: string | null;
  geo: { enabled: boolean; name: string | null; radiusMeters: number; maxAccuracyMeters: number };
  /** Foto absensi bercap: mode (OFF/OPTIONAL/REQUIRED) dan apakah lokasi wajib menyertai foto. */
  photo: PhotoPolicy;
  hasDefaultSchedule: boolean;
}

/**
 * Tanggal kerja untuk punch pada `now`. Shift malam dimiliki tanggal ia DIMULAI, jadi pada dini hari:
 *  - ada check-in kemarin yang belum check-out dan masih dalam masa tenggang → punch ini = check-out shift kemarin;
 *  - belum ada check-in kemarin tetapi shift malam kemarin belum berakhir → punch ini = check-in terlambat untuk shift kemarin;
 *  - selain itu → hari ini.
 */
async function resolveWorkDate(
  emp: { id: string; divisionId: string | null; joinDate: Date; endDate: Date | null },
  now: Date,
): Promise<string> {
  const tz = env().APP_TIMEZONE;
  const today = todayIso(tz, now);
  const yesterday = addDays(today, -1);
  if (dateToIso(emp.joinDate) > yesterday) return today;
  const ctx = await loadRangeContext(yesterday, yesterday, { employeeIds: [emp.id], now });
  const sched = resolveSchedule({
    date: yesterday, employeeId: emp.id, divisionId: emp.divisionId, assignments: ctx.assignments, schedules: ctx.schedules, defaultSchedule: ctx.defaultSchedule,
  });
  if (!sched || !isOvernight(sched)) return today;
  const att = await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: emp.id, date: isoToDate(yesterday) } } });
  const win = shiftWindow(yesterday, sched, tz);
  if (att) {
    return !att.checkOutAt && now.getTime() <= win.end.getTime() + OVERNIGHT_CHECKOUT_GRACE_MINUTES * 60_000 ? yesterday : today;
  }
  if (now.getTime() < win.end.getTime() && computeEmployeePeriod(employeeLite(emp), ctx).days[0]?.scheduled) return yesterday;
  return today;
}

/** Konteks hari kerja berjalan untuk satu karyawan: status turunan + apakah check-in/out boleh. */
async function dayContext(employeeId: string, now: Date, forceWorkDate?: string) {
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) throw Errors.notFound("Karyawan");
  const today = todayIso(env().APP_TIMEZONE, now);
  const workDate = forceWorkDate ?? (await resolveWorkDate(emp, now));
  const ctx = await loadRangeContext(workDate, workDate, { employeeIds: [employeeId], now });
  const lite = employeeLite(emp);
  const { days } = computeEmployeePeriod(lite, ctx);
  const schedule = resolveSchedule({
    date: workDate, employeeId, divisionId: emp.divisionId, assignments: ctx.assignments, schedules: ctx.schedules, defaultSchedule: ctx.defaultSchedule,
  });
  const att = await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId, date: isoToDate(workDate) } } });
  return { emp, today, workDate, ctx, day: days[0]!, schedule, att };
}

/** Pengajuan SEHARI PENUH yang disetujui menghalangi check-in; setengah hari tidak (karyawan tetap bekerja separuh hari). */
function fullDayLeave(day: DayResult): boolean {
  return (day.status === "IZIN" || day.status === "SAKIT" || day.status === "CUTI") && day.dayPart === "FULL";
}

export async function getTodayState(actor: Actor, now: Date = new Date(), opts: { workDate?: string } = {}): Promise<TodayState> {
  const employeeId = requireSelf(actor);
  const { emp, today, workDate, day, schedule, att } = await dayContext(employeeId, now, opts.workDate);
  const settings = await getSettings();
  const geo = geoPolicyOf(settings);
  let blockedReason: string | null = null;
  if (!emp.isActive) blockedReason = "Data karyawan Anda nonaktif.";
  else if (day.status === "DI_LUAR_MASA_KERJA") blockedReason = "Hari ini di luar masa kerja Anda.";
  else if (!att && fullDayLeave(day)) {
    blockedReason = `Anda memiliki ${day.status.toLowerCase()} yang disetujui hari ini. Hubungi HR bila ingin membatalkannya.`;
  }
  const canCheckIn = !att && !blockedReason;
  const canCheckOut = !!att && !att.checkOutAt && emp.isActive;
  return {
    serverNow: now.toISOString(), today, workDate, timeZone: env().APP_TIMEZONE, schedule, day,
    checkInAt: att?.checkInAt.toISOString() ?? null, checkOutAt: att?.checkOutAt?.toISOString() ?? null,
    checkInNote: att?.checkInNote ?? null, checkOutNote: att?.checkOutNote ?? null,
    canCheckIn, canCheckOut, blockedReason,
    geo: { enabled: geo.enabled, name: geo.name, radiusMeters: geo.radiusMeters, maxAccuracyMeters: geo.maxAccuracyMeters },
    photo: photoPolicyOf(settings),
    hasDefaultSchedule: schedule !== null,
  };
}

/** Check-in. Waktu = jam SERVER. Satu baris per karyawan per hari (unik) → check-in ganda mustahil, juga saat klik ganda/balapan. */
export async function checkIn(actor: Actor, raw: unknown, now: Date = new Date(), ctx: PunchContext = { ip: null, deviceToken: null }): Promise<TodayState> {
  const employeeId = requireSelf(actor);
  const input = parseInput(punchSchema, raw ?? {});
  const { emp, workDate: today, day, att } = await dayContext(employeeId, now);
  if (!emp.isActive) throw Errors.forbidden("Data karyawan Anda nonaktif.");
  if (day.status === "DI_LUAR_MASA_KERJA") throw Errors.validation("Hari ini di luar masa kerja Anda.");
  if (att) throw Errors.conflict(`Anda sudah check-in hari ini pukul ${formatClock(att.checkInAt, env().APP_TIMEZONE)}.`);
  if (fullDayLeave(day)) {
    throw Errors.validation(`Anda memiliki ${day.status.toLowerCase()} yang disetujui hari ini, sehingga tidak dapat check-in. Hubungi HR bila ingin membatalkannya.`);
  }
  const geo = await evaluatePunchLocation({ employeeId, employeeName: emp.fullName, kind: "CHECK_IN", workDate: today, now, location: input.location, ctx });
  const photo = await preparePunchPhoto({ policy: photoPolicyOf(await getSettings()), raw: ctx.photo, kind: "CHECK_IN", at: now, location: input.location, employee: { fullName: emp.fullName, employeeNo: emp.employeeNo } });
  try {
    await transaction(async (tx) => {
      const a = await tx.attendance.create({
        data: {
          employeeId, date: isoToDate(today), checkInAt: now, checkInNote: input.note, source: "SELF",
          ...(geo.reading ? { checkInLat: geo.reading.lat, checkInLng: geo.reading.lng, checkInAccuracy: geo.reading.accuracy, checkInDistance: geo.distance } : {}),
        },
      });
      await persistLocationCheck(tx, geo, { employeeId, employeeName: emp.fullName, attendanceId: a.id, kind: "CHECK_IN", workDate: today });
      if (photo) await persistPunchPhoto(tx, actor, photo, { attendanceId: a.id, employeeId });
      await writeAudit(tx, actor, {
        action: "attendance.check_in", entityType: "Attendance", entityId: a.id,
        summary: `Check-in ${formatClock(now, env().APP_TIMEZONE)}${geo.distance !== null ? ` (${geo.distance} m dari titik lokasi)` : ""}${geo.check?.decision === "FLAGGED" ? ` — lokasi ditandai (skor ${geo.check.riskScore})` : ""}${photo ? " — dengan foto" : ""}`,
      });
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const existing = await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId, date: isoToDate(today) } } });
      throw Errors.conflict(`Anda sudah check-in hari ini${existing ? ` pukul ${formatClock(existing.checkInAt, env().APP_TIMEZONE)}` : ""}.`);
    }
    throw e;
  }
  // Tampilkan hasil untuk tanggal kerja yang baru saja dicatat (bukan tanggal kalender hari ini).
  return getTodayState(actor, now, { workDate: today });
}

export async function checkOut(actor: Actor, raw: unknown, now: Date = new Date(), ctx: PunchContext = { ip: null, deviceToken: null }): Promise<TodayState> {
  const employeeId = requireSelf(actor);
  const input = parseInput(punchSchema, raw ?? {});
  const { emp, att, workDate } = await dayContext(employeeId, now);
  if (!emp.isActive) throw Errors.forbidden("Data karyawan Anda nonaktif.");
  if (!att) throw Errors.validation("Anda belum check-in hari ini.");
  if (att.checkOutAt) throw Errors.conflict(`Anda sudah check-out hari ini pukul ${formatClock(att.checkOutAt, env().APP_TIMEZONE)}.`);
  const geo = await evaluatePunchLocation({ employeeId, employeeName: emp.fullName, kind: "CHECK_OUT", workDate, now, location: input.location, ctx });
  // Jaga agar check-out selalu setelah check-in (CHECK constraint) walau jam server bergeser.
  const outAt = now.getTime() > att.checkInAt.getTime() ? now : new Date(att.checkInAt.getTime() + 1000);
  const photo = await preparePunchPhoto({ policy: photoPolicyOf(await getSettings()), raw: ctx.photo, kind: "CHECK_OUT", at: outAt, location: input.location, employee: { fullName: emp.fullName, employeeNo: emp.employeeNo } });
  await transaction(async (tx) => {
    const r = await tx.attendance.updateMany({
      where: { id: att.id, checkOutAt: null },
      data: {
        checkOutAt: outAt, checkOutNote: input.note,
        ...(geo.reading ? { checkOutLat: geo.reading.lat, checkOutLng: geo.reading.lng, checkOutAccuracy: geo.reading.accuracy, checkOutDistance: geo.distance } : {}),
      },
    });
    if (r.count === 0) throw Errors.conflict("Anda sudah check-out hari ini.");
    await persistLocationCheck(tx, geo, { employeeId, employeeName: emp.fullName, attendanceId: att.id, kind: "CHECK_OUT", workDate });
    if (photo) await persistPunchPhoto(tx, actor, photo, { attendanceId: att.id, employeeId });
    await writeAudit(tx, actor, {
      action: "attendance.check_out", entityType: "Attendance", entityId: att.id,
      summary: `Check-out ${formatClock(outAt, env().APP_TIMEZONE)}${geo.distance !== null ? ` (${geo.distance} m dari titik lokasi)` : ""}${geo.check?.decision === "FLAGGED" ? ` — lokasi ditandai (skor ${geo.check.riskScore})` : ""}${photo ? " — dengan foto" : ""}`,
    });
  });
  // Shift malam: check-out dini hari menutup shift kemarin — kembalikan state shift itu (bukan hari baru yang kosong).
  return getTodayState(actor, now, { workDate });
}

// ─────────────────────────── Riwayat ───────────────────────────

export const monthQuerySchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Bulan harus berformat YYYY-MM").optional() });

/** Riwayat harian satu bulan milik pelaku sendiri (status turunan + jam). */
export async function getMyMonth(actor: Actor, raw: unknown = {}) {
  const employeeId = requireSelf(actor);
  const q = parseInput(monthQuerySchema, raw);
  const month = q.month ?? todayIso(env().APP_TIMEZONE).slice(0, 7);
  const { from, to } = monthRange(month);
  return getEmployeeRange(actor, employeeId, from, to, month);
}

/** Hari-hari satu karyawan pada rentang. Karyawan biasa hanya boleh miliknya sendiri; admin (attendance:view_all) boleh semua. */
export async function getEmployeeRange(actor: Actor, employeeId: string, from: string, to: string, label?: string) {
  if (actor.employeeId !== employeeId) assertCan(actor, "attendance:view_all");
  const emp = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!emp) throw Errors.notFound("Karyawan");
  const ctx = await loadRangeContext(from, to, { employeeIds: [employeeId] });
  const { days, totals } = computeEmployeePeriod(employeeLite(emp), ctx);
  return { employee: { id: emp.id, employeeNo: emp.employeeNo, fullName: emp.fullName }, from, to, label: label ?? `${from} – ${to}`, days, totals };
}

// ─────────────────────────── Koreksi (admin) ───────────────────────────

export const correctionSchema = z.object({
  employeeId: uuid,
  date: isoDate,
  /** "remove" menghapus catatan hari itu; "set" membuat/mengubah. */
  action: z.enum(["set", "remove"]),
  checkIn: hhmm.nullable().optional(),
  checkOut: hhmm.nullable().optional(),
  /**
   * Check-out jatuh pada hari kalender BERIKUTNYA (shift malam). Bila tidak diisi: otomatis ya untuk jadwal
   * lintas tengah malam bila jam check-out ≤ jam check-in.
   */
  checkOutNextDay: z.boolean().optional(),
  checkInNote: optionalText(200, "Catatan"),
  reason: requiredText(5, 300, "Alasan koreksi"),
});

type AttSnapshot = { checkInAt: string; checkOutAt: string | null; checkInNote: string | null; checkOutNote: string | null; source: string };
const snap = (a: { checkInAt: Date; checkOutAt: Date | null; checkInNote: string | null; checkOutNote: string | null; source: string }): AttSnapshot => ({
  checkInAt: a.checkInAt.toISOString(), checkOutAt: a.checkOutAt?.toISOString() ?? null, checkInNote: a.checkInNote, checkOutNote: a.checkOutNote, source: a.source,
});

export interface CorrectionResult {
  /** Periode penggajian yang sudah disetujui/terbit dan mencakup tanggal ini (slip terbit TIDAK berubah). */
  payrollNotices: string[];
}

/**
 * Koreksi absensi oleh admin dengan alasan WAJIB. Riwayat (sebelum/sesudah, waktu, pengguna) disimpan di
 * `attendance_corrections` (append-only) dan audit log, dalam transaksi yang sama dengan perubahan datanya.
 */
export async function correctAttendance(actor: Actor, raw: unknown): Promise<CorrectionResult> {
  assertCan(actor, "attendance:correct");
  const input = parseInput(correctionSchema, raw);
  const tz = env().APP_TIMEZONE;
  const today = todayIso(tz);
  if (input.date > today) throw Errors.validation("Tanggal koreksi tidak boleh di masa depan.", { date: "Tanggal di masa depan" });

  // Jadwal pada tanggal itu menentukan apakah jam check-out yang lebih awal berarti "keesokan harinya" (shift malam).
  const empRow = await prisma.employee.findUnique({ where: { id: input.employeeId } });
  let overnightDay = false;
  if (empRow) {
    const ctx = await loadRangeContext(input.date, input.date, { employeeIds: [empRow.id] });
    const sched = resolveSchedule({ date: input.date, employeeId: empRow.id, divisionId: empRow.divisionId, assignments: ctx.assignments, schedules: ctx.schedules, defaultSchedule: ctx.defaultSchedule });
    overnightDay = !!sched && isOvernight(sched);
  }

  return transaction(async (tx) => {
    const emp = await tx.employee.findUnique({ where: { id: input.employeeId } });
    if (!emp) throw Errors.notFound("Karyawan");
    if (input.date < dateToIso(emp.joinDate)) throw Errors.validation("Tanggal sebelum karyawan mulai bekerja.", { date: "Sebelum tanggal mulai bekerja" });
    if (emp.endDate && input.date > dateToIso(emp.endDate)) throw Errors.validation("Tanggal setelah karyawan berhenti.", { date: "Setelah tanggal berhenti" });
    const date = isoToDate(input.date);
    const existing = await tx.attendance.findUnique({ where: { employeeId_date: { employeeId: emp.id, date } } });

    let after: AttSnapshot | null = null;
    if (input.action === "remove") {
      if (!existing) throw Errors.validation("Tidak ada catatan absensi pada tanggal ini untuk dihapus.");
      await tx.attendance.delete({ where: { id: existing.id } });
    } else {
      if (!input.checkIn) throw Errors.validation("Jam check-in wajib diisi.", { checkIn: "Wajib diisi" });
      const inAt = zonedInstant(input.date, input.checkIn, tz);
      let outAt: Date | null = null;
      if (input.checkOut) {
        outAt = zonedInstant(input.date, input.checkOut, tz);
        const nextDay = input.checkOutNextDay ?? (overnightDay && outAt <= inAt);
        if (nextDay) outAt = zonedInstant(addDays(input.date, 1), input.checkOut, tz);
        if (outAt <= inAt) throw Errors.validation("Jam check-out harus setelah jam check-in.", { checkOut: "Harus setelah check-in" });
        if (outAt.getTime() - inAt.getTime() > 24 * 3_600_000) throw Errors.validation("Durasi kerja satu catatan tidak boleh lebih dari 24 jam.", { checkOut: "Lebih dari 24 jam" });
      }
      // Hari ini: jam koreksi tidak boleh melampaui waktu server saat ini.
      if (inAt.getTime() > Date.now() || (outAt && outAt.getTime() > Date.now())) {
        throw Errors.validation("Jam koreksi tidak boleh di masa depan.", { checkIn: "Di masa depan" });
      }
      const newNote = input.checkInNote ?? existing?.checkInNote ?? null;
      if (existing && existing.checkInAt.getTime() === inAt.getTime() && (existing.checkOutAt?.getTime() ?? null) === (outAt?.getTime() ?? null) && existing.checkInNote === newNote) {
        throw Errors.validation("Tidak ada perubahan dibanding data saat ini.");
      }
      const row = existing
        ? await tx.attendance.update({ where: { id: existing.id }, data: { checkInAt: inAt, checkOutAt: outAt, checkInNote: newNote, source: "ADMIN" } })
        : await tx.attendance.create({ data: { employeeId: emp.id, date, checkInAt: inAt, checkOutAt: outAt, checkInNote: newNote, source: "ADMIN" } });
      after = snap(row);
    }

    await tx.attendanceCorrection.create({
      data: {
        employeeId: emp.id, date, before: existing ? snap(existing) : Prisma.DbNull, after: after ?? Prisma.DbNull,
        reason: input.reason, correctedById: actor.userId,
      },
    });
    await writeAudit(tx, actor, {
      action: input.action === "remove" ? "attendance.correct_remove" : "attendance.correct", entityType: "Attendance",
      entityId: existing?.id ?? emp.id, summary: `Koreksi absensi ${emp.fullName} (${emp.employeeNo}) tanggal ${input.date}`,
      before: existing ? snap(existing) : null, after, reason: input.reason,
    });

    const runs = await tx.payrollRun.findMany({
      where: { status: { in: ["PENDING_APPROVAL", "APPROVED", "ISSUED"] }, attendanceStart: { lte: date }, attendanceEnd: { gte: date } },
      select: { label: true, status: true },
    });
    const notices = runs.map((r) => r.status === "ISSUED"
      ? `Periode gaji "${r.label}" sudah diterbitkan: slip TIDAK berubah. Bila diperlukan, batalkan dan buat revisi.`
      : `Periode gaji "${r.label}" (${r.status === "APPROVED" ? "disetujui" : "menunggu persetujuan"}) menggunakan tanggal ini: hitung ulang setelah mengembalikannya ke draf.`);
    return { payrollNotices: notices };
  });
}

export interface CorrectionDto {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  date: string;
  before: AttSnapshot | null;
  after: AttSnapshot | null;
  reason: string;
  correctedBy: string;
  createdAt: string;
}

/** Riwayat koreksi (terbaru dulu). Admin: semua/terfilter; karyawan: hanya miliknya. */
export async function listCorrections(actor: Actor, raw: { employeeId?: string; date?: string; limit?: number } = {}): Promise<CorrectionDto[]> {
  const isAdmin = actorCan(actor, "attendance:view_all");
  const employeeId = isAdmin ? raw.employeeId : requireSelf(actor);
  const rows = await prisma.attendanceCorrection.findMany({
    where: { ...(employeeId ? { employeeId } : {}), ...(raw.date ? { date: isoToDate(raw.date) } : {}) },
    include: { employee: { select: { fullName: true, employeeNo: true } } },
    orderBy: { id: "desc" },
    take: Math.min(raw.limit ?? 50, 200),
  });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.correctedById))] } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id.toString(), employeeId: r.employeeId, employeeName: r.employee.fullName, employeeNo: r.employee.employeeNo, date: dateToIso(r.date),
    before: r.before as AttSnapshot | null, after: r.after as AttSnapshot | null, reason: r.reason, correctedBy: name.get(r.correctedById) ?? "—", createdAt: r.createdAt.toISOString(),
  }));
}

