import { describe, expect, it } from "vitest";
import {
  buildEmployeeDays, countScheduledDays, deriveDay, resolveSchedule, summarizeDays, totalsAreConsistent,
  type AssignmentLite, type AttendanceLite, type DayInput, type LeaveLite, type RangeContext, type ScheduleLite,
} from "@/lib/attendance";
import { addDays, zonedInstant } from "@/lib/time";

const TZ = "Asia/Jakarta";
// Jumat 30 Okt 2026, 10:00 WIB.
const NOW = new Date("2026-10-30T03:00:00Z");

const REG: ScheduleLite = {
  id: "reg", name: "Reguler", workDays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "16:00",
  lateToleranceMinutes: 15, absentCutoffTime: "12:00",
};
const RAMADAN: ScheduleLite = { ...REG, id: "ram", name: "Ramadan", startTime: "08:00", endTime: "15:00", lateToleranceMinutes: 10 };

const at = (date: string, hhmm: string, sec = 0) => {
  const d = zonedInstant(date, hhmm, TZ);
  return new Date(d.getTime() + sec * 1000);
};

function day(over: Partial<DayInput> & { date: string }) {
  return deriveDay({
    now: NOW, timeZone: TZ, join: "2026-01-01", end: null, schedule: REG, calendar: null, leave: null, attendance: null,
    ...over,
  });
}

describe("deriveDay — hadir / terlambat", () => {
  it("check-in sebelum jam masuk → Hadir", () => {
    const r = day({ date: "2026-10-26", attendance: { checkInAt: at("2026-10-26", "07:55"), checkOutAt: at("2026-10-26", "16:05") } });
    expect(r.status).toBe("HADIR");
    expect(r.late).toBe(false);
    expect(r.lateMinutes).toBe(0);
    expect(r.workedMinutes).toBe(8 * 60 + 10);
    expect(r.scheduled).toBe(true);
    expect(r.incomplete).toBe(false);
  });

  it("tepat di batas toleransi (08:15:59) masih Hadir — detik dibuang", () => {
    const r = day({ date: "2026-10-26", attendance: { checkInAt: at("2026-10-26", "08:15", 59), checkOutAt: null } });
    expect(r.status).toBe("HADIR");
  });

  it("08:16 → Terlambat; menit dihitung dari jam masuk (default)", () => {
    const r = day({ date: "2026-10-26", attendance: { checkInAt: at("2026-10-26", "08:16"), checkOutAt: at("2026-10-26", "16:00") } });
    expect(r.status).toBe("TERLAMBAT");
    expect(r.lateMinutes).toBe(16);
    expect(r.explain).toContain("terlambat 16 m");
  });

  it("opsi 'setelah toleransi' → menit dihitung dari batas", () => {
    const r = day({ date: "2026-10-26", lateAfterTolerance: true, attendance: { checkInAt: at("2026-10-26", "08:21"), checkOutAt: null } });
    expect(r.status).toBe("TERLAMBAT");
    expect(r.lateMinutes).toBe(6);
  });

  it("toleransi 0 → 08:01 sudah terlambat", () => {
    const r = day({ date: "2026-10-26", schedule: { ...REG, lateToleranceMinutes: 0 }, attendance: { checkInAt: at("2026-10-26", "08:01"), checkOutAt: null } });
    expect(r.status).toBe("TERLAMBAT");
    expect(r.lateMinutes).toBe(1);
  });

  it("check-in sangat siang tetap tercatat hadir (terlambat), bukan tidak hadir", () => {
    const r = day({ date: "2026-10-26", attendance: { checkInAt: at("2026-10-26", "14:30"), checkOutAt: at("2026-10-26", "16:00") } });
    expect(r.status).toBe("TERLAMBAT");
    expect(r.lateMinutes).toBe(6 * 60 + 30);
  });
});

