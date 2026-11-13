/**
 * Training & Operations — ALUR BISNIS: proyek → tim → tugas → checklist → jadwal → peserta → dokumen → penutupan → dashboard.
 * Setiap tes memakai PostgreSQL sungguhan (trigger & constraint ikut berlaku).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { readFileForActor } from "@/server/services/files";
import { resetDb } from "../helpers/db";
import { addTeam, inDays, makeLetter, mkProject, PDF, seedTraining, TODAY, type TrainingFixtures } from "../helpers/training";
import { formatProjectCode } from "@/lib/training/misc";
import {
  addMember, cancelProject, changeProjectStatus, closeProject, createProject, getProject, listProjects, reopenProject, updateProject,
} from "@/server/services/training/projects";
import {
  addChecklistItem, addComment, applyChecklistTemplate, changeTaskStatus, createTask, deleteChecklistItem, ensureDefaultTemplate, getTask, listChecklist,
  listComments, listMyTasks, listProjectTasks, listTemplates, saveTemplate, updateChecklistItem, updateTask,
} from "@/server/services/training/work";
import {
  addExternalRef, addParticipant, assignInstructor, createInstructor, createSchedule, deleteDocument, linkAssignment, listAllParticipants, listAssignmentLinks,
  listCalendar, listDocuments, listInstructors, listProjectParticipants, removeProjectInstructor, searchAssignmentLetters, unlinkAssignment, uploadDocument, updateSchedule,
} from "@/server/services/training/operations";
import { getClosurePreview, getTrainingDashboard, listProjectActivity, projectReportRows, projectReportTable } from "@/server/services/training/insights";

let fx: TrainingFixtures;
beforeEach(async () => {
  await resetDb();
  fx = await seedTraining();
});

const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const [AYU, BUDI, CITRA] = [0, 1, 2] as const;

/** Proyek berisi PIC = Ayu (emp1), Budi (emp2) staf, Citra (emp3) PJ Peserta. */
async function team(over: Record<string, unknown> = {}) {
  const id = await mkProject(fx.mgr, over);
  await addTeam(fx.mgr, id, [[fx.empIds[AYU], "PROJECT_MANAGER"], [fx.empIds[BUDI], "STAFF"], [fx.empIds[CITRA], "PARTICIPANT_OWNER"]]);
  return id;
}

describe("proyek", () => {
  it("kode TRN-tahun-0001 berurutan dan UNIK walau 8 pengguna membuat proyek bersamaan", async () => {
    const year = Number(TODAY().slice(0, 4));
    const made = await Promise.all(Array.from({ length: 8 }, (_, i) => createProject(fx.mgr, { name: `Batch ke-${i + 1}` })));
    const codes = made.map((m) => m.code).sort();
    expect(new Set(codes).size).toBe(8);
    expect(codes).toEqual(Array.from({ length: 8 }, (_, i) => formatProjectCode(year, i + 1)));
    expect(codes[0]).toMatch(/^TRN-\d{4}-0001$/);
    expect((await prisma.auditLog.count({ where: { action: "training.project.create" } }))).toBe(8);
  });

  it("validasi: tanggal selesai sebelum mulai & nama terlalu pendek ditolak dengan pesan per-field", async () => {
    const e1 = await fail(createProject(fx.mgr, { name: "Ok nama", startDate: inDays(5), endDate: inDays(2) }));
    expect(e1).toMatchObject({ code: "VALIDATION", fieldErrors: { endDate: expect.stringContaining("sebelum") } });
    expect(await fail(createProject(fx.mgr, { name: "ab" }))).toMatchObject({ code: "VALIDATION" });
    expect(await fail(createProject(fx.mgr, { name: "Program ngawur", programId: "00000000-0000-4000-8000-000000000000" }))).toMatchObject({ code: "VALIDATION" });
  });

  it("alur status: Persiapan butuh tanggal + PIC; tidak boleh melompat; semua perubahan tercatat", async () => {
    const id = await mkProject(fx.mgr, { startDate: null, endDate: null });
    const e = await fail(changeProjectStatus(fx.mgr, id, { to: "PREPARATION" }));
    expect(e).toMatchObject({ code: "CONFLICT" });
    expect(e!.message).toContain("Tanggal mulai");
    expect(e!.message).toContain("Project Manager");
    await updateProject(fx.mgr, id, { startDate: inDays(4), endDate: inDays(6) });
    await addMember(fx.mgr, id, { employeeId: fx.empIds[AYU], role: "PROJECT_MANAGER" });
    expect(await fail(changeProjectStatus(fx.mgr, id, { to: "RUNNING" }))).toMatchObject({ code: "CONFLICT" }); // lompat
    expect(await changeProjectStatus(fx.emp1, id, { to: "PREPARATION" })).toEqual({ status: "PREPARATION" }); // PIC boleh
    await changeProjectStatus(fx.emp1, id, { to: "RUNNING" });
    expect(await prisma.auditLog.count({ where: { action: "training.project.status", entityId: id } })).toBe(2);
  });

  it("daftar: cari nama/kode, filter status & PIC, urutan, paginasi, dan penanda perlu perhatian", async () => {
    const a = await team({ name: "Sertifikasi Food Production", startDate: inDays(2), endDate: inDays(4) });
    await mkProject(fx.mgr, { name: "Pelatihan HACCP", startDate: inDays(20), endDate: inDays(22) });
    await mkProject(fx.mgr, { name: "Training of Trainer", startDate: inDays(30), endDate: inDays(31) });
    expect((await listProjects(fx.mgr, { q: "haccp" })).items.map((i) => i.name)).toEqual(["Pelatihan HACCP"]);
    expect((await listProjects(fx.mgr, { q: "TRN-" })).total).toBe(3);
    expect((await listProjects(fx.mgr, { picId: fx.empIds[AYU] })).items.map((i) => i.id)).toEqual([a]);
    expect((await listProjects(fx.mgr, { pageSize: 2, page: 2 })).items).toHaveLength(1);
    expect((await listProjects(fx.mgr, { sort: "start_asc" })).items[0]!.id).toBe(a);
    // perlu perhatian: proyek aktif dengan checklist wajib belum lengkap & mulai ≤ 7 hari
    await changeProjectStatus(fx.mgr, a, { to: "PREPARATION" });
    await addChecklistItem(fx.mgr, a, { phase: "PREPARATION", title: "Narasumber dikonfirmasi", isRequired: true });
    const att = await listProjects(fx.mgr, { attention: "1" });
    expect(att.items.map((i) => i.id)).toEqual([a]);
    expect(att.items[0]!.attention).toContain("REQUIRED_CHECKLIST");
    expect((await listProjects(fx.mgr, { active: "1" })).total).toBe(1);
  });

  it("membatalkan butuh alasan, final (tidak bisa dibuka lagi), dan datanya terkunci", async () => {
    const id = await team();
    expect(await fail(cancelProject(fx.emp1, id, { reason: "tidak ada klien" }))).toMatchObject({ code: "FORBIDDEN" }); // PIC bukan Manajer
    expect(await fail(cancelProject(fx.mgr, id, { reason: "x" }))).toMatchObject({ code: "VALIDATION" });
    await cancelProject(fx.mgr, id, { reason: "Klien menunda ke tahun depan" });
    expect((await getProject(fx.mgr, id))).toMatchObject({ status: "CANCELLED", cancelReason: "Klien menunda ke tahun depan" });
    expect(await fail(createTask(fx.mgr, id, { title: "Tugas setelah batal" }))).toMatchObject({ code: "CONFLICT" });
    expect(await fail(reopenProject(fx.mgr, id, { reason: "salah batal" }))).toMatchObject({ code: "CONFLICT" });
  });
});

