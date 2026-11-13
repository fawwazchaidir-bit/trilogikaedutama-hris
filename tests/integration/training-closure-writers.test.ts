/**
 * Penutupan proyek vs SEMUA jalur tulis proyek (bukan hanya tugas/checklist/anggota): jadwal, peserta, instruktur, dokumen, milestone, kesiapan, jam kerja,
 * template indikator, dan catatan pemulihan. Proyek yang Selesai harus menjadi BACA-SAJA — tidak ada penulis yang commit sesudah penutupan commit.
 *
 * Sebelumnya jalur-jalur ini hanya memakai pemeriksaan status di AWAL service (sebelum transaksi) sehingga penulis yang sudah lolos pemeriksaan itu dapat menyimpan data
 * hampir bersamaan dengan penutupan (terbukti: jadwal dan peserta tersimpan di proyek yang berstatus Selesai). Kini semuanya mengambil kunci proyek BERSAMA sebagai
 * langkah pertama transaksi dan membaca ulang status.
 *
 * Skenario tiap jalur (deterministik): penutupan sungguhan dijalankan dengan trigger uji yang menahan UPDATE status proyek 1,5 dtk (ia sudah memegang kunci eksklusif);
 * 0,5 dtk kemudian penulis mulai — pemeriksaan awalnya masih melihat status Berjalan. Penulis harus MENUNGGU penutupan lalu ditolak dengan pesan jelas
 * (CONFLICT "sudah ditutup"), dan tidak ada yang tersimpan. Pada kode lama penulis langsung berhasil.
 * Skenario sebaliknya: penulis yang sedang menyimpan memegang kunci bersama → penutupan MENUNGGU penulis selesai (urutan sah: tulis dulu, tutup kemudian).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { resetDb } from "../helpers/db";
import { addTeam, mkProject, PDF, seedTraining, inDays, type TrainingFixtures } from "../helpers/training";
import { changeProjectStatus, closeProject } from "@/server/services/training/projects";
import {
  addParticipant, assignInstructor, createInstructor, createSchedule, deleteDocument, removeProjectInstructor, updateParticipant, updateProjectInstructor, updateSchedule, uploadDocument,
} from "@/server/services/training/operations";
import {
  addMilestone, addReadinessItem, addWorkloadTask, applyIndicatorTemplates, completeMilestone, regenerateProjectWorkload, removeReadinessItem, reopenMilestone, setReadinessStatus,
  updateMilestone, updateWorkloadTask,
} from "@/server/services/training/indicator-data";
import { addRecoveryNote } from "@/server/services/training/recovery";

let fx: TrainingFixtures;
const [AYU, BUDI, CITRA] = [0, 1, 2] as const;
const sum = { summary: "Pelatihan selesai dengan baik" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
interface Res { ok: boolean; err?: unknown; at: number }
const settle = (p: Promise<unknown>): Promise<Res> => p.then(() => ({ ok: true, at: Date.now() }), (err) => ({ ok: false, err, at: Date.now() }));
const why = (r: Res) => (r.ok ? "ok" : r.err instanceof AppError ? `${r.err.code}: ${r.err.message}` : `GALAT MENTAH: ${String((r.err as Error)?.message ?? r.err).slice(0, 140)}`);

const SLEEPERS = ["zz_close_hold", "zz_write_hold"] as const;
async function installSleeper(name: (typeof SLEEPERS)[number], table: string, seconds: number, cond?: string) {
  const events = cond ? "UPDATE" : "INSERT OR UPDATE OR DELETE";                       // WHEN yang merujuk OLD hanya sah pada trigger UPDATE
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION trg_${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(${seconds}); RETURN COALESCE(NEW, OLD); END $$`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON ${table}`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE ${events} ON ${table} FOR EACH ROW ${cond ? `WHEN (${cond}) ` : ""}EXECUTE FUNCTION trg_${name}()`);
}
const TABLES = ["training_projects", "training_schedules", "training_participants", "training_workload_tasks", "training_milestones"];
async function clearSleepers() {
  for (const n of SLEEPERS) { for (const t of TABLES) await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${n} ON ${t}`); await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS trg_${n}()`); }
}

beforeEach(async () => { await resetDb(); fx = await seedTraining(); });
afterEach(async () => { await clearSleepers(); });

/** Proyek Berjalan: Ayu = PIC, Budi = Staf, Citra = PJ Peserta. */
async function running() {
  const id = await mkProject(fx.mgr, { startDate: inDays(3), endDate: inDays(5) });
  await addTeam(fx.mgr, id, [[fx.empIds[AYU]!, "PROJECT_MANAGER"], [fx.empIds[BUDI]!, "STAFF"], [fx.empIds[CITRA]!, "PARTICIPANT_OWNER"]]);
  await changeProjectStatus(fx.mgr, id, { to: "PREPARATION" });
  await changeProjectStatus(fx.mgr, id, { to: "RUNNING" });
  return id;
}

