import { describe, expect, it } from "vitest";
import {
  buildEmployeeDays, currentDayRow, dayCloseAt, deriveDay, isOvernight, shiftWindow, summarizeDays, totalsAreConsistent,
  type DayInput, type LeaveLite, type RangeContext, type ScheduleLite,
} from "@/lib/attendance";
import { zonedInstant } from "@/lib/time";

const TZ = "Asia/Jakarta";
const at = (date: string, hhmm: string, sec = 0) => new Date(zonedInstant(date, hhmm, TZ).getTime() + sec * 1000);

// Shift malam: 22:00 → 06:00 (keesokan hari). Batas tidak hadir 02:00 dini hari berikutnya.
const NIGHT: ScheduleLite = {
  id: "night", name: "Shift Malam", workDays: [1, 2, 3, 4, 5], startTime: "22:00", endTime: "06:00",
  lateToleranceMinutes: 15, absentCutoffTime: "02:00",
};
const REG: ScheduleLite = {
  id: "reg", name: "Reguler", workDays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "16:00",
  lateToleranceMinutes: 15, absentCutoffTime: "12:00",
};

// 2026-10-26 = Senin.
function dayAt(now: Date, over: Partial<DayInput> & { date: string }) {
  return deriveDay({ now, timeZone: TZ, join: "2026-01-01", end: null, schedule: NIGHT, calendar: null, leave: null, attendance: null, ...over });
}

describe("jendela shift", () => {
  it("shift malam berakhir keesokan harinya; titik tengah = 02:00", () => {
    const w = shiftWindow("2026-10-26", NIGHT, TZ);
    expect(isOvernight(NIGHT)).toBe(true);
    expect(w.start.toISOString()).toBe(at("2026-10-26", "22:00").toISOString());
    expect(w.end.toISOString()).toBe(at("2026-10-27", "06:00").toISOString());
    expect(w.mid.toISOString()).toBe(at("2026-10-27", "02:00").toISOString());
    expect(w.cutoff.toISOString()).toBe(at("2026-10-27", "02:00").toISOString());
    // Absensi belum lengkap baru dinilai setelah jam pulang + masa tenggang 6 jam.
    expect(w.closeAt.toISOString()).toBe(at("2026-10-27", "12:00").toISOString());
  });

  it("batas tidak hadir malam yang sama (23:30) tetap di hari yang sama", () => {
    const w = shiftWindow("2026-10-26", { ...NIGHT, absentCutoffTime: "23:30" }, TZ);
    expect(w.cutoff.toISOString()).toBe(at("2026-10-26", "23:30").toISOString());
  });

  it("jadwal reguler: closeAt = awal hari berikutnya (perilaku lama)", () => {
    expect(dayCloseAt("2026-10-26", REG, TZ).toISOString()).toBe(at("2026-10-27", "00:00").toISOString());
  });
});

