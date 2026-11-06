/**
 * Mesin status absensi — FUNGSI MURNI (tanpa database) sehingga dapat diuji menyeluruh dan dipakai ulang oleh
 * layar absensi, rekap, dashboard, laporan, dan penggajian. Status harian TIDAK disimpan; selalu diturunkan dari:
 *   jadwal kerja yang berlaku  +  kalender (libur / hari kerja khusus)  +  pengajuan disetujui  +  catatan absensi.
 *
 * Urutan prioritas penentuan status satu hari (lihat `deriveDay`):
 *   1. Di luar masa kerja karyawan (sebelum tanggal mulai / setelah tanggal berhenti) → tidak dihitung.
 *   2. Ada check-in → Hadir / Terlambat (kehadiran nyata menang atas pengajuan).
 *   3. Bukan hari terjadwal (libur nasional / libur mingguan) → Libur.
 *   4. Ada pengajuan DISETUJUI yang mencakup tanggal itu → Izin / Sakit / Cuti.
 *   5. Hari terjadwal tanpa check-in: lewat batas "tidak hadir" → Tidak hadir; sebelum batas → Belum absen
 *      (atau Mendatang bila harinya belum tiba).
 *
 * Shift lintas tengah malam: jam pulang < jam masuk berarti shift berakhir keesokan harinya. Shift SELALU milik
 * tanggal ia DIMULAI (shift Senin 22:00 → Selasa 06:00 adalah "hari Senin"). Semua perbandingan waktu memakai
 * instan absolut (bukan menit-dalam-hari) sehingga check-in/out setelah tengah malam tetap benar.
 *
 * Setengah hari: pengajuan izin/sakit/cuti satu hari dapat berbagian PAGI atau SIANG. Hari itu menghitung 0,5 hari
 * pengajuan + 0,5 hari kerja (hadir bila check-in; tidak hadir bila lewat batas tanpa check-in). Batas pagi/siang =
 * titik tengah shift.
 */
import { addDays, eachDate, isoWeekday, localDate, localTime, rangesOverlap, startOfLocalDay, todayIso, zonedInstant } from "./time";
import { formatDuration } from "./format";

export type DayStatus =
  | "HADIR" | "TERLAMBAT" | "IZIN" | "SAKIT" | "CUTI" | "TIDAK_HADIR" | "LIBUR" | "BELUM_ABSEN" | "MENDATANG" | "DI_LUAR_MASA_KERJA";

export type LeaveKind = "IZIN" | "SAKIT" | "CUTI";
export type DayPart = "FULL" | "MORNING" | "AFTERNOON";

export const DAY_PART_LABEL: Record<DayPart, string> = { FULL: "Sehari penuh", MORNING: "Setengah hari (pagi)", AFTERNOON: "Setengah hari (siang)" };

/** Setelah jam pulang shift malam, check-out masih diterima sebagai penutup shift itu selama sekian menit. */
export const OVERNIGHT_CHECKOUT_GRACE_MINUTES = 360;

