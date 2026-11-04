/**
 * Training & Operations — INDIKATOR PEMANTAUAN (Ketepatan Waktu · Kesiapan · Beban Tim) dan konfigurasinya yang dapat diubah di aplikasi.
 * Dokumen acuan: "Indikator Pemantauan Program Pelatihan" v1.0, termasuk Contoh Perhitungan (§7) yang direproduksi di bawah.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import { addDays, endOfIsoWeek, isoWeekday, startOfIsoWeek } from "@/lib/time";
import { defaultIndicatorConfig, type IndicatorConfig } from "@/lib/training/indicators/config";
import { makeUser, resetDb } from "../helpers/db";
import { addTeam, inDays, mkProject, seedTraining, TODAY, type TrainingFixtures } from "../helpers/training";
import { getIndicatorConfig, loadConfig, resetIndicatorConfig, saveIndicatorConfig } from "@/server/services/training/indicator-config";
import {
  addMilestone, addWorkloadTask, applyIndicatorTemplates, clearStaffCapacity, completeMilestone, listMilestones, listReadiness, listStaffCapacity, listWorkloadTasks,
  regenerateProjectWorkload, reopenMilestone, setReadinessStatus, updateMilestone, upsertStaffCapacity,
} from "@/server/services/training/indicator-data";
import { getClassDensity, getProgramIndicators, getTeamHeatmap, listProgramCards } from "@/server/services/training/indicator-compute";
import { createProject, getProject, updateProject } from "@/server/services/training/projects";
import { addParticipant, listProjectParticipants, updateParticipant } from "@/server/services/training/operations";

let fx: TrainingFixtures;
beforeEach(async () => {
  await resetDb();
  fx = await seedTraining();
});

const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };

/** Konfigurasi dengan pemegang jabatan terisi (agar milestone punya PIC dan tugas jam kerja terbentuk). */
async function setConfig(mutate?: (c: IndicatorConfig) => void): Promise<IndicatorConfig> {
  const c = defaultIndicatorConfig();
  c.roleHolders = {
    SPV_CURRICULUM: fx.empIds[0], MANAGER_MARKETING: fx.empIds[1], MANAGER_OPS: fx.mgrEmp, STAFF_GENERAL: fx.empIds[2], STAFF_CURRICULUM: fx.admEmp,
    STAFF_FINANCE: fx.lonerEmp, STAFF_ADMISI_1: fx.admEmp, STAFF_ADMISI_2: fx.lonerEmp, STAFF_SOCIAL: fx.lonerEmp, SPV_IT: fx.empIds[2], FACILITATOR: fx.empIds[1],
  };
  c.facilitators = [fx.empIds[0], fx.empIds[1]];
  mutate?.(c);
  await saveIndicatorConfig(fx.superAdmin, { config: c, note: "uji" });
  return c;
}

/** Cuti pada rentang tanggal; yang APPROVED wajib memuat peninjau & hari kerja (CHECK leave_requests_review_info). */
const makeLeave = (employeeId: string, from: string, to: string, status: "APPROVED" | "PENDING" = "APPROVED") =>
  prisma.leaveRequest.create({
    data: {
      employeeId, type: "CUTI", startDate: isoToDate(from), endDate: isoToDate(to), reason: "uji", status,
      ...(status === "APPROVED" ? { reviewedById: fx.hr.userId, reviewedAt: new Date(), workingDays: 1 } : {}),
    },
  });

const done = (id: string) => completeMilestone(fx.mgr, id, { evidence: "Berita Acara 001" });

