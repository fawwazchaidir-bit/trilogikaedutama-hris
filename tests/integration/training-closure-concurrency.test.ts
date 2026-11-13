/**
 * Penutupan proyek vs perubahan BERSAMAAN — koneksi basis data yang benar-benar serentak (pool Prisma), bukan urutan berurutan.
 *
 * Risiko: pemeriksaan "proyek masih boleh diubah" dilakukan SEBELUM transaksi tulis, sedangkan penutupan membaca daftar tugas/checklist lalu mengubah status proyek.
 * Tanpa serialisasi, perubahan yang masuk di antara keduanya lolos diam-diam (tugas terbuka menggantung di proyek Selesai, checklist wajib tidak lagi lengkap pada
 * proyek yang ditutup "bersih", pelonggaran belum diakui, proyek Selesai sekaligus Dibatalkan).
 *
 * Agar balapan terjadi sungguhan (bukan kebetulan), jendelanya DILEBARKAN dengan trigger uji yang menunda INSERT/UPDATE tugas, checklist, dan proyek; setiap skenario
 * dijalankan pada beberapa selisih waktu mulai (penulis lebih dulu, bersamaan, dan menyusul). Yang diperiksa adalah INVARIAN akhir + kejelasan galat penolakan.
 *
 * Aturan yang harus berlaku untuk SETIAP urutan:
 *  - penulis berhasil lebih dulu → penutupan membaca data terbaru dan meminta keputusan / menolak dengan pesan jelas;
 *  - penutupan berhasil lebih dulu → perubahan yang tak lagi diizinkan ditolak dengan pesan jelas (AppError CONFLICT, bukan galat basis data mentah);
 *  - tugas tindak lanjut tetap dapat dikerjakan setelah proyek Selesai.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { resetDb } from "../helpers/db";
import { addTeam, inDays, mkProject, seedTraining, type TrainingFixtures } from "../helpers/training";
import { cancelProject, changeProjectStatus, closeProject } from "@/server/services/training/projects";
import { addChecklistItem, changeTaskStatus, createTask, deleteChecklistItem, updateChecklistItem, updateTask } from "@/server/services/training/work";

let fx: TrainingFixtures;
const OPEN = ["TODO", "IN_PROGRESS", "IN_REVIEW"] as const;
const OFFSETS = [-150, 0, 100, 250, 450];                 // ms: negatif = penulis mulai lebih dulu; positif = penulis menyusul
const sum = { summary: "Pelatihan selesai dengan baik" };
const [AYU, BUDI] = [0, 1] as const;

beforeEach(async () => { await resetDb(); fx = await seedTraining(); });
afterEach(async () => { await clearSlow(); });

// ───────── pelebar jendela balapan ─────────
const SLOW = [
  { table: "training_projects", event: "UPDATE", ms: 400 },
  { table: "training_tasks", event: "INSERT OR UPDATE", ms: 200 },
  { table: "training_project_checklist_items", event: "INSERT OR UPDATE OR DELETE", ms: 200 },
];
async function slow(list: typeof SLOW = SLOW) {
  await clearSlow();
  for (const s of list) {
    const i = SLOW.findIndex((x) => x.table === s.table);
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION test_slow_${i}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(${s.ms / 1000}); RETURN COALESCE(NEW, OLD); END $$`);
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_slow_${i} ON ${s.table}`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER test_slow_${i} BEFORE ${s.event} ON ${s.table} FOR EACH ROW EXECUTE FUNCTION test_slow_${i}()`);
  }
}
async function clearSlow() {
  for (const [i, s] of SLOW.entries()) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_slow_${i} ON ${s.table}`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_slow_${i}()`);
  }
}

// ───────── bantuan ─────────
interface Res { ok: boolean; err?: unknown }
const settle = (p: Promise<unknown>): Promise<Res> => p.then(() => ({ ok: true }), (err) => ({ ok: false, err }));
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Jalankan penutup dan penulis SERENTAK; `offset` > 0 = penulis mulai setelah sekian ms, < 0 = penutup yang menyusul. */
async function race(closer: () => Promise<unknown>, writer: () => Promise<unknown>, offset: number): Promise<[Res, Res]> {
  const a = (offset < 0 ? delay(-offset) : Promise.resolve()).then(closer);
  const b = (offset > 0 ? delay(offset) : Promise.resolve()).then(writer);
  return [await settle(a), await settle(b)];
}
const why = (r: Res) => (r.ok ? "ok" : r.err instanceof AppError ? `${r.err.code}: ${r.err.message}` : `GALAT MENTAH: ${String((r.err as Error)?.message ?? r.err).slice(0, 140)}`);
/** Penolakan harus berupa AppError CONFLICT dengan pesan yang dapat dipahami pengguna. */
const cleanConflict = (r: Res, msg: RegExp) => !r.ok && r.err instanceof AppError && r.err.code === "CONFLICT" && msg.test(r.err.message);

