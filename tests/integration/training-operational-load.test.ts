/**
 * Penanda tugas operasional pada peta beban tim: terbuka (termasuk menunggu pemeriksaan) / terlambat (bagian dari terbuka) / menunggu pemeriksaan (terpisah),
 * "Perlu dicek" (beban jam longgar + banyak tugas terbuka atau ada yang terlambat). Tidak dijumlahkan dengan jam standar; tidak memengaruhi status program.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { isoToDate } from "@/server/json";
import { defaultIndicatorConfig } from "@/lib/training/indicators/config";
import { weekStartOf } from "@/lib/training/indicators/engine";
import { addDays } from "@/lib/time";
import { resetDb } from "../helpers/db";
import { addTeam, inDays, mkProject, seedTraining, TODAY, type TrainingFixtures } from "../helpers/training";
import { loadConfig, saveIndicatorConfig } from "@/server/services/training/indicator-config";
import { addWorkloadTask } from "@/server/services/training/indicator-data";
import { getProgramIndicators, getTeamHeatmap } from "@/server/services/training/indicator-compute";
import { getTrainingDashboard } from "@/server/services/training/insights";
import { cancelProject, changeProjectStatus, closeProject, endMember, listMembers } from "@/server/services/training/projects";
import { changeTaskStatus, createTask } from "@/server/services/training/work";
import { runTrainingDailyJob } from "@/server/services/training/automation";

let fx: TrainingFixtures;
beforeEach(async () => { await resetDb(); fx = await seedTraining(); });
const [AYU, BUDI] = [0, 1] as const;

async function running() {
  const id = await mkProject(fx.mgr, { startDate: inDays(40), endDate: inDays(42) });
  await addTeam(fx.mgr, id, [[fx.empIds[AYU]!, "PROJECT_MANAGER"], [fx.empIds[BUDI]!, "STAFF"]]);
  await changeProjectStatus(fx.mgr, id, { to: "PREPARATION" });
  await changeProjectStatus(fx.mgr, id, { to: "RUNNING" });
  return id;
}
const task = (id: string, title: string, over: Record<string, unknown> = {}) => createTask(fx.mgr, id, { title, assigneeId: fx.empIds[BUDI], dueDate: inDays(7), ...over });
const budiRow = async (actor = fx.mgr) => (await getTeamHeatmap(actor)).rows.find((r) => r.employeeId === fx.empIds[BUDI]);

describe("hitungan tugas operasional per staf", () => {
  it("terbuka = Belum + Proses + Menunggu pemeriksaan (Selesai/Dibatalkan tidak); terlambat ⊆ terbuka; menunggu pemeriksaan ⊆ terbuka & terpisah", async () => {
    const id = await running();
    await task(id, "Tugas A");
    await task(id, "Tugas B", { dueDate: inDays(-2) });                                  // terlambat
    const c = await task(id, "Tugas C");
    await changeTaskStatus(fx.emp2, c.id, { status: "IN_PROGRESS" });
    const r = await task(id, "Tugas D", { requiresReview: true, dueDate: inDays(-1) });  // menunggu pemeriksaan & lewat tenggat
    await changeTaskStatus(fx.emp2, r.id, { status: "IN_PROGRESS" });
    await changeTaskStatus(fx.emp2, r.id, { status: "IN_REVIEW" });
    const done = await task(id, "Tugas E");
    await changeTaskStatus(fx.emp2, done.id, { status: "IN_PROGRESS" });
    await changeTaskStatus(fx.emp2, done.id, { status: "DONE" });
    const gone = await task(id, "Tugas F");
    await changeTaskStatus(fx.mgr, gone.id, { status: "CANCELLED" });
    const row = await budiRow();
    expect(row!.operational).toMatchObject({ open: 4, overdue: 2, inReview: 1 });       // A, B, C, D terbuka; B & D terlambat; D menunggu pemeriksaan
    expect(row!.operational.overdue).toBeLessThanOrEqual(row!.operational.open);
    expect(row!.operational.inReview).toBeLessThanOrEqual(row!.operational.open);
  });

  it("staf TANPA tugas jam kerja (beban jam 0%) tetap tampil di peta bila punya tugas terbuka", async () => {
    const id = await running();
    expect(await budiRow()).toBeUndefined();                                             // belum punya apa-apa
    await task(id, "Satu tugas");
    const row = await budiRow();
    expect(row).toBeTruthy();
    expect(row!.peak).toBe(0);
    expect(row!.operational.open).toBe(1);
  });

  it("tindak lanjut pada proyek Selesai DIHITUNG; tugas terkunci (yatim) pada proyek Selesai TIDAK; proyek Dibatalkan TIDAK; bukan anggota aktif TIDAK", async () => {
    const id = await running();
    const fu = await task(id, "Kirim sertifikat", { dueDate: inDays(5) });
    await closeProject(fx.mgr, id, { summary: "Selesai dengan baik", taskDecisions: [{ taskId: fu.id, action: "FOLLOW_UP", dueDate: inDays(5) }] });
    await prisma.trainingTask.create({ data: { projectId: id, title: "Yatim lama", assigneeId: fx.empIds[BUDI]!, dueDate: isoToDate(inDays(-3)), createdById: fx.mgr.userId } });
    expect((await budiRow())!.operational).toMatchObject({ open: 1, overdue: 0 });      // hanya tindak lanjut

    const cancelled = await running();
    await task(cancelled, "Menggantung", { dueDate: inDays(-2) });
    await cancelProject(fx.mgr, cancelled, { reason: "Klien membatalkan" });
    expect((await budiRow())!.operational).toMatchObject({ open: 1, overdue: 0 });

    const other = await running();
    await task(other, "Tugas lain", { dueDate: inDays(-2) });
    expect((await budiRow())!.operational).toMatchObject({ open: 2, overdue: 1 });
    const m = (await listMembers(fx.mgr, other)).find((x) => x.employeeId === fx.empIds[BUDI])!;
    await endMember(fx.mgr, other, m.id);                                                // dikeluarkan dari proyek → tugas tidak lagi miliknya yang sah
    expect((await budiRow())!.operational).toMatchObject({ open: 1, overdue: 0 });
  });
});

describe("penanda 'Perlu dicek'", () => {
  it("beban jam longgar + 5 tugas terbuka → Perlu dicek; 4 → tidak; 1 terlambat → ya (tugas sedikit pun)", async () => {
    const id = await running();
    for (let i = 0; i < 4; i++) await task(id, `Tugas ${i}`);
    expect((await budiRow())!.operational).toMatchObject({ open: 4, needsCheck: false, reason: null });
    await task(id, "Tugas ke-5");
    const five = (await budiRow())!.operational;
    expect(five).toMatchObject({ open: 5, needsCheck: true });
    expect(five.reason).toMatch(/5 tugas terbuka \(batas 5\)/);

    await prisma.trainingTask.deleteMany({ where: { projectId: id } });
    await task(id, "Satu tugas terlambat", { dueDate: inDays(-1) });
    expect((await budiRow())!.operational).toMatchObject({ open: 1, overdue: 1, needsCheck: true });
  });

  it("tidak dijumlahkan dengan jam standar: beban jam (peak) sama sebelum & sesudah menambah tugas operasional", async () => {
    const id = await running();
    await addWorkloadTask(fx.mgr, id, { employeeId: fx.empIds[BUDI], name: "Beban uji", hours: 6, startDate: TODAY(), endDate: inDays(6) });
    const before = (await budiRow())!;
    for (let i = 0; i < 8; i++) await task(id, `Tugas ${i}`);
    const after = (await budiRow())!;
    expect(after.peak).toBe(before.peak);
    expect(after.weeks.map((w) => w.pct)).toEqual(before.weeks.map((w) => w.pct));
    expect(after.operational.open).toBe(8);
  });

  it("hanya saat beban jam 'Ada ruang': beban Padat/Overload tidak ditandai walau tugas banyak", async () => {
    const id = await running();
    // Senin–Jumat PEKAN BERJALAN (bukan "hari ini + 6"): pada Sabtu/Minggu jendela "hari ini" jatuh seluruhnya ke pekan depan dan tes ini gagal untuk alasan yang tak berkaitan.
    const monday = weekStartOf(TODAY());
    await addWorkloadTask(fx.mgr, id, { employeeId: fx.empIds[BUDI], name: "Beban besar", hours: 200, startDate: monday, endDate: addDays(monday, 4) });
    for (let i = 0; i < 6; i++) await task(id, `Tugas ${i}`, { dueDate: inDays(-1) });
    const row = (await budiRow())!;
    expect(row.weeks[0]!.weekStart).toBe(monday);
    expect(row.weeks[0]!.band).not.toBe("ROOMY");
    expect(row.operational).toMatchObject({ open: 6, overdue: 6, needsCheck: false });
  });

  it("ambang dapat diubah di Rumus Indikator (berversi) dan DTO membawa ambang yang berlaku", async () => {
    const id = await running();
    for (let i = 0; i < 3; i++) await task(id, `Tugas ${i}`);
    expect((await budiRow())!.operational.needsCheck).toBe(false);
    const c = defaultIndicatorConfig();
    c.thresholds.operational = { openMin: 3, overdueMin: 4 };
    await saveIndicatorConfig(fx.superAdmin, { config: c, note: "ambang operasional" });
    const h = await getTeamHeatmap(fx.mgr);
    expect(h.operationalThresholds).toEqual({ openMin: 3, overdueMin: 4 });
    expect(h.rows.find((r) => r.employeeId === fx.empIds[BUDI])!.operational).toMatchObject({ open: 3, needsCheck: true });
  });

  it("konfigurasi tersimpan SEBELUM ada ambang ini tetap terbaca dengan nilai bawaan (tidak rusak)", async () => {
    const legacy = JSON.parse(JSON.stringify(defaultIndicatorConfig())) as { thresholds: Record<string, unknown> };
    delete legacy.thresholds.operational;
    await prisma.trainingIndicatorConfig.create({ data: { id: 1, version: 1, config: legacy as never, updatedById: fx.superAdmin.userId } });
    const loaded = await loadConfig();
    expect(loaded.damaged).toBe(false);
    expect(loaded.config.thresholds.operational).toEqual({ openMin: 5, overdueMin: 1 });
  });

  it("penanda HANYA meminta diperiksa: status program tidak berubah dan tidak ada notifikasi/eskalasi baru karenanya", async () => {
    const id = await running();
    const before = JSON.stringify((await getProgramIndicators(fx.mgr, id)).overall);
    for (let i = 0; i < 9; i++) await task(id, `Tugas ${i}`, { dueDate: inDays(-1) });
    expect((await budiRow())!.operational.needsCheck).toBe(true);
    expect(JSON.stringify((await getProgramIndicators(fx.mgr, id)).overall)).toBe(before);
    await runTrainingDailyJob();
    const notes = await prisma.notification.findMany({ select: { title: true, body: true } });
    expect(notes.some((n) => /Perlu dicek/i.test(`${n.title} ${n.body ?? ""}`))).toBe(false);
  });
});

describe("cakupan & dasbor", () => {
  it("anggota biasa hanya melihat barisnya sendiri (scope self) dengan angka tugasnya sendiri", async () => {
    const id = await running();
    for (let i = 0; i < 5; i++) await task(id, `Tugas ${i}`);
    await createTask(fx.mgr, id, { title: "Milik Ayu", assigneeId: fx.empIds[AYU], dueDate: inDays(3) });
    const mine = await getTeamHeatmap(fx.emp2);
    expect(mine.scope).toBe("self");
    expect(mine.rows.map((r) => r.employeeId)).toEqual([fx.empIds[BUDI]]);
    expect(mine.rows[0]!.operational).toMatchObject({ open: 5, needsCheck: true });
    const all = await getTeamHeatmap(fx.mgr);
    expect(all.scope).toBe("all");
    expect(all.rows.find((r) => r.employeeId === fx.empIds[AYU])!.operational.open).toBe(1);
  });

  it("dasbor 'Ringkasan penugasan tim': terbuka, terlambat (bagian dari terbuka), dan menunggu pemeriksaan terpisah", async () => {
    const id = await running();
    await task(id, "Tugas satu", { dueDate: inDays(-1) });
    const r = await task(id, "Tugas dua", { requiresReview: true });
    await changeTaskStatus(fx.emp2, r.id, { status: "IN_PROGRESS" });
    await changeTaskStatus(fx.emp2, r.id, { status: "IN_REVIEW" });
    const d = await getTrainingDashboard(fx.mgr);
    expect(d.teamLoad.find((t) => t.employeeId === fx.empIds[BUDI])).toMatchObject({ openTasks: 2, overdueTasks: 1, inReviewTasks: 1 });
  });
});
