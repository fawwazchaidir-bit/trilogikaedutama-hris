/**
 * Penutupan proyek Training & Operations:
 *  - setiap tugas terbuka WAJIB diputuskan saat menutup (tindak lanjut / batal) — tidak ada tugas yang menggantung;
 *  - tindak lanjut tetap dapat dikerjakan setelah proyek Selesai; tugas lain terkunci dan TIDAK dihitung (Tugas Saya, lencana, dasbor, beranda, pengingat, serah terima);
 *  - melonggarkan checklist WAJIB (tidak wajib / hapus) beralasan, setelah proyek Berjalan hanya oleh pemegang hak menutup, dan harus diakui saat menutup.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import { resetDb } from "../helpers/db";
import { addTeam, inDays, mkProject, seedTraining, TODAY, type TrainingFixtures } from "../helpers/training";
import { cancelProject, changeProjectStatus, closeProject, getProject, reopenProject } from "@/server/services/training/projects";
import {
  addChecklistItem, addComment, changeTaskStatus, countMyOverdueTasks, createTask, deleteChecklistItem, getTask, listChecklist, listMyTasks, listProjectTasks, updateChecklistItem, updateTask,
} from "@/server/services/training/work";
import { addMilestone, completeMilestone, listMilestones } from "@/server/services/training/indicator-data";
import { getClosurePreview, getTrainingDashboard } from "@/server/services/training/insights";
import { getTrainingHome } from "@/server/services/training/home";
import { getEmployeeHandover } from "@/server/services/training/handover";
import { runTrainingDailyJob } from "@/server/services/training/automation";

let fx: TrainingFixtures;
beforeEach(async () => { await resetDb(); fx = await seedTraining(); });
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const [AYU, BUDI, CITRA] = [0, 1, 2] as const;
const sum = { summary: "Pelatihan selesai dengan baik" };

/** Proyek Berjalan: Ayu = PIC (PROJECT_MANAGER), Budi = Staf, Citra = Admin Program (peran proyek). */
async function running(status: "PREPARATION" | "RUNNING" = "RUNNING") {
  const id = await mkProject(fx.mgr);
  await addTeam(fx.mgr, id, [[fx.empIds[AYU]!, "PROJECT_MANAGER"], [fx.empIds[BUDI]!, "STAFF"], [fx.empIds[CITRA]!, "ADMIN_PROGRAM"]]);
  await changeProjectStatus(fx.mgr, id, { to: "PREPARATION" });
  if (status === "RUNNING") await changeProjectStatus(fx.mgr, id, { to: "RUNNING" });
  return id;
}
const taskFor = (id: string, title: string, over: Record<string, unknown> = {}) => createTask(fx.mgr, id, { title, assigneeId: fx.empIds[BUDI], dueDate: inDays(5), ...over });
const extraOf = (e: AppError | null) => (e as unknown as { extra?: Record<string, unknown> } | null)?.extra;