async function running(withTeam = true) {
  const id = await mkProject(fx.mgr, { startDate: inDays(3), endDate: inDays(5) });
  if (withTeam) await addTeam(fx.mgr, id, [[fx.empIds[AYU]!, "PROJECT_MANAGER"], [fx.empIds[BUDI]!, "STAFF"]]);
  await changeProjectStatus(fx.mgr, id, { to: "PREPARATION" });
  await changeProjectStatus(fx.mgr, id, { to: "RUNNING" });
  return id;
}
const state = async (id: string) => ({
  project: await prisma.trainingProject.findUniqueOrThrow({ where: { id } }),
  tasks: await prisma.trainingTask.findMany({ where: { projectId: id } }),
  items: await prisma.trainingProjectChecklistItem.findMany({ where: { projectId: id } }),
  relax: await prisma.trainingChecklistRelaxation.findMany({ where: { projectId: id } }),
});
/** Kumpulkan pelanggaran per selisih waktu; `body` mengembalikan daftar pelanggaran (kosong = aman). */
async function sweep(body: (offset: number) => Promise<string[]>, list: typeof SLOW = SLOW) {
  await slow(list);
  const problems: string[] = [];
  for (const d of OFFSETS) for (const p of await body(d)) problems.push(`[selisih ${d} ms] ${p}`);
  expect(problems).toEqual([]);
}
/** Invarian umum proyek Selesai: tidak ada tugas terbuka non-tindak-lanjut; checklist wajib lengkap bila ditutup bersih; semua pelonggaran sudah diakui. */
function closedInvariants(s: Awaited<ReturnType<typeof state>>): string[] {
  const out: string[] = [];
  if (s.project.status !== "COMPLETED") return out;
  const orphans = s.tasks.filter((t) => (OPEN as readonly string[]).includes(t.status) && !t.isFollowUp);
  if (orphans.length) out.push(`proyek Selesai tetapi ada ${orphans.length} tugas terbuka yang tidak diputuskan (${orphans.map((t) => t.title).join(", ")})`);
  const outstanding = s.items.filter((i) => i.isRequired && !i.isDone);
  if (s.project.closureOverrideReason === null && outstanding.length) out.push(`ditutup BERSIH padahal checklist wajib belum selesai (${outstanding.map((i) => i.title).join(", ")})`);
  const unacked = s.relax.filter((r) => r.acknowledgedAt === null);
  if (unacked.length) out.push(`proyek Selesai tetapi ${unacked.length} pelonggaran checklist wajib belum diakui (${unacked.map((r) => r.itemTitle).join(", ")})`);
  return out;
}

