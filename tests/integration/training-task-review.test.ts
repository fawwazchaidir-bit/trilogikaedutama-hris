/**
 * Pemisahan pelaksana / pengirim hasil / pemeriksa pada tugas wajib periksa (tanpa pengecualian):
 *  - tiga identitas disimpan terpisah (pelaksana saat dikirim, pengirim, pemeriksa);
 *  - pemeriksa ≠ pengirim, ≠ pelaksana saat dikirim, ≠ penanggung jawab saat ini (service + trigger database);
 *  - mengubah penanggung jawab / kewajiban periksa setelah pekerjaan dimulai wajib beralasan dan tercatat (audit + komentar);
 *  - pelaksana tidak boleh mematikan kewajiban periksa tugasnya sendiri.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { resetDb } from "../helpers/db";
import { addTeam, mkProject, seedTraining, type TrainingFixtures } from "../helpers/training";
import { changeTaskStatus, createTask, getTask, listComments, updateTask } from "@/server/services/training/work";

let fx: TrainingFixtures; let pid: string;
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const PM = () => fx.emp1;          // PIC proyek (empIds[0]) — pengelola tugas
const STAFF = () => fx.emp2;       // Staf (empIds[1]) — bukan pengelola
const row = (id: string) => prisma.trainingTask.findUniqueOrThrow({ where: { id } });
const mk = async (assigneeId: string | null, over: Record<string, unknown> = {}) => (await createTask(fx.mgr, pid, { title: "Susun modul pelatihan", assigneeId, requiresReview: true, ...over })).id;
const st = (a: typeof fx.emp1, id: string, status: string, note?: string) => changeTaskStatus(a, id, { status, ...(note ? { note } : {}) });

beforeEach(async () => {
  await resetDb(); fx = await seedTraining(); pid = await mkProject(fx.mgr);
  await addTeam(fx.mgr, pid, [[fx.empIds[0], "PROJECT_MANAGER"], [fx.empIds[1], "STAFF"]]);
});

describe("alur normal: staf mengirim hasilnya, PIC memeriksa", () => {
  it("tiga identitas tercatat terpisah dan tampil di tugas", async () => {
    const id = await mk(fx.empIds[1]);
    await st(STAFF(), id, "IN_REVIEW");
    let t = await getTask(PM(), id);
    expect(t).toMatchObject({ status: "IN_REVIEW", executorName: "Budi Santoso", submittedByName: STAFF().name, reviewedByName: null });
    expect(t.allowedNext).toContain("DONE");                                       // PIC boleh memeriksa
    expect((await getTask(STAFF(), id)).allowedNext).not.toContain("DONE");        // pelaksana tidak
    await st(PM(), id, "DONE");
    t = await getTask(PM(), id);
    const r = await row(id);
    expect(t).toMatchObject({ status: "DONE", executorName: "Budi Santoso", submittedByName: STAFF().name, reviewedByName: PM().name });
    expect(r).toMatchObject({ submittedById: STAFF().userId, assigneeAtSubmitId: fx.empIds[1], reviewedById: PM().userId, completedById: PM().userId });
    expect(r.submittedAt).not.toBeNull(); expect(r.reviewedAt).not.toBeNull();
  });

  it("menarik kembali / dikembalikan / dibuka kembali mengosongkan siklus pemeriksaan; kirim ulang menjadikan pengirim baru", async () => {
    const id = await mk(fx.empIds[1]);
    await st(STAFF(), id, "IN_REVIEW");
    await st(STAFF(), id, "IN_PROGRESS");                                        // menarik kembali
    expect(await row(id)).toMatchObject({ submittedById: null, assigneeAtSubmitId: null, reviewedById: null });
    await st(PM(), id, "IN_REVIEW");                                             // kini PIC yang mengirim (atas nama staf)
    expect((await row(id)).submittedById).toBe(PM().userId);
    await st(fx.mgr, id, "DONE");                                                // Koordinator memeriksa
    expect(await row(id)).toMatchObject({ submittedById: PM().userId, reviewedById: fx.mgr.userId });
    await st(fx.mgr, id, "IN_PROGRESS");                                         // dibuka kembali
    expect(await row(id)).toMatchObject({ submittedById: null, reviewedById: null, completedById: null });
  });
});

describe("skenario 1 — pengelola mengirim tugas orang lain lalu menyetujuinya sendiri", () => {
  it("DITOLAK: pengirim tidak dapat memeriksa; Koordinator & Direktur (orang lain) dapat", async () => {
    const id = await mk(fx.empIds[1]);
    await st(PM(), id, "IN_REVIEW");                                             // PIC mengirim atas nama staf
    const e = await fail(st(PM(), id, "DONE"));
    expect(e?.code).toBe("FORBIDDEN");
    expect(e?.message).toMatch(/Anda yang mengirim hasil ini ke pemeriksaan[^]*pengelola proyek lain/);
    expect((await getTask(PM(), id)).allowedNext).not.toContain("DONE");
    expect((await row(id)).status).toBe("IN_REVIEW");
    expect((await getTask(fx.mgr, id)).allowedNext).toContain("DONE");
    await st(fx.superAdmin, id, "DONE");
    expect(await row(id)).toMatchObject({ status: "DONE", reviewedById: fx.superAdmin.userId, submittedById: PM().userId });
  });
});

describe("skenario 2 — mengosongkan/mengalihkan penanggung jawab saat menunggu pemeriksaan", () => {
  it("2a: dikosongkan → pelaksana saat dikirim tetap tercatat; tetap tidak boleh memeriksa sendiri", async () => {
    const id = await mk(fx.empIds[0]);                                           // PIC mengerjakan tugasnya sendiri
    await st(PM(), id, "IN_REVIEW");
    expect((await fail(st(PM(), id, "DONE")))?.code).toBe("FORBIDDEN");
    const noReason = await fail(updateTask(PM(), id, { assigneeId: null }));
    expect(noReason?.code).toBe("VALIDATION");
    expect(noReason?.fieldErrors?.reason).toBeTruthy();                          // setelah dimulai → wajib alasan
    await updateTask(PM(), id, { assigneeId: null, reason: "Karyawan pindah divisi" });
    const e = await fail(st(PM(), id, "DONE"));
    expect(e?.code).toBe("FORBIDDEN");                                           // pengirim + pelaksana saat dikirim
    expect(await row(id)).toMatchObject({ status: "IN_REVIEW", assigneeId: null, assigneeAtSubmitId: fx.empIds[0] });
    await st(fx.mgr, id, "DONE");                                                // orang lain boleh
    expect((await row(id)).status).toBe("DONE");
  });

  it("2b: dialihkan ke staf → PIC tetap pengirim & pelaksana awal sehingga tidak boleh memeriksa; staf (penanggung jawab baru) pun bukan pengelola", async () => {
    const id = await mk(fx.empIds[0]);
    await st(PM(), id, "IN_REVIEW");
    await updateTask(PM(), id, { assigneeId: fx.empIds[1], reason: "Dialihkan ke Budi" });
    expect((await fail(st(PM(), id, "DONE")))?.code).toBe("FORBIDDEN");
    expect((await getTask(STAFF(), id)).allowedNext).not.toContain("DONE");      // penanggung jawab baru tidak boleh memeriksa
    await st(fx.superAdmin, id, "DONE");
    expect((await row(id)).status).toBe("DONE");
  });

  it("perubahan beralasan tercatat jelas: audit (alasan, sebelum/sesudah) + komentar tugas yang terlihat tim", async () => {
    const id = await mk(fx.empIds[1]);
    await st(STAFF(), id, "IN_PROGRESS");
    await updateTask(PM(), id, { assigneeId: fx.empIds[0], reason: "Staf cuti panjang" });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "training.task.update", entityId: pid }, orderBy: { id: "desc" } });
    expect(audit.reason).toBe("Staf cuti panjang");
    expect(audit.summary).toMatch(/setelah pekerjaan dimulai/);
    expect(audit.before).toMatchObject({ assigneeId: fx.empIds[1] });
    expect(audit.after).toMatchObject({ assigneeId: fx.empIds[0] });
    const c = (await listComments(PM(), id)).at(-1)!;
    expect(c.authorName).toBe(PM().name);
    expect(c.body).toMatch(/\[Perubahan syarat tugas\] penanggung jawab Budi Santoso → .*alasan: Staf cuti panjang/);
  });

  it("sebelum dimulai (Belum dikerjakan): mengalihkan tidak perlu alasan", async () => {
    const id = await mk(fx.empIds[1]);
    await updateTask(PM(), id, { assigneeId: fx.empIds[0] });
    expect((await row(id)).assigneeId).toBe(fx.empIds[0]);
  });
});

describe("skenario 3 — mematikan kewajiban pemeriksaan", () => {
  it("pelaksana TIDAK boleh mematikannya untuk tugasnya sendiri (kapan pun), dengan atau tanpa alasan", async () => {
    const id = await mk(fx.empIds[0]);                                           // PIC adalah pelaksana
    const t0 = await fail(updateTask(PM(), id, { requiresReview: false }));      // Belum dikerjakan
    expect(t0?.code).toBe("FORBIDDEN");
    expect(t0?.message).toMatch(/Pelaksana tidak dapat mematikan kewajiban pemeriksaan tugasnya sendiri/);
    await st(PM(), id, "IN_PROGRESS");
    expect((await fail(updateTask(PM(), id, { requiresReview: false, reason: "Tidak perlu diperiksa" })))?.code).toBe("FORBIDDEN");
    expect((await fail(st(PM(), id, "DONE")))?.code).toBe("CONFLICT");           // tetap wajib lewat pemeriksaan
    expect((await row(id)).requiresReview).toBe(true);
    expect((await getTask(PM(), id)).viewerIsExecutor).toBe(true);
    expect((await getTask(fx.mgr, id)).viewerIsExecutor).toBe(false);
  });

  it("pelaksana awal tetap terkunci walau sudah bukan penanggung jawab saat ini", async () => {
    const id = await mk(fx.empIds[0]);
    await st(PM(), id, "IN_REVIEW");
    await updateTask(PM(), id, { assigneeId: fx.empIds[1], reason: "Dialihkan" });
    await st(PM(), id, "IN_PROGRESS");                                           // PIC mengembalikan (siklus berakhir)
    // PIC bukan lagi penanggung jawab dan siklus sudah kosong → ia pengelola lain bagi tugas milik staf; boleh mematikan dengan alasan
    await updateTask(PM(), id, { requiresReview: false, reason: "Tugas rutin, tidak perlu diperiksa" });
    expect((await row(id)).requiresReview).toBe(false);
  });

  it("pengelola LAIN boleh mematikannya setelah dimulai — wajib alasan, tercatat; saat menunggu pemeriksaan tetap ditolak", async () => {
    const id = await mk(fx.empIds[1]);
    await st(STAFF(), id, "IN_PROGRESS");
    const noReason = await fail(updateTask(PM(), id, { requiresReview: false }));
    expect(noReason?.code).toBe("VALIDATION");
    expect(noReason?.fieldErrors?.reason).toBeTruthy();
    await updateTask(PM(), id, { requiresReview: false, reason: "Tugas administratif" });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "training.task.update", entityId: pid }, orderBy: { id: "desc" } });
    expect(audit.reason).toBe("Tugas administratif");
    expect((await listComments(PM(), id)).at(-1)!.body).toMatch(/kewajiban pemeriksaan aktif → tidak aktif — alasan: Tugas administratif/);
    // saat sedang menunggu pemeriksaan: tidak boleh dimatikan
    const id2 = await mk(fx.empIds[1]);
    await st(STAFF(), id2, "IN_REVIEW");
    expect((await fail(updateTask(PM(), id2, { requiresReview: false, reason: "Ingin dilewati" })))?.code).toBe("CONFLICT");
  });

  it("sebelum dimulai, pengelola lain mematikannya tanpa alasan; menyalakan kembali setelah dimulai juga wajib alasan", async () => {
    const id = await mk(fx.empIds[1], { requiresReview: false });
    await updateTask(PM(), id, { requiresReview: true });                        // belum dimulai → bebas
    await st(STAFF(), id, "IN_PROGRESS");
    expect((await fail(updateTask(PM(), id, { requiresReview: false })))?.code).toBe("VALIDATION");
  });
});

describe("penjaga database (trigger)", () => {
  async function inReviewBy(submitter: typeof fx.emp1, assignee: string) {
    const id = await mk(assignee);
    await st(submitter, id, "IN_REVIEW");
    return id;
  }
  it("menolak status Selesai bila pemeriksa = pengirim; = pelaksana; atau loncat dari status selain Menunggu pemeriksaan", async () => {
    const id = await inReviewBy(PM(), fx.empIds[1]);                             // pengirim PIC, pelaksana staf
    await expect(prisma.trainingTask.update({ where: { id }, data: { status: "DONE", completedById: PM().userId } })).rejects.toThrow(/HRIS-GUARD[^]*mengirim hasil/);
    await expect(prisma.trainingTask.update({ where: { id }, data: { status: "DONE", completedById: STAFF().userId } })).rejects.toThrow(/HRIS-GUARD[^]*pelaksana/);
    await expect(prisma.trainingTask.update({ where: { id }, data: { status: "DONE" } })).rejects.toThrow(/HRIS-GUARD[^]*wajib tercatat/);
    const other = await mk(fx.empIds[1]);
    await expect(prisma.trainingTask.update({ where: { id: other }, data: { status: "DONE", completedById: fx.mgr.userId } })).rejects.toThrow(/HRIS-GUARD[^]*Menunggu pemeriksaan/);
    // pemeriksa yang sah lolos
    await prisma.trainingTask.update({ where: { id }, data: { status: "DONE", completedAt: new Date(), completedById: fx.mgr.userId, reviewedById: fx.mgr.userId } });
    expect((await row(id)).status).toBe("DONE");
  });
  it("tugas tanpa kewajiban periksa tidak terpengaruh", async () => {
    const id = await mk(fx.empIds[1], { requiresReview: false });
    await prisma.trainingTask.update({ where: { id }, data: { status: "DONE", completedAt: new Date(), completedById: STAFF().userId } });
    expect((await row(id)).status).toBe("DONE");
  });
});

describe("migrasi: data lama", () => {
  it("tugas yang SEDANG menunggu pemeriksaan diisi pengirimnya dari audit; yang Selesai tidak diubah", async () => {
    const sql = readFileSync("prisma/migrations/20261111100000_task_review_separation/migration.sql", "utf8");
    const stmt = sql.match(/UPDATE "training_tasks" t SET[\s\S]*?;/)![0];
    const waiting = await mk(fx.empIds[1]);
    const finished = await mk(fx.empIds[1]);
    await st(STAFF(), waiting, "IN_REVIEW");
    await st(STAFF(), finished, "IN_REVIEW"); await st(PM(), finished, "DONE");
    // tiru data lama: kolom baru kosong
    await prisma.trainingTask.updateMany({ data: { submittedById: null, submittedAt: null, assigneeAtSubmitId: null } });
    const before = await row(finished);
    await prisma.$executeRawUnsafe(stmt);
    expect(await row(waiting)).toMatchObject({ submittedById: STAFF().userId, assigneeAtSubmitId: fx.empIds[1] });
    expect((await row(waiting)).submittedAt).not.toBeNull();
    expect(await row(finished)).toMatchObject({ submittedById: before.submittedById, assigneeAtSubmitId: before.assigneeAtSubmitId }); // tidak diubah (masih kosong)
    // setelah terisi, aturan berlaku untuk data lama
    expect((await getTask(STAFF(), waiting)).allowedNext).not.toContain("DONE");
  });
});
