/**
 * Training & Operations — "baca sebelum kunci": keputusan hak (penanggung jawab / PIC / pelaksana) dan nilai yang ditulis harus berasal dari baris yang dibaca DI DALAM
 * transaksi setelah baris itu dikunci, bukan dari bacaan sebelum transaksi.
 *
 * Temuan sebelumnya (terbukti dengan dua koneksi serentak):
 *   · Butir 2 — penanggung jawab lama masih dapat mengubah status tepat saat tugas dialihkan: hak dinilai dari penanggung jawab yang dibaca SEBELUM transaksi, sedangkan penulisan
 *     hanya mencocokkan status. Pola yang sama pada item checklist, milestone (PIC), dan item kesiapan (PIC), serta pada "ubah tugas" (status yang basi).
 *   · Butir 4b — ubah jam (11 → 13) tertimpa penandaan Selesai yang bersamaan: baris jam kerja dibaca sebelum kunci dan SEMUA kolom ditulis kembali dari nilai lama.
 *
 * Cara penyerentakan (deterministik): transaksi pembantu mengunci BARIS lalu — setelah aktor uji selesai membaca dan menunggu — mengubah baris itu dan COMMIT. Pada kode lama
 * aktor lalu menulis dari bacaannya yang basi; pada kode yang benar ia membaca ulang baris yang dikunci dan menilai ulang.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma, transaction, type Tx } from "@/server/db";
import { AppError } from "@/server/errors";
import { resetDb } from "../helpers/db";
import { addTeam, inDays, mkProject, seedTraining, type TrainingFixtures } from "../helpers/training";
import { changeProjectStatus } from "@/server/services/training/projects";
import { addChecklistItem, changeTaskStatus, createTask, updateChecklistItem, updateTask } from "@/server/services/training/work";
import { addMilestone, addReadinessItem, completeMilestone, setReadinessStatus, updateWorkloadTask } from "@/server/services/training/indicator-data";
import { defaultIndicatorConfig, type IndicatorConfig } from "@/lib/training/indicators/config";
import { saveIndicatorConfig } from "@/server/services/training/indicator-config";

let fx: TrainingFixtures;
const [AYU, BUDI, CITRA] = [0, 1, 2] as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errOf = async (p: Promise<unknown>): Promise<string> => { try { await p; return "OK"; } catch (e) { return `${e instanceof AppError ? e.code : "ERR"}: ${(e as Error).message}`; } };

beforeEach(async () => { await resetDb(); fx = await seedTraining(); });

/** Proyek Berjalan: Ayu = PIC, Budi = Staf, Citra = Admin Program. */
async function running() {
  const id = await mkProject(fx.mgr);
  await addTeam(fx.mgr, id, [[fx.empIds[AYU]!, "PROJECT_MANAGER"], [fx.empIds[BUDI]!, "STAFF"], [fx.empIds[CITRA]!, "ADMIN_PROGRAM"]]);
  await changeProjectStatus(fx.mgr, id, { to: "PREPARATION" });
  await changeProjectStatus(fx.mgr, id, { to: "RUNNING" });
  return id;
}

/**
 * Pihak lain yang MENGUBAH baris dan COMMIT saat aktor uji sudah membaca: kunci baris dulu (aktor uji menunggu di sini bila ia menulis/ mengunci baris yang sama),
 * lalu `commit()` menjalankan `mutate` dan melepas. Pakai: `const h = await mutateRowWhile(...)`; mulai aktor; `await sleep(900)`; `await h.commit()`; tunggu aktor.
 */