describe("tutup proyek × tambah tugas", () => {
  it("tugas baru yang masuk bersamaan: ikut diputuskan (penutupan ditolak sampai diputuskan) ATAU penambahan ditolak karena proyek sudah ditutup", async () => {
    await sweep(async (d) => {
      const id = await running();
      const [c, w] = await race(() => closeProject(fx.mgr, id, sum), () => createTask(fx.mgr, id, { title: `Tugas serentak ${d}`, assigneeId: fx.empIds[BUDI], dueDate: inDays(9) }), d);
      const s = await state(id);
      const out = closedInvariants(s);
      if ([c.ok, w.ok].filter(Boolean).length !== 1) out.push(`harus tepat satu yang berhasil: penutup=${why(c)} | penambah=${why(w)}`);
      if (!c.ok && !cleanConflict(c, /belum diputuskan/)) out.push(`penutupan ditolak tanpa pesan keputusan tugas: ${why(c)}`);
      if (!w.ok && !cleanConflict(w, /ditutup|Selesai/)) out.push(`penambahan tugas ditolak tanpa pesan yang jelas: ${why(w)}`);
      return out;
    });
  }, 180_000);
});

describe("tutup proyek × ubah status tugas", () => {
  it("membuka kembali tugas Selesai bersamaan dengan penutupan: tugas terbuka tidak boleh menggantung di proyek Selesai", async () => {
    await sweep(async (d) => {
      const id = await running();
      const x = await createTask(fx.mgr, id, { title: "Sudah beres", assigneeId: fx.empIds[BUDI], dueDate: inDays(9) });
      await changeTaskStatus(fx.emp2, x.id, { status: "IN_PROGRESS" });
      await changeTaskStatus(fx.emp2, x.id, { status: "DONE" });
      const [c, w] = await race(() => closeProject(fx.mgr, id, sum), () => changeTaskStatus(fx.mgr, x.id, { status: "IN_PROGRESS" }), d);
      const out = closedInvariants(await state(id));
      if ([c.ok, w.ok].filter(Boolean).length !== 1) out.push(`harus tepat satu yang berhasil: penutup=${why(c)} | pengubah=${why(w)}`);
      if (!c.ok && !cleanConflict(c, /belum diputuskan/)) out.push(`penutupan ditolak tanpa pesan keputusan tugas: ${why(c)}`);
      if (!w.ok && !cleanConflict(w, /ditutup|Selesai/)) out.push(`perubahan status ditolak tanpa pesan yang jelas: ${why(w)}`);
      return out;
    });
  }, 180_000);

  it("tugas yang diputuskan DIBATALKAN lalu diselesaikan penanggung jawab bersamaan: hasil konsisten (dibatalkan oleh penutupan, atau penutupan ditolak karena daftar berubah)", async () => {
    await sweep(async (d) => {
      const id = await running();
      const z = await createTask(fx.mgr, id, { title: "Foto dokumentasi", assigneeId: fx.empIds[BUDI], dueDate: inDays(9) });
      const [c, w] = await race(
        () => closeProject(fx.mgr, id, { ...sum, taskDecisions: [{ taskId: z.id, action: "CANCEL", reason: "Tidak didokumentasikan" }] }),
        () => changeTaskStatus(fx.emp2, z.id, { status: "DONE" }), d);
      const s = await state(id);
      const out = closedInvariants(s);
      const status = s.tasks.find((t) => t.id === z.id)!.status;
      if (s.project.status === "COMPLETED" && status !== "CANCELLED") out.push(`proyek Selesai tetapi keputusan batal tidak berlaku (status tugas ${status})`);
      if (s.project.status === "RUNNING" && status !== "DONE") out.push(`penutupan ditolak tetapi tugas tidak berstatus Selesai (status ${status}; penutup=${why(c)} | pengubah=${why(w)})`);
      if ([c.ok, w.ok].filter(Boolean).length !== 1) out.push(`harus tepat satu yang berhasil: penutup=${why(c)} | pengubah=${why(w)}`);
      if (!c.ok && !cleanConflict(c, /berubah|belum diputuskan|Muat ulang/)) out.push(`penutupan ditolak tanpa pesan yang jelas: ${why(c)}`);
      if (!w.ok && !cleanConflict(w, /ditutup|Selesai|dikunci|tidak dapat diubah/)) out.push(`perubahan status ditolak tanpa pesan yang jelas: ${why(w)}`);
      return out;
    });
  }, 180_000);

  it("tindak lanjut tetap dapat dikerjakan: penanggung jawab mengubah status tugas yang sedang diputuskan menjadi tindak lanjut — keduanya berhasil, di urutan mana pun", async () => {
    await sweep(async (d) => {
      const id = await running();
      const y = await createTask(fx.mgr, id, { title: "Kirim sertifikat", assigneeId: fx.empIds[BUDI], dueDate: inDays(9) });
      const [c, w] = await race(
        () => closeProject(fx.mgr, id, { ...sum, taskDecisions: [{ taskId: y.id, action: "FOLLOW_UP", dueDate: inDays(9) }] }),
        () => changeTaskStatus(fx.emp2, y.id, { status: "IN_PROGRESS" }), d);
      const s = await state(id);
      const out = closedInvariants(s);
      const t = s.tasks.find((x) => x.id === y.id)!;
      if (!c.ok) out.push(`penutupan gagal: ${why(c)}`);
      if (!w.ok) out.push(`tindak lanjut tidak dapat dikerjakan: ${why(w)}`);
      if (s.project.status === "COMPLETED" && !t.isFollowUp) out.push("proyek Selesai tetapi tugas tidak ditandai tindak lanjut");
      return out;
    });
  }, 180_000);

  it("mengubah isi tugas (tenggat/penanggung jawab) bersamaan dengan penutupan: tidak lolos ke proyek Selesai kecuali tindak lanjut", async () => {
    await sweep(async (d) => {
      const id = await running();
      const x = await createTask(fx.mgr, id, { title: "Sudah beres", assigneeId: fx.empIds[BUDI], dueDate: inDays(9) });
      await changeTaskStatus(fx.emp2, x.id, { status: "IN_PROGRESS" });
      await changeTaskStatus(fx.emp2, x.id, { status: "DONE" });
      const before = (await state(id)).tasks.find((t) => t.id === x.id)!;
      const [c, w] = await race(() => closeProject(fx.mgr, id, sum), () => updateTask(fx.mgr, x.id, { title: "Judul diubah setelah ditutup" }), d);
      const s = await state(id);
      const out = closedInvariants(s);
      const after = s.tasks.find((t) => t.id === x.id)!;
      // Perubahan yang berhasil harus sudah commit SEBELUM penutupan (dikunci sesudahnya); yang ditolak tidak boleh meninggalkan perubahan.
      if (!w.ok && after.title !== before.title) out.push("perubahan ditolak tetapi judul tugas tetap berubah");
      if (w.ok && s.project.status === "COMPLETED" && after.updatedAt.getTime() > s.project.closedAt!.getTime()) out.push("tugas pada proyek Selesai (bukan tindak lanjut) berubah SETELAH proyek ditutup");
      if (w.ok && after.title === before.title) out.push("perubahan dinyatakan berhasil tetapi tidak tersimpan");
      if (!c.ok && !w.ok) out.push(`keduanya gagal: penutup=${why(c)} | pengubah=${why(w)}`);
      if (!w.ok && !cleanConflict(w, /ditutup|Selesai|dikunci/)) out.push(`ubah tugas ditolak tanpa pesan yang jelas: ${why(w)}`);
      return out;
    });
  }, 180_000);
});