describe("deriveDay — shift lintas tengah malam", () => {
  it("check-in 22:05, check-out 06:10 hari berikutnya → Hadir, jam kerja melewati tengah malam, lembur 10 menit", () => {
    const r = dayAt(at("2026-10-28", "09:00"), {
      date: "2026-10-26", attendance: { checkInAt: at("2026-10-26", "22:05"), checkOutAt: at("2026-10-27", "06:10") },
    });
    expect(r.status).toBe("HADIR");
    expect(r.endsNextDay).toBe(true);
    expect(r.checkOutNextDay).toBe(true);
    expect(r.checkInNextDay).toBe(false);
    expect(r.workedMinutes).toBe(8 * 60 + 5);
    expect(r.afterEndMinutes).toBe(10);
    expect(r.incomplete).toBe(false);
  });

  it("check-in 22:16 → Terlambat 16 menit (bukan salah hitung karena menit-dalam-hari)", () => {
    const r = dayAt(at("2026-10-27", "09:00"), { date: "2026-10-26", attendance: { checkInAt: at("2026-10-26", "22:16"), checkOutAt: at("2026-10-27", "06:00") } });
    expect(r.status).toBe("TERLAMBAT");
    expect(r.lateMinutes).toBe(16);
  });

  it("check-in dini hari 01:30 (setelah tengah malam) untuk shift kemarin → Terlambat 210 menit, bukan Hadir", () => {
    const r = dayAt(at("2026-10-27", "09:00"), { date: "2026-10-26", attendance: { checkInAt: at("2026-10-27", "01:30"), checkOutAt: at("2026-10-27", "06:00") } });
    expect(r.status).toBe("TERLAMBAT");
    expect(r.lateMinutes).toBe(3 * 60 + 30);
    expect(r.checkInNextDay).toBe(true);
    expect(r.explain).toContain("(+1 hari)");
  });

  it("check-in sebelum jam masuk (21:30) → Hadir, tidak terlambat", () => {
    const r = dayAt(at("2026-10-27", "09:00"), { date: "2026-10-26", attendance: { checkInAt: at("2026-10-26", "21:30"), checkOutAt: at("2026-10-27", "06:00") } });
    expect(r.status).toBe("HADIR");
    expect(r.lateMinutes).toBe(0);
  });

  it("shift sedang berjalan pukul 03:00 dengan check-in & tanpa check-out: BUKAN 'absensi belum lengkap'", () => {
    const r = dayAt(at("2026-10-27", "03:00"), { date: "2026-10-26", attendance: { checkInAt: at("2026-10-26", "21:55"), checkOutAt: null } });
    expect(r.missingCheckout).toBe(true);
    expect(r.incomplete).toBe(false);
  });

  it("lewat masa tenggang (06:00 + 6 jam = 12:00) tanpa check-out → belum lengkap", () => {
    const before = dayAt(at("2026-10-27", "11:59"), { date: "2026-10-26", attendance: { checkInAt: at("2026-10-26", "21:55"), checkOutAt: null } });
    const after = dayAt(at("2026-10-27", "12:00"), { date: "2026-10-26", attendance: { checkInAt: at("2026-10-26", "21:55"), checkOutAt: null } });
    expect(before.incomplete).toBe(false);
    expect(after.incomplete).toBe(true);
  });

  it("tanpa check-in: pukul 23:00 (hari shift) Belum absen; 01:59 dini hari masih Belum absen; 02:00 → Tidak hadir", () => {
    const status = (now: Date) => dayAt(now, { date: "2026-10-26" }).status;
    expect(status(at("2026-10-26", "23:00"))).toBe("BELUM_ABSEN");
    expect(status(at("2026-10-27", "01:59"))).toBe("BELUM_ABSEN"); // tanggal sudah berganti tetapi batas belum lewat
    expect(status(at("2026-10-27", "02:00"))).toBe("TIDAK_HADIR");
    expect(status(at("2026-10-28", "10:00"))).toBe("TIDAK_HADIR");
  });

  it("hari shift yang belum tiba → Mendatang", () => {
    expect(dayAt(at("2026-10-26", "10:00"), { date: "2026-10-27" }).status).toBe("MENDATANG");
  });

  it("hari libur nasional: shift yang DIMULAI hari libur tidak terjadwal, shift hari sebelumnya tetap terhitung", () => {
    const hol = { kind: "HOLIDAY" as const, name: "Libur" };
    expect(dayAt(at("2026-10-29", "12:00"), { date: "2026-10-28", calendar: hol }).scheduled).toBe(false);
    expect(dayAt(at("2026-10-29", "12:00"), { date: "2026-10-27", calendar: null }).scheduled).toBe(true);
  });

  it("Jumat malam (hari kerja) → shift berakhir Sabtu pagi tetap milik Jumat", () => {
    const r = dayAt(at("2026-10-31", "10:00"), { date: "2026-10-30", attendance: { checkInAt: at("2026-10-30", "22:00"), checkOutAt: at("2026-10-31", "06:00") } });
    expect(r.status).toBe("HADIR");
    expect(r.scheduled).toBe(true);
    // Sabtu (hari libur mingguan) tidak ikut dihitung walau shift berakhir di hari itu.
    expect(dayAt(at("2026-10-31", "10:00"), { date: "2026-10-31" }).scheduled).toBe(false);
  });

  it("opsi 'setelah toleransi' pada shift malam", () => {
    const r = dayAt(at("2026-10-27", "09:00"), { date: "2026-10-26", lateAfterTolerance: true, attendance: { checkInAt: at("2026-10-26", "22:21"), checkOutAt: null } });
    expect(r.lateMinutes).toBe(6);
  });
});

