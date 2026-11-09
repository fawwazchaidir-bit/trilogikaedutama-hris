/**
 * Training & Operations — GERBANG AKSES. Fokus: yang paling berisiko jika salah (siapa boleh melihat/mengubah apa, dan
 * apakah mengganti ID di URL/body membuka proyek orang lain). Semua izin di sini berasal dari level modul / peran proyek —
 * role global HRIS sengaja tidak memberi apa pun.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { readFileForActor } from "@/server/services/files";
import { resetDb } from "../helpers/db";
import { addTeam, inDays, mkProject, PDF, seedTraining, type TrainingFixtures } from "../helpers/training";
import { PROJECT_ABILITIES } from "@/lib/training/access";
import { addMember, changeProjectStatus, createProject, endMember, getProject, listMembers, listProjects, updateMember, updateProject } from "@/server/services/training/projects";
import { changeTaskStatus, addComment, createTask, getTask, listChecklist, listProjectTasks, updateChecklistItem, addChecklistItem, saveTemplate, applyChecklistTemplate } from "@/server/services/training/work";
import { addParticipant, createSchedule, listProjectParticipants, updateParticipant, updateSchedule, uploadDocument } from "@/server/services/training/operations";
import { getTrainingDashboard } from "@/server/services/training/insights";
import { canUserViewProject, listAccessRows, listDirectory, loadProjectAccess, revokeAccessLevel, setAccessLevel } from "@/server/services/training/access";

let fx: TrainingFixtures;
beforeEach(async () => {
  await resetDb();
  fx = await seedTraining();
});

const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const NOT_FOUND = { code: "NOT_FOUND" };
const FORBIDDEN = { code: "FORBIDDEN" };

describe("gerbang modul: siapa yang boleh masuk", () => {
  it("karyawan tanpa level & tanpa keanggotaan: seluruh modul menjawab 404 (keberadaannya tidak bocor)", async () => {
    expect(await fail(listProjects(fx.loner))).toMatchObject(NOT_FOUND);
    expect(await fail(getTrainingDashboard(fx.loner))).toMatchObject(NOT_FOUND);
    expect(await fail(createProject(fx.loner, { name: "Proyek siluman" }))).toMatchObject(NOT_FOUND);
  });

  it("role global HR_ADMIN TIDAK otomatis punya akses ('admin HRIS' ≠ 'Admin Program')", async () => {
    expect(await fail(listProjects(fx.hr))).toMatchObject(NOT_FOUND);
    expect(await fail(createProject(fx.hr, { name: "Dibuat HR" }))).toMatchObject(NOT_FOUND);
  });

  it("Direktur (Super Admin): akses penuh — melihat dan MENGUBAH proyek mana pun tanpa perlu level; semua tercatat di audit", async () => {
    const id = await mkProject(fx.mgr);
    const p = await getProject(fx.superAdmin, id);
    expect([...p.abilities].sort()).toEqual([...PROJECT_ABILITIES].sort());
    await updateProject(fx.superAdmin, id, { name: "Diubah direktur" });
    await createTask(fx.superAdmin, id, { title: "Tugas dari direktur" });
    const made = await createProject(fx.superAdmin, { name: "Dibuat direktur", picEmployeeId: fx.empIds[0] }); // boleh menetapkan PIC
    expect((await listMembers(fx.superAdmin, made.id)).filter((m) => m.active).map((m) => m.role)).toEqual(["PROJECT_MANAGER"]);
    expect((await listProjects(fx.superAdmin)).total).toBe(2);
    expect(await prisma.auditLog.count({ where: { actorId: fx.superAdmin.userId, action: { startsWith: "training.project." } } })).toBeGreaterThanOrEqual(2);
    expect(await prisma.trainingAccess.count({ where: { userId: fx.superAdmin.userId } })).toBe(0); // tanpa baris level
  });

  it("jumlah pemegang level Koordinator Program TIDAK dibatasi; Direktur yang memberi", async () => {
    for (const a of [fx.emp1, fx.emp2, fx.emp3, fx.loner]) await setAccessLevel(fx.superAdmin, { userId: a.userId, level: "COORDINATOR" });
    expect(await prisma.trainingAccess.count({ where: { level: "COORDINATOR" } })).toBe(5); // 4 baru + 1 dari fixture
    const id = await mkProject(fx.mgr);
    for (const a of [fx.emp1, fx.emp2, fx.emp3, fx.loner]) expect((await getProject(a, id)).abilities).toContain("close");
  });

  it("Pemantau (VIEWER): lihat semua, tidak bisa mengubah apa pun (berbeda dari Direktur)", async () => {
    const id = await mkProject(fx.mgr);
    expect((await getProject(fx.viewer, id)).abilities).toEqual(["view"]);
    expect(await fail(updateProject(fx.viewer, id, { name: "x1" }))).toMatchObject(FORBIDDEN);
    expect(await fail(addMember(fx.viewer, id, { employeeId: fx.empIds[0], role: "STAFF" }))).toMatchObject(FORBIDDEN);
    expect(await fail(createProject(fx.viewer, { name: "Baru" }))).toMatchObject(FORBIDDEN);
  });

  it("Pemantau tidak dapat mengubah tugas atau berkomentar (komentar = perubahan data); anggota proyek, Manajer, dan Direktur dapat", async () => {
    const id = await mkProject(fx.mgr);
    await addTeam(fx.mgr, id, [[fx.empIds[0], "PROJECT_MANAGER"], [fx.empIds[1], "STAFF"]]);
    const t = await createTask(fx.emp1, id, { title: "Tugas pemantauan", assigneeId: fx.empIds[1] });
    expect(await fail(addComment(fx.viewer, t.id, { body: "Saya pantau" }))).toMatchObject(FORBIDDEN);
    expect(await fail(changeTaskStatus(fx.viewer, t.id, { status: "DONE" }))).toMatchObject(FORBIDDEN);
    await addComment(fx.superAdmin, t.id, { body: "Dari direktur" });
    await addComment(fx.emp2, t.id, { body: "Anggota boleh" });
    await addComment(fx.mgr, t.id, { body: "Manajer boleh" });
    expect(await prisma.trainingTaskComment.count()).toBe(3);
  });

  it("level modul hanya dapat diatur Super Admin; tercatat di audit dan pemilik akun diberi tahu", async () => {
    expect(await fail(setAccessLevel(fx.mgr, { userId: fx.loner.userId, level: "COORDINATOR" }))).toMatchObject(FORBIDDEN);
    expect(await fail(setAccessLevel(fx.hr, { userId: fx.loner.userId, level: "COORDINATOR" }))).toMatchObject(FORBIDDEN);
    await setAccessLevel(fx.superAdmin, { userId: fx.loner.userId, level: "VIEWER", note: "Pemantau marketing" });
    expect((await listProjects(fx.loner)).total).toBe(0); // kini punya akses modul
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "training.access.grant" } });
    expect(audit).toMatchObject({ entityType: "TrainingAccess", entityId: fx.loner.userId, actorId: fx.superAdmin.userId });
    expect(await prisma.notification.count({ where: { userId: fx.loner.userId, type: "training.access" } })).toBe(1);
    await revokeAccessLevel(fx.superAdmin, { userId: fx.loner.userId });
    expect(await fail(listProjects(fx.loner))).toMatchObject(NOT_FOUND);
    expect(await prisma.auditLog.count({ where: { action: "training.access.revoke" } })).toBe(1);
  });

  it("jabatan HANYA petunjuk: mengubah teks jabatan tidak mengubah izin", async () => {
    const id = await mkProject(fx.mgr);
    await prisma.employee.update({ where: { id: fx.lonerEmp }, data: { position: "Koordinator Program" } });
    expect(await fail(getProject(fx.loner, id))).toMatchObject(NOT_FOUND);
    const rows = await listAccessRows(fx.superAdmin);
    expect(rows.find((r) => r.userId === fx.loner.userId)).toMatchObject({ position: "Koordinator Program", level: null });
  });

  it("Admin Program membuat proyek → otomatis anggota (Admin Program); tidak boleh menetapkan PIC", async () => {
    expect(await fail(createProject(fx.adm, { name: "Dengan PIC", picEmployeeId: fx.empIds[0] }))).toMatchObject(FORBIDDEN);
    const { id } = await createProject(fx.adm, { name: "Batch Jakarta", startDate: inDays(2), endDate: inDays(4) });
    const m = (await listMembers(fx.adm, id)).filter((x) => x.active);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ employeeId: fx.admEmp, role: "ADMIN_PROGRAM" });
    expect(await fail(changeProjectStatus(fx.adm, id, { to: "PREPARATION" }))).toMatchObject(FORBIDDEN); // ubah status = PIC/Manajer
  });

  it("akun berlevel Admin Program TANPA data karyawan ditolak membuat proyek (ia tak akan bisa membukanya)", async () => {
    const { makeUser } = await import("../helpers/db");
    const orphan = await makeUser("orphan@uji.test", "Tanpa Karyawan", "EMPLOYEE", null);
    await prisma.trainingAccess.create({ data: { userId: orphan.userId, level: "ADMIN_PROGRAM", grantedById: fx.superAdmin.userId } });
    expect(await fail(createProject(orphan, { name: "Yatim" }))).toMatchObject(FORBIDDEN);
    expect(await prisma.trainingProject.count()).toBe(0);
  });
});

describe("IDOR: mengganti ID tidak membuka proyek orang lain", () => {
  async function twoProjects() {
    const a = await mkProject(fx.mgr, { name: "Proyek A" });
    const b = await mkProject(fx.mgr, { name: "Proyek B" });
    await addTeam(fx.mgr, a, [[fx.empIds[0], "PROJECT_MANAGER"], [fx.empIds[1], "STAFF"]]);
    await addTeam(fx.mgr, b, [[fx.empIds[2], "PROJECT_MANAGER"]]);
    const tb = await createTask(fx.emp3, b, { title: "Tugas rahasia B" });
    await createTask(fx.emp1, a, { title: "Tugas A", assigneeId: fx.empIds[1] });
    return { a, b, taskB: tb.id };
  }

  it("anggota proyek A mendapat 404 (bukan 403) untuk proyek, tugas, checklist, peserta, jadwal, dan dokumen milik B", async () => {
    const { a, b, taskB } = await twoProjects();
    // sebagai Budi (STAFF di A, bukan anggota B)
    expect((await listProjects(fx.emp2)).items.map((i) => i.id)).toEqual([a]);
    expect(await fail(getProject(fx.emp2, b))).toMatchObject(NOT_FOUND);
    expect(await fail(listProjectTasks(fx.emp2, b))).toMatchObject(NOT_FOUND);
    expect(await fail(getTask(fx.emp2, taskB))).toMatchObject(NOT_FOUND);
    expect(await fail(changeTaskStatus(fx.emp2, taskB, { status: "DONE" }))).toMatchObject(NOT_FOUND);
    expect(await fail(addComment(fx.emp2, taskB, { body: "halo" }))).toMatchObject(NOT_FOUND);
    expect(await fail(listChecklist(fx.emp2, b))).toMatchObject(NOT_FOUND);
    expect(await fail(listProjectParticipants(fx.emp2, b))).toMatchObject(NOT_FOUND);
    expect(await fail(listMembers(fx.emp2, b))).toMatchObject(NOT_FOUND);
  });

  it("ID turunan dari proyek lain tidak dapat dipakai lewat proyek sendiri (anggota, item checklist, jadwal, peserta)", async () => {
    const { a, b } = await twoProjects();
    const memberB = (await listMembers(fx.mgr, b))[0]!;
    // PM proyek A (Ayu) mencoba mengubah/mengakhiri anggota milik proyek B lewat URL proyek A
    expect(await fail(updateMember(fx.emp1, a, memberB.id, { note: "x" }))).toMatchObject(NOT_FOUND);
    expect(await fail(endMember(fx.emp1, a, memberB.id))).toMatchObject(NOT_FOUND);
    const itemB = await addChecklistItem(fx.emp3, b, { phase: "PREPARATION", title: "Item B" });
    expect(await fail(updateChecklistItem(fx.emp1, itemB.id, { isDone: true }))).toMatchObject(NOT_FOUND);
    const sB = await createSchedule(fx.emp3, b, { title: "Sesi B", date: inDays(3), startTime: "09:00", endTime: "10:00" });
    expect(await fail(updateSchedule(fx.emp1, sB.id, { title: "Dibajak" }))).toMatchObject(NOT_FOUND);
    const pB = await addParticipant(fx.emp3, b, { fullName: "Peserta B" });
    expect(await fail(updateParticipant(fx.emp1, pB.id, { fullName: "Dibajak" }))).toMatchObject(NOT_FOUND);
    expect((await prisma.trainingParticipant.findUniqueOrThrow({ where: { id: pB.id } })).fullName).toBe("Peserta B");
  });

  it("ID ngawur (bukan UUID) = 404, bukan 500", async () => {
    await twoProjects();
    expect(await fail(getProject(fx.emp1, "bukan-uuid"))).toMatchObject(NOT_FOUND);
    expect(await fail(getTask(fx.emp1, "123"))).toMatchObject(NOT_FOUND);
    expect(await fail(getProject(fx.emp1, "00000000-0000-4000-8000-000000000000"))).toMatchObject(NOT_FOUND);
  });

  it("berkas dokumen proyek B tidak dapat dibuka anggota proyek A; yang berwenang di B dapat", async () => {
    const { b } = await twoProjects();
    const doc = await uploadDocument(fx.emp3, b, { name: "proposal.pdf", bytes: PDF() }, { category: "PROPOSAL", title: "Proposal B" });
    const fileId = (await prisma.trainingProjectDocument.findUniqueOrThrow({ where: { id: doc.id } })).fileId;
    expect(await fail(readFileForActor(fx.emp2, fileId))).toMatchObject(FORBIDDEN);
    expect(await fail(readFileForActor(fx.loner, fileId))).toMatchObject(FORBIDDEN);
    expect((await readFileForActor(fx.emp3, fileId)).kind).toBe("TRAINING_DOCUMENT");
    expect((await readFileForActor(fx.viewer, fileId)).id).toBe(fileId); // pemantau boleh melihat dokumen non-sensitif
  });

  it("dashboard hanya menghitung proyek dalam lingkup pelaku", async () => {
    await twoProjects();
    const d = await getTrainingDashboard(fx.emp2);
    expect(d.variant).toBe("staff");
    expect(d.counts.projectsInScope).toBe(1);
    expect((await getTrainingDashboard(fx.mgr)).counts.projectsInScope).toBe(2);
  });

  it("anggota yang penugasannya diakhiri langsung kehilangan akses proyek", async () => {
    const { a } = await twoProjects();
    const m = (await listMembers(fx.mgr, a)).find((x) => x.employeeId === fx.empIds[1])!;
    expect((await getProject(fx.emp2, a)).id).toBe(a);
    await endMember(fx.mgr, a, m.id);
    expect(await fail(getProject(fx.emp2, a))).toMatchObject(NOT_FOUND);
  });
});

describe("tim proyek", () => {
  it("hanya Project Manager/Manajer yang mengatur tim; PIC hanya oleh Koordinator Program", async () => {
    const id = await mkProject(fx.mgr);
    await addTeam(fx.mgr, id, [[fx.empIds[0], "PROJECT_MANAGER"], [fx.empIds[1], "STAFF"]]);
    expect(await fail(addMember(fx.emp2, id, { employeeId: fx.empIds[2], role: "STAFF" }))).toMatchObject(FORBIDDEN); // staf
    await addMember(fx.emp1, id, { employeeId: fx.empIds[2], role: "MATERIAL_OWNER" }); // PM boleh menambah non-PIC
    const staffRow = (await listMembers(fx.mgr, id)).find((m) => m.employeeId === fx.empIds[1])!;
    expect(await fail(updateMember(fx.emp1, id, staffRow.id, { role: "PROJECT_MANAGER" }))).toMatchObject({ code: "FORBIDDEN" });
    const pmRow = (await listMembers(fx.mgr, id)).find((m) => m.role === "PROJECT_MANAGER")!;
    expect(await fail(endMember(fx.emp1, id, pmRow.id))).toMatchObject(FORBIDDEN); // PM tak bisa mengakhiri PIC (dirinya)
    await endMember(fx.mgr, id, pmRow.id);
  });

  it("anggota ganda ditolak; setelah diakhiri boleh ditambahkan lagi dan riwayatnya tetap", async () => {
    const id = await mkProject(fx.mgr);
    await addMember(fx.mgr, id, { employeeId: fx.empIds[1], role: "STAFF" });
    expect(await fail(addMember(fx.mgr, id, { employeeId: fx.empIds[1], role: "ADMIN_PROGRAM" }))).toMatchObject({ code: "CONFLICT" });
    const m = (await listMembers(fx.mgr, id))[0]!;
    await endMember(fx.mgr, id, m.id);
    await addMember(fx.mgr, id, { employeeId: fx.empIds[1], role: "ADMIN_PROGRAM" });
    const all = await listMembers(fx.mgr, id);
    expect(all).toHaveLength(2);
    expect(all.filter((x) => x.active)).toHaveLength(1);
    expect(all.find((x) => !x.active)).toMatchObject({ role: "STAFF" });
  });

  it("satu PIC aktif per proyek — dijaga service DAN indeks unik database", async () => {
    const id = await mkProject(fx.mgr);
    await addMember(fx.mgr, id, { employeeId: fx.empIds[0], role: "PROJECT_MANAGER" });
    expect(await fail(addMember(fx.mgr, id, { employeeId: fx.empIds[1], role: "PROJECT_MANAGER" }))).toMatchObject({ code: "CONFLICT" });
    await expect(prisma.trainingProjectMember.create({ data: { projectId: id, employeeId: fx.empIds[1], role: "PROJECT_MANAGER", createdById: fx.mgr.userId } })).rejects.toThrow();
    await expect(prisma.trainingProjectMember.create({ data: { projectId: id, employeeId: fx.empIds[0], role: "STAFF", createdById: fx.mgr.userId } })).rejects.toThrow(); // anggota aktif ganda
  });

  it("karyawan nonaktif tidak dapat ditambahkan; peran proyek tidak mengubah role global HRIS", async () => {
    const id = await mkProject(fx.mgr);
    await prisma.employee.update({ where: { id: fx.empIds[2] }, data: { isActive: false } });
    expect(await fail(addMember(fx.mgr, id, { employeeId: fx.empIds[2], role: "STAFF" }))).toMatchObject({ code: "VALIDATION" });
    await addMember(fx.mgr, id, { employeeId: fx.empIds[0], role: "PROJECT_MANAGER" });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: fx.emp1.userId } })).role).toBe("EMPLOYEE");
  });

  it("akhiri penugasan yang masih memegang tugas: dilaporkan, tugas ditandai perlu dialihkan (tidak diubah diam-diam)", async () => {
    const id = await mkProject(fx.mgr);
    await addTeam(fx.mgr, id, [[fx.empIds[0], "PROJECT_MANAGER"], [fx.empIds[1], "STAFF"]]);
    await createTask(fx.emp1, id, { title: "Siapkan materi", assigneeId: fx.empIds[1] });
    const m = (await listMembers(fx.mgr, id)).find((x) => x.employeeId === fx.empIds[1])!;
    expect(m.openTasks).toBe(1);
    expect(await endMember(fx.mgr, id, m.id)).toEqual({ openTasks: 1 });
    const t = (await listProjectTasks(fx.mgr, id))[0]!;
    expect(t).toMatchObject({ assigneeId: fx.empIds[1], assigneeInactive: true, status: "TODO" });
  });

  it("direktori karyawan untuk memilih anggota: hanya yang berwenang, dan datanya minimal (tanpa kontak/alamat/rekening)", async () => {
    expect(await fail(listDirectory(fx.loner))).toMatchObject(NOT_FOUND);
    const id = await mkProject(fx.mgr);
    await addMember(fx.mgr, id, { employeeId: fx.empIds[1], role: "STAFF" });
    expect(await fail(listDirectory(fx.emp2))).toMatchObject(FORBIDDEN); // anggota staf biasa
    const dir = await listDirectory(fx.mgr);
    expect(dir.length).toBeGreaterThanOrEqual(7);
    expect(Object.keys(dir[0]!).sort()).toEqual(["division", "employeeNo", "fullName", "id", "position"]);
  });
});

describe("penjaga database (defense in depth)", () => {
  it("proyek tidak dapat dihapus, kode tidak dapat diubah, dan lompatan status ditolak lewat SQL langsung", async () => {
    const id = await mkProject(fx.mgr);
    await expect(prisma.trainingProject.delete({ where: { id } })).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.trainingProject.update({ where: { id }, data: { code: "TRN-2026-9999" } })).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.$executeRawUnsafe(`UPDATE training_projects SET status = 'RUNNING' WHERE id = '${id}'`)).rejects.toThrow(/Perubahan status proyek tidak sah/);
  });

  it("status Selesai/Dibatalkan wajib memiliki catatan penutupan/pembatalan lengkap (CHECK)", async () => {
    const id = await mkProject(fx.mgr);
    await addTeam(fx.mgr, id, [[fx.empIds[0], "PROJECT_MANAGER"]]);
    await changeProjectStatus(fx.mgr, id, { to: "PREPARATION" });
    await expect(prisma.$executeRawUnsafe(`UPDATE training_projects SET status = 'COMPLETED' WHERE id = '${id}'`)).rejects.toThrow(/closed_info|check/i);
    await expect(prisma.$executeRawUnsafe(`UPDATE training_projects SET status = 'CANCELLED', "cancelledAt" = now() WHERE id = '${id}'`)).rejects.toThrow(/cancel_info|check/i);
  });

  it("komentar tugas append-only; dokumen tidak dapat dihapus permanen", async () => {
    const id = await mkProject(fx.mgr);
    await addTeam(fx.mgr, id, [[fx.empIds[0], "PROJECT_MANAGER"]]);
    const t = await createTask(fx.emp1, id, { title: "Tugas komentar" });
    await addComment(fx.emp1, t.id, { body: "Catatan awal" });
    const c = await prisma.trainingTaskComment.findFirstOrThrow();
    await expect(prisma.trainingTaskComment.update({ where: { id: c.id }, data: { body: "diubah" } })).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.trainingTaskComment.delete({ where: { id: c.id } })).rejects.toThrow(/HRIS-GUARD/);
    const d = await uploadDocument(fx.emp1, id, { name: "a.pdf", bytes: PDF() }, { category: "OTHER", title: "Lain" });
    await expect(prisma.trainingProjectDocument.delete({ where: { id: d.id } })).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.trainingProjectDocument.update({ where: { id: d.id }, data: { title: "ganti" } })).rejects.toThrow(/HRIS-GUARD/);
  });

  it("modul tidak menyentuh data HRIS: tabel karyawan/pengguna/surat tugas tetap utuh setelah alur lengkap", async () => {
    const before = { u: await prisma.user.count(), e: await prisma.employee.count(), roles: await prisma.user.findMany({ select: { id: true, role: true }, orderBy: { id: "asc" } }) };
    const id = await mkProject(fx.mgr);
    await addTeam(fx.mgr, id, [[fx.empIds[0], "PROJECT_MANAGER"], [fx.empIds[1], "STAFF"]]);
    await saveTemplate(fx.mgr, null, { name: "Template Uji", items: [{ phase: "PREPARATION", title: "Satu", isRequired: true }] });
    const tpl = await prisma.trainingChecklistTemplate.findFirstOrThrow();
    await applyChecklistTemplate(fx.mgr, id, { templateId: tpl.id });
    expect({ u: await prisma.user.count(), e: await prisma.employee.count(), roles: await prisma.user.findMany({ select: { id: true, role: true }, orderBy: { id: "asc" } }) }).toEqual(before);
  });
});

describe("canUserViewProject — aturan yang sama dengan gerbang proyek, untuk pekerja latar belakang", () => {
  it("anggota aktif ya; setelah keanggotaan diakhiri tidak; Manajer/Pemantau/Super Admin ya tanpa keanggotaan; karyawan tanpa level tidak", async () => {
    const id = await mkProject(fx.mgr, {});
    await addTeam(fx.mgr, id, [[fx.empIds[0], "STAFF"]]);
    const subj = (a: { userId: string; employeeId: string | null }, role: "EMPLOYEE" | "SUPER_ADMIN" = "EMPLOYEE") => ({ userId: a.userId, role, employeeId: a.employeeId });
    const can = (a: Parameters<typeof subj>[0], role?: "EMPLOYEE" | "SUPER_ADMIN") => canUserViewProject(prisma, subj(a, role), id);

    expect(await can(fx.emp1)).toBe(true);
    expect(await can(fx.emp2)).toBe(false); // bukan anggota
    expect(await can(fx.mgr)).toBe(true); // level MANAGER
    expect(await can(fx.viewer)).toBe(true); // level VIEWER
    expect(await can(fx.superAdmin, "SUPER_ADMIN")).toBe(true);
    expect(await can(fx.loner)).toBe(false);

    const m = await prisma.trainingProjectMember.findFirstOrThrow({ where: { projectId: id, employeeId: fx.empIds[0], endedAt: null } });
    await endMember(fx.mgr, id, m.id);
    expect(await can(fx.emp1)).toBe(false);

    // identik dengan gerbang yang dipakai halaman/API: yang ditolak di sini juga 404 di sana
    expect(await fail(loadProjectAccess(fx.emp1, id))).toMatchObject(NOT_FOUND);
    await expect(loadProjectAccess(fx.mgr, id)).resolves.toBeTruthy();
  });
});