/** Potret seluruh data proyek yang disentuh jalur-jalur ini (urut, tanpa kolom waktu) — harus IDENTIK sebelum/sesudah penulis yang ditolak. */
async function snapshot(id: string) {
  const w = { where: { projectId: id }, orderBy: { id: "asc" as const } };
  const strip = <T extends Record<string, unknown>>(rows: T[]) => rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !/At$|Date$/.test(k) || k === "doneAt")));
  return JSON.parse(JSON.stringify({
    schedules: strip(await prisma.trainingSchedule.findMany(w)), participants: strip(await prisma.trainingParticipant.findMany(w)), instructors: strip(await prisma.trainingProjectInstructor.findMany(w)),
    documents: strip(await prisma.trainingProjectDocument.findMany(w)), milestones: strip(await prisma.trainingMilestone.findMany(w)), readiness: strip(await prisma.trainingReadinessItem.findMany(w)),
    workload: strip(await prisma.trainingWorkloadTask.findMany(w)), recovery: strip(await prisma.trainingRecoveryNote.findMany(w)),
  }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

interface Case { name: string; prepare: (id: string) => Promise<() => Promise<unknown>> }
const noop = async () => undefined;
const CASES: Case[] = [
  { name: "buat jadwal", prepare: async (id) => () => createSchedule(fx.emp1, id, { title: "Sesi susulan", date: inDays(4), startTime: "09:00", endTime: "10:00" }) },
  { name: "ubah jadwal", prepare: async (id) => { const s = await createSchedule(fx.emp1, id, { title: "Sesi awal", date: inDays(4), startTime: "09:00", endTime: "10:00" }); return () => updateSchedule(fx.emp1, s.id, { title: "Sesi diubah" }); } },
  { name: "tambah peserta", prepare: async (id) => () => addParticipant(fx.emp3, id, { fullName: "Peserta Susulan", organization: "PT Uji" }) },
  { name: "ubah peserta", prepare: async (id) => { const p = await addParticipant(fx.emp3, id, { fullName: "Peserta Awal", organization: "PT Uji" }); return () => updateParticipant(fx.emp3, p.id, { note: "Catatan susulan" }); } },
  { name: "tugaskan instruktur", prepare: async (id) => { const i = await createInstructor(fx.mgr, { name: "Dr. Uji", kind: "INSTRUCTOR" }); return () => assignInstructor(fx.mgr, id, { instructorId: i.id, kind: "INSTRUCTOR" }); } },
  { name: "ubah penugasan instruktur", prepare: async (id) => { const i = await createInstructor(fx.mgr, { name: "Dr. Uji", kind: "INSTRUCTOR" }); const a = await assignInstructor(fx.mgr, id, { instructorId: i.id, kind: "INSTRUCTOR" }); return () => updateProjectInstructor(fx.mgr, id, a.id, { confirmation: "CONFIRMED" }); } },
  { name: "lepas instruktur", prepare: async (id) => { const i = await createInstructor(fx.mgr, { name: "Dr. Uji", kind: "INSTRUCTOR" }); const a = await assignInstructor(fx.mgr, id, { instructorId: i.id, kind: "INSTRUCTOR" }); return () => removeProjectInstructor(fx.mgr, id, a.id); } },
  { name: "unggah dokumen", prepare: async (id) => () => uploadDocument(fx.emp1, id, { name: "a.pdf", bytes: PDF() }, { category: "OTHER", title: "Dokumen susulan" }) },
  { name: "hapus dokumen", prepare: async (id) => { const d = await uploadDocument(fx.emp1, id, { name: "a.pdf", bytes: PDF() }, { category: "OTHER", title: "Dokumen awal" }); return () => deleteDocument(fx.emp1, d.id); } },
  { name: "tambah milestone", prepare: async (id) => () => addMilestone(fx.mgr, id, { code: "X9", name: "Milestone susulan", anchor: "H", days: 3, weight: 1, critical: false }) },
  { name: "ubah milestone", prepare: async (id) => { const m = await addMilestone(fx.mgr, id, { code: "X9", name: "Milestone awal", anchor: "H", days: 3, weight: 1, critical: false }); return () => updateMilestone(fx.mgr, m.id, { name: "Nama milestone baru" }); } },
  { name: "selesaikan milestone", prepare: async (id) => { const m = await addMilestone(fx.mgr, id, { code: "X9", name: "Milestone awal", anchor: "H", days: 3, weight: 1, critical: false }); return () => completeMilestone(fx.mgr, m.id, { evidence: "https://bukti.example/1" }); } },
  { name: "buka kembali milestone", prepare: async (id) => { const m = await addMilestone(fx.mgr, id, { code: "X9", name: "Milestone awal", anchor: "H", days: 3, weight: 1, critical: false }); await completeMilestone(fx.mgr, m.id, { evidence: "https://bukti.example/1" }); return () => reopenMilestone(fx.mgr, m.id, { reason: "Salah tandai" }); } },
  { name: "tambah item kesiapan", prepare: async (id) => () => addReadinessItem(fx.mgr, id, { component: "MATERIAL", name: "Materi dicetak", anchor: "H", days: -1, critical: false }) },
  { name: "ubah status item kesiapan", prepare: async (id) => { const r = await addReadinessItem(fx.mgr, id, { component: "MATERIAL", name: "Materi dicetak", anchor: "H", days: -1, critical: false }); return () => setReadinessStatus(fx.mgr, r.id, { status: "DONE" }); } },
  { name: "hapus item kesiapan", prepare: async (id) => { const r = await addReadinessItem(fx.mgr, id, { component: "MATERIAL", name: "Materi dicetak", anchor: "H", days: -1, critical: false }); return () => removeReadinessItem(fx.mgr, r.id); } },
  { name: "tambah jam kerja", prepare: async (id) => () => addWorkloadTask(fx.mgr, id, { employeeId: fx.empIds[AYU], name: "Jam kerja susulan", hours: 4, startDate: inDays(3), endDate: inDays(4) }) },
  { name: "ubah jam kerja", prepare: async (id) => { const w = await addWorkloadTask(fx.mgr, id, { employeeId: fx.empIds[AYU], name: "Jam kerja awal", hours: 4, startDate: inDays(3), endDate: inDays(4) }); return () => updateWorkloadTask(fx.mgr, w.id, { hours: 9 }); } },
  { name: "hitung ulang jam kerja", prepare: async (id) => () => regenerateProjectWorkload(fx.mgr, id) },
  { name: "terapkan template indikator", prepare: async (id) => () => applyIndicatorTemplates(fx.mgr, id) },
  { name: "catatan pemulihan", prepare: async (id) => () => addRecoveryNote(fx.mgr, id, { kind: "OTHER", body: "Catatan pemulihan susulan" }) },
];
void noop;

describe("penutupan lebih dulu: penulis yang sudah lolos pemeriksaan awal MENUNGGU lalu DITOLAK; tidak ada yang tersimpan", () => {
  it.each(CASES)("$name", async (c) => {
    const id = await running();
    const op = await c.prepare(id);
    const before = await snapshot(id);
    await installSleeper("zz_close_hold", "training_projects", 1.5, `OLD."status" IS DISTINCT FROM NEW."status"`);
    const closer = settle(closeProject(fx.mgr, id, sum));
    await sleep(500);                                   // penutup sudah memegang kunci eksklusif dan menunggu di dalam UPDATE status
    const writer = await settle(op());                  // pemeriksaan awal penulis masih melihat Berjalan
    const closed = await closer;
    expect(closed.ok, `penutupan: ${why(closed)}`).toBe(true);
    expect(why(writer)).toMatch(/^CONFLICT: Proyek sudah ditutup \(Selesai\)/);
    expect(writer.at, "penulis harus menunggu penutupan selesai").toBeGreaterThanOrEqual(closed.at - 30);
    expect(await snapshot(id)).toEqual(before);
    expect((await prisma.trainingProject.findUniqueOrThrow({ where: { id } })).status).toBe("COMPLETED");
  }, 60_000);
});

describe("penulis lebih dulu: penutupan MENUNGGU penulis yang sedang menyimpan (kunci bersama), lalu proyek Selesai dengan data itu tersimpan", () => {
  const WRITERS: { name: string; table: string; op: (id: string) => Promise<unknown> }[] = [
    { name: "jadwal", table: "training_schedules", op: (id) => createSchedule(fx.emp1, id, { title: "Sesi lambat", date: inDays(4), startTime: "09:00", endTime: "10:00" }) },
    { name: "peserta", table: "training_participants", op: (id) => addParticipant(fx.emp3, id, { fullName: "Peserta lambat", organization: "PT Uji" }) },
    { name: "milestone", table: "training_milestones", op: (id) => addMilestone(fx.mgr, id, { code: "X8", name: "Milestone lambat", anchor: "H", days: 3, weight: 1, critical: false }) },
    { name: "jam kerja", table: "training_workload_tasks", op: (id) => addWorkloadTask(fx.mgr, id, { employeeId: fx.empIds[AYU], name: "Jam kerja lambat", hours: 4, startDate: inDays(3), endDate: inDays(4) }) },
  ];
  it.each(WRITERS)("$name", async (w) => {
    const id = await running();
    await installSleeper("zz_write_hold", w.table, 1.5);
    const writer = settle(w.op(id));
    await sleep(500);                                   // penulis sudah lolos pemeriksaan awal, memegang kunci bersama, dan sedang menyimpan
    const closed = await settle(closeProject(fx.mgr, id, sum));
    const wr = await writer;
    expect(wr.ok, `penulis: ${why(wr)}`).toBe(true);
    expect(closed.ok, `penutupan: ${why(closed)}`).toBe(true);
    expect(closed.at, "penutupan harus menunggu penulis (kunci eksklusif menunggu kunci bersama)").toBeGreaterThanOrEqual(wr.at - 30);
    expect((await prisma.trainingProject.findUniqueOrThrow({ where: { id } })).status).toBe("COMPLETED");
  }, 60_000);
});