async function mutateRowWhile(table: string, id: string, mutate: (tx: Tx) => Promise<void>) {
  let release!: () => void; const gate = new Promise<void>((r) => (release = r));
  let locked!: () => void; const lockedP = new Promise<void>((r) => (locked = r));
  const done = transaction(async (tx) => { await tx.$executeRawUnsafe(`SELECT 1 FROM "${table}" WHERE "id" = '${id}'::uuid FOR UPDATE`); locked(); await gate; await mutate(tx); });
  await lockedP;
  return { commit: async () => { release(); await done; } };
}
async function race(table: string, rowId: string, mutate: (tx: Tx) => Promise<void>, actor: () => Promise<unknown>): Promise<string> {
  const h = await mutateRowWhile(table, rowId, mutate);
  const A = errOf(actor());
  await sleep(900);                       // aktor sudah membaca & sedang menunggu baris yang dikunci
  await h.commit();                       // perubahan pihak lain SELESAI (commit)
  return A;
}

describe("Butir 2 — hak 'penanggung jawab' dinilai dari baris yang dibaca ulang di dalam kunci", () => {
  it("tugas dialihkan Budi → Citra saat Budi mengubah status: Budi DITOLAK (bukan lagi penanggung jawab); status & penanggung jawab tidak berubah oleh Budi", async () => {
    const id = await running();
    const t = await createTask(fx.mgr, id, { title: "Siapkan materi", assigneeId: fx.empIds[BUDI], dueDate: inDays(5) });
    const rA = await race("training_tasks", t.id, (tx) => tx.trainingTask.update({ where: { id: t.id }, data: { assigneeId: fx.empIds[CITRA] } }).then(() => undefined),
      () => changeTaskStatus(fx.emp2, t.id, { status: "IN_PROGRESS" }));
    expect(rA).toMatch(/^FORBIDDEN: /);
    const row = await prisma.trainingTask.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ assigneeId: fx.empIds[CITRA], status: "TODO", completedById: null });
    expect(await prisma.auditLog.count({ where: { action: "training.task.status", entityId: id } })).toBe(0);
  }, 120_000);

  it("kirim ke pemeriksaan: pelaksana-saat-kirim tidak pernah tercatat dari data basi — Budi ditolak, pelaksana tetap kosong", async () => {
    const id = await running();
    const t = await createTask(fx.mgr, id, { title: "Susun laporan", assigneeId: fx.empIds[BUDI], dueDate: inDays(5), requiresReview: true });
    await changeTaskStatus(fx.emp2, t.id, { status: "IN_PROGRESS" });
    const rA = await race("training_tasks", t.id, (tx) => tx.trainingTask.update({ where: { id: t.id }, data: { assigneeId: fx.empIds[CITRA] } }).then(() => undefined),
      () => changeTaskStatus(fx.emp2, t.id, { status: "IN_REVIEW" }));
    expect(rA).toMatch(/^FORBIDDEN: /);
    expect(await prisma.trainingTask.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ assigneeId: fx.empIds[CITRA], status: "IN_PROGRESS", assigneeAtSubmitId: null, submittedById: null });
  }, 120_000);

  it("pengelola (PIC) tetap boleh mengubah status saat tugas dialihkan, dan pelaksana-saat-kirim = penanggung jawab SEGAR (Citra), bukan yang basi (Budi)", async () => {
    const id = await running();
    const t = await createTask(fx.mgr, id, { title: "Susun laporan", assigneeId: fx.empIds[BUDI], dueDate: inDays(5), requiresReview: true });
    await changeTaskStatus(fx.emp2, t.id, { status: "IN_PROGRESS" });
    const rA = await race("training_tasks", t.id, (tx) => tx.trainingTask.update({ where: { id: t.id }, data: { assigneeId: fx.empIds[CITRA] } }).then(() => undefined),
      () => changeTaskStatus(fx.emp1, t.id, { status: "IN_REVIEW" }));
    expect(rA).toBe("OK");
    expect(await prisma.trainingTask.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ assigneeId: fx.empIds[CITRA], status: "IN_REVIEW", assigneeAtSubmitId: fx.empIds[CITRA] });
  }, 120_000);

  it("'ubah tugas': mematikan kewajiban periksa ditolak bila tugas SEMENTARA sudah menunggu pemeriksaan (status dibaca ulang, bukan yang basi)", async () => {
    const id = await running();
    const t = await createTask(fx.mgr, id, { title: "Susun laporan", assigneeId: fx.empIds[BUDI], dueDate: inDays(5), requiresReview: true });
    await changeTaskStatus(fx.emp2, t.id, { status: "IN_PROGRESS" });
    const rA = await race("training_tasks", t.id,
      (tx) => tx.trainingTask.update({ where: { id: t.id }, data: { status: "IN_REVIEW", submittedById: fx.emp2.userId, submittedAt: new Date(), assigneeAtSubmitId: fx.empIds[BUDI] } }).then(() => undefined),
      () => updateTask(fx.emp1, t.id, { requiresReview: false, reason: "Tidak perlu diperiksa lagi" }));
    expect(rA).toMatch(/^CONFLICT: .*menunggu pemeriksaan/);
    expect(await prisma.trainingTask.findUniqueOrThrow({ where: { id: t.id } })).toMatchObject({ requiresReview: true, status: "IN_REVIEW" });
  }, 120_000);

  it("item checklist dialihkan Budi → Citra saat Budi menandainya selesai: Budi DITOLAK; item tetap belum selesai", async () => {
    const id = await running();
    const it = await addChecklistItem(fx.mgr, id, { phase: "EXECUTION", title: "Cetak materi", isRequired: false, assigneeId: fx.empIds[BUDI] });
    const rA = await race("training_project_checklist_items", it.id, (tx) => tx.trainingProjectChecklistItem.update({ where: { id: it.id }, data: { assigneeId: fx.empIds[CITRA] } }).then(() => undefined),
      () => updateChecklistItem(fx.emp2, it.id, { isDone: true }));
    expect(rA).toMatch(/^FORBIDDEN: /);
    expect(await prisma.trainingProjectChecklistItem.findUniqueOrThrow({ where: { id: it.id } })).toMatchObject({ assigneeId: fx.empIds[CITRA], isDone: false, doneById: null });
  }, 120_000);

  it("PIC milestone dialihkan Budi → Citra saat Budi menyelesaikannya: Budi DITOLAK; milestone tetap belum selesai", async () => {
    const id = await running();
    const m = await addMilestone(fx.mgr, id, { code: "X1", name: "Sertifikat terbit", anchor: "H", days: 3, weight: 5, critical: false, assigneeId: fx.empIds[BUDI] });
    const rA = await race("training_milestones", m.id, (tx) => tx.trainingMilestone.update({ where: { id: m.id }, data: { assigneeId: fx.empIds[CITRA] } }).then(() => undefined),
      () => completeMilestone(fx.emp2, m.id, { evidence: "https://bukti.example/serah-terima" }));
    expect(rA).toMatch(/^FORBIDDEN: /);
    expect(await prisma.trainingMilestone.findUniqueOrThrow({ where: { id: m.id } })).toMatchObject({ assigneeId: fx.empIds[CITRA], doneAt: null, doneById: null });
  }, 120_000);

  it("penanggung jawab item kesiapan dialihkan Budi → Citra saat Budi menandainya Selesai: Budi DITOLAK; status tetap Terbuka", async () => {
    const id = await running();
    const r = await addReadinessItem(fx.mgr, id, { component: "MATERIAL", name: "Materi dicetak", anchor: "H", days: -1, critical: false, assigneeId: fx.empIds[BUDI] });
    const rA = await race("training_readiness_items", r.id, (tx) => tx.trainingReadinessItem.update({ where: { id: r.id }, data: { assigneeId: fx.empIds[CITRA] } }).then(() => undefined),
      () => setReadinessStatus(fx.emp2, r.id, { status: "DONE" }));
    expect(rA).toMatch(/^FORBIDDEN: /);
    expect(await prisma.trainingReadinessItem.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ assigneeId: fx.empIds[CITRA], status: "OPEN" });
  }, 120_000);

  it("penanggung jawab sah tidak terganggu: tanpa pengalihan, semua jalur tetap berhasil seperti biasa", async () => {
    const id = await running();
    const t = await createTask(fx.mgr, id, { title: "Siapkan materi", assigneeId: fx.empIds[BUDI], dueDate: inDays(5) });
    expect(await errOf(changeTaskStatus(fx.emp2, t.id, { status: "IN_PROGRESS" }))).toBe("OK");
    const it = await addChecklistItem(fx.mgr, id, { phase: "EXECUTION", title: "Cetak materi", isRequired: false, assigneeId: fx.empIds[BUDI] });
    expect(await errOf(updateChecklistItem(fx.emp2, it.id, { isDone: true }))).toBe("OK");
    const m = await addMilestone(fx.mgr, id, { code: "X1", name: "Sertifikat terbit", anchor: "H", days: 3, weight: 5, critical: false, assigneeId: fx.empIds[BUDI] });
    expect(await errOf(completeMilestone(fx.emp2, m.id, { evidence: "https://bukti.example/1" }))).toBe("OK");
    const r = await addReadinessItem(fx.mgr, id, { component: "MATERIAL", name: "Materi dicetak", anchor: "H", days: -1, critical: false, assigneeId: fx.empIds[BUDI] });
    expect(await errOf(setReadinessStatus(fx.emp2, r.id, { status: "DONE" }))).toBe("OK");
  }, 120_000);

  it("tanpa gating: pengalihan × ubah status bersamaan pada lima selisih waktu mulai — tidak ada deadlock/error tak terduga; hasil akhir selalu konsisten", async () => {
    for (const offset of [0, 5, 15, 40, 90]) {
      const id = await running();
      const t = await createTask(fx.mgr, id, { title: `Siapkan materi ${offset}`, assigneeId: fx.empIds[BUDI], dueDate: inDays(5) });
      const A = async () => errOf(changeTaskStatus(fx.emp2, t.id, { status: "IN_PROGRESS" }));
      const B = async () => { await sleep(offset); return errOf(updateTask(fx.emp1, t.id, { assigneeId: fx.empIds[CITRA], reason: "Dialihkan karena beban kerja" })); };
      const [rA, rB] = await Promise.all([A(), B()]);
      for (const r of [rA, rB]) expect(r, `offset ${offset}`).toMatch(/^(OK|FORBIDDEN: .*|CONFLICT: .*)$/);
      expect(rB).toBe("OK");
      const row = await prisma.trainingTask.findUniqueOrThrow({ where: { id: t.id } });
      expect(row.assigneeId).toBe(fx.empIds[CITRA]);
      // Budi hanya berhasil bila ia memang masih penanggung jawab saat itu: status berubah ⇔ aksinya OK.
      expect(row.status === "IN_PROGRESS", `offset ${offset} status=${row.status} rA=${rA}`).toBe(rA === "OK");
    }
  }, 240_000);
});