export interface ScheduleLite {
  id: string;
  name: string;
  /** ISO 1 = Senin … 7 = Minggu (hari shift DIMULAI). */
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

// ─────────────────────────── Shift & jendela waktu ───────────────────────────

/** Shift berakhir keesokan harinya (jam pulang lebih awal dari jam masuk). */
export function isOvernight(s: Pick<ScheduleLite, "startTime" | "endTime">): boolean {
  return s.endTime < s.startTime;
}

export interface ShiftWindow {
  /** Jam masuk terjadwal (instan). */
  start: Date;
  /** Jam pulang terjadwal (instan; hari berikutnya untuk shift malam). */
  end: Date;
  /** Titik tengah shift = batas pagi/siang untuk cuti setengah hari. */
  mid: Date;
  /** Batas "tidak hadir" (instan). */
  cutoff: Date;
  /** Sesudah instan ini, check-out yang hilang dihitung "absensi belum lengkap". */
  closeAt: Date;
  overnight: boolean;
}

/** Jendela waktu satu shift yang DIMULAI pada `date` (YYYY-MM-DD). */
export function shiftWindow(date: string, s: ScheduleLite, timeZone: string): ShiftWindow {
  const overnight = isOvernight(s);
  const start = zonedInstant(date, s.startTime, timeZone);
  const end = zonedInstant(overnight ? addDays(date, 1) : date, s.endTime, timeZone);
  const midMs = Math.round((start.getTime() + end.getTime()) / 2 / 60_000) * 60_000;
  // Batas "tidak hadir" shift malam yang lebih awal dari jam masuk berarti dini hari keesokan harinya.
  const cutoffNextDay = overnight && s.absentCutoffTime < s.startTime;
  const cutoff = zonedInstant(cutoffNextDay ? addDays(date, 1) : date, s.absentCutoffTime, timeZone);
  return { start, end, mid: new Date(midMs), cutoff, closeAt: dayCloseAt(date, s, timeZone), overnight };
}

/** Kapan "hari kerja" `date` dianggap selesai (untuk menilai check-out yang hilang). */
export function dayCloseAt(date: string, schedule: ScheduleLite | null, timeZone: string): Date {
  if (schedule && isOvernight(schedule)) {
    return new Date(zonedInstant(addDays(date, 1), schedule.endTime, timeZone).getTime() + OVERNIGHT_CHECKOUT_GRACE_MINUTES * 60_000);
  }
  return startOfLocalDay(addDays(date, 1), timeZone);
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
  leave: { type: LeaveKind; requestId: string; dayPart?: DayPart } | null;
  attendance: { checkInAt: Date; checkOutAt: Date | null } | null;
  /** true: menit terlambat dihitung setelah toleransi; false (default): dari jam masuk. */
  lateAfterTolerance?: boolean;
}

/** Pembagian "1 hari kerja terjadwal" ke kategori; jumlahnya 1 untuk hari terjadwal, 0 untuk hari lain. */
export interface DayFractions {
  present: number;
  izin: number;
  sakit: number;
  cuti: number;
  absent: number;
  pending: number;
}

const zeroFractions = (): DayFractions => ({ present: 0, izin: 0, sakit: 0, cuti: 0, absent: 0, pending: 0 });
const LEAVE_KEY = { IZIN: "izin", SAKIT: "sakit", CUTI: "cuti" } as const;

/** Penugasan (surat tugas TERBIT) yang mencakup seorang karyawan pada sebuah rentang — hanya KONTEKS jadwal, bukan bukti kehadiran. */
export interface DutyLite { letterId: string; number: string; employeeId: string; startDate: string; endDate: string; destination: string }
/** Penugasan yang berlaku pada satu hari. Tidak memengaruhi status, pecahan hari, rekap, maupun gaji: kehadiran tetap dari catatan absensi. */
export interface DutyInfo { letterId: string; number: string; destination: string; label: string }

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
  /** Shift berakhir keesokan harinya (jam pulang tampil "+1 hari"). */
  endsNextDay: boolean;
  /** Instan mulai & selesai shift terjadwal (ISO) — dasar penentuan "shift sedang berjalan". */
  shiftStartAt: string | null;
  shiftEndAt: string | null;
  checkInAt: string | null;
  checkOutAt: string | null;
  checkInTime: string | null;
  checkOutTime: string | null;
  /** Check-in/out terjadi pada hari kalender setelah tanggal shift (shift malam). */
  checkInNextDay: boolean;
  checkOutNextDay: boolean;
  late: boolean;
  lateMinutes: number;
  workedMinutes: number;
  /** Ada check-in tetapi belum check-out. */
  missingCheckout: boolean;
  /** Belum check-out DAN harinya (shift) sudah selesai → dihitung "absensi belum lengkap". */
  incomplete: boolean;
  /** Menit hadir setelah jam pulang terjadwal (dasar lembur otomatis); tidak pernah melebihi lama kerja aktual. */
  afterEndMinutes: number;
  leaveType: LeaveKind | null;
  leaveRequestId: string | null;
  /** Bagian hari pengajuan yang berlaku (null bila tidak ada pengajuan yang dihitung). */
  dayPart: DayPart | null;
  fractions: DayFractions;
  /** Penjelasan perhitungan satu baris untuk ditampilkan kepada pengguna. */
  explain: string;
  /** Ada surat tugas terbit pada hari ini ("Dinas luar — Surakarta"). Hanya penanda: TIDAK berarti hadir dan tidak mengubah status/rekap/gaji. */
  duty: DutyInfo | null;
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

function partText(part: DayPart): string {
  return part === "MORNING" ? "setengah hari pagi" : part === "AFTERNOON" ? "setengah hari siang" : "";
}

export function deriveDay(input: DayInput): DayResult {
  const { date, now, timeZone, schedule, calendar, leave, attendance } = input;
  const today = todayIso(timeZone, now);
  const nowMs = now.getTime();

  const base: DayResult = {
    date, status: "LIBUR", scheduled: false, offReason: null,
    scheduleName: schedule?.name ?? null, scheduleStart: null, scheduleEnd: null, endsNextDay: false, shiftStartAt: null, shiftEndAt: null,
    checkInAt: null, checkOutAt: null, checkInTime: null, checkOutTime: null, checkInNextDay: false, checkOutNextDay: false,
    late: false, lateMinutes: 0, workedMinutes: 0, missingCheckout: false, incomplete: false, afterEndMinutes: 0,
    leaveType: null, leaveRequestId: null, dayPart: null, fractions: zeroFractions(), explain: "", duty: null,
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
  const win = scheduled && schedule ? shiftWindow(date, schedule, timeZone) : null;
  if (win && schedule) {
    base.scheduled = true;
    base.scheduleStart = schedule.startTime;
    base.scheduleEnd = schedule.endTime;
    base.endsNextDay = win.overnight;
    base.shiftStartAt = win.start.toISOString();
    base.shiftEndAt = win.end.toISOString();
  } else {
    base.offReason = offReason;
  }

  // Pengajuan yang dihitung hanya pada hari terjadwal. `half` = setengah hari.
  const part: DayPart = leave?.dayPart ?? "FULL";
  const half = !!win && !!leave && part !== "FULL";

  // 2. Ada check-in → hadir (atau terlambat)
  if (attendance) {
    const inAt = attendance.checkInAt;
    const outAt = attendance.checkOutAt;
    const r: DayResult = {
      ...base,
      checkInAt: inAt.toISOString(),
      checkInTime: localTime(inAt, timeZone),
      checkInNextDay: localDate(inAt, timeZone) > date,
      checkOutAt: outAt ? outAt.toISOString() : null,
      checkOutTime: outAt ? localTime(outAt, timeZone) : null,
      checkOutNextDay: outAt ? localDate(outAt, timeZone) > date : false,
      workedMinutes: outAt ? Math.max(0, Math.floor((outAt.getTime() - inAt.getTime()) / 60_000)) : 0,
      missingCheckout: !outAt,
    };
    r.incomplete = !outAt && nowMs >= dayCloseAt(date, schedule, timeZone).getTime();
    if (win && schedule) {
      const effStart = half && part === "MORNING" ? win.mid : win.start;
      const tol = schedule.lateToleranceMinutes;
      // Selisih menit penuh terhadap jam masuk efektif (negatif = sebelum jam masuk).
      const offset = Math.floor((inAt.getTime() - effStart.getTime()) / 60_000);
      const isLate = offset > tol;
      r.late = isLate;
      r.lateMinutes = isLate ? (input.lateAfterTolerance ? offset - tol : offset) : 0;
      r.status = isLate ? "TERLAMBAT" : "HADIR";
      // Hanya waktu HADIR setelah jam pulang: check-in yang baru terjadi setelah jam pulang tidak menghitung selisih sebelum check-in.
      if (outAt) r.afterEndMinutes = Math.max(0, Math.floor((outAt.getTime() - Math.max(win.end.getTime(), inAt.getTime())) / 60_000));
      const startTxt = localTime(effStart, timeZone);
      const limitTxt = `${startTxt} + toleransi ${tol} mnt = ${localTime(new Date(effStart.getTime() + tol * 60_000), timeZone)}`;
      const inTxt = `${r.checkInTime}${r.checkInNextDay ? " (+1 hari)" : ""}`;
      r.explain = isLate
        ? `Check-in ${inTxt} melewati batas ${limitTxt}; terlambat ${formatDuration(r.lateMinutes)} ${input.lateAfterTolerance ? "setelah toleransi" : `dari jam masuk ${startTxt}`}`
        : `Check-in ${inTxt} ≤ batas ${limitTxt}`;
      r.fractions = { ...zeroFractions(), present: half ? 0.5 : 1 };
      if (half && leave) {
        r.leaveType = leave.type;
        r.leaveRequestId = leave.requestId;
        r.dayPart = part;
        r.fractions[LEAVE_KEY[leave.type]] = 0.5;
        r.explain += `; ${LEAVE_LABEL[leave.type]} ${partText(part)} disetujui (dihitung 0,5 hari hadir + 0,5 hari ${LEAVE_LABEL[leave.type].toLowerCase()})`;
      }
    } else {
      r.status = "HADIR";
      r.explain = `Hadir pada ${offReason?.toLowerCase() ?? "hari non-kerja"} (tidak dihitung sebagai hari kerja terjadwal)`;
    }
    if (r.missingCheckout) r.explain += r.incomplete ? "; belum check-out (absensi belum lengkap)" : "; belum check-out";
    return r;
  }

  // 3. Bukan hari terjadwal → libur
  if (!win || !schedule) {
    return { ...base, status: "LIBUR", explain: offReason ?? "Libur" };
  }

  // Batas "tidak hadir" efektif: cuti pagi memulai kerja di tengah shift, jadi batasnya baru di akhir shift.
  const cutoffMs = (half && part === "MORNING" ? win.end : win.cutoff).getTime();
  const future = date > today;
  const pastCutoff = !future && nowMs >= cutoffMs;
  const cutoffTxt = localTime(half && part === "MORNING" ? win.end : win.cutoff, timeZone);

  // 4. Pengajuan disetujui
  if (leave) {
    const key = LEAVE_KEY[leave.type];
    const fractions = zeroFractions();
    if (!half) {
      fractions[key] = 1;
      return { ...base, status: leave.type, leaveType: leave.type, leaveRequestId: leave.requestId, dayPart: "FULL", fractions, explain: `${LEAVE_LABEL[leave.type]} disetujui` };
    }
    fractions[key] = 0.5;
    if (pastCutoff) fractions.absent = 0.5; else fractions.pending = 0.5;
    return {
      ...base, status: leave.type, leaveType: leave.type, leaveRequestId: leave.requestId, dayPart: part, fractions,
      explain: `${LEAVE_LABEL[leave.type]} ${partText(part)} disetujui (0,5 hari); ${pastCutoff ? `setengah hari lainnya tidak ada check-in sampai batas ${cutoffTxt} → tidak hadir 0,5 hari` : `setengah hari lainnya menunggu check-in (batas ${cutoffTxt})`}`,
    };
  }

  // 5. Terjadwal tanpa check-in
  if (future) return { ...base, status: "MENDATANG", fractions: { ...zeroFractions(), pending: 1 }, explain: "Hari kerja terjadwal yang belum berlalu" };
  if (pastCutoff) {
    return {
      ...base, status: "TIDAK_HADIR", fractions: { ...zeroFractions(), absent: 1 },
      explain: date < today && !win.overnight ? "Tidak ada check-in pada hari kerja terjadwal" : `Belum check-in sampai batas ${cutoffTxt}`,
    };
  }
  return { ...base, status: "BELUM_ABSEN", fractions: { ...zeroFractions(), pending: 1 }, explain: `Belum check-in (batas tidak hadir ${cutoffTxt})` };
}

// ─────────────────────────── Rekap ───────────────────────────

export interface RecapTotals {
  /** Hari kerja terjadwal pada rentang (di luar libur, libur mingguan, dan di luar masa kerja). */
  scheduledDays: number;
  /** Hari hadir pada hari terjadwal = tepat waktu + terlambat (pecahan 0,5 untuk cuti setengah hari). */
  presentDays: number;
  onTimeDays: number;
  /** Hari hadir yang terlambat (pecahan seperti presentDays). */
  lateDays: number;
  /** Jumlah kejadian terlambat (bilangan bulat; satu hari terlambat = satu kejadian). */
  lateCount: number;
  lateMinutes: number;
  izinDays: number;
  sakitDays: number;
  cutiDays: number;
  absentDays: number;
  /** Hari terjadwal yang belum dapat dinilai: belum absen (hari ini) + mendatang. */
  pendingDays: number;
  /** Absensi belum lengkap: ada check-in, tidak ada check-out, shift sudah selesai. */
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
    scheduledDays: 0, presentDays: 0, onTimeDays: 0, lateDays: 0, lateCount: 0, lateMinutes: 0, izinDays: 0, sakitDays: 0, cutiDays: 0,
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
    const f = d.fractions;
    t.presentDays += f.present;
    if (d.status === "HADIR") t.onTimeDays += f.present;
    else if (d.status === "TERLAMBAT") { t.lateDays += f.present; t.lateCount++; t.lateMinutes += d.lateMinutes; }
    t.izinDays += f.izin;
    t.sakitDays += f.sakit;
    t.cutiDays += f.cuti;
    t.absentDays += f.absent;
    t.pendingDays += f.pending;
  }
  return t;
}

/** Identitas yang harus selalu benar: terjadwal = hadir + izin + sakit + cuti + tidak hadir + belum dinilai. */
export function totalsAreConsistent(t: RecapTotals): boolean {
  return t.scheduledDays === t.presentDays + t.izinDays + t.sakitDays + t.cutiDays + t.absentDays + t.pendingDays
    && t.presentDays === t.onTimeDays + t.lateDays;
}

/**
 * Baris hari yang mewakili "saat ini" untuk karyawan: tanggal hari ini, kecuali shift malam kemarin masih berjalan
 * (belum lewat jam pulangnya) — pada saat itu shift kemarinlah yang relevan untuk dashboard.
 */
export function currentDayRow(days: DayResult[], now: Date, timeZone: string): DayResult | undefined {
  const today = todayIso(timeZone, now);
  const yesterday = addDays(today, -1);
  const y = days.find((d) => d.date === yesterday);
  if (y && y.endsNextDay && y.shiftEndAt && now.getTime() < Date.parse(y.shiftEndAt) + OVERNIGHT_CHECKOUT_GRACE_MINUTES * 60_000) {
    const open = y.missingCheckout && now.getTime() < Date.parse(y.shiftEndAt);
    if (open || y.status === "BELUM_ABSEN") return y;
  }
  return days.find((d) => d.date === today);
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
  dayPart?: DayPart;
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
  /** Penugasan terbit pada rentang (opsional; dimuat hanya oleh layar yang menampilkannya). */
  duty?: DutyLite[];
}

export const dutyLabel = (destination: string): string => `Dinas luar — ${destination}`;

/** Bangun hasil harian satu karyawan untuk seluruh rentang. */
export function buildEmployeeDays(emp: EmployeeLite, ctx: RangeContext): DayResult[] {
  const att = new Map<string, AttendanceLite>();
  for (const a of ctx.attendance) if (a.employeeId === emp.id) att.set(a.date, a);
  const leaves = ctx.leaves.filter((l) => l.employeeId === emp.id && l.status === "APPROVED"
    && rangesOverlap(l.startDate, l.endDate, ctx.from, ctx.to));
  const leaveOn = (date: string) => leaves.find((l) => l.startDate <= date && date <= l.endDate) ?? null;
  const duties = (ctx.duty ?? []).filter((d) => d.employeeId === emp.id && rangesOverlap(d.startDate, d.endDate, ctx.from, ctx.to))
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.number.localeCompare(b.number));

