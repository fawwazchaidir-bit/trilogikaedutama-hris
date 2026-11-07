/**
 * Training & Operations — OTOMASI: snapshot status harian, eskalasi otomatis (dokumen §5.2), aturan "Kuning berturut-turut",
 * pengingat tenggat H-1 / hari-H, dan catatan pemulihan. Pekerja dipanggil langsung (`runTrainingDailyJob`) dan dijamin idempoten.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import type { Actor } from "@/server/actor";
import { addDays, endOfIsoWeek, isoWeekday, startOfIsoWeek } from "@/lib/time";
import { defaultIndicatorConfig, type IndicatorConfig } from "@/lib/training/indicators/config";
import { resetDb } from "../helpers/db";
import { addTeam, inDays, mkProject, seedTraining, TODAY, type TrainingFixtures } from "../helpers/training";
import { saveIndicatorConfig } from "@/server/services/training/indicator-config";
import { addWorkloadTask, completeMilestone, listMilestones, listReadiness, setReadinessStatus } from "@/server/services/training/indicator-data";
import { getProgramIndicators } from "@/server/services/training/indicator-compute";
import { runTrainingDailyJob } from "@/server/services/training/automation";
import { addRecoveryNote, listRecoveryNotes } from "@/server/services/training/recovery";
import { createTask, changeTaskStatus } from "@/server/services/training/work";
import { endMember } from "@/server/services/training/projects";

let fx: TrainingFixtures;
let ayu: Actor, budi: Actor, citra: Actor; // pemegang jabatan yang punya akun
beforeEach(async () => {
  await resetDb();
  fx = await seedTraining();
  [ayu, budi, citra] = [fx.emp1, fx.emp2, fx.emp3];
});

const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const isWork = (iso: string) => ![6, 7].includes(isoWeekday(iso));
const prevWorkday = (iso: string) => { let d = addDays(iso, -1); while (!isWork(d)) d = addDays(d, -1); return d; };
const lastWorkday = (iso: string) => { let d = iso; while (!isWork(d)) d = addDays(d, -1); return d; };

/** Pemegang jabatan: SPV Kurikulum = Ayu (emp1), Manajer Ops = Manajer, Manajer Pemasaran = Budi (emp2), Staf Kurikulum & Umum = Citra (emp3). */
async function setConfig(mutate?: (c: IndicatorConfig) => void) {
  const c = defaultIndicatorConfig();
  c.roleHolders = { SPV_CURRICULUM: fx.empIds[0], MANAGER_OPS: fx.mgrEmp, MANAGER_MARKETING: fx.empIds[1], FACILITATOR: fx.empIds[1], STAFF_CURRICULUM: fx.empIds[2], STAFF_GENERAL: fx.empIds[2] };
  c.facilitators = [fx.empIds[0], fx.empIds[1]];
  mutate?.(c);
  await saveIndicatorConfig(fx.superAdmin, { config: c, note: "uji otomasi" });
}
const notes = (a: Actor | { userId: string }, type: string) => prisma.notification.findMany({ where: { userId: a.userId, type }, orderBy: { id: "asc" } });
const countAll = (type: string) => prisma.notification.count({ where: { type } });

/** Program Persiapan dengan PIC = Ayu. `h` = selisih hari dari hari ini ke hari pertama (H). */
async function program(h: number, over: Record<string, unknown> = {}) {
  const id = await mkProject(fx.mgr, { startDate: inDays(h), endDate: inDays(h + 1), ...over });
  await addTeam(fx.mgr, id, [[fx.empIds[0], "PROJECT_MANAGER"]]);
  await prisma.trainingProject.update({ where: { id }, data: { status: "PREPARATION" } });
  return id;
}

