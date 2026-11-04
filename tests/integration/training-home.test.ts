/** Data beranda Training & Operations: angka dari data nyata dan dibatasi lingkup akses pelaku. */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { resetDb } from "../helpers/db";
import { addTeam, inDays, mkProject, seedTraining, TODAY, type TrainingFixtures } from "../helpers/training";
import { getTrainingHome } from "@/server/services/training/home";
import { addParticipant } from "@/server/services/training/operations";
import { changeTaskStatus, createTask } from "@/server/services/training/work";

let fx: TrainingFixtures;
beforeEach(async () => { await resetDb(); fx = await seedTraining(); });
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };

async function active(name: string, members: [string, "STAFF" | "PROJECT_MANAGER"][] = []) {
  const id = await mkProject(fx.mgr, { name, startDate: inDays(3), endDate: inDays(4) });
  await addTeam(fx.mgr, id, members);
  await prisma.trainingProject.update({ where: { id }, data: { status: "PREPARATION" } });
  return id;
}

describe("beranda training", () => {
  it("Manajer/Direktur/Pemantau melihat seluruh proyek; anggota biasa hanya proyek yang diikuti; tanpa akses → 404", async () => {
    const a = await active("Proyek A", [[fx.empIds[0], "STAFF"]]);
    await active("Proyek B");
    expect((await getTrainingHome(fx.mgr)).scope).toBe("all");
    expect((await getTrainingHome(fx.superAdmin)).kpis.activeProjects).toBe(2);
    expect((await getTrainingHome(fx.viewer)).kpis.activeProjects).toBe(2);
    const mine = await getTrainingHome(fx.emp1);
    expect(mine.scope).toBe("mine");
    expect(mine.kpis.activeProjects).toBe(1);
    expect(mine.myProjects.map((p) => p.id)).toEqual([a]);
    expect(mine.myProjects[0]!.isMember).toBe(true);
    expect((await fail(getTrainingHome(fx.loner)))?.status).toBe(404);
  });

  it("angka: peserta (tanpa yang dibatalkan), tugas tepat waktu = terbuka yang belum lewat tenggat, grafik 14 hari menghitung tugas selesai & peserta baru hari ini", async () => {
    const id = await active("Proyek hitung", [[fx.empIds[1], "STAFF"]]);
    await addParticipant(fx.mgr, id, { fullName: "Peserta Satu" });
    const x = await addParticipant(fx.mgr, id, { fullName: "Peserta Dua" });
    await prisma.trainingParticipant.update({ where: { id: x.id }, data: { status: "CANCELLED" } });
    await createTask(fx.mgr, id, { title: "Tugas terlambat", assigneeId: fx.empIds[1], dueDate: inDays(-1) });
    await createTask(fx.mgr, id, { title: "Tugas masih aman", assigneeId: fx.empIds[1], dueDate: inDays(2) });
    const done = await createTask(fx.mgr, id, { title: "Tugas selesai", assigneeId: fx.empIds[1], dueDate: inDays(1) });
    await changeTaskStatus(fx.emp2, done.id, { status: "IN_PROGRESS" });
    await changeTaskStatus(fx.emp2, done.id, { status: "DONE" });

    const h = await getTrainingHome(fx.mgr);
    expect(h.kpis).toMatchObject({ activeProjects: 1, participants: 1, openTasks: 2, tasksOnTrackPct: 50 });
    expect(h.chart.days).toHaveLength(14);
    expect(h.chart.days.at(-1)).toBe(TODAY());
    expect(h.chart.tasksDone.reduce((a, b) => a + b, 0)).toBe(1);
    expect(h.chart.participantsAdded.reduce((a, b) => a + b, 0)).toBe(2 - 1); // satu dibatalkan
  });

  it("tanpa tugas terbuka → persen 'tepat waktu' kosong (bukan 0%/100%); aktivitas terbaru hanya proyek dalam lingkup", async () => {
    const mineId = await active("Proyek saya", [[fx.empIds[0], "STAFF"]]);
    const otherId = await active("Proyek orang lain");
    expect((await getTrainingHome(fx.mgr)).kpis.tasksOnTrackPct).toBeNull();
    const scoped = await getTrainingHome(fx.emp1);
    expect(scoped.activity.length).toBeGreaterThan(0);
    expect(scoped.activity.every((a) => a.projectId === mineId)).toBe(true);
    const all = await getTrainingHome(fx.mgr);
    expect(new Set(all.activity.map((a) => a.projectId))).toContain(otherId);
    expect(all.activity.length).toBeLessThanOrEqual(6);
  });

  it("proyek Selesai/Dibatalkan tidak muncul di 'proyek saya'; kalender memuat sesi bulan ini", async () => {
    const id = await active("Proyek batal", [[fx.empIds[0], "STAFF"]]);
    await prisma.trainingProject.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: fx.superAdmin.userId, cancelReason: "uji" } });
    const h = await getTrainingHome(fx.emp1);
    expect(h.myProjects).toHaveLength(0);
    expect(h.calendar.month).toBe(TODAY().slice(0, 7));
    expect(h.calendar.days).toEqual([]);
  });
});