  return eachDate(ctx.from, ctx.to, 400).map((date) => {
    const schedule = resolveSchedule({
      date, employeeId: emp.id, divisionId: emp.divisionId, assignments: ctx.assignments,
      schedules: ctx.schedules, defaultSchedule: ctx.defaultSchedule,
    });
    const a = att.get(date);
    const l = leaveOn(date);
    const day = deriveDay({
      date, now: ctx.now, timeZone: ctx.timeZone, join: emp.joinDate, end: emp.endDate, schedule,
      calendar: ctx.calendar.get(date) ?? null,
      leave: l ? { type: l.type, requestId: l.id, dayPart: l.dayPart ?? "FULL" } : null,
      attendance: a ? { checkInAt: a.checkInAt, checkOutAt: a.checkOutAt } : null,
      lateAfterTolerance: ctx.lateAfterTolerance,
    });
    // Penugasan hanya ditempelkan SESUDAH status ditentukan: status, pecahan hari, dan rekap tidak pernah bergantung padanya.
    const d = day.status === "DI_LUAR_MASA_KERJA" ? undefined : duties.find((x) => x.startDate <= date && date <= x.endDate);
    if (!d) return day;
    const label = dutyLabel(d.destination);
    return { ...day, duty: { letterId: d.letterId, number: d.number, destination: d.destination, label }, explain: `${day.explain}${day.explain ? "; " : ""}Penugasan: ${label}` };
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
