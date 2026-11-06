import { describe, expect, it } from "vitest";
import { buildEmployeeDays, summarizeDays, type AttendanceLite, type DutyLite, type LeaveLite, type RangeContext, type ScheduleLite } from "@/lib/attendance";
import { zonedInstant } from "@/lib/time";

const TZ = "Asia/Jakarta";
const NOW = new Date("2026-10-30T03:00:00Z"); // Jumat 30 Okt 2026, 10:00 WIB
const REG: ScheduleLite = { id: "reg", name: "Reguler", workDays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "16:00", lateToleranceMinutes: 15, absentCutoffTime: "12:00" };
const EMP = { id: "hazwan", divisionId: null, joinDate: "2026-01-01", endDate: null };
const ctx = (over: Partial<RangeContext> = {}): RangeContext => ({
  from: "2026-10-26", to: "2026-11-01", now: NOW, timeZone: TZ, lateAfterTolerance: false,
  schedules: new Map([[REG.id, REG]]), defaultSchedule: REG, assignments: [], calendar: new Map(), leaves: [], attendance: [], ...over,
});
const duty = (over: Partial<DutyLite> = {}): DutyLite => ({ letterId: "L1", number: "001/ST/X/2026", employeeId: "hazwan", startDate: "2026-10-27", endDate: "2026-10-29", destination: "Surakarta", ...over });
const present = (date: string): AttendanceLite => ({ employeeId: "hazwan", date, checkInAt: zonedInstant(date, "08:00", TZ), checkOutAt: zonedInstant(date, "16:00", TZ) });
const byDate = (days: ReturnType<typeof buildEmployeeDays>) => Object.fromEntries(days.map((d) => [d.date, d]));

describe("penugasan (surat tugas) pada hari kerja — hanya penanda, bukan kehadiran", () => {
  it("jadwal menampilkan 'Dinas luar — Surakarta' pada tanggal penugasan (inklusif) dan tidak di luarnya", () => {
    const d = byDate(buildEmployeeDays(EMP, ctx({ duty: [duty()] })));
    for (const date of ["2026-10-27", "2026-10-28", "2026-10-29"]) {
      expect(d[date]!.duty).toEqual({ letterId: "L1", number: "001/ST/X/2026", destination: "Surakarta", label: "Dinas luar — Surakarta" });
      expect(d[date]!.explain).toContain("Penugasan: Dinas luar — Surakarta");
    }
    for (const date of ["2026-10-26", "2026-10-30", "2026-10-31"]) expect(d[date]!.duty).toBeNull();
  });

  it("status, pecahan hari, dan rekap IDENTIK dengan atau tanpa penugasan: surat tugas tidak otomatis berarti hadir", () => {
    const base = ctx({ attendance: [present("2026-10-26"), present("2026-10-29")] });
    const without = buildEmployeeDays(EMP, base);
    const withDuty = buildEmployeeDays(EMP, { ...base, duty: [duty()] });
    expect(withDuty.map(({ duty: _d, explain: _e, ...rest }) => rest)).toEqual(without.map(({ duty: _d, explain: _e, ...rest }) => rest));
    expect(summarizeDays(withDuty)).toEqual(summarizeDays(without));
    const d = byDate(withDuty);
    expect(d["2026-10-27"]!.status).toBe("TIDAK_HADIR"); // bertugas tetapi tidak ada catatan absensi → tetap tidak hadir
    expect(d["2026-10-29"]!.status).toBe("HADIR");       // hadir hanya karena ada catatan absensi
    expect(d["2026-10-27"]!.fractions).toEqual({ present: 0, izin: 0, sakit: 0, cuti: 0, absent: 1, pending: 0 });
  });

  it("penugasan di hari libur tetap tampil (status tetap Libur); cuti disetujui pada hari yang sama tetap menang untuk status", () => {
    const leaves: LeaveLite[] = [{ id: "c1", employeeId: "hazwan", type: "CUTI", startDate: "2026-10-28", endDate: "2026-10-28", status: "APPROVED" }];
    const d = byDate(buildEmployeeDays(EMP, ctx({ duty: [duty({ startDate: "2026-10-28", endDate: "2026-11-01" })], leaves })));
    expect(d["2026-10-31"]).toMatchObject({ status: "LIBUR", duty: { destination: "Surakarta" } });
    expect(d["2026-10-28"]).toMatchObject({ status: "CUTI", duty: { destination: "Surakarta" } });
  });

  it("hanya milik orang yang ditugaskan; di luar masa kerja tidak ditempel; dua surat pada hari yang sama → yang mulai lebih awal", () => {
    const d1 = byDate(buildEmployeeDays(EMP, ctx({ duty: [duty({ employeeId: "orang-lain" })] })));
    expect(Object.values(d1).every((x) => x.duty === null)).toBe(true);
    const d2 = byDate(buildEmployeeDays({ ...EMP, joinDate: "2026-10-28" }, ctx({ duty: [duty()] })));
    expect(d2["2026-10-27"]).toMatchObject({ status: "DI_LUAR_MASA_KERJA", duty: null });
    expect(d2["2026-10-28"]!.duty).not.toBeNull();
    const d3 = byDate(buildEmployeeDays(EMP, ctx({ duty: [duty({ letterId: "B", number: "002/ST/X/2026", destination: "Bandung", startDate: "2026-10-28", endDate: "2026-10-28" }), duty()] })));
    expect(d3["2026-10-28"]!.duty!.destination).toBe("Surakarta");
  });
});