describe("deriveDay — belum check-out & belum lengkap", () => {
  it("hari lampau tanpa check-out → belum lengkap", () => {
    const r = day({ date: "2026-10-28", attendance: { checkInAt: at("2026-10-28", "08:00"), checkOutAt: null } });
    expect(r.missingCheckout).toBe(true);
    expect(r.incomplete).toBe(true);
    expect(r.workedMinutes).toBe(0);
  });
  it("hari ini tanpa check-out → belum check-out, tetapi belum dihitung tidak lengkap", () => {
    const r = day({ date: "2026-10-30", attendance: { checkInAt: at("2026-10-30", "08:00"), checkOutAt: null } });
    expect(r.missingCheckout).toBe(true);
    expect(r.incomplete).toBe(false);
  });
  it("menit setelah jam pulang (dasar lembur)", () => {
    const r = day({ date: "2026-10-26", attendance: { checkInAt: at("2026-10-26", "08:00"), checkOutAt: at("2026-10-26", "17:30") } });
    expect(r.afterEndMinutes).toBe(90);
    const early = day({ date: "2026-10-27", attendance: { checkInAt: at("2026-10-27", "08:00"), checkOutAt: at("2026-10-27", "15:00") } });
    expect(early.afterEndMinutes).toBe(0);
  });
  it("check-in baru setelah jam pulang: menit setelah jam pulang dihitung dari check-in, bukan dari jam pulang (tidak melebihi lama kerja)", () => {
    const r = day({ date: "2026-10-26", attendance: { checkInAt: at("2026-10-26", "17:30"), checkOutAt: at("2026-10-26", "18:00") } });
    expect(r.workedMinutes).toBe(30);
    expect(r.afterEndMinutes).toBe(30);
  });
});

describe("deriveDay — tanpa check-in", () => {
  it("hari lampau terjadwal → Tidak hadir", () => {
    expect(day({ date: "2026-10-27" }).status).toBe("TIDAK_HADIR");
  });
  it("hari ini sebelum batas jam → Belum absen; sesudahnya → Tidak hadir", () => {
    expect(day({ date: "2026-10-30" }).status).toBe("BELUM_ABSEN"); // 10:00 < 12:00
    expect(day({ date: "2026-10-30", now: new Date("2026-10-30T05:00:00Z") }).status).toBe("TIDAK_HADIR"); // 12:00 WIB tepat
    expect(day({ date: "2026-10-30", now: new Date("2026-10-30T04:59:00Z") }).status).toBe("BELUM_ABSEN"); // 11:59
  });
  it("hari mendatang → Mendatang (bukan tidak hadir)", () => {
    expect(day({ date: "2026-11-02" }).status).toBe("MENDATANG");
  });
  it("akhir pekan → Libur mingguan, tidak terjadwal", () => {
    const r = day({ date: "2026-10-31" });
    expect(r.status).toBe("LIBUR");
    expect(r.scheduled).toBe(false);
    expect(r.offReason).toBe("Libur mingguan");
  });
  it("hari libur nasional di hari kerja → Libur dengan nama", () => {
    const r = day({ date: "2026-10-28", calendar: { kind: "HOLIDAY", name: "Cuti Bersama Uji" } });
    expect(r.status).toBe("LIBUR");
    expect(r.scheduled).toBe(false);
    expect(r.offReason).toBe("Cuti Bersama Uji");
  });
  it("hari kerja khusus pada akhir pekan → terjadwal; masa lalu tanpa absen = Tidak hadir", () => {
    const r = day({ date: "2026-10-24", calendar: { kind: "SPECIAL_WORKDAY", name: "Lembur bersama" } });
    expect(r.scheduled).toBe(true);
    expect(r.status).toBe("TIDAK_HADIR");
  });
  it("tanpa jadwal sama sekali → tidak terjadwal", () => {
    const r = day({ date: "2026-10-27", schedule: null });
    expect(r.scheduled).toBe(false);
    expect(r.status).toBe("LIBUR");
  });
});

describe("deriveDay — pengajuan disetujui", () => {
  it.each(["IZIN", "SAKIT", "CUTI"] as const)("%s pada hari terjadwal tanpa absen", (type) => {
    const r = day({ date: "2026-10-27", leave: { type, requestId: "r1" } });
    expect(r.status).toBe(type);
    expect(r.leaveRequestId).toBe("r1");
    expect(r.scheduled).toBe(true);
  });
  it("cuti pada hari libur/akhir pekan tidak dihitung sebagai cuti", () => {
    expect(day({ date: "2026-10-31", leave: { type: "CUTI", requestId: "r1" } }).status).toBe("LIBUR");
    expect(day({ date: "2026-10-28", calendar: { kind: "HOLIDAY", name: "Libur" }, leave: { type: "CUTI", requestId: "r1" } }).status).toBe("LIBUR");
  });
  it("kehadiran nyata menang atas pengajuan", () => {
    const r = day({ date: "2026-10-27", leave: { type: "IZIN", requestId: "r1" }, attendance: { checkInAt: at("2026-10-27", "08:00"), checkOutAt: at("2026-10-27", "16:00") } });
    expect(r.status).toBe("HADIR");
  });
  it("cuti di masa depan tampil sebagai cuti (sudah disetujui)", () => {
    expect(day({ date: "2026-11-03", leave: { type: "CUTI", requestId: "r1" } }).status).toBe("CUTI");
  });
});