describe("konfigurasi indikator (dapat diubah di aplikasi)", () => {
  it("belum pernah disimpan → nilai bawaan dokumen v1.0 (versi 0); Super Admin menyimpan → versi 1 + riwayat + audit", async () => {
    const first = await loadConfig();
    expect(first).toMatchObject({ version: 0, fromDefault: true, damaged: false });
    expect(first.config.thresholds.spi).toEqual({ greenMin: 0.95, yellowMin: 0.85 });

    const c = defaultIndicatorConfig();
    c.thresholds.spi = { greenMin: 0.9, yellowMin: 0.8 };
    const r = await saveIndicatorConfig(fx.superAdmin, { config: c, note: "Ditinjau setelah 3 bulan" });
    expect(r.version).toBe(1);
    expect(r.changed).toContain("thresholds");

    const now = await loadConfig();
    expect(now).toMatchObject({ version: 1, fromDefault: false });
    expect(now.config.thresholds.spi.greenMin).toBe(0.9);
    const dto = await getIndicatorConfig(fx.superAdmin);
    expect(dto.history).toHaveLength(1);
    expect(dto.history[0]).toMatchObject({ version: 1, note: "Ditinjau setelah 3 bulan" });
    const audit = await prisma.auditLog.findFirst({ where: { action: "training.indicator.config" } });
    expect(audit?.summary).toContain("versi 1");
  });

  it("hanya Super Admin yang boleh mengubah; Manajer Program, Admin Program, Pemantau, dan HR Admin ditolak", async () => {
    for (const a of [fx.mgr, fx.adm, fx.viewer, fx.hr]) {
      const e = await fail(saveIndicatorConfig(a, { config: defaultIndicatorConfig() }));
      expect(e?.status, a.email).toBeOneOf([403, 404]);
    }
    expect((await loadConfig()).version).toBe(0);
    expect((await fail(resetIndicatorConfig(fx.mgr)))?.status).toBe(403);
  });

  it("semua pengguna modul boleh MELIHAT rumus; yang tanpa akses modul tidak", async () => {
    expect((await getIndicatorConfig(fx.viewer)).canEdit).toBe(false);
    expect((await getIndicatorConfig(fx.mgr)).canEdit).toBe(false);
    expect((await getIndicatorConfig(fx.superAdmin)).canEdit).toBe(true);
    expect((await fail(getIndicatorConfig(fx.loner)))?.status).toBe(404);
  });

  it("galat semantik memblokir simpan: batas warna terbalik, jabatan tak dikenal, kode milestone kembar, rujukan tak sah", async () => {
    const bad = (m: (c: IndicatorConfig) => void) => { const c = defaultIndicatorConfig(); m(c); return fail(saveIndicatorConfig(fx.superAdmin, { config: c })); };
    expect((await bad((c) => { c.thresholds.spi = { greenMin: 0.8, yellowMin: 0.9 }; }))?.status).toBe(422);
    expect((await bad((c) => { c.thresholds.load = { roomyMax: 100, greenMax: 90, yellowMax: 110 }; }))?.status).toBe(422);
    expect((await bad((c) => { c.templates.REGULAR.milestones[0]!.roleKey = "TIDAK_ADA"; }))?.status).toBe(422);
    expect((await bad((c) => { c.templates.REGULAR.milestones[1]!.code = c.templates.REGULAR.milestones[0]!.code; }))?.status).toBe(422);
    expect((await bad((c) => { c.templates.PARTNER.milestones[1]!.ref = "ZZZ"; }))?.status).toBe(422);
    expect((await bad((c) => { c.participants.rampEndCode = "ZZZ"; }))?.status).toBe(422);
    expect((await bad((c) => { c.roleHolders = { MANAGER_OPS: "bukan-uuid" }; }))?.status).toBe(422);
    expect((await loadConfig()).version).toBe(0);
  });

  it("bobot tidak berjumlah 100 hanya PERINGATAN (tersimpan); pemegang jabatan harus karyawan aktif", async () => {
    const c = defaultIndicatorConfig();
    c.weights.REGULAR.PARTICIPANTS = 40;
    const r = await saveIndicatorConfig(fx.superAdmin, { config: c });
    expect(r.warnings.join(" ")).toContain("bobot komponen kesiapan");
    const ghost = defaultIndicatorConfig();
    ghost.roleHolders = { MANAGER_OPS: "00000000-0000-4000-8000-000000000001" };
    expect((await fail(saveIndicatorConfig(fx.superAdmin, { config: ghost })))?.status).toBe(422);
  });

  it("dua penyimpanan serentak menghasilkan dua versi berbeda (tanpa tabrakan nomor versi)", async () => {
    const a = defaultIndicatorConfig(); a.thresholds.spi = { greenMin: 0.9, yellowMin: 0.8 };
    const b = defaultIndicatorConfig(); b.thresholds.spi = { greenMin: 0.92, yellowMin: 0.82 };
    const rs = await Promise.all([saveIndicatorConfig(fx.superAdmin, { config: a }), saveIndicatorConfig(fx.superAdmin, { config: b })]);
    expect(rs.map((r) => r.version).sort()).toEqual([1, 2]);
    expect(await prisma.trainingIndicatorConfigVersion.count()).toBe(2);
  });

  it("reset ke bawaan = VERSI BARU (riwayat tidak dihapus), pemegang jabatan dipertahankan; riwayat append-only di database", async () => {
    await setConfig((c) => { c.thresholds.spi = { greenMin: 0.9, yellowMin: 0.8 }; });
    const r = await resetIndicatorConfig(fx.superAdmin);
    expect(r.version).toBe(2);
    const now = await loadConfig();
    expect(now.config.thresholds.spi.greenMin).toBe(0.95);
    expect(now.config.roleHolders.MANAGER_OPS).toBe(fx.mgrEmp);
    expect(await prisma.trainingIndicatorConfigVersion.count()).toBe(2);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM training_indicator_config_versions`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE training_indicator_config_versions SET note = 'ubah'`)).rejects.toThrow();
  });

  it("isi tersimpan yang rusak (disunting langsung di database) → bawaan dipakai dan ditandai rusak, tidak pernah menghitung dari data tak sah", async () => {
    await setConfig();
    await prisma.$executeRawUnsafe(`UPDATE training_indicator_config SET config = '{"thresholds": 5}'::jsonb`);
    const l = await loadConfig();
    expect(l).toMatchObject({ damaged: true, fromDefault: true, version: 1 });
    expect(l.config.thresholds.spi.greenMin).toBe(0.95);
  });

  it("perubahan ambang memengaruhi warna tanpa mengubah kode (SPI 0,84 jadi Kuning bila batas Kuning diturunkan)", async () => {
    await setConfig();
    const id = await mkProject(fx.mgr, { track: "REGULAR", bnsp: true, participantsMin: 15, startDate: inDays(4), endDate: inDays(4) });
    for (const m of await listMilestones(fx.mgr, id)) if (["R01", "R02", "R03", "R07", "R04", "R05", "R09"].includes(m.code)) await done(m.id);
    expect((await getProgramIndicators(fx.mgr, id)).timeliness!.bandStatus).toBe("RED");
    await setConfig((c) => { c.thresholds.spi = { greenMin: 0.9, yellowMin: 0.8 }; });
    const after = await getProgramIndicators(fx.mgr, id);
    expect(after.timeliness!.bandStatus).toBe("YELLOW");
    expect(after.configVersion).toBe(2);
  });
});

