/**
 * Serah terima saat karyawan berhenti: daftar yang masih dipegang (tugas, checklist, milestone, item kesiapan, keanggotaan), penanda "perlu dialihkan" satu
 * definisi, pemberitahuan ke PIC (atau Koordinator Program & Direktur bila PIC-nya yang berhenti) SEKALI per proyek, larangan penugasan baru ke karyawan
 * nonaktif, dan pengingat yang tidak lagi melewati tugas tanpa penanggung jawab tersedia.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import { defaultIndicatorConfig } from "@/lib/training/indicators/config";
import type { ProjectRole } from "@/lib/training/types";
import { resetDb } from "../helpers/db";
import { addTeam, inDays, mkProject, seedTraining, type TrainingFixtures } from "../helpers/training";
import { saveIndicatorConfig } from "@/server/services/training/indicator-config";
import { runTrainingDailyJob } from "@/server/services/training/automation";
import { addChecklistItem, createTask, getTask, listChecklist, updateChecklistItem, updateTask } from "@/server/services/training/work";
import { endMember, listMembers } from "@/server/services/training/projects";
import { listMilestones, listReadiness } from "@/server/services/training/indicator-data";
import { getTrainingDashboard } from "@/server/services/training/insights";
import { getEmployeeHandover } from "@/server/services/training/handover";
import { deactivateEmployee, reactivateEmployee } from "@/server/services/employees";

let fx: TrainingFixtures;
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const AYU = () => fx.empIds[0], BUDI = () => fx.empIds[1], CITRA = () => fx.empIds[2];
const notes = (userId: string, type: string) => prisma.notification.findMany({ where: { userId, type }, orderBy: { id: "asc" } });

async function project(pm: string, staff: string[] = [], status: "PREPARATION" | "RUNNING" = "PREPARATION") {
  const id = await mkProject(fx.mgr, { startDate: inDays(45), endDate: inDays(46) });
  await addTeam(fx.mgr, id, [[pm, "PROJECT_MANAGER" as ProjectRole], ...staff.map((s): [string, ProjectRole] => [s, "STAFF"])]);
  await prisma.trainingProject.update({ where: { id }, data: { status } });
  return id;
}
/** Budi memegang: 1 tugas, 1 item checklist, 1 milestone, 1 item kesiapan pada proyek `id`. */
async function budiHolds(id: string) {
  const task = (await createTask(fx.mgr, id, { title: "Susun modul", assigneeId: BUDI(), dueDate: inDays(30), requiresReview: false })).id;
  const item = (await addChecklistItem(fx.mgr, id, { phase: "PREPARATION", title: "Siapkan ruang", isRequired: true, assigneeId: BUDI() })).id;
  const ms = await prisma.trainingMilestone.create({ data: { projectId: id, code: "M1", name: "Proposal terkirim", anchor: "T", offsetDays: 0, weight: 5, assigneeId: BUDI() } });
  const rd = await prisma.trainingReadinessItem.create({ data: { projectId: id, component: "MATERIAL", name: "Materi final", anchor: "H", offsetDays: -3, assigneeId: BUDI() } });
  return { task, item, ms: ms.id, rd: rd.id };
}

/** Milestone & item kesiapan terisi OTOMATIS dari pemegang jabatan (konfigurasi indikator), jadi jumlah sebenarnya dihitung dari data. */
const heldCounts = async (projectId: string, employeeId: string) => ({
  milestones: await prisma.trainingMilestone.count({ where: { projectId, assigneeId: employeeId, doneAt: null, notApplicable: false } }),
  readiness: await prisma.trainingReadinessItem.count({ where: { projectId, assigneeId: employeeId, status: "OPEN" } }),
});

beforeEach(async () => {
  await resetDb(); fx = await seedTraining();
  const c = defaultIndicatorConfig();
  c.roleHolders = { SPV_CURRICULUM: AYU(), MANAGER_OPS: fx.mgrEmp, MANAGER_MARKETING: BUDI(), FACILITATOR: BUDI(), STAFF_CURRICULUM: CITRA(), STAFF_GENERAL: CITRA() };
  c.facilitators = [AYU(), BUDI()];
  await saveIndicatorConfig(fx.superAdmin, { config: c, note: "uji serah terima" });
});

