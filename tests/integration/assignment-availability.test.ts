/**
 * Surat tugas di jadwal kerja & ketersediaan tim. Prinsip: penugasan adalah KONTEKS jadwal ("Dinas luar — Surakarta"), BUKAN bukti hadir —
 * status harian, rekap, dan hash sumber gaji tidak berubah karenanya; kehadiran tetap dari catatan absensi.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import { addDays, isoWeekday, todayIso } from "@/lib/time";
import { addAttendance, resetDb } from "../helpers/db";
import { seedTraining, type TrainingFixtures } from "../helpers/training";
import { cancelAssignment, createAssignment } from "@/server/services/assignments";
import { getEmployeeRange } from "@/server/services/attendance";
import { getRecapDetail } from "@/server/services/recap";
import { getTeamAvailability } from "@/server/services/availability";
import { updateCompany } from "@/server/services/settings";
import { sourceHash } from "@/server/services/context";

let fx: TrainingFixtures;
const [AYU, BUDI, CITRA] = [0, 1, 2] as const;
const TODAY = () => todayIso("Asia/Jakarta");
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const workday = (plus: number) => { let d = addDays(TODAY(), plus); while (isoWeekday(d) > 5) d = addDays(d, 1); return d; };
const company = () => ({
  name: "TRILOGIKA EDUTAMA (UJI)", legalName: null, tagline: "Light & Insight", address: "Alamat uji", phone: null, email: null, website: null,
  slipShowAttendance: true, slipFooterNote: null, slipNumberPrefix: "SG", slipSignerName: "Fawwaz Chaidir, S.Psi.", slipSignerTitle: "Chief Executive Officer", slipSignerPlace: "Yogyakarta",
});
const trip = (startDate: string, endDate: string, who: number[], destination = "Surakarta") => ({
  purpose: "Pendampingan uji kompetensi", destination, startDate, endDate, assignees: who.map((i) => ({ employeeId: fx.empIds[i], dailyRate: 300_000 })),
});
const approvedLeave = (employeeId: string, type: "CUTI" | "SAKIT" | "IZIN", date: string) =>
  prisma.leaveRequest.create({ data: { employeeId, type, startDate: isoToDate(date), endDate: isoToDate(date), reason: "uji", status: "APPROVED", workingDays: 1, reviewedById: fx.hr.userId, reviewedAt: new Date() } });

beforeEach(async () => {
  await resetDb();
  fx = await seedTraining();
  await updateCompany(fx.superAdmin, company());
});

describe("jadwal kerja menampilkan penugasan, bukan kehadiran", () => {
  it("'Dinas luar — Surakarta' pada tanggal penugasan; status harian, rekap, dan hash gaji TIDAK berubah; hadir hanya karena ada absensi", async () => {
    const from = workday(-8), to = addDays(from, 2);
    await addAttendance(fx.empIds[AYU], addDays(from, 1), "08:00", "16:00"); // hadir di tengah masa penugasan
    const before = await getEmployeeRange(fx.hr, fx.empIds[AYU], addDays(from, -1), addDays(to, 1));
    const letter = await createAssignment(fx.hr, trip(from, to, [AYU]));
    const after = await getEmployeeRange(fx.hr, fx.empIds[AYU], addDays(from, -1), addDays(to, 1));

    expect(after.days.map((d) => d.status)).toEqual(before.days.map((d) => d.status));
    expect(after.totals).toEqual(before.totals);
    expect(sourceHash(after.days)).toBe(sourceHash(before.days)); // tidak menandai periode gaji sebagai "data berubah"
    const inside = after.days.filter((d) => d.date >= from && d.date <= to);
    expect(inside.map((d) => d.duty?.label)).toEqual(inside.map(() => "Dinas luar — Surakarta"));
    expect(after.days.filter((d) => d.date < from || d.date > to).every((d) => d.duty === null)).toBe(true);
    const status = Object.fromEntries(after.days.map((d) => [d.date, d.status]));
    expect(status[addDays(from, 1)]).toBe("HADIR");                       // karena ada catatan absensi
    if (isoWeekday(from) <= 5) expect(status[from]).toBe("TIDAK_HADIR");   // bertugas ≠ hadir
    // karyawan melihat penugasannya sendiri pada profil/jadwalnya; orang lain tidak melihat milik Ayu lewat jalur ini
    expect((await getEmployeeRange(fx.emp1, fx.empIds[AYU], from, to)).days[0]!.duty?.number).toBe(letter.number);
    expect((await fail(getEmployeeRange(fx.emp2, fx.empIds[AYU], from, to)))?.code).toBe("FORBIDDEN");
    // keterangan rekap ikut memuat penugasan
    const detail = await getRecapDetail(fx.hr, fx.empIds[AYU], { view: "kustom", from, to });
    expect(JSON.stringify(detail)).toContain("Penugasan: Dinas luar — Surakarta");

    // surat tugas dibatalkan → penanda hilang, status tetap
    await cancelAssignment(fx.hr, letter.id, { reason: "Kegiatan dibatalkan klien" });
    const gone = await getEmployeeRange(fx.hr, fx.empIds[AYU], addDays(from, -1), addDays(to, 1));
    expect(gone.days.every((d) => d.duty === null)).toBe(true);
    expect(gone.days.map((d) => d.status)).toEqual(before.days.map((d) => d.status));
  });
});

describe("ketersediaan tim", () => {
  const D = () => workday(4);
  /** Hari kerja berikutnya setelah D (bila D hari Jumat, jatuh pada Senin — izin/sakit tidak tampil pada akhir pekan). */
  const D2 = () => { let d = addDays(D(), 1); while (isoWeekday(d) > 5) d = addDays(d, 1); return d; };
  async function seedWeek() {
    await createAssignment(fx.hr, trip(D(), D(), [AYU, BUDI]));
    await approvedLeave(fx.empIds[CITRA], "CUTI", D());
    await approvedLeave(fx.empIds[BUDI], "SAKIT", D2());
  }
  const cell = (r: Awaited<ReturnType<typeof getTeamAvailability>>, who: number, date = D()) => r.rows.find((x) => x.employeeId === fx.empIds[who])!.cells.find((c) => c.date === date)!;

  it("HR melihat penugasan lengkap dengan nomor surat; cuti ditandai; izin/sakit digabung; orang yang bertugas terlihat oleh admin program lain", async () => {
    await seedWeek();
    const hr = await getTeamAvailability(fx.hr, { from: D(), days: 5 });
    expect(hr.canSeeNumbers).toBe(true);
    expect(cell(hr, AYU).duty).toEqual({ destination: "Surakarta", number: "001/ST/XI/2026" });
    expect(cell(hr, BUDI).duty?.destination).toBe("Surakarta");
    expect(cell(hr, CITRA)).toMatchObject({ leave: "CUTI", half: false, duty: null });
    expect(cell(hr, BUDI, D2()).leave).toBe("IZIN_SAKIT"); // sakit tidak dibuka alasannya
    expect(hr.summary).toBeNull(); // hari ini di luar rentang yang ditampilkan

    // Admin Program lain (level modul Training): melihat tujuan, tidak nomor/maksud surat
    const adm = await getTeamAvailability(fx.adm, { from: D(), days: 3 });
    expect(adm.canSeeNumbers).toBe(false);
    expect(cell(adm, AYU).duty).toEqual({ destination: "Surakarta", number: null });
    expect(JSON.stringify(adm)).not.toMatch(/Pendampingan uji kompetensi|ST\/XI/);
    expect((await getTeamAvailability(fx.viewer, { from: D(), days: 1 })).rows.length).toBe(adm.rows.length); // Pemantau juga
  });

  it("hak akses: karyawan tanpa level modul (termasuk yang ditugaskan) dan HR tanpa..., ditolak; surat tugas dibatalkan tidak muncul", async () => {
    await seedWeek();
    expect((await fail(getTeamAvailability(fx.loner)))?.code).toBe("FORBIDDEN");
    expect((await fail(getTeamAvailability(fx.emp1)))?.code).toBe("FORBIDDEN"); // Ayu bertugas, tetapi bukan pemegang level modul
    const letter = await prisma.assignmentLetter.findFirstOrThrow();
    await cancelAssignment(fx.hr, letter.id, { reason: "Dibatalkan" });
    expect(cell(await getTeamAvailability(fx.hr, { from: D(), days: 1 }), AYU).duty).toBeNull();
  });

  it("ringkasan hari ini konsisten dengan jumlah baris; filter divisi & nama; karyawan nonaktif dikecualikan; batas parameter divalidasi", async () => {
    await createAssignment(fx.hr, trip(TODAY(), TODAY(), [AYU]));
    const r = await getTeamAvailability(fx.hr, { from: TODAY(), days: 1 });
    expect(r.summary).not.toBeNull();
    expect(Object.values(r.summary!).reduce((a, b) => a + b, 0)).toBe(r.rows.length);
    expect(r.summary!.duty).toBe(1);
    expect((await getTeamAvailability(fx.hr, { q: "Ayu" })).rows.map((x) => x.name)).toEqual(["Ayu Lestari"]);
    expect((await getTeamAvailability(fx.hr, { divisionId: fx.divisionB })).rows.every((x) => x.division === "Pemasaran")).toBe(true);
    await prisma.employee.update({ where: { id: fx.empIds[BUDI] }, data: { isActive: false } });
    expect((await getTeamAvailability(fx.hr)).rows.some((x) => x.employeeId === fx.empIds[BUDI])).toBe(false);
    expect((await fail(getTeamAvailability(fx.hr, { days: 32 })))?.code).toBe("VALIDATION");
    expect((await fail(getTeamAvailability(fx.hr, { from: "kemarin" })))?.code).toBe("VALIDATION");
  });
});