describe("penerapan template saat proyek dibuat", () => {
  it("program reguler: 16 milestone, 15 item kesiapan, PIC dari pemegang jabatan, tenggat dihitung dari H", async () => {
    await setConfig();
    const id = await mkProject(fx.mgr, { track: "REGULAR", participantsMin: 15, startDate: inDays(20), endDate: inDays(21) });
    const ms = await listMilestones(fx.mgr, id);
    expect(ms).toHaveLength(16);
    const by = Object.fromEntries(ms.map((m) => [m.code, m]));
    expect(by.R07!.due).toBe(inDays(3)); // H-17
    expect(by.R08!.due).toBe(inDays(17)); // H-3
    expect(by.R12!.due).toBe(inDays(21)); // hari terakhir + 0
    expect(by.R14!.due).toBe(inDays(28)); // hari terakhir + 7
    expect(by.R07!.assigneeId).toBe(fx.empIds[0]);
    expect(by.R06!.notApplicable).toBe(true); // khusus BNSP, program tanpa BNSP
    expect(await listReadiness(fx.mgr, id)).toHaveLength(15);
    const p = await getProject(fx.mgr, id);
    expect(p.indicatorsApplied).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "training.indicator.apply", entityId: id } })).toBe(1);
  });

  it("program kerjasama: tenggat berpatokan T dan milestone lain, dalam hari kerja (K01 = T+2 hari kerja, K02 = K01+1 hari kerja)", async () => {
    await setConfig();
    const t = "2026-11-06"; // Jumat
    const id = await mkProject(fx.mgr, { track: "PARTNER", participantsMin: 20, requestDate: t, startDate: "2027-01-18", endDate: "2027-01-19" });
    const by = Object.fromEntries((await listMilestones(fx.mgr, id)).map((m) => [m.code, m]));
    expect(by.K01!.due).toBe("2026-11-10"); // Jumat + 2 hari kerja = Selasa
    expect(by.K02!.due).toBe("2026-11-11");
    expect(by.K03!.due).toBe("2027-01-04"); // H-14
    expect(by.K04!.due).toBe("2027-01-06"); // K03 + 2 hari kerja
    expect(by.K05!.due).toBeNull(); // manual, belum diisi
    expect(Object.keys(by)).toHaveLength(18);
  });

  it("tanpa tanggal H: tenggat kosong dan tidak ada yang dianggap terlambat; ditandai di 'gaps'", async () => {
    await setConfig();
    const id = await mkProject(fx.mgr, { startDate: null, endDate: null });
    expect((await listMilestones(fx.mgr, id)).every((m) => m.due === null && !m.overdue)).toBe(true);
    const ind = await getProgramIndicators(fx.mgr, id);
    expect(ind.gaps.join(" ")).toContain("Tanggal mulai (H)");
    expect(ind.timeliness!.pv).toBe(0);
  });

  it("autoApplyOnCreate dimatikan → tidak ada milestone; template dapat diterapkan manual satu kali saja", async () => {
    await setConfig((c) => { c.autoApplyOnCreate = false; });
    const id = await mkProject(fx.mgr, { participantsMin: 15 });
    expect(await listMilestones(fx.mgr, id)).toHaveLength(0);
    expect((await getProgramIndicators(fx.mgr, id)).applied).toBe(false);
    const r = await applyIndicatorTemplates(fx.mgr, id);
    expect(r.milestones).toBe(16);
    expect((await fail(applyIndicatorTemplates(fx.mgr, id)))?.status).toBe(409);
  });

  it("pemegang jabatan belum diisi → tetap jadi, dengan peringatan dan tanpa PIC", async () => {
    const r = await createProject(fx.mgr, { name: "Tanpa pemegang jabatan", startDate: inDays(10), endDate: inDays(11) });
    expect(r.indicatorWarnings.join(" ")).toContain("Belum ada pemegang aktif");
    expect((await listMilestones(fx.mgr, r.id)).every((m) => m.assigneeId === null)).toBe(true);
  });

  it("pemegang jabatan yang sudah NONAKTIF tidak dipakai sebagai PIC", async () => {
    await setConfig();
    await prisma.employee.update({ where: { id: fx.empIds[0] }, data: { isActive: false } });
    const id = await mkProject(fx.mgr, { startDate: inDays(20), endDate: inDays(21) });
    const m = (await listMilestones(fx.mgr, id)).find((x) => x.code === "R07")!;
    expect(m.assigneeId).toBeNull();
  });
});

