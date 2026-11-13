/**
 * Penugasan BARU hanya kepada penanggung jawab yang TERSEDIA — satu definisi (`lib/training/availability`): karyawan aktif DAN akun login tidak nonaktif (dan anggota aktif proyek
 * untuk tugas/checklist). Sebelumnya gerbang penugasan hanya memeriksa karyawan aktif + keanggotaan, sehingga Koordinator dapat menjadikan orang yang AKUN LOGIN-nya nonaktif
 * sebagai penanggung jawab tindak lanjut (dan menutup proyek): tugas tercatat aktif tetapi orangnya tidak dapat masuk untuk mengerjakannya.
 *
 * Yang TIDAK berubah (sengaja): karyawan yang sama sekali TIDAK punya akun login tidak dianggap "tidak tersedia" (tidak ada akun yang bisa nonaktif) — tetap boleh, dan diberi
 * penanda "tanpa akun login" di ringkasan penutupan; mengedit kolom lain pada tugas yang sudah atas nama orang berakun nonaktif tidak terkunci (hanya PENUGASAN BARU yang ditolak).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { makeEmployee, resetDb } from "../helpers/db";
import { addTeam, inDays, mkProject, seedTraining, type TrainingFixtures } from "../helpers/training";
import { addMember, changeProjectStatus, closeProject } from "@/server/services/training/projects";
import { addChecklistItem, createTask, updateChecklistItem, updateTask } from "@/server/services/training/work";
import { addMilestone, addReadinessItem, updateMilestone } from "@/server/services/training/indicator-data";
import { getClosurePreview } from "@/server/services/training/insights";

let fx: TrainingFixtures;
const [AYU, BUDI, CITRA] = [0, 1, 2] as const;
const sum = { summary: "Pelatihan selesai dengan baik" };
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
beforeEach(async () => { await resetDb(); fx = await seedTraining(); });

async function running() {
  const id = await mkProject(fx.mgr, { startDate: inDays(3), endDate: inDays(5) });
  await addTeam(fx.mgr, id, [[fx.empIds[AYU]!, "PROJECT_MANAGER"], [fx.empIds[BUDI]!, "STAFF"], [fx.empIds[CITRA]!, "ADMIN_PROGRAM"]]);
  await changeProjectStatus(fx.mgr, id, { to: "PREPARATION" });
  await changeProjectStatus(fx.mgr, id, { to: "RUNNING" });
  return id;
}
const setAccount = (userId: string, isActive: boolean) => prisma.user.update({ where: { id: userId }, data: { isActive } });
const budiOff = () => setAccount(fx.emp2.userId, false);
/** Anggota aktif proyek yang TIDAK punya akun login sama sekali. */
async function noAccountMember(id: string) {
  const e = await makeEmployee({ fullName: "Nadia Tanpa Akun" });
  await addMember(fx.mgr, id, { employeeId: e.id, role: "STAFF" });
  return e.id;
}
const mustReject = (e: AppError | null, what: string) => {
  expect(e, what).toMatchObject({ code: "VALIDATION", fieldErrors: { assigneeId: expect.any(String) } });
  expect(e!.message, what).toMatch(/akun login/i);
};