describe("pengingat tenggat H-1 dan hari-H", () => {
  it("tugas jatuh tempo besok → pengingat H-1; hari ini → pengingat hari-H; kemarin/lusa/selesai/menunggu pemeriksaan → tidak", async () => {
    await setConfig();
    const id = await program(45);
    await addTeam(fx.mgr, id, [[fx.empIds[1], "STAFF"], [fx.empIds[2], "STAFF"]]);
    const mk = (title: string, due: string, to = fx.empIds[1]) => createTask(fx.mgr, id, { title, assigneeId: to, dueDate: due });
    await mk("Tugas besok", inDays(1));
    await mk("Tugas hari ini", inDays(0));
    await mk("Tugas lusa", inDays(2));
    await mk("Tugas kemarin", inDays(-1));
    const done = await mk("Tugas selesai", inDays(1));
    await changeTaskStatus(budi, done.id, { status: "IN_PROGRESS" });
    await changeTaskStatus(budi, done.id, { status: "DONE" });
    const rev = await createTask(fx.mgr, id, { title: "Tugas menunggu pemeriksa", assigneeId: fx.empIds[1], dueDate: inDays(1), requiresReview: true });
    await changeTaskStatus(budi, rev.id, { status: "IN_PROGRESS" });
    await changeTaskStatus(budi, rev.id, { status: "IN_REVIEW" });

    const r = await runTrainingDailyJob();
    expect(r.skipped).toBeNull();
    const tomorrow = (await notes(budi, "training.reminder.due_tomorrow")).filter((n) => n.title.startsWith("Tugas"));
    const today = (await notes(budi, "training.reminder.due_today")).filter((n) => n.title.startsWith("Tugas"));
    expect(tomorrow.map((n) => n.body)).toEqual([expect.stringContaining("Tugas besok")]);
    expect(today.map((n) => n.body)).toEqual([expect.stringContaining("Tugas hari ini")]);
    expect(tomorrow[0]!.title).toBe("Tugas jatuh tempo besok");
    expect(today[0]!.href).toBe("/training/tugas-saya");
    expect(await notes(citra, "training.reminder.due_tomorrow")).toHaveLength(0); // orang lain tidak diganggu
  });

  it("idempoten: menjalankan pekerja berulang tidak mengirim pengingat ganda; tenggat yang dipindah menghasilkan pengingat baru", async () => {
    await setConfig();
    const id = await program(45);
    await addTeam(fx.mgr, id, [[fx.empIds[1], "STAFF"]]);
    const t = await createTask(fx.mgr, id, { title: "Tugas berpindah", assigneeId: fx.empIds[1], dueDate: inDays(1) });
    await runTrainingDailyJob();
    const second = await runTrainingDailyJob();
    expect(second.reminders).toBe(0);
    expect(await notes(budi, "training.reminder.due_tomorrow")).toHaveLength(1);
    // dipindah ke hari ini: kunci dedupe memuat tanggal tenggat → pengingat hari-H tetap terkirim sekali
    const { updateTask } = await import("@/server/services/training/work");
    await updateTask(fx.mgr, t.id, { dueDate: inDays(0) });
    await runTrainingDailyJob();
    await runTrainingDailyJob();
    expect(await notes(budi, "training.reminder.due_today")).toHaveLength(1);
  });

  it("penanggung jawab yang sudah dikeluarkan dari proyek tidak menerima pengingat tugas (kode proyek & judul tidak terkirim); PIC diberi tahu sebagai tugas tanpa penanggung jawab aktif", async () => {
    await setConfig();
    const id = await program(45);
    await addTeam(fx.mgr, id, [[fx.empIds[1], "STAFF"], [fx.empIds[2], "STAFF"]]);
    await createTask(fx.mgr, id, { title: "Tugas Budi yang keluar", assigneeId: fx.empIds[1], dueDate: inDays(1) });
    await createTask(fx.mgr, id, { title: "Tugas Citra yang tetap", assigneeId: fx.empIds[2], dueDate: inDays(1) });
    await endMember(fx.mgr, id, (await prisma.trainingProjectMember.findFirstOrThrow({ where: { projectId: id, employeeId: fx.empIds[1], endedAt: null } })).id);

    await runTrainingDailyJob();
    const code = (await prisma.trainingProject.findUniqueOrThrow({ where: { id } })).code;
    // (pemberitahuan "ditambahkan"/"tugas baru" dari saat ia masih anggota memang ada; yang dilarang adalah keluaran pekerja: pengingat & eskalasi)
    const budiGot = await prisma.notification.findMany({ where: { userId: budi.userId, OR: [{ type: { startsWith: "training.reminder" } }, { type: { startsWith: "training.escalation" } }] } });
    expect(budiGot.filter((n) => n.body?.includes("Tugas Budi") || n.body?.includes(code) || n.title.includes(code))).toHaveLength(0);

    const orphan = (await notes(ayu, "training.reminder.due_tomorrow")).find((n) => n.body!.includes("Tugas Budi yang keluar"))!;
    expect(orphan.title).toBe("Tugas tanpa penanggung jawab aktif jatuh tempo besok");
    expect(orphan.href).toBe(`/training/proyek/${id}?tab=tugas`);
    expect((await notes(citra, "training.reminder.due_tomorrow")).some((n) => n.title === "Tugas jatuh tempo besok" && n.body!.includes("Tugas Citra yang tetap"))).toBe(true);
    expect((await runTrainingDailyJob()).reminders).toBe(0); // tetap idempoten
  });

  it("milestone & item kesiapan: pemegang jabatan yang bukan anggota proyek dan tanpa level modul tidak diingatkan (PIC yang menerima); setelah menjadi anggota ia diingatkan", async () => {
    await setConfig();
    // PIC = Citra. Ayu pemegang SPV_CURRICULUM (R07, "Silabus dan RPP final") tetapi BUKAN anggota proyek dan tanpa level modul.
    const id = await mkProject(fx.mgr, { startDate: inDays(18), endDate: inDays(19) });
    await addTeam(fx.mgr, id, [[fx.empIds[2], "PROJECT_MANAGER"]]);
    await prisma.trainingProject.update({ where: { id }, data: { status: "PREPARATION" } });
    const code = (await prisma.trainingProject.findUniqueOrThrow({ where: { id } })).code;
    const forProject = <T extends { body: string | null }>(list: T[]) => list.filter((n) => n.body?.includes(code));

    await runTrainingDailyJob();
    expect(forProject(await notes(ayu, "training.reminder.due_tomorrow"))).toHaveLength(0);
    const pic = forProject(await notes(citra, "training.reminder.due_tomorrow"));
    expect(pic.some((n) => n.title === "Milestone jatuh tempo besok" && n.body!.includes("R07"))).toBe(true);
    expect(pic.some((n) => n.title === "Item kesiapan jatuh tempo besok" && n.body!.includes("Silabus dan RPP final"))).toBe(true);

    // setelah ditambahkan sebagai anggota, Ayu boleh membuka proyek → pengingat ke dirinya berjalan
    await addTeam(fx.mgr, id, [[fx.empIds[0], "STAFF"]]);
    await runTrainingDailyJob();
    const got = forProject(await notes(ayu, "training.reminder.due_tomorrow"));
    expect(got.some((n) => n.title === "Milestone jatuh tempo besok" && n.body!.includes("R07"))).toBe(true);
  });

  it("milestone & item kesiapan: pengingat ke PIC-nya (pemegang jabatan) H-1; selesai / tidak berlaku tidak diingatkan", async () => {
    await setConfig();
    const id = await program(18); // R07 (H-17) jatuh tempo besok; "Silabus dan RPP final" juga H-17
    const r07 = (await listMilestones(fx.mgr, id)).find((m) => m.code === "R07")!;
    expect(r07.due).toBe(inDays(1));
    await runTrainingDailyJob();
    const got = await notes(ayu, "training.reminder.due_tomorrow");
    expect(got.some((n) => n.title === "Milestone jatuh tempo besok" && n.body!.includes("R07"))).toBe(true);
    expect(got.some((n) => n.title === "Item kesiapan jatuh tempo besok" && n.body!.includes("Silabus dan RPP final"))).toBe(true);
    expect(got.every((n) => n.href === `/training/proyek/${id}?tab=pemantauan`)).toBe(true);

    // yang sudah selesai tidak diingatkan (program lain, tanggal sama)
    const id2 = await program(18, { name: "Program kedua" });
    await completeMilestone(fx.mgr, (await listMilestones(fx.mgr, id2)).find((m) => m.code === "R07")!.id, { evidence: "Silabus final.pdf" });
    const item = (await listReadiness(fx.mgr, id2)).find((i) => i.name === "Silabus dan RPP final")!;
    await setReadinessStatus(fx.mgr, item.id, { status: "DONE" });
    const before = (await notes(ayu, "training.reminder.due_tomorrow")).length;
    await runTrainingDailyJob();
    const after = await notes(ayu, "training.reminder.due_tomorrow");
    expect(after.filter((n) => n.href!.includes(id2) && (n.body!.includes("R07") || n.body!.includes("Silabus"))).length).toBe(0);
    expect(after.length).toBeGreaterThanOrEqual(before); // program kedua tetap memberi pengingat item lain yang jatuh tempo, bukan yang selesai
  });

  it("milestone jatuh tempo hari ini → pengingat hari-H", async () => {
    await setConfig();
    await program(17); // R07 = H-17 = hari ini
    await runTrainingDailyJob();
    expect((await notes(ayu, "training.reminder.due_today")).some((n) => n.title === "Milestone jatuh tempo hari ini" && n.body!.includes("R07"))).toBe(true);
  });

  it("hari pelaksanaan program: anggota tim diingatkan H-1 dan hari-H; draf tidak", async () => {
    await setConfig();
    const tomorrow = await program(1);
    await addTeam(fx.mgr, tomorrow, [[fx.empIds[1], "STAFF"]]);
    const today = await program(0, { name: "Program hari ini" });
    await addTeam(fx.mgr, today, [[fx.empIds[1], "STAFF"]]);
    await mkProject(fx.mgr, { name: "Masih draf", startDate: inDays(1), endDate: inDays(2) });
    await runTrainingDailyJob();
    expect((await notes(budi, "training.reminder.start_tomorrow")).map((n) => n.body)).toEqual([expect.stringContaining("TRN-")]);
    expect(await notes(budi, "training.reminder.start_today")).toHaveLength(1);
    expect(await notes(ayu, "training.reminder.start_tomorrow")).toHaveLength(1); // PIC juga anggota
  });

  it("dapat dimatikan per jenis di konfigurasi (H-1 mati, hari-H hidup)", async () => {
    await setConfig((c) => { c.escalation.reminders.dayBefore = false; });
    const id = await program(45);
    await addTeam(fx.mgr, id, [[fx.empIds[1], "STAFF"]]);
    await createTask(fx.mgr, id, { title: "Tugas pertama", assigneeId: fx.empIds[1], dueDate: inDays(1) });
    await createTask(fx.mgr, id, { title: "Tugas kedua", assigneeId: fx.empIds[1], dueDate: inDays(0) });
    await runTrainingDailyJob();
    expect(await notes(budi, "training.reminder.due_tomorrow")).toHaveLength(0);
    expect(await notes(budi, "training.reminder.due_today")).toHaveLength(1);
  });

  it("proyek Selesai/Dibatalkan tidak mengirim pengingat; karyawan nonaktif tidak menerima", async () => {
    await setConfig();
    const id = await program(45);
    await addTeam(fx.mgr, id, [[fx.empIds[1], "STAFF"], [fx.empIds[2], "STAFF"]]);
    await createTask(fx.mgr, id, { title: "Untuk budi", assigneeId: fx.empIds[1], dueDate: inDays(1) });
    await createTask(fx.mgr, id, { title: "Untuk citra", assigneeId: fx.empIds[2], dueDate: inDays(1) });
    await prisma.employee.update({ where: { id: fx.empIds[2] }, data: { isActive: false } });
    await runTrainingDailyJob();
    expect(await notes(budi, "training.reminder.due_tomorrow")).toHaveLength(1);
    expect(await notes(citra, "training.reminder.due_tomorrow")).toHaveLength(0);
    await prisma.trainingProject.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: fx.superAdmin.userId, cancelReason: "uji" } });
    await prisma.notification.deleteMany({});
    await prisma.trainingReminderLog.deleteMany({});
    await runTrainingDailyJob();
    expect(await countAll("training.reminder.due_tomorrow")).toBe(0);
  });
});