describe("deriveDay — masa kerja", () => {
  it("sebelum tanggal mulai & setelah tanggal berhenti → di luar masa kerja", () => {
    expect(day({ date: "2026-10-26", join: "2026-10-28" }).status).toBe("DI_LUAR_MASA_KERJA");
    expect(day({ date: "2026-10-29", end: "2026-10-28" }).status).toBe("DI_LUAR_MASA_KERJA");
    expect(day({ date: "2026-10-28", join: "2026-10-28", end: "2026-10-28" }).status).toBe("TIDAK_HADIR");
  });
  it("hadir di hari libur: tercatat, tidak dihitung terjadwal", () => {
    const r = day({ date: "2026-10-31", attendance: { checkInAt: at("2026-10-31", "09:00"), checkOutAt: at("2026-10-31", "13:00") } });
    expect(r.status).toBe("HADIR");
    expect(r.scheduled).toBe(false);
    expect(r.workedMinutes).toBe(240);
  });
});

describe("resolveSchedule — prioritas penugasan", () => {
  const schedules = new Map([[REG.id, REG], [RAMADAN.id, RAMADAN], ["vip", { ...REG, id: "vip", name: "VIP" }]]);
  const base = { employeeId: "e1", divisionId: "d1", schedules, defaultSchedule: REG };
  const A = (over: Partial<AssignmentLite>): AssignmentLite => ({
    scheduleId: "ram", scope: "ALL", divisionId: null, employeeId: null, startDate: "2027-02-01", endDate: "2027-03-01", ...over,
  });

  it("tanpa penugasan → default", () => {
    expect(resolveSchedule({ ...base, date: "2026-10-26", assignments: [] })?.id).toBe("reg");
  });
  it("penugasan seluruh perusahaan berlaku hanya dalam rentang (inklusif)", () => {
    const assignments = [A({})];
    expect(resolveSchedule({ ...base, date: "2027-01-31", assignments })?.id).toBe("reg");
    expect(resolveSchedule({ ...base, date: "2027-02-01", assignments })?.id).toBe("ram");
    expect(resolveSchedule({ ...base, date: "2027-03-01", assignments })?.id).toBe("ram");
    expect(resolveSchedule({ ...base, date: "2027-03-02", assignments })?.id).toBe("reg");
  });
  it("karyawan > divisi > seluruh perusahaan", () => {
    const assignments = [
      A({ scope: "ALL", scheduleId: "ram" }),
      A({ scope: "DIVISION", divisionId: "d1", scheduleId: "reg" }),
      A({ scope: "EMPLOYEE", employeeId: "e1", scheduleId: "vip" }),
    ];
    expect(resolveSchedule({ ...base, date: "2027-02-10", assignments })?.id).toBe("vip");
    expect(resolveSchedule({ ...base, employeeId: "e2", date: "2027-02-10", assignments })?.id).toBe("reg");
    expect(resolveSchedule({ ...base, employeeId: "e2", divisionId: "d9", date: "2027-02-10", assignments })?.id).toBe("ram");
  });
  it("level sama: tanggal mulai terbaru menang; penugasan karyawan lain/divisi lain diabaikan", () => {
    const assignments = [
      A({ scheduleId: "reg", startDate: "2027-01-01", endDate: null }),
      A({ scheduleId: "ram", startDate: "2027-02-01" }),
      A({ scope: "EMPLOYEE", employeeId: "lain", scheduleId: "vip", startDate: "2027-02-01" }),
    ];
    expect(resolveSchedule({ ...base, date: "2027-02-10", assignments })?.id).toBe("ram");
    expect(resolveSchedule({ ...base, date: "2027-04-10", assignments })?.id).toBe("reg");
  });
});

// ─────────────────────────── Rekap ───────────────────────────

function ctx(over: Partial<RangeContext> = {}): RangeContext {
  return {
    from: "2026-10-26", to: "2026-11-01", now: NOW, timeZone: TZ, lateAfterTolerance: false,
    schedules: new Map([[REG.id, REG]]), defaultSchedule: REG, assignments: [], calendar: new Map(), leaves: [], attendance: [],
    ...over,
  };
}
const EMP = { id: "e1", divisionId: null, joinDate: "2026-01-01", endDate: null };
const att = (date: string, inT: string, outT: string | null): AttendanceLite => ({
  employeeId: "e1", date, checkInAt: at(date, inT), checkOutAt: outT ? at(date, outT) : null,
});