describe("penugasan baru ke akun login NONAKTIF ditolak", () => {
  it("buat tugas: ditolak dengan pesan jelas; tidak ada tugas tercipta; setelah akun diaktifkan kembali → boleh", async () => {
    const id = await running();
    await budiOff();
    mustReject(await fail(createTask(fx.mgr, id, { title: "Siapkan materi", assigneeId: fx.empIds[BUDI], dueDate: inDays(5) })), "createTask");
    expect(await prisma.trainingTask.count({ where: { projectId: id } })).toBe(0);
    await setAccount(fx.emp2.userId, true);
    expect((await createTask(fx.mgr, id, { title: "Siapkan materi", assigneeId: fx.empIds[BUDI], dueDate: inDays(5) })).id).toBeTruthy();
  });

  it("ubah tugas: mengalihkan KE akun nonaktif ditolak; mengedit kolom lain pada tugas yang sudah atas nama orang berakun nonaktif TIDAK terkunci", async () => {
    const id = await running();
    const t = await createTask(fx.mgr, id, { title: "Siapkan materi", assigneeId: fx.empIds[BUDI], dueDate: inDays(5) });
    const other = await createTask(fx.mgr, id, { title: "Hubungi klien", assigneeId: fx.empIds[CITRA], dueDate: inDays(5) });
    await budiOff();
    mustReject(await fail(updateTask(fx.mgr, other.id, { assigneeId: fx.empIds[BUDI] })), "updateTask → akun nonaktif");
    expect((await prisma.trainingTask.findUniqueOrThrow({ where: { id: other.id } })).assigneeId).toBe(fx.empIds[CITRA]);
    await updateTask(fx.mgr, t.id, { title: "Siapkan materi (judul diubah)", priority: "HIGH" });          // tetap boleh
    expect(await prisma.trainingTask.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ title: "Siapkan materi (judul diubah)", assigneeId: fx.empIds[BUDI] });
  });

  it("checklist: item baru / penanggung jawab diganti ke akun nonaktif ditolak; menandai/mengedit item yang sudah atas namanya oleh pengelola tidak terkunci", async () => {
    const id = await running();
    const keep = await addChecklistItem(fx.mgr, id, { phase: "EXECUTION", title: "Cetak materi", isRequired: false, assigneeId: fx.empIds[BUDI] });
    const free = await addChecklistItem(fx.mgr, id, { phase: "EXECUTION", title: "Siapkan ruang", isRequired: false });
    await budiOff();
    mustReject(await fail(addChecklistItem(fx.mgr, id, { phase: "EXECUTION", title: "Tambahan", isRequired: false, assigneeId: fx.empIds[BUDI] })), "addChecklistItem");
    mustReject(await fail(updateChecklistItem(fx.mgr, free.id, { assigneeId: fx.empIds[BUDI] })), "updateChecklistItem → akun nonaktif");
    await updateChecklistItem(fx.mgr, keep.id, { note: "Catatan pengelola" });                                  // tetap boleh
    expect((await prisma.trainingProjectChecklistItem.findUniqueOrThrow({ where: { id: keep.id } })).note).toBe("Catatan pengelola");
  });

  it("PIC milestone & penanggung jawab item kesiapan: baru/diganti ke akun nonaktif ditolak; PIC yang tidak berubah tidak mengunci penyuntingan", async () => {
    const id = await running();
    const m = await addMilestone(fx.mgr, id, { code: "X1", name: "Sertifikat terbit", anchor: "H", days: 3, weight: 5, critical: false, assigneeId: fx.empIds[BUDI] });
    const free = await addMilestone(fx.mgr, id, { code: "X2", name: "Dokumentasi diunggah", anchor: "H", days: 3, weight: 1, critical: false });
    await budiOff();
    mustReject(await fail(addMilestone(fx.mgr, id, { code: "X3", name: "Laporan akhir", anchor: "H", days: 5, weight: 1, critical: false, assigneeId: fx.empIds[BUDI] })), "addMilestone");
    mustReject(await fail(updateMilestone(fx.mgr, free.id, { assigneeId: fx.empIds[BUDI] })), "updateMilestone → akun nonaktif");
    await updateMilestone(fx.mgr, m.id, { name: "Sertifikat terbit (nama diubah)", assigneeId: fx.empIds[BUDI] });   // PIC sama, hanya nama berubah → tidak terkunci
    expect((await prisma.trainingMilestone.findUniqueOrThrow({ where: { id: m.id } })).name).toBe("Sertifikat terbit (nama diubah)");
    mustReject(await fail(addReadinessItem(fx.mgr, id, { component: "MATERIAL", name: "Materi dicetak", anchor: "H", days: -1, critical: false, assigneeId: fx.empIds[BUDI] })), "addReadinessItem");
  });
});