describe("penanda 'perlu dialihkan' — satu definisi", () => {
  it("karyawan berhenti: tugas, checklist, milestone, kesiapan, dan anggota tim ditandai; keanggotaan TIDAK diakhiri otomatis; hilang sendiri saat diaktifkan kembali", async () => {
    const p = await project(AYU(), [BUDI()]);
    const h = await budiHolds(p);
    // sebelum berhenti: tidak ada penanda
    expect((await getTask(fx.mgr, h.task)).assigneeUnavailable).toBeNull();
    await deactivateEmployee(fx.hr, BUDI(), { reason: "Resign" });
    const t = await getTask(fx.mgr, h.task);
    expect(t).toMatchObject({ assigneeInactive: true, assigneeUnavailable: "EMPLOYEE_INACTIVE", assigneeName: "Budi Santoso" });
    expect((await listChecklist(fx.mgr, p)).items.find((i) => i.id === h.item)?.assigneeUnavailable).toBe("EMPLOYEE_INACTIVE");
    expect((await listMilestones(fx.mgr, p)).find((m) => m.id === h.ms)?.assigneeUnavailable).toBe("EMPLOYEE_INACTIVE");
    expect((await listReadiness(fx.mgr, p)).find((r) => r.id === h.rd)?.assigneeUnavailable).toBe("EMPLOYEE_INACTIVE");
    const member = (await listMembers(fx.mgr, p)).find((m) => m.employeeId === BUDI())!;
    expect(member).toMatchObject({ active: true, unavailable: "EMPLOYEE_INACTIVE" });          // tidak diakhiri otomatis
    expect((await getTrainingDashboard(fx.mgr)).risks.orphanTasks).toBe(1);                     // dasbor risiko memakai definisi yang sama
    // diaktifkan kembali → penanda hilang otomatis
    await reactivateEmployee(fx.hr, BUDI());
    expect((await getTask(fx.mgr, h.task)).assigneeUnavailable).toBeNull();
    expect((await listMembers(fx.mgr, p)).find((m) => m.employeeId === BUDI())?.unavailable).toBeNull();
    expect((await getTrainingDashboard(fx.mgr)).risks.orphanTasks).toBe(0);
  });

  it("akun nonaktif (karyawan masih aktif) dan keluar dari tim juga ditandai, dengan alasan berbeda", async () => {
    const p = await project(AYU(), [BUDI(), CITRA()]);
    const tBudi = (await createTask(fx.mgr, p, { title: "Tugas Budi", assigneeId: BUDI(), requiresReview: false })).id;
    const tCitra = (await createTask(fx.mgr, p, { title: "Tugas Citra", assigneeId: CITRA(), requiresReview: false })).id;
    await prisma.user.update({ where: { id: fx.emp2.userId }, data: { isActive: false } });                       // akun Budi dimatikan
    const m = await prisma.trainingProjectMember.findFirstOrThrow({ where: { projectId: p, employeeId: CITRA(), endedAt: null } });
    await endMember(fx.mgr, p, m.id);                                                                             // Citra dikeluarkan dari tim
    expect((await getTask(fx.mgr, tBudi)).assigneeUnavailable).toBe("ACCOUNT_INACTIVE");
    expect((await getTask(fx.mgr, tCitra)).assigneeUnavailable).toBe("NOT_MEMBER");
  });
});

