/**
 * Mesin status absensi — FUNGSI MURNI (tanpa database) sehingga dapat diuji menyeluruh dan dipakai ulang oleh
 * layar absensi, rekap, dashboard, dan penggajian. Status harian TIDAK disimpan; selalu diturunkan dari:
 *   jadwal kerja yang berlaku  +  kalender (libur / hari kerja khusus)  +  pengajuan disetujui  +  catatan absensi.
 *
 * Urutan prioritas penentuan status satu hari (lihat `deriveDay`):
 *   1. Di luar masa kerja karyawan (sebelum tanggal mulai / setelah tanggal berhenti) → tidak dihitung.
 *   2. Ada check-in → Hadir / Terlambat (kehadiran nyata menang atas pengajuan).
 *   3. Bukan hari terjadwal (libur nasional / libur mingguan) → Libur.
 *   4. Ada pengajuan DISETUJUI yang mencakup tanggal itu → Izin / Sakit / Cuti.
 *   5. Hari terjadwal tanpa check-in: lampau → Tidak hadir; hari ini → Belum absen sampai batas jam tidak hadir,
 *      setelahnya Tidak hadir; mendatang → Mendatang.
 */
import { eachDate, isoWeekday, localMinutes, localTime, rangesOverlap, timeToMinutes, todayIso, zonedInstant } from "./time";
import { formatDuration } from "./format";

export type DayStatus =
  | "HADIR" | "TERLAMBAT" | "IZIN" | "SAKIT" | "CUTI" | "TIDAK_HADIR" | "LIBUR" | "BELUM_ABSEN" | "MENDATANG" | "DI_LUAR_MASA_KERJA";

export type LeaveKind = "IZIN" | "SAKIT" | "CUTI";

export interface ScheduleLite {
  id: string;
  name: string;
  /** ISO 1 = Senin … 7 = Minggu. */
  workDays: number[];
  startTime: string;
  endTime: string;
  lateToleranceMinutes: number;
  absentCutoffTime: string;
}

export interface AssignmentLite {
  scheduleId: string;
  scope: "ALL" | "DIVISION" | "EMPLOYEE";
  divisionId: string | null;
  employeeId: string | null;
  startDate: string;
  endDate: string | null;
}

// ─────────────────────────── Penentuan jadwal ───────────────────────────

const SCOPE_RANK = { EMPLOYEE: 3, DIVISION: 2, ALL: 1 } as const;

/**
 * Jadwal yang berlaku untuk seorang karyawan pada suatu tanggal.
 * Prioritas: penugasan per karyawan > per divisi > seluruh perusahaan > jadwal default.
 * Pada level yang sama, penugasan dengan tanggal mulai paling baru menang (mis. jadwal Ramadan menimpa jadwal biasa).
 */
export function resolveSchedule(args: {
  date: string;
  employeeId: string;
  divisionId: string | null;
  assignments: AssignmentLite[];
  schedules: Map<string, ScheduleLite>;
  defaultSchedule: ScheduleLite | null;
}): ScheduleLite | null {
  let best: AssignmentLite | null = null;
  for (const a of args.assignments) {
    if (a.startDate > args.date || (a.endDate !== null && a.endDate < args.date)) continue;
    if (a.scope === "EMPLOYEE" && a.employeeId !== args.employeeId) continue;
    if (a.scope === "DIVISION" && (!args.divisionId || a.divisionId !== args.divisionId)) continue;
    if (!args.schedules.has(a.scheduleId)) continue;
    if (!best) { best = a; continue; }
    const rank = SCOPE_RANK[a.scope] - SCOPE_RANK[best.scope];
    if (rank > 0 || (rank === 0 && a.startDate > best.startDate)) best = a;
  }
  return (best && args.schedules.get(best.scheduleId)) || args.defaultSchedule;
}

// ─────────────────────────── Penentuan status harian ───────────────────────────

export interface DayInput {
  date: string;
  now: Date;
  timeZone: string;
  /** Tanggal mulai bekerja & (opsional) tanggal berhenti. */
  join: string;
  end: string | null;
  schedule: ScheduleLite | null;
  calendar: { kind: "HOLIDAY" | "SPECIAL_WORKDAY"; name: string } | null;
  leave: { type: LeaveKind; requestId: string } | null;
  attendance: { checkInAt: Date; checkOutAt: Date | null } | null;
  /** true: menit terlambat dihitung setelah toleransi; false (default): dari jam masuk. */
  lateAfterTolerance?: boolean;
}