describe("snapshot status & eskalasi Merah", () => {
  // Eskalasi Merah/Kuning berbasis HARI KERJA (akhir pekan tidak memicu). Bila tes dijalankan pada Sabtu/Minggu, jam aplikasi dipatok ke hari kerja terakhir
  // agar hasilnya tidak bergantung pada hari tes dijalankan (jam tetap berjalan; hanya Date yang dipatok).
  beforeEach(() => { if (!isWork(TODAY())) vi.useFakeTimers({ now: new Date(`${lastWorkday(TODAY())}T03:00:00Z`), toFake: ["Date"], shouldAdvanceTime: true }); });
  afterEach(() => { vi.useRealTimers(); });

  it("snapshot harian disimpan satu per program per tanggal (menimpa bila dijalankan lagi)", async () => {
    await setConfig();
    const id = await program(2);
    const r1 = await runTrainingDailyJob();
    await runTrainingDailyJob();
    expect(r1.snapshots).toBe(1);
    const rows = await prisma.trainingStatusSnapshot.findMany({ where: { projectId: id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ overall: "RED" });
    expect(rows[0]!.triggers).toContain("CRITICAL_MILESTONE");
  });

  it("Merah: pelaksana (SPV Kurikulum), Manajer Operasional, dan PIC diberi tahu hari itu juga; H-2 → juga keputusan Go/No-Go; tidak ganda", async () => {
    await setConfig();
    const id = await program(2); // R01 kritikal terlambat → Merah; H-2 masuk jendela H-7…H-1
    const r = await runTrainingDailyJob();
    expect(r.escalations).toBeGreaterThan(0);
    const red = async (a: { userId: string }) => notes(a, "training.escalation.red");
    expect(await red(ayu)).toHaveLength(1); // SPV Kurikulum sekaligus PIC → satu pesan
    expect(await red(fx.mgr)).toHaveLength(1); // Manajer Operasional
    expect(await red(budi)).toHaveLength(0); // bukan penyebab pemasaran
    expect(await red(citra)).toHaveLength(0);
    const msg = (await red(ayu))[0]!;
    expect(msg.title).toContain("MERAH");
    expect(msg.href).toBe(`/training/proyek/${id}?tab=pemantauan#pemulihan`);
    expect((await notes(fx.mgr, "training.escalation.red_late"))[0]!.title).toBe(`Merah pada H-2: ${(await prisma.trainingProject.findUniqueOrThrow({ where: { id } })).code}`);

    const total = await prisma.notification.count({ where: { type: { startsWith: "training.escalation" } } });
    const again = await runTrainingDailyJob();
    expect(again.escalations).toBe(0);
    expect(await prisma.notification.count({ where: { type: { startsWith: "training.escalation" } } })).toBe(total);
  });

  it("penyebab Merah urusan pemasaran (proyeksi peserta rendah mulai H-4) → Manajer Pemasaran, bukan SPV pelaksana, ikut diberi tahu", async () => {
    await setConfig();
    await program(2, { participantsMin: 20 }); // 0 peserta → rasio proyeksi 0 < 0,8 pada H-2 → PROJECTION_LOW
    await runTrainingDailyJob();
    expect(await notes(budi, "training.escalation.red")).toHaveLength(1); // Manajer Pemasaran = emp2
    expect(await notes(fx.mgr, "training.escalation.red")).toHaveLength(1);
    expect((await notes(ayu, "training.escalation.red")).length).toBe(1); // tetap sebagai PIC
  });

  it("milestone terlambat > 3 hari → atasan pemegangnya (naik satu tingkat), sekali per milestone; tanpa atasan di portal → Direktur", async () => {
    await setConfig();
    await program(2);
    await runTrainingDailyJob();
    // R01 dipegang STAFF_CURRICULUM (Citra) → atasan SPV Kurikulum (Ayu); R07/R04 dipegang SPV → atasan Manajer Operasional
    const ayuOverdue = await notes(ayu, "training.escalation.overdue");
    expect(ayuOverdue.some((n) => n.title.startsWith("Milestone R01 terlambat"))).toBe(true);
    const mgrOverdue = await notes(fx.mgr, "training.escalation.overdue");
    expect(mgrOverdue.some((n) => n.title.startsWith("Milestone R07 terlambat"))).toBe(true);
    // R02/R03 dipegang Manajer Pemasaran (tanpa atasan di portal) → Direktur
    const boss = await notes(fx.superAdmin, "training.escalation.overdue");
    expect(boss.some((n) => n.title.startsWith("Milestone R02 terlambat"))).toBe(true);
    // R05/R09 hanya terlambat 2 hari (< ambang 3) → tidak dieskalasi
    expect([...ayuOverdue, ...mgrOverdue, ...boss].some((n) => /Milestone R0[59] /.test(n.title))).toBe(false);
  });

  it("tanpa pemegang jabatan terisi, pesan Merah tidak hilang: jatuh ke Direktur (Super Admin)", async () => {
    const id = await program(2);
    await prisma.trainingProjectMember.updateMany({ where: { projectId: id, role: "PROJECT_MANAGER" }, data: { endedAt: new Date("2100-01-01T00:00:00Z") } }); // tanggal tetap: jam basis data bisa berbeda dari jam aplikasi yang dipatok
    await runTrainingDailyJob();
    expect((await notes(fx.superAdmin, "training.escalation.red")).length).toBeGreaterThanOrEqual(1);
  });

  it("eskalasi dimatikan di konfigurasi: snapshot tetap dibuat, pengingat tetap jalan, tidak ada pesan eskalasi", async () => {
    await setConfig((c) => { c.escalation.enabled = false; });
    const id = await program(2);
    await addTeam(fx.mgr, id, [[fx.empIds[1], "STAFF"]]);
    await createTask(fx.mgr, id, { title: "Tugas uji", assigneeId: fx.empIds[1], dueDate: inDays(1) });
    const r = await runTrainingDailyJob();
    expect(r.snapshots).toBe(1);
    expect(r.escalations).toBe(0);
    expect(await prisma.notification.count({ where: { type: { startsWith: "training.escalation" } } })).toBe(0);
    expect(await notes(budi, "training.reminder.due_tomorrow")).toHaveLength(1);
  });

  it("program Draf, Selesai, atau tanpa template tidak dinilai (tanpa snapshot, tanpa eskalasi)", async () => {
    await setConfig();
    await mkProject(fx.mgr, { startDate: inDays(2), endDate: inDays(3) }); // Draf
    const r = await runTrainingDailyJob();
    expect(r.snapshots).toBe(0);
    expect(await prisma.notification.count({ where: { type: { startsWith: "training.escalation" } } })).toBe(0);
  });
});

describe("aturan Kuning berturut-turut", () => {
  /** Program yang pasti KUNING (bukan Merah/Hijau): ambang dipaksa lebar & semua milestone/item kritikal yang jatuh tempo diselesaikan. */
  async function yellowProgram() {
    await setConfig((c) => { c.thresholds.spi = { greenMin: 5, yellowMin: 0 }; c.thresholds.readiness = { greenMin: 100, yellowMin: -100 }; });
    const id = await program(2);
    for (const m of await listMilestones(fx.mgr, id)) if (m.critical && !m.notApplicable && m.due && m.due < TODAY()) await completeMilestone(fx.mgr, m.id, { evidence: "Bukti uji" });
    for (const i of await listReadiness(fx.mgr, id)) if (i.critical && !i.bnspExcluded) await setReadinessStatus(fx.mgr, i.id, { status: "DONE" });
    expect((await getProgramIndicators(fx.mgr, id)).overall).toBe("YELLOW");
    return id;
  }
  const snap = (projectId: string, date: string, overall: "YELLOW" | "GREEN" | "RED") => prisma.trainingStatusSnapshot.create({ data: { projectId, date: isoToDate(date), overall, triggers: [] } });
  /** Hari kerja terakhir ≤ hari ini: pada akhir pekan pekerja memakainya sebagai acuan (snapshot akhir pekan tidak dihitung). */
  const anchor = () => lastWorkday(TODAY());

  it("Kuning hari pertama → hanya PIC; belum ada pesan ke atasan", async () => {
    const id = await yellowProgram();
    if (anchor() !== TODAY()) await snap(id, anchor(), "YELLOW"); // akhir pekan: pekerja Jumat sudah menilai Kuning
    await runTrainingDailyJob();
    expect(await notes(ayu, "training.escalation.yellow")).toHaveLength(1);
    expect(await countAll("training.escalation.yellow_streak")).toBe(0);
  });

  it("Kuning 2 hari kerja berturut-turut → atasan langsung PIC (Manajer Operasional) + PIC; tercatat butuh rencana pemulihan; hanya sekali", async () => {
    const id = await yellowProgram();
    await snap(id, prevWorkday(anchor()), "YELLOW");
    if (anchor() !== TODAY()) await snap(id, anchor(), "YELLOW");
    await runTrainingDailyJob();
    const boss = await notes(fx.mgr, "training.escalation.yellow_streak");
    expect(boss).toHaveLength(1);
    expect(boss[0]!.title).toContain("Kuning 2 hari kerja berturut-turut");
    expect(boss[0]!.body).toContain("rencana pemulihan");
    expect(boss[0]!.href).toBe(`/training/proyek/${id}?tab=pemantauan#pemulihan`);
    expect(await notes(ayu, "training.escalation.yellow_streak")).toHaveLength(1);
    await runTrainingDailyJob();
    expect(await countAll("training.escalation.yellow_streak")).toBe(2);
    // indikator proyek menampilkan deret berturut-turut
    const runs = (await getProgramIndicators(fx.mgr, id)).runs!;
    expect(runs.yellow.count).toBeGreaterThanOrEqual(2);
  });

  it("hari kerja sebelumnya Hijau atau tanpa snapshot → deret putus, tidak ada pesan atasan", async () => {
    const id = await yellowProgram();
    await snap(id, prevWorkday(anchor()), "GREEN");
    if (anchor() !== TODAY()) await snap(id, anchor(), "YELLOW");
    await runTrainingDailyJob();
    expect(await countAll("training.escalation.yellow_streak")).toBe(0);
    expect(await notes(ayu, "training.escalation.yellow")).toHaveLength(1);
  });

  it("ambang deret dapat dinaikkan di konfigurasi (3 hari): 2 hari belum cukup", async () => {
    const id = await yellowProgram();
    await setConfig((c) => { c.thresholds.spi = { greenMin: 5, yellowMin: 0 }; c.thresholds.readiness = { greenMin: 100, yellowMin: -100 }; c.escalation.yellowStreakDays = 3; });
    await snap(id, prevWorkday(anchor()), "YELLOW");
    if (anchor() !== TODAY()) await snap(id, anchor(), "YELLOW");
    await runTrainingDailyJob();
    expect(await countAll("training.escalation.yellow_streak")).toBe(0);
  });
});

describe("beban berlebih dua minggu berturut-turut", () => {
  it("→ Manajer Operasional dan Keuangan, sekali per minggu; satu minggu overload saja tidak", async () => {
    await setConfig();
    const id = await mkProject(fx.mgr, { startDate: inDays(90), endDate: inDays(91) });
    const wk = startOfIsoWeek(TODAY());
    await addWorkloadTask(fx.mgr, id, { employeeId: fx.empIds[1], name: "Beban dua minggu", hours: 72, startDate: wk, endDate: endOfIsoWeek(addDays(wk, 7)) });
    await addWorkloadTask(fx.mgr, id, { employeeId: fx.empIds[2], name: "Beban sepekan", hours: 36, startDate: wk, endDate: endOfIsoWeek(wk) });
    await runTrainingDailyJob();
    const got = await notes(fx.mgr, "training.escalation.overload");
    expect(got).toHaveLength(1);
    expect(got[0]!.title).toContain("Budi Santoso");
    expect(got[0]!.href).toBe("/training/pemantauan?tab=tim");
    await runTrainingDailyJob();
    expect(await notes(fx.mgr, "training.escalation.overload")).toHaveLength(1);
  });
});

describe("catatan pemulihan", () => {
  it("PIC dan Manajer boleh menulis; staf biasa, Pemantau ditolak; non-anggota 404; append-only dan tercatat di audit", async () => {
    await setConfig();
    const id = await program(45);
    await addTeam(fx.mgr, id, [[fx.empIds[1], "STAFF"]]);
    const a = await addRecoveryNote(ayu, id, { kind: "YELLOW_STREAK", body: "Instruktur dikonfirmasi ulang; tambah satu staf kurikulum minggu ini.", newDate: inDays(5) });
    await addRecoveryNote(fx.mgr, id, { kind: "RED", body: "Go diputuskan; jadwal uji LSP digeser sehari." });
    expect((await fail(addRecoveryNote(budi, id, { kind: "OTHER", body: "Catatan staf biasa tidak boleh." })))?.status).toBe(403);
    expect((await fail(addRecoveryNote(fx.viewer, id, { kind: "OTHER", body: "Pemantau hanya melihat." })))?.status).toBe(403);
    expect((await fail(addRecoveryNote(fx.loner, id, { kind: "OTHER", body: "Bukan anggota proyek." })))?.status).toBe(404);
    expect((await fail(addRecoveryNote(ayu, id, { kind: "OTHER", body: "abc" })))?.status).toBe(422);
    expect((await fail(addRecoveryNote(ayu, id, { kind: "ASAL", body: "Jenis tidak dikenal oleh sistem." })))?.status).toBe(422);

    const list = await listRecoveryNotes(budi, id); // staf boleh membaca
    expect(list.map((n) => n.kind)).toEqual(["RED", "YELLOW_STREAK"]);
    expect(list[1]).toMatchObject({ id: a.id, createdByName: "Ayu Lestari", newDate: inDays(5), kindLabel: "Kuning berturut-turut" });
    expect((await fail(listRecoveryNotes(fx.loner, id)))?.status).toBe(404);
    await expect(prisma.$executeRawUnsafe(`UPDATE training_recovery_notes SET body = 'diubah diam-diam'`)).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`DELETE FROM training_recovery_notes`)).rejects.toThrow();
    expect(await prisma.auditLog.count({ where: { action: "training.recovery.add", entityId: id } })).toBe(2);
  });

  it("proyek Selesai/Dibatalkan terkunci untuk catatan baru", async () => {
    await setConfig();
    const id = await program(45);
    await prisma.trainingProject.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: fx.superAdmin.userId, cancelReason: "uji" } });
    expect((await fail(addRecoveryNote(fx.mgr, id, { kind: "OTHER", body: "Catatan setelah dibatalkan." })))?.status).toBe(409);
  });
});
