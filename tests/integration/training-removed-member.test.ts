/**
 * Hak "pemilik" tugas/checklist hanya untuk ANGGOTA AKTIF proyek. Pemantau (atau Manajer otomatis Pemantau) yang dikeluarkan dari tim masih boleh MELIHAT proyek,
 * tetapi tidak dapat mengubah tugas/checklist lamanya; "Tugas Saya" dan lencana tidak lagi memuatnya. Mengakhiri anggota hanya MEMPERINGATKAN (tidak menolak).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { resetDb } from "../helpers/db";
import { addTeam, mkProject, seedTraining, type TrainingFixtures } from "../helpers/training";
import { addChecklistItem, addComment, changeTaskStatus, countMyOverdueTasks, createTask, getTask, listChecklist, listMyChecklistItems, listMyTasks, updateChecklistItem, updateTask } from "@/server/services/training/work";
import { addMember, endMember } from "@/server/services/training/projects";
import { addDays, todayIso } from "@/lib/time";

let fx: TrainingFixtures; let pid: string; let vEmp: string; let taskId: string; let itemId: string; let memberId: string;
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const NOT_MEMBER = /sudah tidak menjadi anggota aktif proyek/;

beforeEach(async () => {
  await resetDb(); fx = await seedTraining(); pid = await mkProject(fx.mgr);
  vEmp = fx.viewer.employeeId!;                                                       // Vina Viewer: level Pemantau (VIEWER) di tingkat modul
  await addTeam(fx.mgr, pid, [[fx.empIds[0], "PROJECT_MANAGER"], [vEmp, "STAFF"]]);
  taskId = (await createTask(fx.mgr, pid, { title: "Tugas lama Vina", assigneeId: vEmp, requiresReview: false, dueDate: addDays(todayIso("Asia/Jakarta"), -2) })).id;
  itemId = (await addChecklistItem(fx.mgr, pid, { phase: "PREPARATION", title: "Item lama Vina", isRequired: true, assigneeId: vEmp })).id;
  memberId = (await prisma.trainingProjectMember.findFirstOrThrow({ where: { projectId: pid, employeeId: vEmp, endedAt: null } })).id;
  await prisma.trainingProject.update({ where: { id: pid }, data: { status: "PREPARATION" } });   // "checklist saya" hanya memuat proyek Persiapan/Berjalan
});

describe("anggota aktif (kontrol): Pemantau yang diberi tugas tetap bisa mengerjakannya", () => {
  it("mengubah status tugas, menandai checklist, tampil di Tugas Saya, tombol ditawarkan", async () => {
    expect((await getTask(fx.viewer, taskId)).allowedNext.length).toBeGreaterThan(0);
    expect((await listChecklist(fx.viewer, pid)).items.find((i) => i.id === itemId)?.canToggle).toBe(true);
    expect((await listMyTasks(fx.viewer, { filter: "open" })).map((t) => t.id)).toContain(taskId);
    expect(await countMyOverdueTasks(fx.viewer)).toBe(1);
    expect((await listMyChecklistItems(fx.viewer)).map((i) => i.id)).toContain(itemId);
    await changeTaskStatus(fx.viewer, taskId, { status: "IN_PROGRESS" });
    await updateChecklistItem(fx.viewer, itemId, { isDone: true });
    expect((await prisma.trainingTask.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("IN_PROGRESS");
  });
});

describe("setelah dikeluarkan dari tim (masih Pemantau)", () => {
  beforeEach(async () => { await endMember(fx.mgr, pid, memberId); });

  it("masih MELIHAT proyek dan tugasnya, tetapi tombol status tidak ditawarkan dan penanda 'alihkan' tampil", async () => {
    const t = await getTask(fx.viewer, taskId);
    expect(t).toMatchObject({ title: "Tugas lama Vina", assigneeInactive: true, allowedNext: [] });
    expect((await listChecklist(fx.viewer, pid)).items.find((i) => i.id === itemId)?.canToggle).toBe(false);
  });

  it("DITOLAK mengubah status tugas lamanya dan menandai checklist lamanya (pesan jelas)", async () => {
    const a = await fail(changeTaskStatus(fx.viewer, taskId, { status: "DONE" }));
    expect(a?.code).toBe("FORBIDDEN");
    expect(a?.message).toMatch(NOT_MEMBER);
    const b = await fail(updateChecklistItem(fx.viewer, itemId, { isDone: true }));
    expect(b?.code).toBe("FORBIDDEN");
    expect(b?.message).toMatch(NOT_MEMBER);
    expect(await prisma.trainingTask.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({ status: "TODO", completedById: null });
    expect((await prisma.trainingProjectChecklistItem.findUniqueOrThrow({ where: { id: itemId } })).isDone).toBe(false);
    // konsisten dengan komentar & ubah isi (sudah ditolak sebelumnya)
    expect((await fail(addComment(fx.viewer, taskId, { body: "halo" })))?.code).toBe("FORBIDDEN");
    expect((await fail(updateTask(fx.viewer, taskId, { title: "x" })))?.code).toBe("FORBIDDEN");
  });

  it("tidak lagi masuk Tugas Saya, lencana terlambat, maupun daftar checklist saya", async () => {
    expect((await listMyTasks(fx.viewer, { filter: "all" })).map((t) => t.id)).not.toContain(taskId);
    expect(await countMyOverdueTasks(fx.viewer)).toBe(0);
    expect((await listMyChecklistItems(fx.viewer)).map((i) => i.id)).not.toContain(itemId);
  });

  it("pengelola (PIC/Koordinator) tetap dapat bertindak atas nama; ditambahkan kembali ke tim memulihkan haknya", async () => {
    await changeTaskStatus(fx.emp1, taskId, { status: "IN_PROGRESS" });              // PIC
    await updateChecklistItem(fx.mgr, itemId, { isDone: true });                      // Koordinator
    await addMember(fx.mgr, pid, { employeeId: vEmp, role: "STAFF" });
    expect((await getTask(fx.viewer, taskId)).allowedNext.length).toBeGreaterThan(0);
    await changeTaskStatus(fx.viewer, taskId, { status: "DONE" });
    expect((await prisma.trainingTask.findUniqueOrThrow({ where: { id: taskId } })).status).toBe("DONE");
    expect((await listMyTasks(fx.viewer, { filter: "all" })).map((t) => t.id)).toContain(taskId);
  });

  it("pemisahan pemeriksa tidak bergantung keanggotaan: pengelola yang dikeluarkan tetapi masih penanggung jawab tidak boleh memeriksa hasil sendiri", async () => {
    // Direktur-lain (Koordinator) sebagai penanggung jawab tugas wajib periksa; dikeluarkan dari tim; tetap tak boleh memeriksa sendiri.
    await addMember(fx.mgr, pid, { employeeId: fx.mgrEmp, role: "STAFF" });
    const id = (await createTask(fx.mgr, pid, { title: "Tugas Koordinator", assigneeId: fx.mgrEmp, requiresReview: true })).id;
    await changeTaskStatus(fx.mgr, id, { status: "IN_REVIEW" });
    const m = await prisma.trainingProjectMember.findFirstOrThrow({ where: { projectId: pid, employeeId: fx.mgrEmp, endedAt: null } });
    await endMember(fx.mgr, pid, m.id);
    expect((await fail(changeTaskStatus(fx.mgr, id, { status: "DONE" })))?.code).toBe("FORBIDDEN");
  });
});

describe("kontrol: anggota biasa (tanpa akses Pemantau) yang dikeluarkan", () => {
  it("tetap tidak melihat apa pun (404) — perilaku lama tidak berubah", async () => {
    await addTeam(fx.mgr, pid, [[fx.lonerEmp, "STAFF"]]);
    const tid = (await createTask(fx.mgr, pid, { title: "Tugas Lola", assigneeId: fx.lonerEmp, requiresReview: false })).id;
    const m = await prisma.trainingProjectMember.findFirstOrThrow({ where: { projectId: pid, employeeId: fx.lonerEmp, endedAt: null } });
    await endMember(fx.mgr, pid, m.id);
    expect((await fail(changeTaskStatus(fx.loner, tid, { status: "IN_PROGRESS" })))?.code).toBe("NOT_FOUND");
  });
});

describe("mengakhiri anggota: peringatan, bukan penolakan", () => {
  it("tetap berhasil walau masih memegang tugas/checklist; hasil menyebut jumlahnya; audit mencatat 'perlu dialihkan'", async () => {
    const r = await endMember(fx.mgr, pid, memberId);
    expect(r).toEqual({ openTasks: 1, openChecklist: 1 });
    const ended = await prisma.trainingProjectMember.findUniqueOrThrow({ where: { id: memberId } });
    expect(ended.endedAt).not.toBeNull();
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "training.member.end", entityId: pid } });
    expect(audit.summary).toMatch(/masih memegang 1 tugas terbuka dan 1 item checklist; perlu dialihkan/);
    // tugas tidak dialihkan otomatis
    expect((await prisma.trainingTask.findUniqueOrThrow({ where: { id: taskId } })).assigneeId).toBe(vEmp);
  });
  it("tanpa tanggungan → hasil nol dan tanpa catatan tambahan", async () => {
    await prisma.trainingTask.update({ where: { id: taskId }, data: { assigneeId: null } });
    await prisma.trainingProjectChecklistItem.update({ where: { id: itemId }, data: { assigneeId: null } });
    expect(await endMember(fx.mgr, pid, memberId)).toEqual({ openTasks: 0, openChecklist: 0 });
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "training.member.end", entityId: pid } })).summary).not.toMatch(/perlu dialihkan/);
  });
});