describe("tugas terbuka wajib diputuskan saat menutup", () => {
  it("tanpa keputusan → ditolak (CONFLICT, daftar yang belum diputuskan); tidak ada yang berubah", async () => {
    const id = await running();
    const t1 = await taskFor(id, "Kirim sertifikat");
    await taskFor(id, "Evaluasi peserta");
    const e = await fail(closeProject(fx.mgr, id, sum));
    expect(e).toMatchObject({ code: "CONFLICT" });
    expect(e!.message).toMatch(/2 tugas terbuka yang belum diputuskan/);
    expect(extraOf(e)?.undecided).toEqual(expect.arrayContaining(["Kirim sertifikat", "Evaluasi peserta"]));
    expect((await getProject(fx.mgr, id)).status).toBe("RUNNING");
    expect((await getTask(fx.mgr, t1.id)).status).toBe("TODO");
  });

  it("tindak lanjut + batal: proyek Selesai, tugas tindak lanjut ditandai & tetap terbuka, tugas batal CANCELLED beralasan, audit & notifikasi tercatat", async () => {
    const id = await running();
    const keep = await taskFor(id, "Kirim sertifikat", { dueDate: inDays(7) });
    const drop = await taskFor(id, "Foto dokumentasi", { dueDate: inDays(1) });
    const r = await closeProject(fx.mgr, id, {
      ...sum,
      taskDecisions: [
        { taskId: keep.id, action: "FOLLOW_UP", assigneeId: fx.empIds[BUDI], dueDate: inDays(9) },
        { taskId: drop.id, action: "CANCEL", reason: "Acara tidak jadi didokumentasikan" },
      ],
    });
    expect(r).toMatchObject({ closedWithOverride: false, openTasks: 2, followUpTasks: 1, cancelledTasks: 1 });
    expect(await getProject(fx.mgr, id)).toMatchObject({ status: "COMPLETED", closureOverrideReason: null });

    const k = await prisma.trainingTask.findUniqueOrThrow({ where: { id: keep.id } });
    expect(k).toMatchObject({ isFollowUp: true, status: "TODO", assigneeId: fx.empIds[BUDI] });
    expect(k.dueDate!.toISOString().slice(0, 10)).toBe(inDays(9));
    const d = await prisma.trainingTask.findUniqueOrThrow({ where: { id: drop.id } });
    expect(d).toMatchObject({ isFollowUp: false, status: "CANCELLED" });

    const comments = await prisma.trainingTaskComment.findMany({ where: { taskId: { in: [keep.id, drop.id] } }, select: { taskId: true, body: true } });
    expect(comments.find((c) => c.taskId === keep.id)!.body).toContain("[Tindak lanjut]");
    expect(comments.find((c) => c.taskId === drop.id)!.body).toContain("Acara tidak jadi didokumentasikan");

    const au = await prisma.auditLog.findFirstOrThrow({ where: { action: "training.project.close" } });
    expect(au.summary).toContain("1 jadi tindak lanjut, 1 dibatalkan");
    expect(JSON.stringify(au.after)).toContain("Kirim sertifikat");
    expect(JSON.stringify(au.after)).toContain("Acara tidak jadi didokumentasikan");
    expect(await prisma.notification.count({ where: { userId: fx.emp2.userId, type: "training.task.followup" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: fx.emp2.userId, type: "training.task.cancelled" } })).toBe(1);
  });

  it("keputusan tidak sah menggagalkan SELURUH penutupan (transaksi): tenggat lewat, penanggung jawab bukan anggota, batal tanpa alasan, ID asing, 'Selesai'", async () => {
    const id = await running();
    const a = await taskFor(id, "Tugas A");
    const b = await taskFor(id, "Tugas B");
    const ok = { taskId: a.id, action: "CANCEL", reason: "Dibatalkan klien" } as const;
    const attempts: [string, unknown[], RegExp][] = [
      ["tenggat lewat", [ok, { taskId: b.id, action: "FOLLOW_UP", dueDate: inDays(-1) }], /sudah lewat/],
      ["bukan anggota", [ok, { taskId: b.id, action: "FOLLOW_UP", assigneeId: fx.lonerEmp }], /anggota aktif proyek/],
      ["batal tanpa alasan", [ok, { taskId: b.id, action: "CANCEL" }], /Alasan pembatalan/],
      ["ID asing", [ok, { taskId: b.id, action: "CANCEL", reason: "Tidak diperlukan" }, { taskId: "99999999-9999-4999-8999-999999999999", action: "CANCEL", reason: "Tidak ada" }], /berubah/],
    ];
    for (const [name, decisions, msg] of attempts) {
      const e = await fail(closeProject(fx.mgr, id, { ...sum, taskDecisions: decisions }));
      expect(e, name).toMatchObject({ code: expect.stringMatching(/CONFLICT|VALIDATION/) });
      expect(e!.message, name).toMatch(msg);
    }
    expect(await fail(closeProject(fx.mgr, id, { ...sum, taskDecisions: [{ taskId: a.id, action: "DONE" }] }))).toMatchObject({ code: "VALIDATION" });
    expect((await getProject(fx.mgr, id)).status).toBe("RUNNING");
    expect((await prisma.trainingTask.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("TODO");   // pembatalan 'ok' tidak ikut tersimpan
  });

  it("tugas yang sedang menunggu pemeriksaan dapat dijadikan tindak lanjut; pemisahan pemeriksa tetap berlaku sesudahnya", async () => {
    const id = await running();
    const t = await taskFor(id, "Susun laporan", { requiresReview: true });
    await changeTaskStatus(fx.emp2, t.id, { status: "IN_PROGRESS" });
    await changeTaskStatus(fx.emp2, t.id, { status: "IN_REVIEW" });
    await closeProject(fx.mgr, id, { ...sum, taskDecisions: [{ taskId: t.id, action: "FOLLOW_UP", dueDate: inDays(2) }] });
    expect((await getTask(fx.mgr, t.id))).toMatchObject({ status: "IN_REVIEW", isFollowUp: true, locked: false });
    // pengirim hasil tidak boleh memeriksanya sendiri, walau proyek sudah ditutup
    expect(await fail(changeTaskStatus(fx.emp2, t.id, { status: "DONE" }))).toMatchObject({ code: "FORBIDDEN" });
    await changeTaskStatus(fx.mgr, t.id, { status: "DONE" });
    expect((await getTask(fx.mgr, t.id)).status).toBe("DONE");
  });

  it("mengganti penanggung jawab tugas yang sudah dimulai wajib beralasan, tercatat di komentar tugas", async () => {
    const id = await running();
    const t = await taskFor(id, "Susun modul");
    await changeTaskStatus(fx.emp2, t.id, { status: "IN_PROGRESS" });
    const base = { taskId: t.id, action: "FOLLOW_UP" as const, assigneeId: fx.empIds[AYU] };
    expect(await fail(closeProject(fx.mgr, id, { ...sum, taskDecisions: [base] }))).toMatchObject({ code: "CONFLICT" });
    await closeProject(fx.mgr, id, { ...sum, taskDecisions: [{ ...base, reason: "Budi dialihkan ke proyek lain" }] });
    const c = await prisma.trainingTaskComment.findFirstOrThrow({ where: { taskId: t.id, body: { startsWith: "[Tindak lanjut]" } } });
    expect(c.body).toContain("penanggung jawab diganti");
    expect(c.body).toContain("Budi dialihkan ke proyek lain");
  });
});

describe("tindak lanjut hidup setelah proyek Selesai; tugas lain terkunci dan tidak dihitung", () => {
  /** Proyek Selesai: satu tindak lanjut (Budi, tenggat hari ini) + satu tugas YATIM warisan (terbuka, terlambat, tanpa keputusan — seperti data sebelum aturan ini). */
  async function closedWithFollowUp() {
    const id = await running();
    const fu = await taskFor(id, "Kirim sertifikat", { dueDate: inDays(5) });
    await closeProject(fx.mgr, id, { ...sum, taskDecisions: [{ taskId: fu.id, action: "FOLLOW_UP", dueDate: TODAY() }] });
    const orphan = await prisma.trainingTask.create({ data: { projectId: id, title: "Yatim lama", assigneeId: fx.empIds[BUDI]!, dueDate: isoToDate(inDays(-3)), createdById: fx.mgr.userId } });
    return { id, fu, orphan };
  }

  it("tindak lanjut dapat dikerjakan (status, komentar, ubah); tugas lain & tugas baru tetap terkunci (409)", async () => {
    const { id, fu, orphan } = await closedWithFollowUp();
    const dto = (await listProjectTasks(fx.emp2, id)).find((t) => t.id === fu.id)!;
    expect(dto).toMatchObject({ isFollowUp: true, locked: false, canEdit: false });
    expect(dto.allowedNext).toContain("IN_PROGRESS");
    await changeTaskStatus(fx.emp2, fu.id, { status: "IN_PROGRESS" });
    await addComment(fx.emp2, fu.id, { body: "Sertifikat dicetak" });
    await updateTask(fx.mgr, fu.id, { dueDate: inDays(3) });
    await changeTaskStatus(fx.emp2, fu.id, { status: "DONE" });
    expect((await getTask(fx.mgr, fu.id)).status).toBe("DONE");

    const o = (await listProjectTasks(fx.emp2, id)).find((t) => t.id === orphan.id)!;
    expect(o).toMatchObject({ isFollowUp: false, locked: true, canEdit: false, allowedNext: [] });
    expect(await fail(changeTaskStatus(fx.emp2, orphan.id, { status: "DONE" }))).toMatchObject({ code: "CONFLICT" });
    expect(await fail(updateTask(fx.mgr, orphan.id, { title: "Ubah" }))).toMatchObject({ code: "CONFLICT" });
    expect(await fail(addComment(fx.emp2, orphan.id, { body: "x" }))).toMatchObject({ code: "CONFLICT" });
    expect(await fail(createTask(fx.mgr, id, { title: "Tugas baru" }))).toMatchObject({ code: "CONFLICT" });
  });

  it("Tugas Saya, lencana, dasbor, beranda & ringkasan proyek menghitung tindak lanjut — bukan tugas yatim", async () => {
    const { id, fu, orphan } = await closedWithFollowUp();
    // Tindak lanjut tenggat hari ini (belum terlambat); yatim terlambat tetapi tidak terhitung.
    expect((await listMyTasks(fx.emp2)).map((t) => t.id)).toEqual([fu.id]);
    expect(await countMyOverdueTasks(fx.emp2)).toBe(0);
    const dash = await getTrainingDashboard(fx.mgr);
    expect(dash.counts).toMatchObject({ openTasks: 1, overdueTasks: 0, dueTodayTasks: 1 });
    const home = await getTrainingHome(fx.mgr);
    expect(home.kpis).toMatchObject({ openTasks: 1, tasksOnTrackPct: 100 });
    expect(await getProject(fx.mgr, id)).toMatchObject({ openTasks: 1, overdueTasks: 0 });
    // riwayat (Selesai/Dibatalkan) tetap tampil di "Semua"/"Selesai" (terkunci), tugas terbuka yatim tidak.
    expect((await listMyTasks(fx.emp2, { filter: "all" })).map((t) => t.id)).toEqual([fu.id]);
    expect(orphan.id).toBeTruthy();
    // tindak lanjut lewat tenggat → terlambat di semua tempat
    await prisma.trainingTask.update({ where: { id: fu.id }, data: { dueDate: isoToDate(inDays(-1)) } });
    expect(await countMyOverdueTasks(fx.emp2)).toBe(1);
    expect((await getTrainingDashboard(fx.mgr)).counts.overdueTasks).toBe(1);
    expect((await getTrainingHome(fx.mgr)).kpis.tasksOnTrackPct).toBe(0);
  });

  it("proyek DIBATALKAN: tugas terbuka tidak lagi terhitung di Tugas Saya / lencana / dasbor", async () => {
    const id = await running();
    await taskFor(id, "Menggantung", { dueDate: inDays(-2) });
    expect(await countMyOverdueTasks(fx.emp2)).toBe(1);
    await cancelProject(fx.mgr, id, { reason: "Klien membatalkan" });
    expect(await countMyOverdueTasks(fx.emp2)).toBe(0);
    expect((await listMyTasks(fx.emp2)).length).toBe(0);
    expect((await getTrainingDashboard(fx.mgr)).counts).toMatchObject({ openTasks: 0, overdueTasks: 0 });
  });

  it("pengingat harian menjangkau tindak lanjut (bukan tugas yatim); serah terima karyawan berhenti memuat tindak lanjutnya", async () => {
    const { id, fu } = await closedWithFollowUp();
    // Yatim yang tenggatnya JUGA hari ini: bila filter "hidup" dilepas, dialah yang akan ikut diingatkan.
    await prisma.trainingTask.create({ data: { projectId: id, title: "Yatim hari ini", assigneeId: fx.empIds[BUDI]!, dueDate: isoToDate(TODAY()), createdById: fx.mgr.userId } });
    await runTrainingDailyJob();
    const rem = await prisma.notification.findMany({ where: { userId: fx.emp2.userId, type: "training.reminder.due_today" } });
    expect(rem.map((n) => n.body)).toEqual([expect.stringContaining("Kirim sertifikat")]);
    expect(rem.some((n) => n.body!.includes("Yatim"))).toBe(false);

    const h = await getEmployeeHandover(fx.superAdmin, fx.empIds[BUDI]!);
    const proj = h.projects.find((p) => p.projectId === id)!;
    expect(proj.status).toBe("COMPLETED");
    expect(proj.detail?.tasks.map((t) => t.id)).toEqual([fu.id]);
  });

  it("dibuka kembali: tindak lanjut kembali menjadi tugas biasa; penutupan berikutnya meminta keputusan lagi", async () => {
    const { id, fu } = await closedWithFollowUp();
    await reopenProject(fx.mgr, id, { reason: "Ada koreksi laporan" });
    expect(await prisma.trainingTask.findUniqueOrThrow({ where: { id: fu.id } })).toMatchObject({ isFollowUp: false, status: "TODO" });
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "training.project.reopen" } })).summary).toContain("1 tugas tindak lanjut kembali menjadi tugas biasa");
    expect(await fail(closeProject(fx.mgr, id, sum))).toMatchObject({ code: "CONFLICT" });
  });
});