describe("tindak lanjut saat menutup proyek", () => {
  it("tindak lanjut yang TETAP dipegang orang berakun nonaktif DITOLAK; proyek tetap Berjalan; tugas tidak berubah (repro temuan)", async () => {
    const id = await running();
    const t = await createTask(fx.mgr, id, { title: "Kirim sertifikat", assigneeId: fx.empIds[BUDI], dueDate: inDays(5) });
    await budiOff();
    const e = await fail(closeProject(fx.mgr, id, { ...sum, taskDecisions: [{ taskId: t.id, action: "FOLLOW_UP", dueDate: inDays(3) }] }));
    expect(e).toMatchObject({ code: "VALIDATION" });
    expect(e!.message).toMatch(/Tindak lanjut "Kirim sertifikat".*akun login/i);
    expect((await prisma.trainingProject.findUniqueOrThrow({ where: { id } })).status).toBe("RUNNING");
    expect(await prisma.trainingTask.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ isFollowUp: false, assigneeId: fx.empIds[BUDI], status: "TODO" });
  });

  it("memilih penanggung jawab BARU berakun nonaktif juga ditolak; memilih anggota yang akunnya aktif → proyek Selesai dan tindak lanjut berpindah", async () => {
    const id = await running();
    const t = await createTask(fx.mgr, id, { title: "Kirim sertifikat", assigneeId: fx.empIds[BUDI], dueDate: inDays(5) });
    await setAccount(fx.emp3.userId, false);                                                              // Citra nonaktif
    const e = await fail(closeProject(fx.mgr, id, { ...sum, taskDecisions: [{ taskId: t.id, action: "FOLLOW_UP", dueDate: inDays(3), assigneeId: fx.empIds[CITRA] }] }));
    expect(e).toMatchObject({ code: "VALIDATION" });
    expect(e!.message).toMatch(/akun login/i);
    await setAccount(fx.emp3.userId, true);                                                               // diaktifkan kembali → sah
    await closeProject(fx.mgr, id, { ...sum, taskDecisions: [{ taskId: t.id, action: "FOLLOW_UP", dueDate: inDays(3), assigneeId: fx.empIds[CITRA], reason: "Dialihkan saat penutupan" }] });
    expect((await prisma.trainingProject.findUniqueOrThrow({ where: { id } })).status).toBe("COMPLETED");
    expect(await prisma.trainingTask.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ isFollowUp: true, assigneeId: fx.empIds[CITRA] });
  });

  it("karyawan TANPA akun login sama sekali tidak ditolak (bukan 'akun nonaktif'): boleh jadi penanggung jawab & tindak lanjut", async () => {
    const id = await running();
    const nadia = await noAccountMember(id);
    const t = await createTask(fx.mgr, id, { title: "Susun laporan", assigneeId: nadia, dueDate: inDays(5) });
    expect(t.id).toBeTruthy();
    await closeProject(fx.mgr, id, { ...sum, taskDecisions: [{ taskId: t.id, action: "FOLLOW_UP", dueDate: inDays(3) }] });
    expect(await prisma.trainingTask.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ isFollowUp: true, assigneeId: nadia });
  });

  it("pratinjau penutupan: daftar penanggung jawab tidak memuat akun nonaktif; tugas milik orang tanpa akun diberi penanda 'tanpa akun login'", async () => {
    const id = await running();
    const nadia = await noAccountMember(id);
    await createTask(fx.mgr, id, { title: "Susun laporan", assigneeId: nadia, dueDate: inDays(5) });
    const held = await createTask(fx.mgr, id, { title: "Kirim sertifikat", assigneeId: fx.empIds[BUDI], dueDate: inDays(5) });
    await budiOff();
    const p = await getClosurePreview(fx.mgr, id);
    const names = p.assignees.map((a) => a.name);
    expect(names).not.toContain("Budi Santoso");
    expect(names).toEqual(expect.arrayContaining(["Ayu Lestari", "Citra Dewi", "Nadia Tanpa Akun"]));
    const byTitle = (title: string) => p.openTasks.find((x) => x.title === title)!;
    expect(byTitle("Kirim sertifikat")).toMatchObject({ assigneeUnavailable: "ACCOUNT_INACTIVE", assigneeNoAccount: false });
    expect(byTitle("Susun laporan")).toMatchObject({ assigneeUnavailable: null, assigneeNoAccount: true });
    void held;
  });
});