describe("tutup proyek × ubah checklist wajib", () => {
  it("membuka kembali checklist wajib yang sudah selesai: tidak boleh ditutup 'bersih' padahal wajib kembali belum selesai", async () => {
    await sweep(async (d) => {
      const id = await running();
      const r = await addChecklistItem(fx.mgr, id, { phase: "CLOSING", title: "Laporan disusun", isRequired: true });
      await updateChecklistItem(fx.mgr, r.id, { isDone: true });
      const [c, w] = await race(() => closeProject(fx.mgr, id, sum), () => updateChecklistItem(fx.mgr, r.id, { isDone: false }), d);
      const out = closedInvariants(await state(id));
      if ([c.ok, w.ok].filter(Boolean).length !== 1) out.push(`harus tepat satu yang berhasil: penutup=${why(c)} | pengubah=${why(w)}`);
      if (!c.ok && !cleanConflict(c, /checklist wajib/)) out.push(`penutupan ditolak tanpa pesan checklist wajib: ${why(c)}`);
      if (!w.ok && !cleanConflict(w, /ditutup|Selesai|dikunci/)) out.push(`ubah checklist ditolak tanpa pesan yang jelas: ${why(w)}`);
      return out;
    });
  }, 180_000);

  it("melonggarkan checklist wajib (tidak wajib, dengan alasan) bersamaan dengan penutupan: pelonggaran harus diakui, atau perubahan ditolak karena proyek sudah ditutup", async () => {
    await sweep(async (d) => {
      const id = await running();
      const r = await addChecklistItem(fx.mgr, id, { phase: "CLOSING", title: "Laporan disusun", isRequired: true });
      await updateChecklistItem(fx.mgr, r.id, { isDone: true });
      const [c, w] = await race(() => closeProject(fx.mgr, id, sum), () => updateChecklistItem(fx.mgr, r.id, { isRequired: false, reason: "Klien tidak meminta laporan" }), d);
      const out = closedInvariants(await state(id));
      if ([c.ok, w.ok].filter(Boolean).length !== 1) out.push(`harus tepat satu yang berhasil: penutup=${why(c)} | pelonggar=${why(w)}`);
      if (!c.ok && !cleanConflict(c, /dilonggarkan|pengakuan/)) out.push(`penutupan ditolak tanpa pesan pengakuan pelonggaran: ${why(c)}`);
      if (!w.ok && !cleanConflict(w, /ditutup|Selesai|dikunci/)) out.push(`pelonggaran ditolak tanpa pesan yang jelas: ${why(w)}`);
      return out;
    });
  }, 180_000);

  it("menambah item checklist wajib bersamaan dengan penutupan: tidak boleh menyelinap ke proyek yang ditutup bersih", async () => {
    await sweep(async (d) => {
      const id = await running();
      const [c, w] = await race(() => closeProject(fx.mgr, id, sum), () => addChecklistItem(fx.mgr, id, { phase: "CLOSING", title: `Item wajib serentak ${d}`, isRequired: true }), d);
      const out = closedInvariants(await state(id));
      if ([c.ok, w.ok].filter(Boolean).length !== 1) out.push(`harus tepat satu yang berhasil: penutup=${why(c)} | penambah=${why(w)}`);
      if (!c.ok && !cleanConflict(c, /checklist wajib/)) out.push(`penutupan ditolak tanpa pesan checklist wajib: ${why(c)}`);
      if (!w.ok && !cleanConflict(w, /ditutup|Selesai|dikunci/)) out.push(`tambah item ditolak tanpa pesan yang jelas: ${why(w)}`);
      return out;
    });
  }, 180_000);

  it("menghapus item checklist wajib (beralasan) bersamaan dengan penutupan: dicatat & diakui, atau ditolak karena proyek sudah ditutup", async () => {
    await sweep(async (d) => {
      const id = await running();
      const r = await addChecklistItem(fx.mgr, id, { phase: "CLOSING", title: "Berita acara", isRequired: true });
      const [c, w] = await race(
        () => closeProject(fx.mgr, id, { ...sum, overrideReason: "Berita acara menyusul setelah acara" }),
        () => deleteChecklistItem(fx.mgr, r.id, { reason: "Digantikan dokumen lain" }), d);
      const s = await state(id);
      const out = closedInvariants(s);
      if (!c.ok && !w.ok) out.push(`keduanya gagal: penutup=${why(c)} | penghapus=${why(w)}`);
      if (!w.ok && !cleanConflict(w, /ditutup|Selesai|dikunci/)) out.push(`hapus item ditolak tanpa pesan yang jelas: ${why(w)}`);
      return out;
    });
  }, 180_000);
});