describe("contoh perhitungan dokumen §7 (HACCP, BNSP, peserta minimum 15, hari ini H-4)", () => {
  it("SPI 0,84 · IKP 56,0 vs Target 65,0 (selisih −9) · rasio proyeksi ≈ 0,89 · status program Merah", async () => {
    await setConfig();
    const id = await mkProject(fx.mgr, { name: "Pelatihan dan Sertifikasi HACCP", track: "REGULAR", bnsp: true, participantsMin: 15, startDate: inDays(4), endDate: inDays(4) });

    for (const m of await listMilestones(fx.mgr, id)) if (["R01", "R02", "R03", "R07", "R04", "R05", "R09"].includes(m.code)) await done(m.id); // semua kecuali R06 (jadwal uji LSP)
    const items = await listReadiness(fx.mgr, id);
    for (const name of ["Instruktur terkonfirmasi", "Kontrak/honor instruktur disepakati", "Silabus dan RPP final", "Bahan ajar final", "Alat evaluasi pre/post-test siap", "Venue atau tautan kelas siap", "Berkas asesi lengkap"]) {
      await setReadinessStatus(fx.mgr, items.find((i) => i.name === name)!.id, { status: "DONE" });
    }
    for (let i = 1; i <= 13; i++) await addParticipant(fx.mgr, id, { fullName: `Peserta ${i}`, confirmed: true });
    // createdAt default memakai jam DATABASE; "hari ini" memakai jam aplikasi (bisa digeser TEST_NOW) → tetapkan eksplisit: 7 pendaftar lama, 6 dalam 14 hari terakhir.
    const ids = (await prisma.trainingParticipant.findMany({ where: { projectId: id }, orderBy: { fullName: "asc" }, select: { id: true } })).map((x) => x.id);
    await prisma.trainingParticipant.updateMany({ where: { id: { in: ids.slice(0, 7) } }, data: { createdAt: new Date(Date.now() - 30 * 86400_000) } });
    await prisma.trainingParticipant.updateMany({ where: { id: { in: ids.slice(7) } }, data: { createdAt: new Date(Date.now() - 2 * 86400_000) } });

    const r = await getProgramIndicators(fx.mgr, id);
    const t = r.timeliness!;
    expect([t.pv, t.ev]).toEqual([50, 42]);
    expect(t.spi).toBeCloseTo(0.84, 2);
    expect(t.criticalOverdue).toEqual(["R06"]);
    expect(t.oldestOverdueDays).toBe(3);
    expect(t.status).toBe("RED");

    const k = r.readiness!;
    expect(k.ikp).toBeCloseTo(56.0, 1);
    expect(k.target).toBeCloseTo(65.0, 1);
    expect(k.gap).toBeCloseTo(-9.0, 1);
    expect(k.bandStatus).toBe("YELLOW"); // "skor saja: Kuning"
    expect(k.criticalOpen).toContain("Jadwal uji dari LSP terkonfirmasi");
    expect(k.status).toBe("RED");

    expect(r.projection!.projection).toBeCloseTo(13 + 6 / 14, 3);
    expect(r.projection!.ratio).toBeCloseTo(0.894, 2);
    expect(r.projection!.status).toBe("YELLOW");
    expect(r.triggers).toEqual(expect.arrayContaining(["CRITICAL_MILESTONE", "CRITICAL_ITEM"]));
    expect(r.triggers).not.toContain("PROJECTION_LOW");
    expect(r.overall).toBe("RED");
    expect(r.next?.code).toBe("R08"); // Go/No-Go H-3
  });

  it("rasio proyeksi < 0,8 mulai H-4 → pemicu Merah PROJECTION_LOW; belum H-4 → tidak", async () => {
    await setConfig();
    const near = await mkProject(fx.mgr, { track: "REGULAR", participantsMin: 20, startDate: inDays(4), endDate: inDays(4) });
    for (let i = 1; i <= 5; i++) await addParticipant(fx.mgr, near, { fullName: `Dekat ${i}`, confirmed: true });
    expect((await getProgramIndicators(fx.mgr, near)).triggers).toContain("PROJECTION_LOW");
    const far = await mkProject(fx.mgr, { track: "REGULAR", participantsMin: 20, startDate: inDays(5), endDate: inDays(5) });
    for (let i = 1; i <= 5; i++) await addParticipant(fx.mgr, far, { fullName: `Jauh ${i}`, confirmed: true });
    expect((await getProgramIndicators(fx.mgr, far)).triggers).not.toContain("PROJECTION_LOW");
  });

  it("peserta DIBATALKAN tidak dihitung; konfirmasi dapat dicabut dan tercatat di audit", async () => {
    await setConfig();
    const id = await mkProject(fx.mgr, { participantsMin: 10, startDate: inDays(4), endDate: inDays(4) });
    const a = await addParticipant(fx.mgr, id, { fullName: "Aksa", confirmed: true });
    await addParticipant(fx.mgr, id, { fullName: "Bima", confirmed: true });
    const confirmedOf = async () => (await getProgramIndicators(fx.mgr, id)).readiness!.components.find((c) => c.component === "PARTICIPANTS")!.done;
    expect(await confirmedOf()).toBe(2);
    await updateParticipant(fx.mgr, a.id, { status: "CANCELLED" });
    expect(await confirmedOf()).toBe(1);
    await updateParticipant(fx.mgr, a.id, { status: "REGISTERED", confirmed: false });
    expect(await confirmedOf()).toBe(1);
    expect((await listProjectParticipants(fx.mgr, id)).find((p) => p.fullName === "Aksa")).toMatchObject({ confirmed: false, status: "REGISTERED" });
    expect(await prisma.auditLog.count({ where: { action: "training.participant.confirm" } })).toBe(1);
  });
});

describe("milestone: bukti, hak, dan kejujuran tanggal", () => {
  it("tanpa bukti ditolak; tanggal masa depan ditolak; selesai dua kali ditolak; buka kembali butuh alasan", async () => {
    await setConfig();
    const id = await mkProject(fx.mgr, { startDate: inDays(20), endDate: inDays(21) });
    const m = (await listMilestones(fx.mgr, id)).find((x) => x.code === "R01")!;
    expect((await fail(completeMilestone(fx.mgr, m.id, {})))?.status).toBe(422);
    expect((await fail(completeMilestone(fx.mgr, m.id, { evidence: "BA-001", doneAt: inDays(1) })))?.status).toBe(422);
    await completeMilestone(fx.mgr, m.id, { evidence: "BA-001" });
    expect((await fail(completeMilestone(fx.mgr, m.id, { evidence: "BA-002" })))?.status).toBe(409);
    expect((await fail(reopenMilestone(fx.mgr, m.id, {})))?.status).toBe(422);
    await reopenMilestone(fx.mgr, m.id, { reason: "Bukti keliru" });
    expect((await listMilestones(fx.mgr, id)).find((x) => x.code === "R01")!.doneAt).toBeNull();
  });

  it("bukti tidak wajib bila konfigurasi mengizinkan", async () => {
    await setConfig((c) => { c.requireEvidence = false; });
    const id = await mkProject(fx.mgr, { startDate: inDays(20), endDate: inDays(21) });
    const m = (await listMilestones(fx.mgr, id)).find((x) => x.code === "R01")!;
    await completeMilestone(fx.mgr, m.id, {});
    expect((await listMilestones(fx.mgr, id)).find((x) => x.code === "R01")!.doneAt).toBe(TODAY());
  });

  it("PIC milestone boleh menyelesaikan miliknya sendiri, bukan milik orang lain; Pemantau dan non-anggota tidak", async () => {
    await setConfig();
    const id = await mkProject(fx.mgr, { startDate: inDays(20), endDate: inDays(21) });
    const ayu = await makeUser("ayu.pic@uji.test", "Ayu PIC", "EMPLOYEE", fx.empIds[0]); // pemegang SPV_CURRICULUM
    await addTeam(fx.mgr, id, [[fx.empIds[0], "STAFF"]]);
    const ms = await listMilestones(fx.mgr, id);
    const own = ms.find((m) => m.code === "R07")!; // SPV_CURRICULUM = emp1
    const other = ms.find((m) => m.code === "R12")!; // FACILITATOR = emp2
    const seen = await listMilestones(ayu, id);
    expect(seen.find((m) => m.code === "R07")!.canComplete).toBe(true);
    expect(seen.find((m) => m.code === "R12")!.canComplete).toBe(false);
    await completeMilestone(ayu, own.id, { evidence: "Silabus final.pdf" });
    expect((await fail(completeMilestone(ayu, other.id, { evidence: "x" })))?.status).toBe(403);
    expect((await fail(completeMilestone(fx.viewer, other.id, { evidence: "x" })))?.status).toBe(403);
    expect((await fail(completeMilestone(fx.loner, other.id, { evidence: "x" })))?.status).toBe(404);
  });

  it("proyek Selesai/Dibatalkan terkunci untuk milestone; tambah milestone mengikuti aturan kode unik dan acuan", async () => {
    await setConfig();
    const id = await mkProject(fx.mgr, { startDate: inDays(20), endDate: inDays(21) });
    expect((await fail(addMilestone(fx.mgr, id, { code: "R01", name: "Kembar", anchor: "H", days: -1, weight: 1 })))?.status).toBe(409);
    expect((await fail(addMilestone(fx.mgr, id, { code: "X1", name: "Acuan hilang", anchor: "MILESTONE", ref: "ZZZ", days: 1, weight: 1 })))?.status).toBe(422);
    const added = await addMilestone(fx.mgr, id, { code: "X2", name: "Tambahan ad-hoc", anchor: "MILESTONE", ref: "R07", days: 2, work: true, weight: 3 });
    expect((await listMilestones(fx.mgr, id)).find((m) => m.id === added.id)!.due).toBeTruthy();
    await updateMilestone(fx.mgr, added.id, { notApplicable: true });
    expect((await listMilestones(fx.mgr, id)).find((m) => m.id === added.id)!.notApplicable).toBe(true);
    await prisma.trainingProject.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: fx.superAdmin.userId, cancelReason: "uji" } });
    const m = (await listMilestones(fx.mgr, id)).find((x) => x.code === "R01")!;
    expect((await fail(completeMilestone(fx.mgr, m.id, { evidence: "BA" })))?.status).toBe(409);
  });
});