export interface DayResult {
  date: string;
  status: DayStatus;
  /** Hari ini termasuk "hari kerja terjadwal"? (dasar hitungan hari kerja). */
  scheduled: boolean;
  /** Alasan bila bukan hari kerja: "Libur mingguan" / nama hari libur. */
  offReason: string | null;
  scheduleName: string | null;
  scheduleStart: string | null;
  scheduleEnd: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  late: boolean;
  lateMinutes: number;
  workedMinutes: number;
  /** Ada check-in tetapi belum check-out. */
  missingCheckout: boolean;
  /** Belum check-out DAN harinya sudah lewat → dihitung "absensi belum lengkap". */
  incomplete: boolean;
  /** Menit melewati jam pulang terjadwal (dasar lembur otomatis). */
  afterEndMinutes: number;
  leaveType: LeaveKind | null;
  leaveRequestId: string | null;
  /** Penjelasan perhitungan satu baris untuk ditampilkan kepada pengguna. */
  explain: string;
}

export const STATUS_LABEL: Record<DayStatus, string> = {
  HADIR: "Hadir",
  TERLAMBAT: "Terlambat",
  IZIN: "Izin",
  SAKIT: "Sakit",
  CUTI: "Cuti",
  TIDAK_HADIR: "Tidak hadir",
  LIBUR: "Libur",
  BELUM_ABSEN: "Belum absen",
  MENDATANG: "Mendatang",
  DI_LUAR_MASA_KERJA: "Di luar masa kerja",
};

const LEAVE_LABEL: Record<LeaveKind, string> = { IZIN: "Izin", SAKIT: "Sakit", CUTI: "Cuti" };

export function deriveDay(input: DayInput): DayResult {
  const { date, now, timeZone, schedule, calendar, leave, attendance } = input;
  const today = todayIso(timeZone, now);

  const base: DayResult = {
    date, status: "LIBUR", scheduled: false, offReason: null,
    scheduleName: schedule?.name ?? null, scheduleStart: null, scheduleEnd: null,
    checkInAt: null, checkOutAt: null, checkInTime: null, checkOutTime: null,
    late: false, lateMinutes: 0, workedMinutes: 0, missingCheckout: false, incomplete: false, afterEndMinutes: 0,
    leaveType: null, leaveRequestId: null, explain: "",
  };

  // 1. Di luar masa kerja
  if (date < input.join || (input.end !== null && date > input.end)) {
    return { ...base, status: "DI_LUAR_MASA_KERJA", explain: date < input.join ? "Sebelum tanggal mulai bekerja" : "Setelah tanggal berhenti" };
  }

  // Apakah hari ini terjadwal?
  let scheduled = false;
  let offReason: string | null = null;
  if (calendar?.kind === "HOLIDAY") {
    offReason = calendar.name;
  } else if (!schedule) {
    offReason = "Tidak ada jadwal kerja";
  } else if (calendar?.kind === "SPECIAL_WORKDAY") {
    scheduled = true;
  } else if (schedule.workDays.includes(isoWeekday(date))) {
    scheduled = true;
  } else {
    offReason = "Libur mingguan";
  }
  if (scheduled && schedule) {
    base.scheduled = true;
    base.scheduleStart = schedule.startTime;
    base.scheduleEnd = schedule.endTime;
  } else {
    base.offReason = offReason;
  }

  // 2. Ada check-in → hadir (atau terlambat)
  if (attendance) {
    const inAt = attendance.checkInAt;
    const outAt = attendance.checkOutAt;
    const r: DayResult = {
      ...base,
      checkInAt: inAt.toISOString(),
      checkInTime: localTime(inAt, timeZone),
      checkOutAt: outAt ? outAt.toISOString() : null,
      checkOutTime: outAt ? localTime(outAt, timeZone) : null,
      workedMinutes: outAt ? Math.max(0, Math.floor((outAt.getTime() - inAt.getTime()) / 60_000)) : 0,
      missingCheckout: !outAt,
    };
    r.incomplete = !outAt && date < today;
    if (scheduled && schedule) {
      const start = timeToMinutes(schedule.startTime);
      const limit = start + schedule.lateToleranceMinutes;
      const inMin = localMinutes(inAt, timeZone);
      const isLate = inMin > limit;
      r.late = isLate;
      r.lateMinutes = isLate ? (input.lateAfterTolerance ? inMin - limit : inMin - start) : 0;
      r.status = isLate ? "TERLAMBAT" : "HADIR";
      if (outAt) {
        const endInstant = zonedInstant(date, schedule.endTime, timeZone);
        r.afterEndMinutes = Math.max(0, Math.floor((outAt.getTime() - endInstant.getTime()) / 60_000));
      }
      const limitTxt = `${schedule.startTime} + toleransi ${schedule.lateToleranceMinutes} mnt = ${minutesText(limit)}`;
      r.explain = isLate
        ? `Check-in ${r.checkInTime} melewati batas ${limitTxt}; terlambat ${formatDuration(r.lateMinutes)} ${input.lateAfterTolerance ? "setelah toleransi" : `dari jam masuk ${schedule.startTime}`}`
        : `Check-in ${r.checkInTime} ≤ batas ${limitTxt}`;
    } else {
      r.status = "HADIR";
      r.explain = `Hadir pada ${offReason?.toLowerCase() ?? "hari non-kerja"} (tidak dihitung sebagai hari kerja terjadwal)`;
    }
    if (r.missingCheckout) r.explain += date < today ? "; belum check-out (absensi belum lengkap)" : "; belum check-out";
    return r;
  }

  // 3. Bukan hari terjadwal → libur
  if (!scheduled) {
    return { ...base, status: "LIBUR", explain: offReason ?? "Libur" };
  }

  // 4. Pengajuan disetujui
  if (leave) {
    return {
      ...base, status: leave.type, leaveType: leave.type, leaveRequestId: leave.requestId,
      explain: `${LEAVE_LABEL[leave.type]} disetujui`,
    };
  }

  // 5. Terjadwal tanpa check-in
  if (date < today) return { ...base, status: "TIDAK_HADIR", explain: "Tidak ada check-in pada hari kerja terjadwal" };
  if (date > today) return { ...base, status: "MENDATANG", explain: "Hari kerja terjadwal yang belum berlalu" };
  const cutoff = schedule!.absentCutoffTime;
  if (localMinutes(now, timeZone) >= timeToMinutes(cutoff)) {
    return { ...base, status: "TIDAK_HADIR", explain: `Belum check-in sampai batas ${cutoff}` };
  }
  return { ...base, status: "BELUM_ABSEN", explain: `Belum check-in (batas tidak hadir ${cutoff})` };
}