describe("melonggarkan checklist wajib", () => {
  const demote = (actor: typeof fx.emp1, itemId: string, reason?: string) => updateChecklistItem(actor, itemId, { isRequired: false, ...(reason !== undefined ? { reason } : {}) });

  it("Berjalan: PIC & Admin Program ditolak; Koordinator Program wajib beralasan; tercatat sebagai pelonggaran", async () => {
    const id = await running("RUNNING");
    const it1 = await addChecklistItem(fx.mgr, id, { phase: "CLOSING", title: "Laporan disusun", isRequired: true });
    expect(await fail(demote(fx.emp2, it1.id, "Tidak perlu"))).toMatchObject({ code: "FORBIDDEN" });         // Staf
    for (const a of [fx.emp1, fx.emp3]) {                                                                      // PIC & Admin Program
      const e = await fail(demote(a, it1.id, "Klien tidak meminta laporan"));
      expect(e).toMatchObject({ code: "FORBIDDEN" });
      expect(e!.message).toMatch(/Koordinator Program atau Direktur/);
    }
    expect(await fail(demote(fx.mgr, it1.id))).toMatchObject({ code: "VALIDATION" });                         // tanpa alasan
    expect(await fail(demote(fx.mgr, it1.id, "abc"))).toMatchObject({ code: "VALIDATION" });                  // terlalu pendek
    expect((await listChecklist(fx.mgr, id)).items[0]!.isRequired).toBe(true);

    await demote(fx.mgr, it1.id, "Klien tidak meminta laporan");
    expect((await listChecklist(fx.mgr, id)).items[0]!.isRequired).toBe(false);
    expect(await prisma.trainingChecklistRelaxation.findMany({ where: { projectId: id } })).toMatchObject([{ itemId: it1.id, itemTitle: "Laporan disusun", kind: "DEMOTED", reason: "Klien tidak meminta laporan", actorId: fx.mgr.userId, acknowledgedAt: null }]);
    const au = await prisma.auditLog.findFirstOrThrow({ where: { action: "training.checklist.update" } });
    expect(au.summary).toContain("dijadikan TIDAK WAJIB");
    expect(au.reason).toBe("Klien tidak meminta laporan");
  });

  it("DAFTAR checklist memberi tahu siapa yang boleh melonggarkan (untuk UI)", async () => {
    const id = await running("RUNNING");
    expect((await listChecklist(fx.emp1, id)).canRelax).toBe(false);
    expect((await listChecklist(fx.mgr, id)).canRelax).toBe(true);
    const prep = await running("PREPARATION");
    expect((await listChecklist(fx.emp1, prep)).canRelax).toBe(true);
    expect((await listChecklist(fx.emp2, prep)).canRelax).toBe(false);       // Staf tidak mengelola checklist
  });

  it("Persiapan: PIC boleh dengan alasan; tanpa alasan ditolak; hapus item wajib juga beralasan dan tercatat", async () => {
    const id = await running("PREPARATION");
    const a = await addChecklistItem(fx.emp1, id, { phase: "PREPARATION", title: "Kontrak ditandatangani", isRequired: true });
    const b = await addChecklistItem(fx.emp1, id, { phase: "PREPARATION", title: "Konsumsi dipesan", isRequired: true });
    expect(await fail(demote(fx.emp1, a.id))).toMatchObject({ code: "VALIDATION" });
    await demote(fx.emp1, a.id, "Kontrak diganti PO");
    expect(await fail(deleteChecklistItem(fx.emp1, b.id))).toMatchObject({ code: "VALIDATION" });
    await deleteChecklistItem(fx.emp1, b.id, { reason: "Konsumsi dari klien" });
    const rows = await prisma.trainingChecklistRelaxation.findMany({ where: { projectId: id }, orderBy: { itemTitle: "asc" } });
    expect(rows.map((r) => [r.itemTitle, r.kind, r.reason])).toEqual([["Konsumsi dipesan", "DELETED", "Konsumsi dari klien"], ["Kontrak ditandatangani", "DEMOTED", "Kontrak diganti PO"]]);
    const del = await prisma.auditLog.findFirstOrThrow({ where: { action: "training.checklist.delete" } });
    expect(del.summary).toContain("WAJIB");
    expect(del.reason).toBe("Konsumsi dari klien");
  });

  it("Berjalan: hapus item wajib hanya Koordinator Program/Direktur (beralasan); item tidak wajib dihapus bebas tanpa alasan", async () => {
    const id = await running("RUNNING");
    const req = await addChecklistItem(fx.mgr, id, { phase: "CLOSING", title: "Berita acara", isRequired: true });
    const opt = await addChecklistItem(fx.mgr, id, { phase: "CLOSING", title: "Foto bersama", isRequired: false });
    expect(await fail(deleteChecklistItem(fx.emp1, req.id, { reason: "Tidak diperlukan" }))).toMatchObject({ code: "FORBIDDEN" });
    expect(await fail(deleteChecklistItem(fx.mgr, req.id))).toMatchObject({ code: "VALIDATION" });
    await deleteChecklistItem(fx.emp1, opt.id);                                    // tidak wajib: tanpa alasan, PIC cukup
    await deleteChecklistItem(fx.superAdmin, req.id, { reason: "Digantikan dokumen lain" });
    expect((await prisma.trainingChecklistRelaxation.findMany({ where: { projectId: id } })).map((r) => r.kind)).toEqual(["DELETED"]);
  });

  it("celah 'turunkan lalu buka kembali' tertutup: menurunkan item wajib yang SUDAH selesai pun harus beralasan; dijadikan wajib lagi → pelonggaran dicabut", async () => {
    const id = await running("PREPARATION");
    const a = await addChecklistItem(fx.mgr, id, { phase: "CLOSING", title: "Laporan disusun", isRequired: true });
    await updateChecklistItem(fx.mgr, a.id, { isDone: true });
    expect(await fail(demote(fx.mgr, a.id))).toMatchObject({ code: "VALIDATION" });
    await demote(fx.mgr, a.id, "Dipindah ke dokumen lain");
    expect(await prisma.trainingChecklistRelaxation.count({ where: { itemId: a.id } })).toBe(1);
    await updateChecklistItem(fx.mgr, a.id, { isRequired: true });
    expect(await prisma.trainingChecklistRelaxation.count({ where: { itemId: a.id } })).toBe(0);
    expect((await prisma.auditLog.findMany({ where: { action: "training.checklist.update" }, orderBy: { id: "desc" }, take: 1 }))[0]!.summary).toContain("dijadikan wajib");
  });

  it("item yang sudah dilonggarkan lalu dihapus: tercatat sebagai dihapus (alasan semula dipertahankan)", async () => {
    const id = await running("PREPARATION");
    const a = await addChecklistItem(fx.mgr, id, { phase: "CLOSING", title: "Laporan disusun", isRequired: true });
    await demote(fx.mgr, a.id, "Klien tidak meminta");
    await deleteChecklistItem(fx.mgr, a.id);                                       // sudah tidak wajib → tanpa alasan baru
    expect(await prisma.trainingChecklistRelaxation.findMany({ where: { itemId: a.id } })).toMatchObject([{ kind: "DELETED", reason: "Klien tidak meminta" }]);
  });
});