describe("perubahan data program memperbarui hitungan", () => {
  it("tanggal H digeser → tenggat milestone ikut bergeser (tidak disimpan) dan tugas jam kerja template dibuat ulang; yang MANUAL tetap", async () => {
    await setConfig();
    const id = await mkProject(fx.mgr, { participantsMin: 15, startDate: inDays(20), endDate: inDays(21) });
    expect((await listMilestones(fx.mgr, id)).find((m) => m.code === "R07")!.due).toBe(inDays(3));
    const before = await listWorkloadTasks(fx.mgr, id);
    expect(before.length).toBeGreaterThan(5);
    expect(before.every((w) => w.source === "TEMPLATE")).toBe(true);
    await addWorkloadTask(fx.mgr, id, { employeeId: fx.empIds[0], name: "Rapat khusus klien", hours: 3, startDate: inDays(5), endDate: inDays(5) });

    await updateProject(fx.mgr, id, { startDate: inDays(30), endDate: inDays(31) });
    expect((await listMilestones(fx.mgr, id)).find((m) => m.code === "R07")!.due).toBe(inDays(13));
    const after = await listWorkloadTasks(fx.mgr, id);
    expect(after.filter((w) => w.source === "MANUAL")).toHaveLength(1);
    expect(after.filter((w) => w.source === "TEMPLATE")).toHaveLength(before.length);
    const spv = after.find((w) => w.roleKey === "SPV_CURRICULUM")!;
    expect(spv.startDate).toBe(inDays(0)); // H-30
    expect(spv.endDate).toBe(inDays(38)); // hari terakhir + 7
  });

  it("jam standar = tetap + per peserta × acuan + per hari kelas × durasi (Staf Adm. Umum reguler: 4 + 0,3×15 + 2×2 = 12,5 jam)", async () => {
    await setConfig();
    const id = await mkProject(fx.mgr, { participantsMin: 15, startDate: inDays(20), endDate: inDays(21) });
    const general = (await listWorkloadTasks(fx.mgr, id)).find((w) => w.roleKey === "STAFF_GENERAL")!;
    expect(general.hours).toBeCloseTo(12.5, 2);
    await updateProject(fx.mgr, id, { participantsMin: 25 });
    expect((await listWorkloadTasks(fx.mgr, id)).find((w) => w.roleKey === "STAFF_GENERAL")!.hours).toBeCloseTo(4 + 0.3 * 25 + 2 * 2, 2);
  });

  it("PATCH sebagian tidak menimpa jenis program/BNSP/moda (regresi: default Zod pada .partial())", async () => {
    await setConfig();
    const id = await mkProject(fx.mgr, { track: "PARTNER", bnsp: true, deliveryMode: "HYBRID", participantsMin: 20, requestDate: inDays(-2), startDate: inDays(30), endDate: inDays(31) });
    await updateProject(fx.mgr, id, { location: "Ruang Mawar" });
    expect(await getProject(fx.mgr, id)).toMatchObject({ track: "PARTNER", bnsp: true, deliveryMode: "HYBRID", participantsMin: 20, location: "Ruang Mawar" });
  });

  it("jenis program boleh diganti sebelum ada kemajuan (template diterapkan ulang); setelah ada kemajuan ditolak", async () => {
    await setConfig();
    const id = await mkProject(fx.mgr, { track: "REGULAR", participantsMin: 15, startDate: inDays(20), endDate: inDays(21) });
    await updateProject(fx.mgr, id, { track: "PARTNER", requestDate: inDays(-5) });
    const ms = await listMilestones(fx.mgr, id);
    expect(ms).toHaveLength(18);
    expect(ms[0]!.code).toBe("K01");
    await completeMilestone(fx.mgr, ms[0]!.id, { evidence: "Notulen" });
    expect((await fail(updateProject(fx.mgr, id, { track: "REGULAR" })))?.status).toBe(409);
    expect(await prisma.trainingMilestone.count({ where: { projectId: id } })).toBe(18);
  });

  it("validasi: peserta maksimum < minimum dan tutup pendaftaran setelah H ditolak", async () => {
    await setConfig();
    const id = await mkProject(fx.mgr, { participantsMin: 15, startDate: inDays(20), endDate: inDays(21) });
    expect((await fail(updateProject(fx.mgr, id, { participantsMax: 10 })))?.status).toBe(422);
    expect((await fail(updateProject(fx.mgr, id, { registrationCloseDate: inDays(25) })))?.status).toBe(422);
    expect((await fail(createProject(fx.mgr, { name: "Salah angka", participantsMin: 20, participantsMax: 5 })))?.status).toBe(422);
  });

  it("hitung ulang tugas jam kerja manual oleh pengelola; Pemantau tidak boleh", async () => {
    await setConfig();
    const id = await mkProject(fx.mgr, { participantsMin: 15, startDate: inDays(20), endDate: inDays(21) });
    expect((await regenerateProjectWorkload(fx.mgr, id)).created).toBeGreaterThan(5);
    expect((await fail(regenerateProjectWorkload(fx.viewer, id)))?.status).toBe(403);
  });
});