describe("daftar serah terima & pemberitahuan", () => {
  it("hasil penonaktifan memuat daftar per proyek; HR (tanpa akses Training) hanya melihat jumlah, Koordinator melihat rincian", async () => {
    const p = await project(AYU(), [BUDI()]);
    await budiHolds(p);
    const held = await heldCounts(p, BUDI());
    expect(held.milestones).toBeGreaterThanOrEqual(1);
    const total = 1 + 1 + held.milestones + held.readiness;
    const r = await deactivateEmployee(fx.hr, BUDI(), { reason: "Resign" });
    expect(r.handover).toMatchObject({ employeeId: BUDI(), employeeActive: false, total });
    expect(r.handover.projects).toHaveLength(1);
    expect(r.handover.projects[0]).toMatchObject({ projectId: p, role: "STAFF", isPic: false, counts: { tasks: 1, checklist: 1, milestones: held.milestones, readiness: held.readiness, instructors: 0 }, detail: null });
    const asCoordinator = await getEmployeeHandover(fx.mgr, BUDI());
    const d = asCoordinator.projects[0]!.detail!;
    expect(d.tasks).toMatchObject([{ title: "Susun modul", status: "TODO" }]);
    expect(d.checklist).toMatchObject([{ title: "Siapkan ruang" }]);
    expect(d.milestones.map((m) => m.code)).toContain("M1");
    expect(d.readiness.map((x) => x.name)).toContain("Materi final");
    expect((await getEmployeeHandover(fx.superAdmin, BUDI())).projects[0]!.detail).not.toBeNull();             // Direktur
    expect((await fail(getEmployeeHandover(fx.emp2, BUDI())))?.code).toBe("FORBIDDEN");                        // karyawan biasa tidak
    expect(await getEmployeeHandover(fx.hr, BUDI())).toMatchObject({ total });                                    // HR dapat membukanya kembali (jumlah)
  });

  it("PIC diberi tahu SEKALI per proyek; Koordinator tidak; menonaktifkan ulang (atau aktifkan lalu nonaktifkan lagi) tidak mengirim ulang", async () => {
    const p = await project(AYU(), [BUDI()]);
    await budiHolds(p);
    const held = await heldCounts(p, BUDI());
    await deactivateEmployee(fx.hr, BUDI(), {});
    const got = await notes(fx.emp1.userId, "training.handover.needed");
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ title: "Karyawan berhenti — alihkan pekerjaannya", href: `/training/proyek/${p}?tab=tugas` });
    expect(got[0]!.body).toContain(`perlu dialihkan: 1 tugas, 1 item checklist, ${held.milestones} milestone, ${held.readiness} item kesiapan`);
    expect(got[0]!.body).toMatch(/^Budi Santoso berhenti · TRN-/);
    expect(await notes(fx.mgr.userId, "training.handover.needed")).toHaveLength(0);
    await reactivateEmployee(fx.hr, BUDI());
    await deactivateEmployee(fx.hr, BUDI(), {});
    expect(await notes(fx.emp1.userId, "training.handover.needed")).toHaveLength(1);                       // tidak diulang
  });

  it("PIC yang berhenti → Koordinator Program dan Direktur diberi tahu (bukan PIC lama); proyek tanpa pekerjaan tetapi PIC-nya berhenti tetap dikabarkan", async () => {
    const p = await project(CITRA(), [BUDI()]);                                                                  // Citra = PIC, tanpa tugas
    await deactivateEmployee(fx.hr, CITRA(), {});
    for (const a of [fx.mgr, fx.superAdmin]) {
      const n = await notes(a.userId, "training.handover.needed");
      expect(n, `penerima ${a.email}`).toHaveLength(1);
      expect(n[0]).toMatchObject({ title: "PIC proyek berhenti — tetapkan PIC baru", href: `/training/proyek/${p}?tab=tim` });
    }
    expect(await notes(fx.emp3.userId, "training.handover.needed")).toHaveLength(0);
  });

  it("karyawan yang tidak memegang apa pun di Training: tidak ada pemberitahuan dan daftar kosong", async () => {
    await project(AYU(), [BUDI()]);
    const r = await deactivateEmployee(fx.hr, fx.lonerEmp, {});                                                  // Lola: bukan anggota, tak punya jabatan indikator
    expect(r.handover).toMatchObject({ total: 0, projects: [] });
    expect(await prisma.notification.count({ where: { type: "training.handover.needed" } })).toBe(0);
  });
});