describe("pratinjau & pengakuan pelonggaran saat menutup", () => {
  it("ringkasan satu layar: tugas terbuka, milestone kritis, dokumen, checklist wajib, pelonggaran, anggota", async () => {
    const id = await running();
    await taskFor(id, "Kirim sertifikat", { dueDate: inDays(-2) });
    await addMilestone(fx.mgr, id, { code: "X1", name: "Sertifikat terbit", anchor: "H", days: 3, weight: 5, critical: true });
    await addMilestone(fx.mgr, id, { code: "X2", name: "Dokumentasi diunggah", anchor: "H", days: 3, weight: 1, critical: false });
    const req = await addChecklistItem(fx.mgr, id, { phase: "CLOSING", title: "Laporan disusun", isRequired: true });
    await updateChecklistItem(fx.mgr, req.id, { isRequired: false, reason: "Klien tidak meminta" });
    const pv = await getClosurePreview(fx.mgr, id);
    expect(pv.openTasks).toMatchObject([{ title: "Kirim sertifikat", assigneeName: "Budi Santoso", overdue: true, assigneeUnavailable: null }]);
    const crit = pv.criticalMilestones.map((m) => m.code);                                   // template program (otomatis) + tambahan; hanya yang kritis & belum selesai
    expect(crit).toContain("X1");
    expect(crit).not.toContain("X2");
    await completeMilestone(fx.mgr, (await listMilestones(fx.mgr, id)).find((m) => m.code === "X1")!.id, { evidence: "Berita Acara 001" });
    expect((await getClosurePreview(fx.mgr, id)).criticalMilestones.map((m) => m.code)).not.toContain("X1");
    expect(pv.relaxations).toMatchObject([{ title: "Laporan disusun", kind: "DEMOTED", reason: "Klien tidak meminta", byName: "Maya Manajer", acknowledged: false }]);
    expect(pv.unacknowledgedRelaxations).toBe(1);
    expect(pv.assignees.map((a) => a.name)).toEqual(expect.arrayContaining(["Budi Santoso"]));
    expect(pv).toMatchObject({ canCloseClean: true, requiredOutstanding: [], missingRecommendedDocuments: ["ATTENDANCE", "FINAL_REPORT"] });
  });

  it("pelonggaran yang belum diakui menghalangi penutupan; setelah diakui: tercatat di audit & tidak diminta lagi; yang baru perlu diakui lagi", async () => {
    const id = await running();
    const a = await addChecklistItem(fx.mgr, id, { phase: "CLOSING", title: "Laporan disusun", isRequired: true });
    await updateChecklistItem(fx.mgr, a.id, { isRequired: false, reason: "Klien tidak meminta" });
    const e = await fail(closeProject(fx.mgr, id, sum));
    expect(e).toMatchObject({ code: "CONFLICT" });
    expect(e!.message).toMatch(/1 checklist wajib yang dilonggarkan/);
    expect(extraOf(e)?.relaxed).toEqual(["Laporan disusun"]);
    expect((await getProject(fx.mgr, id)).status).toBe("RUNNING");

    const r = await closeProject(fx.mgr, id, { ...sum, acknowledgeRelaxed: true });
    expect(r).toMatchObject({ closedWithOverride: false, acknowledgedRelaxations: 1 });
    const au = await prisma.auditLog.findFirstOrThrow({ where: { action: "training.project.close" } });
    expect(au.summary).toContain("1 pelonggaran checklist wajib diakui");
    expect(JSON.stringify(au.after)).toContain("Klien tidak meminta");
    const row = await prisma.trainingChecklistRelaxation.findFirstOrThrow({ where: { itemId: a.id } });
    expect(row.acknowledgedAt).not.toBeNull();
    expect(row.acknowledgedById).toBe(fx.mgr.userId);

    // dibuka kembali: yang sudah diakui tidak diminta lagi; pelonggaran BARU perlu diakui
    await reopenProject(fx.mgr, id, { reason: "Ada koreksi laporan" });
    expect((await getClosurePreview(fx.mgr, id)).unacknowledgedRelaxations).toBe(0);
    const b = await addChecklistItem(fx.mgr, id, { phase: "CLOSING", title: "Evaluasi", isRequired: true });
    await deleteChecklistItem(fx.mgr, b.id, { reason: "Digabung ke laporan" });
    expect(await fail(closeProject(fx.mgr, id, sum))).toMatchObject({ code: "CONFLICT" });
    expect(await closeProject(fx.mgr, id, { ...sum, acknowledgeRelaxed: true })).toMatchObject({ acknowledgedRelaxations: 1 });
  });

  it("tanpa pelonggaran & tanpa tugas terbuka: ditutup bersih seperti biasa (pengakuan tidak diminta)", async () => {
    const id = await running();
    const done = await taskFor(id, "Sudah beres");
    await changeTaskStatus(fx.emp2, done.id, { status: "IN_PROGRESS" });
    await changeTaskStatus(fx.emp2, done.id, { status: "DONE" });
    expect(await closeProject(fx.mgr, id, sum)).toMatchObject({ closedWithOverride: false, openTasks: 0, followUpTasks: 0, cancelledTasks: 0, acknowledgedRelaxations: 0 });
  });

  it("pengecualian checklist wajib belum selesai tetap berlaku bersama keputusan tugas", async () => {
    const id = await running();
    await addChecklistItem(fx.mgr, id, { phase: "CLOSING", title: "Laporan disusun", isRequired: true });
    const t = await taskFor(id, "Kirim sertifikat");
    expect(await fail(closeProject(fx.mgr, id, { ...sum, taskDecisions: [{ taskId: t.id, action: "CANCEL", reason: "Tidak diperlukan" }] }))).toMatchObject({ code: "CONFLICT", extra: { outstanding: ["Laporan disusun"] } });
    const r = await closeProject(fx.mgr, id, { ...sum, overrideReason: "Klien membatalkan sesi penutup", taskDecisions: [{ taskId: t.id, action: "CANCEL", reason: "Tidak diperlukan" }] });
    expect(r).toMatchObject({ closedWithOverride: true, cancelledTasks: 1 });
  });
});