describe("Beban Tim", () => {
  const week = () => startOfIsoWeek(TODAY());

  /** Tugas manual yang menutup seluruh minggu berjalan (Senin–Minggu): persen = jam ÷ 30. */
  async function loadWeek(employeeId: string, hours: number, weeks = 1) {
    const id = await mkProject(fx.mgr, { startDate: inDays(90), endDate: inDays(91) });
    await addWorkloadTask(fx.mgr, id, { employeeId, name: "Beban uji", hours, startDate: week(), endDate: endOfIsoWeek(addDays(week(), (weeks - 1) * 7)) });
    return id;
  }
  const rowOf = async (a: Parameters<typeof getTeamHeatmap>[0], emp: string) => (await getTeamHeatmap(a)).rows.find((r) => r.employeeId === emp)!;

  beforeEach(async () => { await setConfig((c) => { c.autoApplyOnCreate = false; }); });

  it("persen beban = jam ÷ kapasitas (5 hari × 6 jam = 30); pita memakai persen bulat: 105% Padat, 120% Overload, 70% Ada ruang, 90% Ideal", async () => {
    const e = fx.empIds[2];
    await loadWeek(e, 31.5);
    const w = (await rowOf(fx.mgr, e)).weeks[0]!;
    expect([w.capacity, w.hours]).toEqual([30, 31.5]);
    expect(w.pct).toBeCloseTo(105, 5);
    expect(w.band).toBe("BUSY");
    await loadWeek(fx.empIds[1], 36);
    expect((await rowOf(fx.mgr, fx.empIds[1])).weeks[0]!.band).toBe("OVERLOAD");
    await loadWeek(fx.empIds[0], 21);
    expect((await rowOf(fx.mgr, fx.empIds[0])).weeks[0]!.band).toBe("ROOMY");
    await loadWeek(fx.admEmp, 27);
    expect((await rowOf(fx.mgr, fx.admEmp)).weeks[0]!.band).toBe("IDEAL");
  });

  it("cuti DISETUJUI dari HRIS mengurangi kapasitas (30 → 24 jam); cuti yang masih menunggu tidak; dapat dimatikan di konfigurasi", async () => {
    const e = fx.empIds[2];
    await loadWeek(e, 24);
    const leave = (status: "APPROVED" | "PENDING") => makeLeave(e, addDays(week(), 2), addDays(week(), 2), status);
    await leave("PENDING");
    expect((await rowOf(fx.mgr, e)).weeks[0]!.capacity).toBe(30);
    await leave("APPROVED");
    const w = (await rowOf(fx.mgr, e)).weeks[0]!;
    expect(w.capacity).toBe(24);
    expect(w.pct).toBeCloseTo(100, 5);
    await setConfig((c) => { c.autoApplyOnCreate = false; c.capacity.useHrisLeave = false; });
    expect((await rowOf(fx.mgr, e)).weeks[0]!.capacity).toBe(30);
  });

  it("kapasitas per staf dapat dikecualikan (4 jam/hari → 20 jam) oleh Manajer Program; Admin Program/Pemantau ditolak; dapat dihapus", async () => {
    const e = fx.empIds[2];
    await loadWeek(e, 20);
    await upsertStaffCapacity(fx.mgr, e, { hoursPerDay: 4, workDays: [1, 2, 3, 4, 5], note: "Paruh waktu" });
    expect((await rowOf(fx.mgr, e)).weeks[0]).toMatchObject({ capacity: 20, pct: 100 });
    expect((await fail(upsertStaffCapacity(fx.adm, e, { hoursPerDay: 4, workDays: [1] })))?.status).toBe(403);
    expect((await fail(upsertStaffCapacity(fx.viewer, e, { hoursPerDay: 4, workDays: [1] })))?.status).toBe(403);
    expect((await fail(upsertStaffCapacity(fx.mgr, e, { hoursPerDay: 0, workDays: [1] })))?.status).toBe(422);
    expect((await fail(upsertStaffCapacity(fx.mgr, e, { hoursPerDay: 4, workDays: [] })))?.status).toBe(422);
    expect((await listStaffCapacity(fx.mgr)).rows).toHaveLength(1);
    expect((await fail(listStaffCapacity(fx.adm)))?.status).toBe(403);
    await clearStaffCapacity(fx.mgr, e);
    expect((await rowOf(fx.mgr, e)).weeks[0]!.capacity).toBe(30);
  });

  it("kapasitas 0 (cuti seminggu penuh) dengan jam > 0 = Overload, bukan galat pembagian nol", async () => {
    const e = fx.empIds[2];
    await loadWeek(e, 10);
    for (let i = 0; i < 5; i++) await makeLeave(e, addDays(week(), i), addDays(week(), i));
    const w = (await rowOf(fx.mgr, e)).weeks[0]!;
    expect(w).toMatchObject({ capacity: 0, band: "OVERLOAD" });
    expect(Number.isFinite(w.pct)).toBe(true);
  });

  it("Overload dua minggu berturut-turut ditandai (pemicu eskalasi); satu minggu saja tidak", async () => {
    await loadWeek(fx.empIds[0], 72, 2);
    await loadWeek(fx.empIds[1], 36, 1);
    expect((await rowOf(fx.mgr, fx.empIds[0])).overloadStreak).toBe(true);
    expect((await rowOf(fx.mgr, fx.empIds[1])).overloadStreak).toBe(false);
  });

  it("hanya tugas OPEN pada proyek yang belum Selesai/Batal yang dihitung", async () => {
    const e = fx.empIds[2];
    const id = await loadWeek(e, 30);
    const [w] = await listWorkloadTasks(fx.mgr, id);
    expect((await rowOf(fx.mgr, e)).weeks[0]!.pct).toBeCloseTo(100, 5);
    await prisma.trainingWorkloadTask.update({ where: { id: w!.id }, data: { status: "DONE" } });
    expect((await getTeamHeatmap(fx.mgr)).rows.find((r) => r.employeeId === e)?.weeks[0]!.hours ?? 0).toBe(0);
    await prisma.trainingWorkloadTask.update({ where: { id: w!.id }, data: { status: "OPEN" } });
    await prisma.trainingProject.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: fx.superAdmin.userId, cancelReason: "uji" } });
    expect((await getTeamHeatmap(fx.mgr)).rows.find((r) => r.employeeId === e)?.weeks[0]!.hours ?? 0).toBe(0);
  });

  it("peta beban: Pemantau/Manajer melihat seluruh tim; anggota proyek biasa hanya barisnya sendiri; tanpa akses modul → 404", async () => {
    await loadWeek(fx.empIds[0], 20);
    await loadWeek(fx.empIds[1], 20);
    const all = await getTeamHeatmap(fx.viewer);
    expect(all.scope).toBe("all");
    expect(all.rows.map((r) => r.employeeId)).toEqual(expect.arrayContaining([fx.empIds[0], fx.empIds[1]]));
    const ayu = await makeUser("ayu2@uji.test", "Ayu Dua", "EMPLOYEE", fx.empIds[0]);
    const pid = await mkProject(fx.mgr, {});
    await addTeam(fx.mgr, pid, [[fx.empIds[0], "STAFF"]]);
    const mine = await getTeamHeatmap(ayu);
    expect(mine.scope).toBe("self");
    expect(mine.rows.map((r) => r.employeeId)).toEqual([fx.empIds[0]]);
    expect(mine.divisions).toEqual([]);
    expect((await fail(getTeamHeatmap(fx.loner)))?.status).toBe(404);
  });

  it("beban program = beban tertinggi staf pemegang milestone yang masih terbuka; nama hanya terlihat bagi yang boleh melihat semua proyek", async () => {
    await setConfig();
    const id = await mkProject(fx.mgr, { participantsMin: 15, startDate: inDays(20), endDate: inDays(21) });
    const spv = fx.empIds[0]; // SPV_CURRICULUM: pemegang R07, R04, R14, ...
    const before = await getProgramIndicators(fx.mgr, id);
    expect(before.load.band).toBe("ROOMY");
    await addWorkloadTask(fx.mgr, id, { employeeId: spv, name: "Pekerjaan lain", hours: 40, startDate: week(), endDate: endOfIsoWeek(TODAY()) });
    const after = await getProgramIndicators(fx.mgr, id);
    expect(after.load).toMatchObject({ band: "OVERLOAD", status: "RED", topPerson: expect.any(String) });
    expect(after.load.pct!).toBeGreaterThan(110);
    expect(after.overall).toBe("RED");
    const ayu = await makeUser("ayu3@uji.test", "Ayu Tiga", "EMPLOYEE", fx.empIds[1]);
    await addTeam(fx.mgr, id, [[fx.empIds[1], "STAFF"]]);
    expect((await getProgramIndicators(ayu, id)).load.topPerson).toBeNull();
    expect((await getProgramIndicators(ayu, id)).load.band).toBe("OVERLOAD");
  });

  it("ketimpangan beban per divisi = beban tertinggi ÷ rerata divisi; ditandai bila melewati batas", async () => {
    // Fixtures: karyawan 1–3 satu divisi. Satu orang 150%, yang lain longgar → indeks tinggi DAN beban tertinggi di atas "ada ruang" → ditandai.
    await loadWeek(fx.empIds[0], 45);
    const flagged = (await getTeamHeatmap(fx.mgr)).divisions.find((d) => d.index !== null && d.index > 1.5);
    expect(flagged?.flagged).toBe(true);
  });

  it("indeks ketimpangan TIDAK ditandai bila semua orang masih longgar (rasio besar dari angka kecil bukan masalah)", async () => {
    await loadWeek(fx.empIds[0], 3); // 10% dari kapasitas, sementara rekan sekelompok 0%
    const h = await getTeamHeatmap(fx.mgr);
    const div = h.divisions.find((d) => d.index !== null)!;
    expect(div.index!).toBeGreaterThan(1.5);
    expect(div.flagged).toBe(false);
  });
});