describe("tutup proyek × batalkan proyek", () => {
  it("tepat satu yang menang; yang kalah ditolak dengan pesan jelas; keadaan akhir utuh (tidak Selesai sekaligus Dibatalkan, tugas yang diputuskan hanya berubah bila penutupan menang)", async () => {
    await sweep(async (d) => {
      const id = await running();
      const z = await createTask(fx.mgr, id, { title: "Tugas menggantung", assigneeId: fx.empIds[BUDI], dueDate: inDays(9) });
      const [c, w] = await race(
        () => closeProject(fx.mgr, id, { ...sum, taskDecisions: [{ taskId: z.id, action: "CANCEL", reason: "Dibatalkan saat penutupan" }] }),
        () => cancelProject(fx.mgr, id, { reason: "Klien membatalkan seluruh kegiatan" }), d);
      const s = await state(id);
      const out = closedInvariants(s);
      const p = s.project;
      const t = s.tasks.find((x) => x.id === z.id)!;
      if ([c.ok, w.ok].filter(Boolean).length !== 1) out.push(`harus tepat satu yang menang: penutup=${why(c)} | pembatal=${why(w)}`);
      if (p.status === "COMPLETED" && (p.cancelledAt || p.cancelReason || p.cancelledById)) out.push("proyek Selesai tetapi berisi data pembatalan");
      if (p.status === "CANCELLED" && (p.closedAt || p.closureSummary || p.closedById)) out.push("proyek Dibatalkan tetapi berisi data penutupan");
      if (p.status === "COMPLETED" && t.status !== "CANCELLED") out.push(`penutupan menang tetapi keputusan tugas tidak diterapkan (status ${t.status})`);
      if (p.status === "CANCELLED" && t.status !== "TODO") out.push(`pembatalan menang tetapi tugas berubah (status ${t.status}) — penutupan yang gagal harus ter-rollback penuh`);
      if (!["COMPLETED", "CANCELLED"].includes(p.status)) out.push(`proyek tidak berakhir di status final (${p.status})`);
      if (!c.ok && !cleanConflict(c, /baru saja diubah|dibatalkan|Hanya proyek berstatus/)) out.push(`penutupan ditolak tanpa pesan yang jelas: ${why(c)}`);
      if (!w.ok && !cleanConflict(w, /ditutup|Selesai|baru saja diubah|dikunci/)) out.push(`pembatalan ditolak tanpa pesan yang jelas: ${why(w)}`);
      return out;
    });
  }, 180_000);
});