describe("tugas", () => {
  it("penanggung jawab harus anggota aktif proyek; staf hanya mengubah status tugasnya sendiri", async () => {
    const id = await team();
    expect(await fail(createTask(fx.emp1, id, { title: "Untuk orang luar", assigneeId: fx.lonerEmp }))).toMatchObject({ code: "VALIDATION" });
    const mine = await createTask(fx.emp1, id, { title: "Siapkan materi", assigneeId: fx.empIds[BUDI], dueDate: inDays(1) });
    const other = await createTask(fx.emp1, id, { title: "Hubungi klien", assigneeId: fx.empIds[CITRA] });
    expect(await fail(createTask(fx.emp2, id, { title: "Staf membuat tugas" }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await fail(updateTask(fx.emp2, mine.id, { title: "Ubah judul" }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await fail(changeTaskStatus(fx.emp2, other.id, { status: "IN_PROGRESS" }))).toMatchObject({ code: "FORBIDDEN" });
    const t = await changeTaskStatus(fx.emp2, mine.id, { status: "IN_PROGRESS", note: "Mulai dari bab 1" });
    expect(t.status).toBe("IN_PROGRESS");
    expect((await listComments(fx.emp2, mine.id)).map((c) => c.body)).toEqual(["[Dalam proses] Mulai dari bab 1"]);
    const done = await changeTaskStatus(fx.emp2, mine.id, { status: "DONE" });
    expect(done).toMatchObject({ status: "DONE", allowedNext: [] });
    expect((await prisma.trainingTask.findUniqueOrThrow({ where: { id: mine.id } })).completedById).toBe(fx.emp2.userId);
  });

  it("tugas yang perlu diperiksa: penanggung jawab hanya mengirim; pemeriksa ≠ penanggung jawab", async () => {
    const id = await team();
    const t = await createTask(fx.mgr, id, { title: "Susun modul", assigneeId: fx.empIds[BUDI], requiresReview: true });
    expect(await fail(changeTaskStatus(fx.emp2, t.id, { status: "DONE" }))).toMatchObject({ code: "CONFLICT" }); // wajib lewat pemeriksaan
    expect((await changeTaskStatus(fx.emp2, t.id, { status: "IN_REVIEW" })).status).toBe("IN_REVIEW");
    expect(await prisma.notification.count({ where: { userId: fx.emp1.userId, type: "training.task.review" } })).toBe(1); // PIC diberi tahu
    expect(await fail(changeTaskStatus(fx.emp2, t.id, { status: "DONE" }))).toMatchObject({ code: "FORBIDDEN" }); // memeriksa diri sendiri
    expect((await changeTaskStatus(fx.emp1, t.id, { status: "DONE", note: "Sudah sesuai" })).status).toBe("DONE"); // PIC memeriksa
    // PIC yang menjadi penanggung jawab tidak boleh menyetujui tugasnya sendiri
    const own = await createTask(fx.mgr, id, { title: "Laporan PIC", assigneeId: fx.empIds[AYU], requiresReview: true });
    await changeTaskStatus(fx.emp1, own.id, { status: "IN_REVIEW" });
    expect(await fail(changeTaskStatus(fx.emp1, own.id, { status: "DONE" }))).toMatchObject({ code: "FORBIDDEN" });
    expect((await changeTaskStatus(fx.mgr, own.id, { status: "DONE" })).status).toBe("DONE"); // Manajer memeriksa
  });

  it("terlambat = terbuka & tenggat < hari ini (WIB); 'Tugas Saya' memfilter; membuka kembali tugas selesai menghapus waktu selesai", async () => {
    const id = await team();
    const late = await createTask(fx.mgr, id, { title: "Terlambat", assigneeId: fx.empIds[BUDI], dueDate: inDays(-2) });
    await createTask(fx.mgr, id, { title: "Hari ini", assigneeId: fx.empIds[BUDI], dueDate: TODAY() });
    await createTask(fx.mgr, id, { title: "Dua hari lagi", assigneeId: fx.empIds[BUDI], dueDate: inDays(2) });
    const finished = await createTask(fx.mgr, id, { title: "Sudah", assigneeId: fx.empIds[BUDI], dueDate: inDays(-5) });
    await changeTaskStatus(fx.emp2, finished.id, { status: "DONE" });
    expect((await listMyTasks(fx.emp2, { filter: "overdue" })).map((t) => t.title)).toEqual(["Terlambat"]); // yang selesai bukan terlambat
    expect((await listMyTasks(fx.emp2, { filter: "today" })).map((t) => t.title)).toEqual(["Hari ini"]);
    expect((await listMyTasks(fx.emp2, { filter: "soon" })).map((t) => t.title).sort()).toEqual(["Dua hari lagi", "Hari ini"]);
    expect((await listMyTasks(fx.emp2)).map((t) => t.title)).toEqual(["Terlambat", "Hari ini", "Dua hari lagi"]); // terlambat paling atas
    expect((await getTask(fx.emp2, late.id)).overdue).toBe(true);
    await changeTaskStatus(fx.mgr, finished.id, { status: "IN_PROGRESS" });
    expect((await prisma.trainingTask.findUniqueOrThrow({ where: { id: finished.id } })).completedAt).toBeNull();
  });

  it("tugas Selesai TIDAK mengubah status proyek, checklist, atau data HRIS", async () => {
    const id = await team();
    await changeProjectStatus(fx.mgr, id, { to: "PREPARATION" });
    const t = await createTask(fx.mgr, id, { title: "Satu-satunya", assigneeId: fx.empIds[BUDI] });
    await changeTaskStatus(fx.emp2, t.id, { status: "DONE" });
    expect((await getProject(fx.mgr, id)).status).toBe("PREPARATION");
    expect(await prisma.assignmentLetter.count()).toBe(0);
    expect(await prisma.trainingProjectChecklistItem.count()).toBe(0);
  });

  it("penanggung jawab yang diberi tugas dinotifikasi; komentar anggota proyek diperbolehkan", async () => {
    const id = await team();
    const t = await createTask(fx.mgr, id, { title: "Tugas notifikasi", assigneeId: fx.empIds[BUDI] });
    expect(await prisma.notification.count({ where: { userId: fx.emp2.userId, type: "training.task.assigned" } })).toBe(1);
    await addComment(fx.emp2, t.id, { body: "Siap, dikerjakan" });
    await addComment(fx.emp3, t.id, { body: "Saya bantu" });
    expect((await listComments(fx.emp1, t.id))).toHaveLength(2);
    expect((await listProjectTasks(fx.emp3, id)).map((x) => x.canEdit)).toEqual([false]); // PJ Peserta tidak mengelola tugas
  });
});

describe("checklist & template", () => {
  const items = [
    { phase: "PREPARATION" as const, title: "Data proyek lengkap", isRequired: true },
    { phase: "EXECUTION" as const, title: "Dokumentasi tersedia", isRequired: false },
    { phase: "CLOSING" as const, title: "Laporan disusun", isRequired: true },
  ];

  it("item DISALIN menjadi milik proyek: mengubah template kemudian tidak mengubah checklist proyek; template sama tidak dua kali", async () => {
    const { id: tplId } = await saveTemplate(fx.mgr, null, { name: "Standar Uji", items });
    const id = await team();
    await applyChecklistTemplate(fx.mgr, id, { templateId: tplId });
    expect((await listChecklist(fx.mgr, id)).items.map((i) => i.title).sort()).toEqual(["Data proyek lengkap", "Dokumentasi tersedia", "Laporan disusun"]);
    await saveTemplate(fx.mgr, tplId, { name: "Standar Uji", items: [{ phase: "PREPARATION", title: "Item baru sama sekali", isRequired: true }] });
    const after = await listChecklist(fx.mgr, id);
    expect(after.items).toHaveLength(3);
    expect(after.items.every((i) => i.sourceTemplateName === "Standar Uji")).toBe(true);
    expect(await fail(applyChecklistTemplate(fx.mgr, id, { templateId: tplId }))).toMatchObject({ code: "CONFLICT" });
    expect((await listTemplates(fx.mgr)).find((t) => t.id === tplId)!.items).toHaveLength(1);
  });

  it("dipilih saat proyek dibuat; hanya Manajer yang mengelola template; template standar idempoten dan eksplisit", async () => {
    expect(await prisma.trainingChecklistTemplate.count()).toBe(0); // tidak ada seed otomatis
    expect(await fail(saveTemplate(fx.adm, null, { name: "Tidak boleh", items }))).toMatchObject({ code: "FORBIDDEN" });
    const std = await ensureDefaultTemplate(fx.mgr);
    expect(std.created).toBe(true);
    expect((await ensureDefaultTemplate(fx.mgr)).created).toBe(false);
    const { id } = await createProject(fx.adm, { name: "Dengan template", checklistTemplateId: std.id });
    const cl = await listChecklist(fx.adm, id);
    expect(cl.items.length).toBeGreaterThan(10);
    expect(cl.requiredOutstanding).toBeGreaterThan(0);
    expect((await getProject(fx.adm, id)).checklistTemplateName).toBe("Standar Pelatihan Trilogika");
  });

  it("progres = selesai ÷ semua; proyek tanpa item = 'Belum tersedia' (null), bukan 0%", async () => {
    const id = await team();
    expect((await getProject(fx.mgr, id)).checklist).toEqual({ done: 0, total: 0, percent: null });
    const a = await addChecklistItem(fx.mgr, id, { phase: "PREPARATION", title: "Item A", isRequired: true, assigneeId: fx.empIds[BUDI] });
    await addChecklistItem(fx.mgr, id, { phase: "PREPARATION", title: "Item B" });
    await updateChecklistItem(fx.emp2, a.id, { isDone: true }); // penanggung jawab item
    expect((await getProject(fx.mgr, id)).checklist).toEqual({ done: 1, total: 2, percent: 50 });
  });

  it("hanya penanggung jawab item atau pengelola yang menandai selesai; isi item hanya pengelola; yang selesai tak bisa dihapus", async () => {
    const id = await team();
    const mine = await addChecklistItem(fx.mgr, id, { phase: "EXECUTION", title: "Milik Budi", assigneeId: fx.empIds[BUDI] });
    const nobody = await addChecklistItem(fx.mgr, id, { phase: "EXECUTION", title: "Tanpa PJ" });
    expect(await fail(updateChecklistItem(fx.emp3, mine.id, { isDone: true }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await fail(updateChecklistItem(fx.emp2, nobody.id, { isDone: true }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await fail(updateChecklistItem(fx.emp2, mine.id, { title: "Ganti judul" }))).toMatchObject({ code: "FORBIDDEN" });
    await updateChecklistItem(fx.emp2, mine.id, { isDone: true });
    expect(await fail(deleteChecklistItem(fx.emp1, mine.id))).toMatchObject({ code: "CONFLICT" });
    await updateChecklistItem(fx.emp1, nobody.id, { isDone: true }); // PIC mengelola checklist
    expect(await prisma.auditLog.count({ where: { action: "training.checklist.toggle" } })).toBe(2);
  });
});

describe("penutupan proyek", () => {
  async function runningWithRequired() {
    const id = await team();
    await changeProjectStatus(fx.mgr, id, { to: "PREPARATION" });
    await changeProjectStatus(fx.mgr, id, { to: "RUNNING" });
    const a = await addChecklistItem(fx.mgr, id, { phase: "CLOSING", title: "Laporan disusun", isRequired: true });
    await addChecklistItem(fx.mgr, id, { phase: "CLOSING", title: "Tindak lanjut dicatat", isRequired: false });
    return { id, a };
  }

  it("checklist wajib yang belum selesai menghalangi penutupan; pratinjau menunjukkan apa yang kurang", async () => {
    const { id } = await runningWithRequired();
    const pv = await getClosurePreview(fx.mgr, id);
    expect(pv).toMatchObject({ canCloseClean: false, requiredOutstanding: [{ title: "Laporan disusun" }], missingRecommendedDocuments: ["ATTENDANCE", "FINAL_REPORT"] });
    const e = await fail(closeProject(fx.mgr, id, { summary: "Pelatihan berjalan lancar" }));
    expect(e).toMatchObject({ code: "CONFLICT", extra: { outstanding: ["Laporan disusun"] } });
    expect((await getProject(fx.mgr, id)).status).toBe("RUNNING");
  });

  it("hanya Koordinator Program yang menutup (PIC tidak); selesai → ditutup bersih; tugas terbuka diputuskan (tindak lanjut) dan tidak diselesaikan otomatis", async () => {
    const { id, a } = await runningWithRequired();
    const t = await createTask(fx.mgr, id, { title: "Tugas masih terbuka", assigneeId: fx.empIds[BUDI] });
    await updateChecklistItem(fx.mgr, a.id, { isDone: true });
    expect(await fail(closeProject(fx.emp1, id, { summary: "PIC mencoba menutup" }))).toMatchObject({ code: "FORBIDDEN" });
    // Tugas terbuka tidak menghalangi penutupan, tetapi wajib diputuskan (lihat training-closure.test.ts untuk aturan lengkapnya).
    expect(await fail(closeProject(fx.mgr, id, { summary: "Pelatihan berjalan lancar" }))).toMatchObject({ code: "CONFLICT" });
    const r = await closeProject(fx.mgr, id, { summary: "Pelatihan berjalan lancar", followUp: "Kirim sertifikat", taskDecisions: [{ taskId: t.id, action: "FOLLOW_UP", dueDate: inDays(7) }] });
    expect(r).toMatchObject({ closedWithOverride: false, outstandingRequired: [], openTasks: 1, followUpTasks: 1 });
    const p = await getProject(fx.mgr, id);
    expect(p).toMatchObject({ status: "COMPLETED", closedByName: "Maya Manajer", closureSummary: "Pelatihan berjalan lancar", closureFollowUp: "Kirim sertifikat", closureOverrideReason: null });
    expect(await getTask(fx.mgr, t.id)).toMatchObject({ status: "TODO", isFollowUp: true }); // menutup proyek tidak menyelesaikan tugas
  });

  it("pengecualian: boleh ditutup dengan alasan tertulis; item yang dilewati dicatat di audit", async () => {
    const { id } = await runningWithRequired();
    await closeProject(fx.mgr, id, { summary: "Ditutup lebih awal", overrideReason: "Klien membatalkan sesi penutup" });
    const p = await getProject(fx.mgr, id);
    expect(p.closureOverrideReason).toBe("Klien membatalkan sesi penutup");
    const au = await prisma.auditLog.findFirstOrThrow({ where: { action: "training.project.close" } });
    expect(au.summary).toContain("DENGAN PENGECUALIAN");
    expect(au.reason).toBe("Klien membatalkan sesi penutup");
    expect(JSON.stringify(au.after)).toContain("Laporan disusun");
  });

  it("proyek ditutup = baca-saja; Manajer dapat membuka kembali (beralasan) dan catatan lama tetap di audit", async () => {
    const { id, a } = await runningWithRequired();
    await updateChecklistItem(fx.mgr, a.id, { isDone: true });
    await closeProject(fx.mgr, id, { summary: "Selesai normal" });
    expect(await fail(createTask(fx.mgr, id, { title: "Setelah tutup" }))).toMatchObject({ code: "CONFLICT" });
    expect(await fail(addParticipant(fx.emp3, id, { fullName: "Peserta telat" }))).toMatchObject({ code: "CONFLICT" });
    expect(await fail(uploadDocument(fx.emp1, id, { name: "a.pdf", bytes: PDF() }, { category: "OTHER", title: "Terlambat" }))).toMatchObject({ code: "CONFLICT" });
    expect(await fail(reopenProject(fx.emp1, id, { reason: "salah tutup" }))).toMatchObject({ code: "FORBIDDEN" });
    await reopenProject(fx.mgr, id, { reason: "Ada koreksi laporan" });
    expect(await getProject(fx.mgr, id)).toMatchObject({ status: "RUNNING", closedAt: null, closureSummary: null });
    const reopen = await prisma.auditLog.findFirstOrThrow({ where: { action: "training.project.reopen" } });
    expect(JSON.stringify(reopen.before)).toContain("Selesai normal");
  });

  it("menutup proyek tidak menyentuh surat tugas/uang harian yang terkait", async () => {
    const { id, a } = await runningWithRequired();
    const letter = await makeLetter(fx.superAdmin.userId);
    await prisma.trainingProjectAssignmentLink.create({ data: { projectId: id, letterId: letter.id, linkedById: fx.mgr.userId } });
    await updateChecklistItem(fx.mgr, a.id, { isDone: true });
    await closeProject(fx.mgr, id, { summary: "Selesai" });
    expect((await prisma.assignmentLetter.findUniqueOrThrow({ where: { id: letter.id } })).status).toBe("ISSUED");
    expect(await prisma.dailyAllowanceReceipt.count()).toBe(0);
  });
});

describe("jadwal", () => {
  it("disimpan sebagai instan WIB (UTC+7) dan ditampilkan kembali sebagai tanggal/jam WIB", async () => {
    const id = await team();
    const r = await createSchedule(fx.emp1, id, { title: "Hari 1", date: "2027-03-10", startTime: "08:30", endTime: "16:00", room: "Ruang A" });
    const row = await prisma.trainingSchedule.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.startAt.toISOString()).toBe("2027-03-10T01:30:00.000Z");
    const [dto] = await listCalendar(fx.emp1, { from: "2027-03-01", to: "2027-03-31" });
    expect(dto).toMatchObject({ date: "2027-03-10", startTime: "08:30", endTime: "16:00" });
    expect(await fail(createSchedule(fx.emp1, id, { title: "Terbalik", date: "2027-03-10", startTime: "10:00", endTime: "09:00" }))).toMatchObject({ code: "VALIDATION" });
  });

  it("peringatan bentrok ruangan lintas proyek (tidak memblokir); bersentuhan di batas bukan bentrok; yang dibatalkan diabaikan", async () => {
    const period = { startDate: "2027-04-04", endDate: "2027-04-06" };
    // Citra HANYA anggota Proyek B → rincian jadwal Proyek A harus disamarkan baginya.
    const a = await mkProject(fx.mgr, { name: "Proyek A", ...period });
    await addTeam(fx.mgr, a, [[fx.empIds[AYU], "PROJECT_MANAGER"]]);
    const b = await mkProject(fx.mgr, { name: "Proyek B", ...period });
    await addTeam(fx.mgr, b, [[fx.empIds[CITRA], "ADMIN_PROGRAM"]]);
    await createSchedule(fx.emp1, a, { title: "Sesi A", date: "2027-04-05", startTime: "09:00", endTime: "12:00", room: "Ruang Utama", location: "Kantor Pusat" });
    const touching = await createSchedule(fx.emp3, b, { title: "Sesi B1", date: "2027-04-05", startTime: "12:00", endTime: "14:00", room: "ruang   utama", location: "kantor pusat" });
    expect(touching.warnings).toEqual([]);
    // B2 beririsan dengan Sesi A (proyek lain) saja; tidak menyentuh B1 (mulai 12.00).
    const overlap = await createSchedule(fx.emp3, b, { title: "Sesi B2", date: "2027-04-05", startTime: "10:00", endTime: "11:30", room: "RUANG UTAMA", location: "Kantor  Pusat." });
    expect(overlap.warnings).toHaveLength(1);
    expect(overlap.warnings[0]).toContain("Ruangan yang sama");
    expect(overlap.warnings[0]).toContain("proyek lain (di luar akses Anda)"); // Citra bukan anggota A → detail disembunyikan
    const asMgr = (await listCalendar(fx.mgr, { from: "2027-04-01", to: "2027-04-30" })).find((s) => s.title === "Sesi B2")!;
    expect(asMgr.conflicts[0]).toMatchObject({ kind: "ROOM", visible: true, withTitle: "Sesi A" });
    // Bentrok dengan jadwal proyek sendiri juga terdeteksi, dan rinciannya terlihat oleh anggotanya.
    const same = await createSchedule(fx.emp3, b, { title: "Sesi B3", date: "2027-04-05", startTime: "13:30", endTime: "15:00", room: "Ruang Utama", location: "Kantor Pusat" });
    expect(same.warnings).toHaveLength(1);
    expect(same.warnings[0]).toContain('"Sesi B1"');
    await updateSchedule(fx.emp3, overlap.id, { status: "CANCELLED" });
    // Setelah B2 (satu-satunya yang beririsan dengan Sesi A) dibatalkan, Sesi A bebas bentrok; jadwal yang dibatalkan tidak dihitung.
    const cal = await listCalendar(fx.mgr, { from: "2027-04-01", to: "2027-04-30" });
    expect(cal.find((x) => x.title === "Sesi A")!.conflicts).toEqual([]);
    expect(cal.find((x) => x.title === "Sesi B2")!.conflicts).toEqual([]);
  });

  it("bentrok instruktur yang sama; penanggung jawab jadwal harus anggota; kalender hanya memuat proyek dalam lingkup", async () => {
    const a = await team({ name: "Proyek A" });
    const b = await mkProject(fx.mgr, { name: "Proyek B" });
    await addTeam(fx.mgr, b, [[fx.empIds[CITRA], "ADMIN_PROGRAM"]]);
    const { id: insId } = await createInstructor(fx.mgr, { name: "Dr. Asesor Uji", kind: "ASSESSOR" });
    const pa = await assignInstructor(fx.mgr, a, { instructorId: insId, kind: "ASSESSOR" });
    const pb = await assignInstructor(fx.mgr, b, { instructorId: insId, kind: "ASSESSOR", confirmation: "CONFIRMED" });
    await createSchedule(fx.emp1, a, { title: "Uji A", date: "2027-05-05", startTime: "09:00", endTime: "11:00", projectInstructorId: pa.id });
    const r = await createSchedule(fx.emp3, b, { title: "Uji B", date: "2027-05-05", startTime: "10:00", endTime: "12:00", projectInstructorId: pb.id });
    expect(r.warnings.join(" ")).toContain("Instruktur / asesor yang sama");
    expect(await fail(createSchedule(fx.emp1, a, { title: "PJ luar", date: "2027-05-06", startTime: "09:00", endTime: "10:00", inchargeId: fx.lonerEmp }))).toMatchObject({ code: "VALIDATION" });
    expect((await listCalendar(fx.emp2, { from: "2027-05-01", to: "2027-05-31" })).map((s) => s.title)).toEqual(["Uji A"]); // Budi hanya di A
    expect(await fail(removeProjectInstructor(fx.mgr, a, pa.id))).toMatchObject({ code: "CONFLICT" }); // masih dipakai jadwal
  });

  describe("bentrok ruangan menurut LOKASI + RUANGAN + waktu (bukan nama ruang saja)", () => {
    const period = { startDate: "2027-06-07", endDate: "2027-06-09" };
    const day = "2027-06-08";
    const sess = (title: string, startTime: string, endTime: string, over: Record<string, unknown> = {}) => ({ title, date: day, startTime, endTime, ...over });
    const twoProjects = async () => {
      const a = await mkProject(fx.mgr, { name: "Proyek A", ...period });
      await addTeam(fx.mgr, a, [[fx.empIds[AYU], "PROJECT_MANAGER"]]);
      const b = await mkProject(fx.mgr, { name: "Proyek B", ...period });
      await addTeam(fx.mgr, b, [[fx.empIds[AYU], "PROJECT_MANAGER"]]);
      return { a, b };
    };
    const calendar = async () => listCalendar(fx.mgr, { from: "2027-06-01", to: "2027-06-30" });

    it("'Ruang Jasmine' di DUA HOTEL berbeda bukan bentrok; di hotel yang sama = bentrok pasti (kedua arah)", async () => {
      const { a, b } = await twoProjects();
      await createSchedule(fx.emp1, a, sess("Kelas Aston", "09:00", "12:00", { room: "Ruang Jasmine", location: "Hotel Aston Magelang" }));
      const other = await createSchedule(fx.emp1, b, sess("Kelas Santika", "10:00", "11:00", { room: "ruang jasmine", location: "Hotel Santika Yogyakarta" }));
      expect(other.warnings).toEqual([]);
      let cal = await calendar();
      expect(cal.find((x) => x.title === "Kelas Aston")!.conflicts).toEqual([]);
      expect(cal.find((x) => x.title === "Kelas Santika")!.conflicts).toEqual([]);

      const same = await createSchedule(fx.emp1, b, sess("Kelas Aston lagi", "11:00", "13:00", { room: "RUANG JASMINE", location: "aston hotel, magelang" }));
      expect(same.warnings).toHaveLength(1);
      expect(same.warnings[0]).toContain("Ruangan yang sama (lokasi sama)");
      cal = await calendar();
      expect(cal.find((x) => x.title === "Kelas Aston lagi")!.conflicts).toMatchObject([{ kind: "ROOM", visible: true, withTitle: "Kelas Aston", why: null }]);
      expect(cal.find((x) => x.title === "Kelas Aston")!.conflicts).toMatchObject([{ kind: "ROOM", withTitle: "Kelas Aston lagi" }]);
    });

    it("lokasi belum jelas → 'perlu diperiksa' (bukan dianggap aman), dua arah; tidak memblokir penyimpanan", async () => {
      const { a, b } = await twoProjects();
      await createSchedule(fx.emp1, a, sess("Sesi berlokasi", "09:00", "12:00", { room: "Ruang Jasmine", location: "Hotel Aston" }));
      const r = await createSchedule(fx.emp1, b, sess("Sesi tanpa lokasi", "10:00", "11:00", { room: "Ruang Jasmine" }));
      expect(r.id).toBeTruthy();                                                       // tetap tersimpan
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toMatch(/Bentrok ruangan perlu diperiksa:.*Sesi berlokasi.*lokasinya belum jelas/);
      expect(r.warnings[0]).not.toContain("Ruangan yang sama (lokasi sama)");            // bukan klaim pasti
      const cal = await calendar();
      expect(cal.find((x) => x.title === "Sesi tanpa lokasi")!.conflicts).toMatchObject([{ kind: "ROOM_CHECK", why: "NO_LOCATION", withTitle: "Sesi berlokasi" }]);
      expect(cal.find((x) => x.title === "Sesi berlokasi")!.conflicts).toMatchObject([{ kind: "ROOM_CHECK", why: "NO_LOCATION", withTitle: "Sesi tanpa lokasi" }]);
      // Setelah lokasi dilengkapi dan ternyata berbeda → peringatan hilang; bila ternyata sama → menjadi bentrok pasti.
      const fix = await updateSchedule(fx.emp1, r.id, { location: "Hotel Santika" });
      expect(fix.warnings).toEqual([]);
      const fix2 = await updateSchedule(fx.emp1, r.id, { location: "Hotel Aston" });
      expect(fix2.warnings).toHaveLength(1);
      expect(fix2.warnings[0]).toContain("Ruangan yang sama (lokasi sama)");
    });

    it("lokasi berbeda tetapi mirip ('Hotel Aston' vs 'Hotel Aston Magelang') → perlu diperiksa dengan sebab SIMILAR_LOCATION", async () => {
      const { a, b } = await twoProjects();
      await createSchedule(fx.emp1, a, sess("Sesi umum", "09:00", "12:00", { room: "Ruang Jasmine", location: "Hotel Aston" }));
      const r = await createSchedule(fx.emp1, b, sess("Sesi rinci", "10:00", "11:00", { room: "Ruang Jasmine", location: "Hotel Aston Magelang" }));
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toMatch(/perlu diperiksa:.*lokasinya mirip/);
      expect((await calendar()).find((x) => x.title === "Sesi rinci")!.conflicts).toMatchObject([{ kind: "ROOM_CHECK", why: "SIMILAR_LOCATION" }]);
    });

    it("jadwal tanpa ruangan tidak pernah bentrok ruangan; ruangan berbeda di lokasi sama bukan bentrok; waktu bersentuhan bukan bentrok", async () => {
      const { a, b } = await twoProjects();
      await createSchedule(fx.emp1, a, sess("Ruang Jasmine", "09:00", "12:00", { room: "Ruang Jasmine", location: "Hotel Aston" }));
      expect((await createSchedule(fx.emp1, b, sess("Tanpa ruangan", "10:00", "11:00", { location: "Hotel Aston" }))).warnings).toEqual([]);
      expect((await createSchedule(fx.emp1, b, sess("Ruang Melati", "10:00", "11:00", { room: "Ruang Melati", location: "Hotel Aston" }))).warnings).toEqual([]);
      expect((await createSchedule(fx.emp1, b, sess("Mulai pas selesai", "12:00", "13:00", { room: "Ruang Jasmine", location: "Hotel Aston" }))).warnings).toEqual([]);
    });

    it("lawan di luar akses: peringatan umum saja — lokasi/rincian proyek lawan tidak dibuka, termasuk pada 'perlu diperiksa'", async () => {
      const a = await mkProject(fx.mgr, { name: "Proyek rahasia klien", ...period });
      await addTeam(fx.mgr, a, [[fx.empIds[AYU], "PROJECT_MANAGER"]]);
      const b = await mkProject(fx.mgr, { name: "Proyek B", ...period });
      await addTeam(fx.mgr, b, [[fx.empIds[CITRA], "ADMIN_PROGRAM"]]);                  // Citra tidak ada di proyek A
      await createSchedule(fx.emp1, a, sess("Sesi rahasia", "09:00", "12:00", { room: "Ruang Jasmine", location: "Hotel Aston" }));
      const r = await createSchedule(fx.emp3, b, sess("Sesi Citra", "10:00", "11:00", { room: "Ruang Jasmine" }));
      expect(r.warnings).toHaveLength(1);
      expect(r.warnings[0]).toContain("proyek lain (di luar akses Anda)");
      expect(r.warnings[0]).not.toMatch(/Aston|rahasia/i);
      const mine = (await listCalendar(fx.emp3, { from: "2027-06-01", to: "2027-06-30" })).find((x) => x.title === "Sesi Citra")!;
      expect(mine.conflicts).toEqual([{ kind: "ROOM_CHECK", visible: false, withProjectCode: null, withTitle: null, why: "NO_LOCATION" }]);
    });

    it("jadwal milik proyek yang DIBATALKAN tidak menimbulkan bentrok (ruangannya tidak jadi dipakai), dan sebaliknya", async () => {
      const { a, b } = await twoProjects();
      await createSchedule(fx.emp1, a, sess("Sesi proyek batal", "09:00", "12:00", { room: "Ruang Jasmine", location: "Hotel Aston" }));
      const r = await createSchedule(fx.emp1, b, sess("Sesi proyek aktif", "10:00", "11:00", { room: "Ruang Jasmine", location: "Hotel Aston" }));
      expect(r.warnings).toHaveLength(1);
      await cancelProject(fx.mgr, a, { reason: "Klien membatalkan seluruh program" });
      const cal = await calendar();
      expect(cal.find((x) => x.title === "Sesi proyek aktif")!.conflicts).toEqual([]);
      expect(cal.find((x) => x.title === "Sesi proyek batal")!.conflicts).toEqual([]);
      // 11.30–12.30 hanya beririsan dengan jadwal proyek yang sudah dibatalkan (09.00–12.00), bukan dengan sesi aktif (10.00–11.00).
      expect((await createSchedule(fx.emp1, b, sess("Sesi susulan", "11:30", "12:30", { room: "Ruang Jasmine", location: "Hotel Aston" }))).warnings).toEqual([]);
    });

    it("instruktur: orang yang sama bentrok walau ruangan & lokasi berbeda; instruktur berbeda tidak", async () => {
      const { a, b } = await twoProjects();
      const { id: i1 } = await createInstructor(fx.mgr, { name: "Dr. Satu", kind: "INSTRUCTOR" });
      const { id: i2 } = await createInstructor(fx.mgr, { name: "Dr. Dua", kind: "INSTRUCTOR" });
      const a1 = await assignInstructor(fx.mgr, a, { instructorId: i1, kind: "INSTRUCTOR" });
      const b1 = await assignInstructor(fx.mgr, b, { instructorId: i1, kind: "INSTRUCTOR", confirmation: "CONFIRMED" });
      const b2 = await assignInstructor(fx.mgr, b, { instructorId: i2, kind: "INSTRUCTOR", confirmation: "CONFIRMED" });
      await createSchedule(fx.emp1, a, sess("Mengajar A", "09:00", "12:00", { room: "Ruang Jasmine", location: "Hotel Aston", projectInstructorId: a1.id }));
      const same = await createSchedule(fx.emp1, b, sess("Mengajar B1", "10:00", "11:00", { room: "Ruang Melati", location: "Hotel Santika", projectInstructorId: b1.id }));
      expect(same.warnings).toHaveLength(1);
      expect(same.warnings[0]).toContain("Instruktur / asesor yang sama");
      expect((await calendar()).find((x) => x.title === "Mengajar B1")!.conflicts).toMatchObject([{ kind: "INSTRUCTOR", why: null }]);
      const diff = await createSchedule(fx.emp1, b, sess("Mengajar B2", "10:00", "11:00", { room: "Ruang Melati", location: "Hotel Santika", projectInstructorId: b2.id }));
      expect(diff.warnings.filter((w) => w.includes("Instruktur"))).toEqual([]);
    });
  });

  it("peringatan bila tanggal di luar periode proyek", async () => {
    const id = await team({ startDate: "2027-06-01", endDate: "2027-06-03" });
    const r = await createSchedule(fx.emp1, id, { title: "Di luar", date: "2027-06-20", startTime: "09:00", endTime: "10:00" });
    expect(r.warnings).toContain("Tanggal ini berada di luar periode proyek.");
  });
});

describe("peserta & instruktur: data kontak hanya bagi yang berwenang", () => {
  it("kontak peserta tersembunyi dari staf, terlihat bagi PJ Peserta/PIC/Manajer; audit tidak memuat kontak; tanpa kolom pembayaran/kompetensi", async () => {
    const id = await team();
    await addParticipant(fx.emp3, id, { fullName: "Peserta Satu", organization: "PT Contoh", phone: "081234567890", email: "satu@contoh.test", status: "INCOMPLETE_DOCS" });
    expect(await fail(addParticipant(fx.emp2, id, { fullName: "Dari staf" }))).toMatchObject({ code: "FORBIDDEN" });
    const asStaff = (await listProjectParticipants(fx.emp2, id))[0]!;
    expect(asStaff).toMatchObject({ fullName: "Peserta Satu", organization: "PT Contoh", phone: null, email: null, contactVisible: false });
    expect((await listProjectParticipants(fx.emp3, id))[0]).toMatchObject({ phone: "081234567890", contactVisible: true });
    expect((await listProjectParticipants(fx.mgr, id))[0]!.email).toBe("satu@contoh.test");
    expect((await listProjectParticipants(fx.viewer, id))[0]!.phone).toBeNull(); // pemantau tidak melihat kontak
    const logs = JSON.stringify((await prisma.auditLog.findMany({ where: { action: { startsWith: "training.participant" } } })).map((l) => ({ a: l.action, s: l.summary, b: l.before, f: l.after })));
    expect(logs).not.toContain("081234567890");
    expect(logs).not.toContain("satu@contoh.test");
    expect(Object.keys(asStaff)).not.toContain("paymentStatus");
    expect(Object.keys(asStaff)).not.toContain("competencyStatus");
    expect(asStaff.source).toBe("MANUAL");
  });

  it("daftar peserta lintas proyek menyamarkan kontak per proyek dan menghormati lingkup", async () => {
    const a = await team({ name: "Proyek A" });
    const b = await mkProject(fx.mgr, { name: "Proyek B" });
    await addTeam(fx.mgr, b, [[fx.empIds[BUDI], "STAFF"]]);
    await addParticipant(fx.emp3, a, { fullName: "Peserta A", phone: "0811111111" });
    await addParticipant(fx.mgr, b, { fullName: "Peserta B", phone: "0822222222" });
    const asCitra = await listAllParticipants(fx.emp3);
    expect(asCitra.items.map((p) => p.fullName)).toEqual(["Peserta A"]); // Citra hanya di A
    const asBudi = await listAllParticipants(fx.emp2); // staf di A dan B
    expect(asBudi.items.every((p) => p.phone === null)).toBe(true);
    const asMgr = await listAllParticipants(fx.mgr);
    expect(asMgr.items.map((p) => p.phone).sort()).toEqual(["0811111111", "0822222222"]);
    expect((await listAllParticipants(fx.mgr, { q: "peserta b" })).total).toBe(1);
  });

  it("kontak instruktur pada direktori hanya untuk Koordinator/Admin Program; karyawan internal dapat ditautkan tanpa akun baru", async () => {
    await team(); // Ayu (PIC) & Budi (staf) kini anggota proyek → punya akses modul, tetapi bukan level Admin Program/Manajer
    await createInstructor(fx.mgr, { name: "Chef Eksternal", kind: "INSTRUCTOR", phone: "0813000000", organization: "Hotel X" });
    await createInstructor(fx.adm, { name: "Budi Santoso", kind: "FACILITATOR", employeeId: fx.empIds[BUDI] });
    expect(await fail(createInstructor(fx.adm, { name: "Duplikat", employeeId: fx.empIds[BUDI] }))).toMatchObject({ code: "CONFLICT" });
    expect(await fail(createInstructor(fx.emp1, { name: "Staf biasa" }))).toMatchObject({ code: "FORBIDDEN" }); // PIC proyek ≠ pengelola direktori
    expect(await fail(createInstructor(fx.loner, { name: "Tanpa akses" }))).toMatchObject({ code: "NOT_FOUND" }); // di luar modul sama sekali
    expect((await listInstructors(fx.mgr)).find((i) => i.name === "Chef Eksternal")!.phone).toBe("0813000000");
    expect((await listInstructors(fx.adm)).find((i) => i.name === "Chef Eksternal")!.phone).toBe("0813000000");
    const asStaff = await listInstructors(fx.emp2); // anggota proyek boleh melihat direktori…
    expect(asStaff).toHaveLength(2);
    expect(asStaff.every((i) => i.phone === null && i.email === null && !i.contactVisible)).toBe(true); // …tanpa kontak
    expect(await prisma.user.count({ where: { email: { contains: "chef" } } })).toBe(0); // tidak ada akun HRIS baru
  });
});

describe("dokumen proyek", () => {
  it("unggah hanya oleh yang berwenang; tipe diverifikasi dari isi berkas; metadata tercatat tanpa isi", async () => {
    const id = await team();
    expect(await fail(uploadDocument(fx.emp2, id, { name: "a.pdf", bytes: PDF() }, { category: "PROPOSAL", title: "Staf tidak boleh" }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await fail(uploadDocument(fx.emp1, id, { name: "palsu.pdf", bytes: new Uint8Array(Buffer.from("ini bukan pdf")) }, { category: "PROPOSAL", title: "Palsu" }))).toMatchObject({ code: "VALIDATION" });
    expect(await fail(uploadDocument(fx.emp1, id, { name: "x.pdf", bytes: PDF() }, { category: "BUKAN_KATEGORI", title: "X" }))).toMatchObject({ code: "VALIDATION" });
    const ok = await uploadDocument(fx.emp1, id, { name: "Proposal Klien.pdf", bytes: PDF() }, { category: "PROPOSAL", title: "Proposal klien", note: "versi 1" });
    const docs = await listDocuments(fx.emp2, id);
    expect(docs.items).toHaveLength(1);
    expect(docs.items[0]).toMatchObject({ id: ok.id, category: "PROPOSAL", mimeType: "application/pdf", uploadedByName: "Ayu Lestari", canDelete: false });
    const au = await prisma.auditLog.findFirstOrThrow({ where: { action: "training.document.upload" } });
    expect(JSON.stringify(au.after)).not.toContain("%PDF");
    expect((await prisma.storedFile.findFirstOrThrow({ where: { kind: "TRAINING_DOCUMENT" } })).originalName).toBe("Proposal_Klien.pdf");
  });

  it("dokumen peserta (sensitif): hanya pengelola peserta yang melihat/membuka; pembukaan dicatat", async () => {
    const id = await team();
    const d = await uploadDocument(fx.emp3, id, { name: "ktp.pdf", bytes: PDF() }, { category: "PARTICIPANT_DOC", title: "Berkas peserta" });
    const fileId = (await prisma.trainingProjectDocument.findUniqueOrThrow({ where: { id: d.id } })).fileId;
    expect((await listDocuments(fx.emp2, id))).toMatchObject({ items: [], hiddenSensitive: 1 });
    expect((await listDocuments(fx.viewer, id)).items).toHaveLength(0);
    expect(await fail(readFileForActor(fx.emp2, fileId))).toMatchObject({ code: "FORBIDDEN" });
    expect(await fail(readFileForActor(fx.viewer, fileId))).toMatchObject({ code: "FORBIDDEN" });
    expect(await fail(uploadDocument(fx.emp2, id, { name: "b.pdf", bytes: PDF() }, { category: "PARTICIPANT_DOC", title: "Staf" }))).toMatchObject({ code: "FORBIDDEN" });
    expect((await readFileForActor(fx.emp3, fileId)).id).toBe(fileId);
    expect(await prisma.auditLog.count({ where: { action: "training.document.view" } })).toBe(1);
  });

  it("'hapus' menyembunyikan & mencabut akses unduh; hanya pengunggah/pengelola; berkas tetap sebagai jejak", async () => {
    const id = await team();
    const d = await uploadDocument(fx.emp3, id, { name: "daftar-hadir.pdf", bytes: PDF() }, { category: "ATTENDANCE", title: "Daftar hadir" });
    const fileId = (await prisma.trainingProjectDocument.findUniqueOrThrow({ where: { id: d.id } })).fileId;
    expect(await fail(deleteDocument(fx.emp2, d.id))).toMatchObject({ code: "FORBIDDEN" }); // staf bukan pengunggah
    await deleteDocument(fx.emp3, d.id); // pengunggah menghapus miliknya
    expect((await listDocuments(fx.emp1, id)).items).toHaveLength(0);
    expect(await fail(readFileForActor(fx.mgr, fileId))).toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.storedFile.count({ where: { id: fileId } })).toBe(1);
    expect(await fail(deleteDocument(fx.emp3, d.id))).toMatchObject({ code: "NOT_FOUND" });
    expect(await prisma.auditLog.count({ where: { action: "training.document.delete" } })).toBe(1);
  });
});

describe("dashboard, laporan, dan riwayat: angka berasal dari data nyata", () => {
  it("dashboard Manajer menghitung tepat sesuai data (terlambat, hari ini, checklist wajib, status, penugasan tim)", async () => {
    const a = await team({ name: "Proyek Aktif", startDate: inDays(2), endDate: inDays(4) });
    await changeProjectStatus(fx.mgr, a, { to: "PREPARATION" });
    await mkProject(fx.mgr, { name: "Proyek Draf" });
    await createTask(fx.mgr, a, { title: "Telat 1", assigneeId: fx.empIds[BUDI], dueDate: inDays(-3) });
    await createTask(fx.mgr, a, { title: "Telat 2", assigneeId: fx.empIds[BUDI], dueDate: inDays(-1) });
    await createTask(fx.mgr, a, { title: "Hari ini", assigneeId: fx.empIds[AYU], dueDate: TODAY() });
    const done = await createTask(fx.mgr, a, { title: "Selesai lama", assigneeId: fx.empIds[AYU], dueDate: inDays(-9) });
    await changeTaskStatus(fx.emp1, done.id, { status: "DONE" });
    await addChecklistItem(fx.mgr, a, { phase: "PREPARATION", title: "Wajib", isRequired: true });
    await addChecklistItem(fx.mgr, a, { phase: "PREPARATION", title: "Opsional" });
    const d = await getTrainingDashboard(fx.mgr);
    expect(d.variant).toBe("manager");
    expect(d.counts).toMatchObject({ projectsInScope: 2, activeProjects: 1, completedProjects: 0, overdueTasks: 2, dueTodayTasks: 1, requiredChecklistProjects: 1, openChecklistItems: 2, activeWithoutDocuments: 1 });
    expect(d.statusDistribution.find((s) => s.status === "DRAFT")!.count).toBe(1);
    expect(d.teamLoad[0]).toMatchObject({ name: "Budi Santoso", openTasks: 2, overdueTasks: 2 });
    expect(d.attention.map((p) => p.name)).toEqual(["Proyek Aktif"]);
    expect(d.risks).toMatchObject({ overdueTasks: 2, requiredChecklistNearStart: 1, noPic: 0, pastEndNotClosed: 0, orphanTasks: 0 });
    expect(Object.keys(d.teamLoad[0]!)).not.toContain("percent"); // tidak ada persentase beban tim
  });

  it("dashboard staf = tugas, proyek, dan checklist miliknya saja; Direktur = ringkasan lintas proyek tanpa hak ubah", async () => {
    const a = await team();
    await changeProjectStatus(fx.mgr, a, { to: "PREPARATION" });
    await createTask(fx.mgr, a, { title: "Tugas Budi", assigneeId: fx.empIds[BUDI], dueDate: inDays(1) });
    await createTask(fx.mgr, a, { title: "Tugas Citra", assigneeId: fx.empIds[CITRA] });
    await addChecklistItem(fx.mgr, a, { phase: "PREPARATION", title: "Item Budi", assigneeId: fx.empIds[BUDI] });
    const s = await getTrainingDashboard(fx.emp2);
    expect(s.variant).toBe("staff");
    expect(s.myTasks.map((t) => t.title)).toEqual(["Tugas Budi"]);
    expect(s.myChecklist.map((c) => c.title)).toEqual(["Item Budi"]);
    expect(s.counts.dueSoonTasks).toBe(1); // hanya tugas Budi (tenggat +1 hari); tugas Citra tanpa tenggat
    const dir = await getTrainingDashboard(fx.superAdmin);
    expect(dir.variant).toBe("director");
    expect(dir.counts.projectsInScope).toBe(1);
    expect(dir.byMonth.length).toBeGreaterThan(0);
    expect((await getTrainingDashboard(fx.adm)).variant).toBe("admin");
  });

  it("laporan proyek: baris sesuai data & lingkup; tabel unduhan memuat definisi indikator; staf tidak melihat proyek lain", async () => {
    const a = await team({ name: "Sertifikasi Uji", programId: null });
    await addChecklistItem(fx.mgr, a, { phase: "PREPARATION", title: "Item A" });
    await addParticipant(fx.emp3, a, { fullName: "P1" });
    await addParticipant(fx.emp3, a, { fullName: "P2", status: "CANCELLED" });
    await mkProject(fx.mgr, { name: "Proyek Lain" });
    const rows = await projectReportRows(fx.mgr);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id === a)).toMatchObject({ participants: 1, checklist: { done: 0, total: 1, percent: 0 }, tasksTotal: 0 });
    expect(await projectReportRows(fx.emp2)).toHaveLength(1);
    const table = await projectReportTable(fx.mgr);
    expect(table.disclaimer).toContain("Belum tersedia");
    expect(table.rows).toHaveLength(2);
    expect(table.columns.map((c) => c.key)).toContain("attention");
  });

  it("riwayat aktivitas memuat kejadian proyek tanpa IP/user-agent/email", async () => {
    const id = await team();
    await createTask(fx.mgr, id, { title: "Tugas riwayat" });
    const log = await listProjectActivity(fx.emp2, id);
    expect(log.total).toBeGreaterThanOrEqual(5);
    expect(log.items[0]!.action).toBe("training.task.create");
    expect(Object.keys(log.items[0]!).sort()).toEqual(["action", "actorName", "at", "id", "reason", "summary"]);
    expect(await fail(listProjectActivity(fx.loner, id))).toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("referensi: surat tugas HRIS & sistem lain", () => {
  it("menautkan surat tugas butuh izin HRIS (assignment:view_all) DAN hak kelola proyek; nominal uang harian tidak terlihat", async () => {
    const id = await team();
    const letter = await makeLetter(fx.superAdmin.userId);
    // Koordinator Program tanpa izin HRIS → ditolak; HR (punya izin HRIS) tetapi bukan pengelola proyek → 404 (tak punya akses proyek)
    expect(await fail(linkAssignment(fx.mgr, id, { letterId: letter.id }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await fail(searchAssignmentLetters(fx.mgr, "Bandung"))).toMatchObject({ code: "FORBIDDEN" });
    expect(await fail(linkAssignment(fx.hr, id, { letterId: letter.id }))).toMatchObject({ code: "NOT_FOUND" });
    // Super Admin (izin HRIS penuh + akses penuh modul, tanpa perlu level) → boleh
    expect((await searchAssignmentLetters(fx.superAdmin, "bandung")).map((l) => l.number)).toEqual(["001/ST/XI/2026"]);
    await linkAssignment(fx.superAdmin, id, { letterId: letter.id });
    expect(await fail(linkAssignment(fx.superAdmin, id, { letterId: letter.id }))).toMatchObject({ code: "CONFLICT" });
    const links = await listAssignmentLinks(fx.emp2, id); // anggota staf melihat referensi…
    expect(links).toHaveLength(1);
    expect(Object.keys(links[0]!).sort()).toEqual(["destination", "endDate", "id", "letterId", "number", "purpose", "startDate", "status"]); // …tanpa nominal/penerima
    await unlinkAssignment(fx.superAdmin, id, links[0]!.id);
    expect(await prisma.assignmentLetter.count()).toBe(1); // surat tugas tidak tersentuh
  });

  it("referensi manual sistem lain: unik per (proyek, sistem, ID); boleh ditambahkan setelah proyek ditutup; bukan integrasi", async () => {
    const id = await team();
    await addExternalRef(fx.mgr, id, { system: "FINANCE", externalId: "INV-2026-0042", label: "Invoice klien" });
    await addExternalRef(fx.mgr, id, { system: "HALOAI", externalId: "DEAL-77" });
    expect(await fail(addExternalRef(fx.mgr, id, { system: "FINANCE", externalId: "INV-2026-0042" }))).toMatchObject({ code: "CONFLICT" });
    expect(await fail(addExternalRef(fx.emp2, id, { system: "WEBSITE", externalId: "REG-1" }))).toMatchObject({ code: "FORBIDDEN" });
    await changeProjectStatus(fx.mgr, id, { to: "PREPARATION" });
    await closeProject(fx.mgr, id, { summary: "Selesai", overrideReason: "tanpa checklist" });
    await addExternalRef(fx.mgr, id, { system: "FINANCE", externalId: "INV-2026-0099" }); // invoice terbit setelah tutup
    expect(await prisma.trainingExternalRef.count({ where: { projectId: id } })).toBe(3);
  });
});