describe("Kepadatan kelas paralel (KP)", () => {
  const workday = (n: number) => { let d = addDays(TODAY(), n); while ([6, 7].includes(isoWeekday(d))) d = addDays(d, 1); return d; };
  async function klass(mode: "ONSITE" | "ONLINE" | "HYBRID", date: string) {
    const id = await mkProject(fx.mgr, { deliveryMode: mode, startDate: date, endDate: date });
    await prisma.trainingProject.update({ where: { id }, data: { status: "PREPARATION" } });
    return id;
  }

  it("KP = (luring + daring + 2 × hybrid) ÷ fasilitator tersedia; > 1,0 menjadi pemicu Merah pada program yang berjalan hari itu", async () => {
    await setConfig(); // 2 fasilitator
    const d = workday(2);
    const a = await klass("ONSITE", d);
    expect((await getClassDensity(fx.mgr)).list.find((x) => x.date === d)).toMatchObject({ load: 1, facilitators: 2, kp: 0.5, status: "GREEN" });
    const b = await klass("ONLINE", d);
    expect((await getClassDensity(fx.mgr)).list.find((x) => x.date === d)).toMatchObject({ kp: 1, status: "GREEN" }); // tepat 1,0 belum melewati batas
    const c = await klass("HYBRID", d);
    const day = (await getClassDensity(fx.mgr)).list.find((x) => x.date === d)!;
    expect(day).toMatchObject({ load: 4, kp: 2, status: "RED" });
    for (const id of [a, b, c]) expect((await getProgramIndicators(fx.mgr, id)).triggers).toContain("PARALLEL_DENSITY");
    const other = await mkProject(fx.mgr, { startDate: workday(9), endDate: workday(9) });
    await prisma.trainingProject.update({ where: { id: other }, data: { status: "PREPARATION" } });
    expect((await getProgramIndicators(fx.mgr, other)).triggers).not.toContain("PARALLEL_DENSITY");
  });

  it("fasilitator yang cuti penuh pada hari itu tidak dihitung; tanpa fasilitator dikonfigurasi dengan kelas = KP tak terhingga (Merah)", async () => {
    await setConfig();
    const d = workday(2);
    await klass("ONSITE", d);
    await klass("ONSITE", d);
    expect((await getClassDensity(fx.mgr)).list.find((x) => x.date === d)!.kp).toBe(1);
    await makeLeave(fx.empIds[1], d, d);
    expect((await getClassDensity(fx.mgr)).list.find((x) => x.date === d)).toMatchObject({ facilitators: 1, kp: 2, status: "RED" });
    await setConfig((c) => { c.facilitators = []; });
    const none = (await getClassDensity(fx.mgr)).list.find((x) => x.date === d)!;
    expect(none.status).toBe("RED");
    expect(Number.isFinite(none.kp)).toBe(true);
  });

  it("angka lintas program hanya untuk yang boleh melihat semua proyek", async () => {
    await setConfig();
    await klass("ONSITE", workday(2));
    expect((await getClassDensity(fx.viewer)).list.length).toBeGreaterThan(0);
    const pid = await mkProject(fx.mgr, {});
    await addTeam(fx.mgr, pid, [[fx.empIds[0], "STAFF"]]);
    const ayu = await makeUser("ayu4@uji.test", "Ayu Empat", "EMPLOYEE", fx.empIds[0]);
    expect(await getClassDensity(ayu)).toMatchObject({ restricted: true, list: [] });
    expect((await fail(getClassDensity(fx.loner)))?.status).toBe(404);
  });
});