describe("Butir 4b — jam kerja: baca di dalam kunci, tulis hanya kolom yang diubah", () => {
  async function setConfig() {
    const c: IndicatorConfig = defaultIndicatorConfig();
    c.roleHolders = {
      SPV_CURRICULUM: fx.empIds[0], MANAGER_MARKETING: fx.empIds[1], MANAGER_OPS: fx.mgrEmp, STAFF_GENERAL: fx.empIds[2], STAFF_CURRICULUM: fx.admEmp,
      STAFF_FINANCE: fx.lonerEmp, STAFF_ADMISI_2: fx.lonerEmp, STAFF_SOCIAL: fx.lonerEmp, SPV_IT: fx.empIds[2], FACILITATOR: fx.empIds[1],
    };
    c.facilitators = [fx.empIds[0], fx.empIds[1]];
    await saveIndicatorConfig(fx.superAdmin, { config: c, note: "uji" });
  }
  async function program() {
    const id = await mkProject(fx.mgr, { startDate: inDays(40), endDate: inDays(42), participantsMin: 20 });
    await addTeam(fx.mgr, id, [[fx.empIds[AYU]!, "PROJECT_MANAGER"]]);
    return id;
  }
  const openRow = async (id: string) => (await prisma.trainingWorkloadTask.findMany({ where: { projectId: id, status: "OPEN" }, orderBy: { name: "asc" } }))[0]!;

  it("ubah jam (+2) lalu pengguna lain menandai Selesai dari bacaan lama: jam BARU tetap, status Selesai (tidak tertimpa jam lama)", async () => {
    await setConfig(); const id = await program(); const target = await openRow(id);
    const rA = await race("training_workload_tasks", target.id,
      (tx) => tx.trainingWorkloadTask.update({ where: { id: target.id }, data: { hours: target.hours + 2, adjusted: true, adjustedAt: new Date() } }).then(() => undefined),
      () => updateWorkloadTask(fx.mgr, target.id, { status: "DONE" }));
    expect(rA).toBe("OK");
    expect(await prisma.trainingWorkloadTask.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ hours: target.hours + 2, status: "DONE", adjusted: true });
  }, 120_000);

  it("ubah nama oleh satu pengguna, ubah jam oleh pengguna lain secara bersamaan: KEDUANYA tersimpan (tidak saling menimpa)", async () => {
    await setConfig(); const id = await program(); const target = await openRow(id);
    const rA = await race("training_workload_tasks", target.id,
      (tx) => tx.trainingWorkloadTask.update({ where: { id: target.id }, data: { name: "Nama baru dari pengguna lain", adjusted: true, adjustedAt: new Date() } }).then(() => undefined),
      () => updateWorkloadTask(fx.mgr, target.id, { hours: target.hours + 3 }));
    expect(rA).toBe("OK");
    expect(await prisma.trainingWorkloadTask.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ name: "Nama baru dari pengguna lain", hours: target.hours + 3, adjusted: true });
  }, 120_000);

  it("'disesuaikan' dinilai dari baris SEGAR: menandai Selesai saja bukan penyesuaian, dan tidak menghapus penanda yang baru dipasang pengguna lain", async () => {
    await setConfig(); const id = await program(); const target = await openRow(id);
    expect(target.adjusted).toBe(false);
    await updateWorkloadTask(fx.mgr, target.id, { status: "DONE" });
    expect(await prisma.trainingWorkloadTask.findUniqueOrThrow({ where: { id: target.id } })).toMatchObject({ status: "DONE", adjusted: false, hours: target.hours });
  }, 120_000);

  it("tanpa gating: ubah jam × tandai selesai bersamaan pada lima selisih waktu mulai — hasil akhir SELALU jam baru + Selesai", async () => {
    await setConfig(); const id = await program();
    const rows = await prisma.trainingWorkloadTask.findMany({ where: { projectId: id, status: "OPEN" }, orderBy: { name: "asc" } });
    expect(rows.length).toBeGreaterThanOrEqual(5);
    let n = 0;
    for (const offset of [0, 5, 15, 40, 90]) {
      const target = rows[n++]!;
      const A = async () => errOf(updateWorkloadTask(fx.mgr, target.id, { hours: target.hours + 2 }));
      const B = async () => { await sleep(offset); return errOf(updateWorkloadTask(fx.mgr, target.id, { status: "DONE" })); };
      const [rA, rB] = await Promise.all([A(), B()]);
      expect([rA, rB], `offset ${offset}`).toEqual(["OK", "OK"]);
      expect(await prisma.trainingWorkloadTask.findUniqueOrThrow({ where: { id: target.id } }), `offset ${offset}`).toMatchObject({ hours: target.hours + 2, status: "DONE" });
    }
  }, 240_000);
});