function minutesText(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

// ─────────────────────────── Rekap ───────────────────────────

export interface RecapTotals {
  /** Hari kerja terjadwal pada rentang (di luar libur, libur mingguan, dan di luar masa kerja). */
  scheduledDays: number;
  /** Hari hadir pada hari terjadwal = tepat waktu + terlambat. */
  presentDays: number;
  onTimeDays: number;
  lateCount: number;
  lateMinutes: number;
  izinDays: number;
  sakitDays: number;
  cutiDays: number;
  absentDays: number;
  /** Hari terjadwal yang belum dapat dinilai: belum absen (hari ini) + mendatang. */
  pendingDays: number;
  /** Absensi belum lengkap: ada check-in, tidak ada check-out, hari sudah lewat. */
  incompleteCount: number;
  /** Total menit kerja tercatat (check-out − check-in) pada semua hari ber-absensi lengkap. */
  workedMinutes: number;
  /** Hari ber-absensi pada hari non-kerja (libur/akhir pekan). */
  offDayAttendance: number;
  /** Jumlah hari libur/non-kerja dalam rentang (informasi). */
  offDays: number;
}

export function emptyTotals(): RecapTotals {
  return {
    scheduledDays: 0, presentDays: 0, onTimeDays: 0, lateCount: 0, lateMinutes: 0, izinDays: 0, sakitDays: 0, cutiDays: 0,
    absentDays: 0, pendingDays: 0, incompleteCount: 0, workedMinutes: 0, offDayAttendance: 0, offDays: 0,
  };
}

export function summarizeDays(days: DayResult[]): RecapTotals {
  const t = emptyTotals();
  for (const d of days) {
    if (d.status === "DI_LUAR_MASA_KERJA") continue;
    t.workedMinutes += d.workedMinutes;
    if (d.incomplete) t.incompleteCount++;
    if (!d.scheduled) {
      t.offDays++;
      if (d.checkInAt) t.offDayAttendance++;
      continue;
    }
    t.scheduledDays++;
    switch (d.status) {
      case "HADIR": t.presentDays++; t.onTimeDays++; break;
      case "TERLAMBAT": t.presentDays++; t.lateCount++; t.lateMinutes += d.lateMinutes; break;
      case "IZIN": t.izinDays++; break;
      case "SAKIT": t.sakitDays++; break;
      case "CUTI": t.cutiDays++; break;
      case "TIDAK_HADIR": t.absentDays++; break;
      case "BELUM_ABSEN":
      case "MENDATANG": t.pendingDays++; break;
      default: break;
    }
  }
  return t;
}

/** Identitas yang harus selalu benar: terjadwal = hadir + izin + sakit + cuti + tidak hadir + belum dinilai. */
export function totalsAreConsistent(t: RecapTotals): boolean {
  return t.scheduledDays === t.presentDays + t.izinDays + t.sakitDays + t.cutiDays + t.absentDays + t.pendingDays
    && t.presentDays === t.onTimeDays + t.lateCount;
}

// ─────────────────────────── Perakitan rentang hari satu karyawan ───────────────────────────

export interface EmployeeLite {
  id: string;
  divisionId: string | null;
  joinDate: string;
  endDate: string | null;
}

export interface LeaveLite {
  id: string;
  employeeId: string;
  type: LeaveKind;
  startDate: string;
  endDate: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
}

export interface AttendanceLite {
  employeeId: string;
  date: string;
  checkInAt: Date;
  checkOutAt: Date | null;
}

export interface RangeContext {
  from: string;
  to: string;
  now: Date;
  timeZone: string;
  lateAfterTolerance: boolean;
  schedules: Map<string, ScheduleLite>;
  defaultSchedule: ScheduleLite | null;
  assignments: AssignmentLite[];
  calendar: Map<string, { kind: "HOLIDAY" | "SPECIAL_WORKDAY"; name: string }>;
  leaves: LeaveLite[];
  attendance: AttendanceLite[];
}

/** Bangun hasil harian satu karyawan untuk seluruh rentang. */
export function buildEmployeeDays(emp: EmployeeLite, ctx: RangeContext): DayResult[] {
  const att = new Map<string, AttendanceLite>();
  for (const a of ctx.attendance) if (a.employeeId === emp.id) att.set(a.date, a);
  const leaves = ctx.leaves.filter((l) => l.employeeId === emp.id && l.status === "APPROVED"
    && rangesOverlap(l.startDate, l.endDate, ctx.from, ctx.to));
  const leaveOn = (date: string) => leaves.find((l) => l.startDate <= date && date <= l.endDate) ?? null;

  return eachDate(ctx.from, ctx.to, 400).map((date) => {
    const schedule = resolveSchedule({
      date, employeeId: emp.id, divisionId: emp.divisionId, assignments: ctx.assignments,
      schedules: ctx.schedules, defaultSchedule: ctx.defaultSchedule,
    });
    const a = att.get(date);
    const l = leaveOn(date);
    return deriveDay({
      date, now: ctx.now, timeZone: ctx.timeZone, join: emp.joinDate, end: emp.endDate, schedule,
      calendar: ctx.calendar.get(date) ?? null,
      leave: l ? { type: l.type, requestId: l.id } : null,
      attendance: a ? { checkInAt: a.checkInAt, checkOutAt: a.checkOutAt } : null,
      lateAfterTolerance: ctx.lateAfterTolerance,
    });
  });
}

/** Hari kerja terjadwal dalam [start, end] untuk satu karyawan — dasar pemotongan saldo cuti. */
export function countScheduledDays(emp: EmployeeLite, start: string, end: string, ctx: Omit<RangeContext, "from" | "to" | "attendance" | "leaves">): { total: number; byYear: Map<number, number> } {
  const days = buildEmployeeDays(emp, { ...ctx, from: start, to: end, leaves: [], attendance: [] });
  const byYear = new Map<number, number>();
  let total = 0;
  for (const d of days) {
    if (!d.scheduled) continue;
    total++;
    const y = Number(d.date.slice(0, 4));
    byYear.set(y, (byYear.get(y) ?? 0) + 1);
  }
  return { total, byYear };
}