describe("summarizeDays — satu minggu campuran", () => {
  // Sen 26 hadir, Sel 27 terlambat 20 mnt, Rab 28 izin, Kam 29 tidak hadir, Jum 30 (hari ini) belum absen, Sab/Min libur.
  const leaves: LeaveLite[] = [{ id: "l1", employeeId: "e1", type: "IZIN", startDate: "2026-10-28", endDate: "2026-10-28", status: "APPROVED" }];
  const days = buildEmployeeDays(EMP, ctx({
    leaves,
    attendance: [att("2026-10-26", "07:50", "16:10"), att("2026-10-27", "08:20", "16:00")],
  }));
  const t = summarizeDays(days);

  it("menghitung setiap kategori", () => {
    expect(t.scheduledDays).toBe(5);
    expect(t.presentDays).toBe(2);
    expect(t.onTimeDays).toBe(1);
    expect(t.lateCount).toBe(1);
    expect(t.lateMinutes).toBe(20);
    expect(t.izinDays).toBe(1);
    expect(t.absentDays).toBe(1);
    expect(t.pendingDays).toBe(1);
    expect(t.offDays).toBe(2);
    expect(t.workedMinutes).toBe(500 + 460); // Sen 07:50–16:10 = 8j20m; Sel 08:20–16:00 = 7j40m
    expect(t.incompleteCount).toBe(0);
  });
  it("identitas: terjadwal = hadir + izin + sakit + cuti + tidak hadir + belum dinilai", () => {
    expect(totalsAreConsistent(t)).toBe(true);
  });
  it("pengajuan yang BELUM disetujui tidak memengaruhi rekap", () => {
    const pending = buildEmployeeDays(EMP, ctx({ leaves: leaves.map((l) => ({ ...l, status: "PENDING" as const })), attendance: [] }));
    expect(summarizeDays(pending).izinDays).toBe(0);
    expect(summarizeDays(pending).absentDays).toBe(4); // Sen–Kam
  });
  it("koreksi absensi langsung mengubah rekap (data sumber = satu-satunya kebenaran)", () => {
    // Kamis 29 semula tidak hadir; setelah admin menambahkan kehadiran, tidak hadir → 0 dan hadir → 3.
    const fixed = summarizeDays(buildEmployeeDays(EMP, ctx({
      leaves,
      attendance: [att("2026-10-26", "07:50", "16:10"), att("2026-10-27", "08:20", "16:00"), att("2026-10-29", "08:00", "16:00")],
    })));
    expect(fixed.absentDays).toBe(0);
    expect(fixed.presentDays).toBe(3);
    expect(totalsAreConsistent(fixed)).toBe(true);
  });
});

describe("summarizeDays — perilaku khusus", () => {
  it("hari libur nasional tidak masuk hari kerja terjadwal", () => {
    const cal = new Map([["2026-10-28", { kind: "HOLIDAY" as const, name: "Libur Uji" }]]);
    const t = summarizeDays(buildEmployeeDays(EMP, ctx({ calendar: cal })));
    expect(t.scheduledDays).toBe(4);
    expect(t.offDays).toBe(3);
  });
  it("absensi belum lengkap dihitung hanya untuk hari yang sudah lewat", () => {
    const t = summarizeDays(buildEmployeeDays(EMP, ctx({ attendance: [att("2026-10-27", "08:00", null), att("2026-10-30", "08:00", null)] })));
    expect(t.incompleteCount).toBe(1);
    expect(t.workedMinutes).toBe(0);
  });
  it("hadir di akhir pekan dicatat sebagai kehadiran non-kerja, jam kerja tetap dihitung", () => {
    const t = summarizeDays(buildEmployeeDays(EMP, ctx({ attendance: [att("2026-10-31", "09:00", "12:00")] })));
    expect(t.offDayAttendance).toBe(1);
    expect(t.presentDays).toBe(0);
    expect(t.workedMinutes).toBe(180);
  });
  it("karyawan baru bergabung di tengah rentang: hari sebelumnya tidak dihitung", () => {
    const t = summarizeDays(buildEmployeeDays({ ...EMP, joinDate: "2026-10-29" }, ctx()));
    expect(t.scheduledDays).toBe(2); // Kam, Jum
  });
  it("jadwal Ramadan: jam pulang & toleransi berbeda memengaruhi status", () => {
    const assignments: AssignmentLite[] = [{ scheduleId: "ram", scope: "ALL", divisionId: null, employeeId: null, startDate: "2026-10-26", endDate: "2026-10-30" }];
    const c = ctx({ assignments, schedules: new Map([[REG.id, REG], [RAMADAN.id, RAMADAN]]), attendance: [att("2026-10-26", "08:12", "15:00")] });
    const d = buildEmployeeDays(EMP, c);
    expect(d[0]!.status).toBe("TERLAMBAT"); // toleransi Ramadan 10 mnt, bukan 15
    expect(d[0]!.scheduleEnd).toBe("15:00");
  });
  it("countScheduledDays memisah per tahun", () => {
    const r = countScheduledDays(EMP, "2026-12-30", "2027-01-04", {
      now: NOW, timeZone: TZ, lateAfterTolerance: false, schedules: new Map([[REG.id, REG]]), defaultSchedule: REG, assignments: [], calendar: new Map(),
    });
    // 30 Des (Rab), 31 Des (Kam), 1 Jan (Jum), 4 Jan (Sen) → 2 di 2026, 2 di 2027
    expect(r.total).toBe(4);
    expect(r.byYear.get(2026)).toBe(2);
    expect(r.byYear.get(2027)).toBe(2);
  });
});