describe("currentDayRow — dashboard saat shift malam berjalan", () => {
  const ctx = (now: Date, attendance: RangeContext["attendance"]): RangeContext => ({
    from: "2026-10-25", to: "2026-10-28", now, timeZone: TZ, lateAfterTolerance: false,
    schedules: new Map([[NIGHT.id, NIGHT]]), defaultSchedule: NIGHT, assignments: [], calendar: new Map(), leaves: [], attendance,
  });
  const emp = { id: "e1", divisionId: null, joinDate: "2026-01-01", endDate: null };

  it("pukul 03:00 Selasa dengan shift Senin berjalan → baris Senin yang dipakai", () => {
    const now = at("2026-10-27", "03:00");
    const days = buildEmployeeDays(emp, ctx(now, [{ employeeId: "e1", date: "2026-10-26", checkInAt: at("2026-10-26", "21:58"), checkOutAt: null }]));
    expect(currentDayRow(days, now, TZ)?.date).toBe("2026-10-26");
  });

  it("setelah check-out (06:30) → kembali ke tanggal hari ini", () => {
    const now = at("2026-10-27", "06:30");
    const days = buildEmployeeDays(emp, ctx(now, [{ employeeId: "e1", date: "2026-10-26", checkInAt: at("2026-10-26", "21:58"), checkOutAt: at("2026-10-27", "06:05") }]));
    expect(currentDayRow(days, now, TZ)?.date).toBe("2026-10-27");
  });

  it("jadwal reguler → selalu hari ini", () => {
    const now = at("2026-10-27", "03:00");
    const c = { ...ctx(now, []), schedules: new Map([[REG.id, REG]]), defaultSchedule: REG };
    expect(currentDayRow(buildEmployeeDays(emp, c), now, TZ)?.date).toBe("2026-10-27");
  });
});

// ─────────────────────────── Setengah hari ───────────────────────────

const NOW = at("2026-10-30", "10:00"); // Jumat
function reg(over: Partial<DayInput> & { date: string }) {
  return deriveDay({ now: NOW, timeZone: TZ, join: "2026-01-01", end: null, schedule: REG, calendar: null, leave: null, attendance: null, ...over });
}
const AM = { type: "CUTI" as const, requestId: "r1", dayPart: "MORNING" as const };
const PM = { type: "CUTI" as const, requestId: "r1", dayPart: "AFTERNOON" as const };

describe("deriveDay — setengah hari", () => {
  it("cuti pagi + check-in 12:05 → hadir (jam masuk efektif = tengah shift 12:00), 0,5 hadir + 0,5 cuti", () => {
    const r = reg({ date: "2026-10-26", leave: AM, attendance: { checkInAt: at("2026-10-26", "12:05"), checkOutAt: at("2026-10-26", "16:00") } });
    expect(r.status).toBe("HADIR");
    expect(r.fractions).toEqual({ present: 0.5, izin: 0, sakit: 0, cuti: 0.5, absent: 0, pending: 0 });
    expect(r.leaveType).toBe("CUTI");
    expect(r.dayPart).toBe("MORNING");
    expect(r.explain).toContain("setengah hari pagi");
  });

  it("cuti pagi + check-in 12:20 → terlambat 20 menit dari 12:00 (bukan 260 menit dari 08:00)", () => {
    const r = reg({ date: "2026-10-26", leave: AM, attendance: { checkInAt: at("2026-10-26", "12:20"), checkOutAt: null } });
    expect(r.status).toBe("TERLAMBAT");
    expect(r.lateMinutes).toBe(20);
    expect(r.fractions.present).toBe(0.5);
  });

  it("cuti siang + check-in 08:20 → terlambat normal dari 08:00", () => {
    const r = reg({ date: "2026-10-26", leave: PM, attendance: { checkInAt: at("2026-10-26", "08:20"), checkOutAt: at("2026-10-26", "12:00") } });
    expect(r.status).toBe("TERLAMBAT");
    expect(r.lateMinutes).toBe(20);
    expect(r.fractions).toEqual({ present: 0.5, izin: 0, sakit: 0, cuti: 0.5, absent: 0, pending: 0 });
    expect(r.afterEndMinutes).toBe(0);
  });

  it("cuti pagi tanpa check-in pada hari lampau → 0,5 cuti + 0,5 tidak hadir", () => {
    const r = reg({ date: "2026-10-26", leave: AM });
    expect(r.status).toBe("CUTI");
    expect(r.fractions).toEqual({ present: 0, izin: 0, sakit: 0, cuti: 0.5, absent: 0.5, pending: 0 });
  });

  it("cuti siang tanpa check-in hari ini sebelum batas (12:00) → 0,5 cuti + 0,5 belum dinilai", () => {
    const r = reg({ date: "2026-10-30", leave: PM });
    expect(r.fractions).toEqual({ present: 0, izin: 0, sakit: 0, cuti: 0.5, absent: 0, pending: 0.5 });
  });

  it("cuti pagi hari ini pukul 13:00 (lewat 12:00 tetapi sebelum akhir shift) → separuh lainnya belum dinilai, bukan tidak hadir", () => {
    const r = deriveDay({ now: at("2026-10-30", "13:00"), timeZone: TZ, join: "2026-01-01", end: null, schedule: REG, calendar: null, leave: { ...AM }, attendance: null, date: "2026-10-30" });
    expect(r.fractions.pending).toBe(0.5);
    expect(r.fractions.absent).toBe(0);
  });

  it("setengah hari di hari libur diabaikan (tidak terjadwal)", () => {
    const r = reg({ date: "2026-10-31", leave: AM }); // Sabtu
    expect(r.status).toBe("LIBUR");
    expect(r.fractions).toEqual({ present: 0, izin: 0, sakit: 0, cuti: 0, absent: 0, pending: 0 });
  });

  it("cuti sehari penuh tetap 1 hari cuti; kehadiran nyata di hari cuti penuh mengalahkan cuti (perilaku lama)", () => {
    const full = reg({ date: "2026-10-26", leave: { type: "IZIN", requestId: "x", dayPart: "FULL" } });
    expect(full.fractions.izin).toBe(1);
    const worked = reg({ date: "2026-10-26", leave: { type: "IZIN", requestId: "x", dayPart: "FULL" }, attendance: { checkInAt: at("2026-10-26", "08:00"), checkOutAt: null } });
    expect(worked.fractions).toEqual({ present: 1, izin: 0, sakit: 0, cuti: 0, absent: 0, pending: 0 });
  });

  it("izin & sakit setengah hari dihitung ke kolom masing-masing", () => {
    expect(reg({ date: "2026-10-26", leave: { type: "IZIN", requestId: "x", dayPart: "MORNING" }, attendance: { checkInAt: at("2026-10-26", "12:00"), checkOutAt: null } }).fractions.izin).toBe(0.5);
    expect(reg({ date: "2026-10-26", leave: { type: "SAKIT", requestId: "x", dayPart: "AFTERNOON" }, attendance: { checkInAt: at("2026-10-26", "08:00"), checkOutAt: null } }).fractions.sakit).toBe(0.5);
  });
});