describe("tidak ada penugasan baru ke karyawan nonaktif", () => {
  it("tugas & checklist baru ditolak; mengganti penanggung jawab ke karyawan nonaktif ditolak; menyunting hal lain pada tugas lama tidak terkunci", async () => {
    const p = await project(AYU(), [BUDI(), CITRA()]);
    const old = await budiHolds(p);
    const other = (await createTask(fx.mgr, p, { title: "Tugas Citra", assigneeId: CITRA(), requiresReview: false })).id;
    const otherItem = (await addChecklistItem(fx.mgr, p, { phase: "PREPARATION", title: "Item Citra", isRequired: false, assigneeId: CITRA() })).id;
    await deactivateEmployee(fx.hr, BUDI(), {});
    const e1 = await fail(createTask(fx.mgr, p, { title: "Tugas baru untuk Budi", assigneeId: BUDI(), requiresReview: false }));
    expect(e1?.code).toBe("VALIDATION");
    expect(e1?.fieldErrors?.assigneeId).toBeTruthy();
    expect((await fail(addChecklistItem(fx.mgr, p, { phase: "PREPARATION", title: "Item baru", isRequired: false, assigneeId: BUDI() })))?.code).toBe("VALIDATION");
    expect((await fail(updateTask(fx.mgr, other, { assigneeId: BUDI() })))?.code).toBe("VALIDATION");
    expect((await fail(updateChecklistItem(fx.mgr, otherItem, { assigneeId: BUDI() })))?.code).toBe("VALIDATION");
    // tugas lama atas nama Budi: judul boleh diubah (penanggung jawab tidak berubah → tidak divalidasi ulang) dan boleh dialihkan ke orang lain
    await updateTask(fx.mgr, old.task, { title: "Susun modul (revisi)", assigneeId: BUDI() });
    expect((await getTask(fx.mgr, old.task)).title).toBe("Susun modul (revisi)");
    await updateTask(fx.mgr, old.task, { assigneeId: CITRA() });
    expect((await getTask(fx.mgr, old.task)).assigneeUnavailable).toBeNull();
  });
});

describe("pengingat tenggat tidak lagi melewati tugas", () => {
  const todo = (pid: string, title: string, to: string) => createTask(fx.mgr, pid, { title, assigneeId: to, dueDate: inDays(1), requiresReview: false });
  const remindersFor = (userId: string, title: string) => prisma.notification.findMany({ where: { userId, type: "training.reminder.due_tomorrow", body: { contains: title } } });

  it("penanggung jawab BERHENTI → pengingat diteruskan ke PIC dengan judul 'tanpa penanggung jawab aktif'; yang bersangkutan tidak dikirimi", async () => {
    const p = await project(AYU(), [BUDI()]);
    await todo(p, "Tugas milik yang berhenti", BUDI());
    await deactivateEmployee(fx.hr, BUDI(), {});
    await runTrainingDailyJob();
    const pic = await remindersFor(fx.emp1.userId, "Tugas milik yang berhenti");
    expect(pic).toHaveLength(1);
    expect(pic[0]!.title).toBe("Tugas tanpa penanggung jawab aktif jatuh tempo besok");
    expect(await remindersFor(fx.emp2.userId, "Tugas milik yang berhenti")).toHaveLength(0);
  });

  it("PIC-nya pun tidak tersedia → Koordinator Program dan Direktur menerima (tidak ada tugas yang lolos tanpa pengingat)", async () => {
    const p = await project(AYU(), [BUDI()]);
    await todo(p, "Tugas yatim", BUDI());
    await deactivateEmployee(fx.hr, BUDI(), {});
    await deactivateEmployee(fx.hr, AYU(), {});                                                                  // PIC juga berhenti
    await runTrainingDailyJob();
    for (const a of [fx.mgr, fx.superAdmin]) expect((await remindersFor(a.userId, "Tugas yatim")).length, `penerima ${a.email}`).toBe(1);
    expect(await remindersFor(fx.emp1.userId, "Tugas yatim")).toHaveLength(0);
  });

  it("penanggung jawab keluar dari tim (akun aktif) → ke PIC; penanggung jawab yang tersedia tetap menerima sendiri", async () => {
    const p = await project(AYU(), [BUDI(), CITRA()]);
    await todo(p, "Tugas anggota keluar", BUDI());
    await todo(p, "Tugas normal", CITRA());
    const m = await prisma.trainingProjectMember.findFirstOrThrow({ where: { projectId: p, employeeId: BUDI(), endedAt: null } });
    await endMember(fx.mgr, p, m.id);
    await runTrainingDailyJob();
    expect(await remindersFor(fx.emp1.userId, "Tugas anggota keluar")).toHaveLength(1);                        // PIC
    expect(await remindersFor(fx.emp3.userId, "Tugas normal")).toHaveLength(1);                                // Citra sendiri
    expect(await remindersFor(fx.emp1.userId, "Tugas normal")).toHaveLength(0);
  });
});