describe("kartu pemantauan & akses lintas program", () => {
  it("kartu diurutkan Merah → Kuning → Hijau → belum diterapkan; anggota biasa hanya melihat program yang ia ikuti; tanpa akses → 404", async () => {
    await setConfig();
    const red = await mkProject(fx.mgr, { name: "Program merah", bnsp: true, participantsMin: 15, startDate: inDays(4), endDate: inDays(4) });
    await mkProject(fx.mgr, { name: "Program jauh", participantsMin: 15, startDate: inDays(40), endDate: inDays(41) });
    await setConfig((c) => { c.autoApplyOnCreate = false; });
    await mkProject(fx.mgr, { name: "Belum diterapkan", startDate: inDays(50), endDate: inDays(51) });
    const cards = await listProgramCards(fx.mgr);
    expect(cards.cards.map((c) => c.name)).toEqual(["Program merah", "Program jauh", "Belum diterapkan"]);
    expect(cards.cards[0]!.overall).toBe("RED");
    expect(cards.cards[2]!.applied).toBe(false);

    const ayu = await makeUser("ayu5@uji.test", "Ayu Lima", "EMPLOYEE", fx.empIds[0]);
    await addTeam(fx.mgr, red, [[fx.empIds[0], "STAFF"]]);
    expect((await listProgramCards(ayu)).cards.map((c) => c.name)).toEqual(["Program merah"]);
    expect((await listProgramCards(fx.viewer)).cards).toHaveLength(3);
    expect((await fail(listProgramCards(fx.loner)))?.status).toBe(404);
    const jauh = cards.cards[1]!.projectId;
    expect((await fail(getProgramIndicators(ayu, jauh)))?.status).toBe(404); // bukan anggota → 404, bukan 403
  });

  it("hari libur kalender HRIS hanya dikecualikan bila diaktifkan (bawaan dokumen: tidak)", async () => {
    await prisma.calendarDay.create({ data: { date: isoToDate("2026-11-09"), kind: "HOLIDAY", name: "Libur uji", createdById: fx.superAdmin.userId } });
    const mk = async () => {
      const id = await mkProject(fx.mgr, { track: "PARTNER", participantsMin: 20, requestDate: "2026-11-06", startDate: "2027-01-18", endDate: "2027-01-19" });
      return (await listMilestones(fx.mgr, id)).find((m) => m.code === "K01")!.due;
    };
    await setConfig();
    expect(await mk()).toBe("2026-11-10"); // Jumat + 2 hari kerja
    await setConfig((c) => { c.capacity.skipHolidays = true; });
    expect(await mk()).toBe("2026-11-11"); // Senin 9 Nov libur → Rabu
  });

  it("modul dimatikan atau pengguna tanpa akses: seluruh layanan indikator menjawab 404, bukan data", async () => {
    await setConfig();
    const id = await mkProject(fx.mgr, {});
    for (const call of [() => getProgramIndicators(fx.loner, id), () => listMilestones(fx.loner, id), () => listReadiness(fx.loner, id), () => listWorkloadTasks(fx.loner, id), () => getTeamHeatmap(fx.loner), () => listProgramCards(fx.loner)]) {
      expect((await fail(call()))?.status).toBe(404);
    }
  });
});