describe("rekap dengan setengah hari", () => {
  const emp = { id: "e1", divisionId: null, joinDate: "2026-01-01", endDate: null };
  const mk = (leaves: LeaveLite[], attendance: RangeContext["attendance"]): RangeContext => ({
    from: "2026-10-26", to: "2026-10-30", now: NOW, timeZone: TZ, lateAfterTolerance: false,
    schedules: new Map([[REG.id, REG]]), defaultSchedule: REG, assignments: [], calendar: new Map(), leaves, attendance,
  });

  it("minggu dengan 1 cuti pagi (hadir siang), 1 izin siang (hadir pagi), 1 cuti penuh, 2 hari normal → identitas tetap benar", () => {
    const leaves: LeaveLite[] = [
      { id: "a", employeeId: "e1", type: "CUTI", startDate: "2026-10-26", endDate: "2026-10-26", status: "APPROVED", dayPart: "MORNING" },
      { id: "b", employeeId: "e1", type: "IZIN", startDate: "2026-10-27", endDate: "2026-10-27", status: "APPROVED", dayPart: "AFTERNOON" },
      { id: "c", employeeId: "e1", type: "CUTI", startDate: "2026-10-28", endDate: "2026-10-28", status: "APPROVED", dayPart: "FULL" },
    ];
    const att: RangeContext["attendance"] = [
      { employeeId: "e1", date: "2026-10-26", checkInAt: at("2026-10-26", "12:00"), checkOutAt: at("2026-10-26", "16:00") },
      { employeeId: "e1", date: "2026-10-27", checkInAt: at("2026-10-27", "08:00"), checkOutAt: at("2026-10-27", "12:00") },
      { employeeId: "e1", date: "2026-10-29", checkInAt: at("2026-10-29", "08:30"), checkOutAt: at("2026-10-29", "16:00") }, // terlambat
      { employeeId: "e1", date: "2026-10-30", checkInAt: at("2026-10-30", "07:50"), checkOutAt: null },
    ];
    const t = summarizeDays(buildEmployeeDays(emp, mk(leaves, att)));
    expect(t.scheduledDays).toBe(5);
    expect(t.presentDays).toBe(0.5 + 0.5 + 1 + 1);
    expect(t.cutiDays).toBe(0.5 + 1);
    expect(t.izinDays).toBe(0.5);
    expect(t.lateCount).toBe(1);
    expect(t.lateDays).toBe(1);
    expect(t.onTimeDays).toBe(2);
    expect(t.absentDays).toBe(0);
    expect(totalsAreConsistent(t)).toBe(true);
  });
});