describe("batalkan proyek × perubahan bersamaan", () => {
  it("penulis yang masih berjalan saat pembatalan: tugas tidak boleh tercipta SETELAH proyek dibatalkan (penulis ditolak dengan pesan jelas, atau selesai sebelum pembatalan)", async () => {
    // Penulis sengaja LAMBAT setelah lolos pemeriksaan (INSERT tugas 700 ms) agar ia commit sesudah pembatalan bila tidak ada serialisasi.
    const list = [{ table: "training_projects", event: "UPDATE", ms: 100 }, { table: "training_tasks", event: "INSERT OR UPDATE", ms: 700 }];
    await sweep(async (d) => {
      const id = await running();
      const [c, w] = await race(() => cancelProject(fx.mgr, id, { reason: "Klien membatalkan seluruh kegiatan" }), () => createTask(fx.mgr, id, { title: `Tugas serentak ${d}`, assigneeId: fx.empIds[BUDI], dueDate: inDays(9) }), d);
      const s = await state(id);
      const out: string[] = [];
      const cancelAudit = await prisma.auditLog.findFirst({ where: { action: "training.project.cancel", entityId: id } });
      const taskAudit = await prisma.auditLog.findFirst({ where: { action: "training.task.create", entityId: id } });
      if (!c.ok) out.push(`pembatalan gagal: ${why(c)}`);
      if (s.project.status !== "CANCELLED") out.push(`proyek tidak berstatus Dibatalkan (${s.project.status})`);
      if (cancelAudit && taskAudit && taskAudit.id > cancelAudit.id) out.push("tugas dibuat SETELAH proyek dibatalkan (menyelinap melewati kunci)");
      if (!w.ok && !cleanConflict(w, /dibatalkan|dikunci/)) out.push(`penambahan tugas ditolak tanpa pesan yang jelas: ${why(w)}`);
      return out;
    }, list);
  }, 180_000);
});