// PRNG deterministik untuk uji acak (mulberry32).
function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("uji acak: identitas rekap tidak pernah rusak", () => {
  it("500 skenario acak (jadwal, libur, cuti, absensi, tanggal masuk/keluar)", () => {
    const rand = rng(20261030);
    const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)]!;
    for (let i = 0; i < 500; i++) {
      const from = addDays("2026-09-01", Math.floor(rand() * 40));
      const to = addDays(from, 5 + Math.floor(rand() * 40));
      const calendar = new Map<string, { kind: "HOLIDAY" | "SPECIAL_WORKDAY"; name: string }>();
      for (let k = 0; k < 4; k++) calendar.set(addDays(from, Math.floor(rand() * 40)), { kind: pick(["HOLIDAY", "SPECIAL_WORKDAY"] as const), name: "Uji" });
      const leaves: LeaveLite[] = [];
      for (let k = 0; k < 3; k++) {
        const s = addDays(from, Math.floor(rand() * 40));
        leaves.push({ id: `l${k}`, employeeId: "e1", type: pick(["IZIN", "SAKIT", "CUTI"] as const), startDate: s, endDate: addDays(s, Math.floor(rand() * 4)), status: pick(["APPROVED", "PENDING", "REJECTED", "CANCELLED"] as const) });
      }
      const attendance: AttendanceLite[] = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        if (rand() < 0.6) {
          const inH = 6 + Math.floor(rand() * 9);
          const inM = Math.floor(rand() * 60);
          const hh = (n: number) => String(n).padStart(2, "0");
          const inT = `${hh(inH)}:${hh(inM)}`;
          const outOk = rand() < 0.8 && inH < 20;
          attendance.push({ employeeId: "e1", date: d, checkInAt: at(d, inT), checkOutAt: outOk ? at(d, `${hh(Math.min(23, inH + 1 + Math.floor(rand() * 4)))}:${hh(Math.floor(rand() * 60))}`) : null });
        }
      }
      const emp = { id: "e1", divisionId: null, joinDate: addDays(from, Math.floor(rand() * 15) - 5), endDate: rand() < 0.3 ? addDays(to, -Math.floor(rand() * 10)) : null };
      const c = ctx({ from, to, calendar, leaves, attendance, now: new Date(NOW.getTime() + Math.floor(rand() * 40 - 20) * 86_400_000) });
      const days = buildEmployeeDays(emp, c);
      const t = summarizeDays(days);
      expect(totalsAreConsistent(t), JSON.stringify({ from, to, t })).toBe(true);
      expect(t.scheduledDays).toBe(days.filter((d) => d.scheduled && d.status !== "DI_LUAR_MASA_KERJA").length);
      expect(t.workedMinutes).toBeGreaterThanOrEqual(0);
      for (const d of days) {
        if (d.status === "TERLAMBAT") expect(d.lateMinutes).toBeGreaterThan(0);
        if (d.status === "HADIR") expect(d.lateMinutes).toBe(0);
        if (d.incomplete) expect(d.missingCheckout).toBe(true);
      }
    }
  });
});
