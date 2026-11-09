/**
 * Penyelarasan peran & wewenang dengan Buku SOP Trilogika Edutama Rev 0.5:
 *  - tingkat jabatan (Staf / Supervisor / Manajer) tersimpan eksplisit, tercatat di riwayat, dengan petunjuk lunak;
 *  - tingkat Manajer otomatis = Pemantau Training (hanya baca, kontak peserta tersembunyi); level manual menimpa;
 *  - level modul "Koordinator Program" (COORDINATOR) menggantikan nama lama (MANAGER);
 *  - aturan MAGANG: tidak boleh memegang fungsi penyetuju / akses data peserta, dan tidak boleh melihat DAFTAR peserta
 *    (angka agregat dashboard tetap boleh); menjadi Magang diblok selama masih memegang fungsi.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import type { Actor } from "@/server/actor";
import { todayIso } from "@/lib/time";
import { resetDb, makeEmployee, makeUser } from "../helpers/db";
import { addTeam, mkProject, seedTraining, TODAY, type TrainingFixtures } from "../helpers/training";
import { changeOrg, createDelegation, getOrgProfile, listOrgHistory } from "@/server/services/org";
import { updateEmployee } from "@/server/services/employees";
import { createUser, updateUser } from "@/server/services/users";
import { getModuleContext, listAccessRows, setAccessLevel } from "@/server/services/training/access";
import { addMember, createProject, getProject, listMembers, listProjects, updateMember } from "@/server/services/training/projects";
import { addParticipant, listAllParticipants, listProjectParticipants } from "@/server/services/training/operations";
import { getTrainingDashboard } from "@/server/services/training/insights";
import { addDays } from "@/lib/time";

let fx: TrainingFixtures;
let projectId: string;
let magang: Actor;
let magangEmp: string;

const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const FORBIDDEN = { code: "FORBIDDEN" };
const NOT_FOUND = { code: "NOT_FOUND" };
const VALIDATION = { code: "VALIDATION" };
const eff = () => todayIso("Asia/Jakarta");

async function setJobLevel(employeeId: string, jobLevel: "STAFF" | "SUPERVISOR" | "MANAGER") {
  return changeOrg(fx.hr, employeeId, { jobLevel, effectiveFrom: eff() });
}

beforeEach(async () => {
  await resetDb();
  fx = await seedTraining();
  projectId = await mkProject(fx.mgr);
  await addTeam(fx.mgr, projectId, [[fx.empIds[0], "PROJECT_MANAGER"], [fx.empIds[1], "STAFF"]]);
  await addParticipant(fx.mgr, projectId, { fullName: "Peserta Satu", email: "peserta1@uji.test", phone: "0812000111" });
  // Karyawan berstatus Magang dengan akun (peran akun Karyawan).
  const e = await prisma.employee.create({ data: { employeeNo: "TE-090", fullName: "Mira Magang", position: "Magang Administrasi", employmentStatus: "INTERN", joinDate: isoToDate("2026-01-05"), divisionId: fx.divisionA } });
  magang = await makeUser("mira@uji.test", "Mira Magang", "EMPLOYEE", e.id);
  magangEmp = e.id;
});

describe("tingkat jabatan: tersimpan eksplisit, tercatat di riwayat, petunjuk lunak", () => {
  it("bawaan Staf; HR mengubahnya lewat changeOrg → tercatat JOB_LEVEL di riwayat & audit, ada snapshot sebelum/sesudah", async () => {
    expect((await getOrgProfile(fx.hr, fx.mgrEmp)).jobLevel).toBe("STAFF");
    const p = await changeOrg(fx.hr, fx.mgrEmp, { jobLevel: "MANAGER", effectiveFrom: eff(), note: "Pengangkatan Manajer" });
    expect(p.jobLevel).toBe("MANAGER");
    const h = await listOrgHistory(fx.hr, fx.mgrEmp);
    expect(h[0]).toMatchObject({ changes: ["JOB_LEVEL"], jobLevel: "MANAGER" });
    expect(h.some((x) => x.changes.includes("BASELINE") && x.jobLevel === "STAFF")).toBe(true);
    const audit = await prisma.auditLog.findFirst({ where: { action: "employee.org_change", entityId: fx.mgrEmp }, orderBy: { createdAt: "desc" } });
    expect(audit?.after).toMatchObject({ jobLevel: "MANAGER" });
    expect(audit?.before).toMatchObject({ jobLevel: "STAFF" });
  });

  it("mengirim tingkat yang sama = tidak ada perubahan (ditolak); karyawan biasa tidak boleh mengubah tingkat", async () => {
    expect(await fail(setJobLevel(fx.mgrEmp, "STAFF"))).toMatchObject(VALIDATION);
    expect(await fail(changeOrg(fx.emp1, fx.empIds[1], { jobLevel: "MANAGER", effectiveFrom: eff() }))).toMatchObject(FORBIDDEN);
  });

  it("petunjuk lunak: Manajer tanpa atasan Direktur / Staf berada di bawah Staf dimunculkan, tetapi TIDAK memblokir penyimpanan", async () => {
    await changeOrg(fx.hr, fx.empIds[0], { jobLevel: "MANAGER", supervisorId: fx.empIds[1], effectiveFrom: eff() }); // atasan Manajer = Staf
    const p = await getOrgProfile(fx.hr, fx.empIds[0]);
    expect(p.jobLevel).toBe("MANAGER");
    expect(p.hints.length).toBeGreaterThan(0);
  });

  it("DB menolak Magang yang bertingkat bukan-Staf (CHECK employees_intern_staff_level)", async () => {
    await expect(prisma.employee.update({ where: { id: magangEmp }, data: { jobLevel: "MANAGER" } })).rejects.toThrow(/employees_intern_staff_level/);
    expect(await fail(changeOrg(fx.hr, magangEmp, { jobLevel: "SUPERVISOR", effectiveFrom: eff() }))).toMatchObject(VALIDATION);
  });
});

describe("Manajer otomatis = Pemantau Training; level manual menimpa", () => {
  it("tingkat Manajer tanpa baris level → Pemantau otomatis: melihat semua proyek & peserta, tidak bisa mengubah, kontak peserta tersembunyi", async () => {
    expect((await getModuleContext(fx.loner)).canSee).toBe(false);
    await setJobLevel(fx.lonerEmp, "MANAGER");
    const ctx = await getModuleContext(fx.loner);
    expect(ctx).toMatchObject({ canSee: true, level: "VIEWER", levelSource: "AUTO_MANAGER" });
    expect(await prisma.trainingAccess.count({ where: { userId: fx.loner.userId } })).toBe(0); // dihitung saat berjalan, tidak disimpan

    expect((await listProjects(fx.loner)).total).toBe(1);
    const p = await getProject(fx.loner, projectId);
    expect(p.abilities).toContain("view");
    expect(p.abilities).not.toContain("update");
    expect(await fail(createProject(fx.loner, { name: "Tidak boleh" }))).toMatchObject(FORBIDDEN);
    expect(await fail(addMember(fx.loner, projectId, { employeeId: fx.empIds[2], role: "STAFF" }))).toMatchObject(FORBIDDEN);

    const parts = await listProjectParticipants(fx.loner, projectId);
    expect(parts).toHaveLength(1);
    expect(JSON.stringify(parts)).not.toContain("peserta1@uji.test");
    expect(JSON.stringify(parts)).not.toContain("0812000111");
  });

  it("tingkat Supervisor/Staf TIDAK memberi akses modul apa pun", async () => {
    await setJobLevel(fx.lonerEmp, "SUPERVISOR");
    expect((await getModuleContext(fx.loner)).canSee).toBe(false);
    expect(await fail(listProjects(fx.loner))).toMatchObject(NOT_FOUND);
  });

  it("level manual menimpa otomatis: Manajer yang diberi Admin Program berfungsi sebagai Admin Program; kembali otomatis setelah dicabut", async () => {
    await setJobLevel(fx.lonerEmp, "MANAGER");
    await setAccessLevel(fx.superAdmin, { userId: fx.loner.userId, level: "ADMIN_PROGRAM" });
    expect(await getModuleContext(fx.loner)).toMatchObject({ level: "ADMIN_PROGRAM", levelSource: "MANUAL" });
    expect((await createProject(fx.loner, { name: "Dibuat Manajer berlevel" })).id).toBeTruthy();
    await prisma.trainingAccess.delete({ where: { userId: fx.loner.userId } });
    expect(await getModuleContext(fx.loner)).toMatchObject({ level: "VIEWER", levelSource: "AUTO_MANAGER" });
  });

  it("level Koordinator Program (COORDINATOR) tersimpan di database dengan nama baru; daftar akses memuat tingkat jabatan & status Magang", async () => {
    const rows = await listAccessRows(fx.superAdmin);
    const maya = rows.find((r) => r.userId === fx.mgr.userId)!;
    expect(maya.level).toBe("COORDINATOR");
    expect(maya.jobLevel).toBe("STAFF");
    expect(rows.find((r) => r.userId === magang.userId)?.intern).toBe(true);
    const labels = await prisma.$queryRaw<{ v: string }[]>`SELECT enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'TrainingLevel'`;
    expect(labels.map((l) => l.v).sort()).toEqual(["ADMIN_PROGRAM", "COORDINATOR", "VIEWER"]);
  });

  it("dashboard memperlakukan Manajer otomatis sebagai Pemantau (varian Direktur, hanya baca)", async () => {
    await setJobLevel(fx.lonerEmp, "MANAGER");
    const d = await getTrainingDashboard(fx.loner);
    expect(d.variant).toBe("director");
  });
});

describe("aturan Magang: pemberian fungsi ditolak di setiap pintu", () => {
  it("akun Magang tidak boleh diberi peran Admin/HR atau Super Admin (buat akun maupun ubah akun)", async () => {
    const e = await prisma.employee.create({ data: { employeeNo: "TE-091", fullName: "Nanda Magang", position: "Magang", employmentStatus: "INTERN", joinDate: isoToDate("2026-02-02") } });
    expect(await fail(createUser(fx.superAdmin, { email: "nanda@uji.test", name: "Nanda Magang", role: "HR_ADMIN", password: "Sandi-Aman-12345!", employeeId: e.id }))).toMatchObject(VALIDATION);
    const ok = await createUser(fx.superAdmin, { email: "nanda@uji.test", name: "Nanda Magang", role: "EMPLOYEE", password: "Sandi-Aman-12345!", employeeId: e.id });
    expect(ok.role).toBe("EMPLOYEE");
    expect(await fail(updateUser(fx.superAdmin, magang.userId, { role: "HR_ADMIN" }))).toMatchObject(VALIDATION);
    expect(await fail(updateUser(fx.superAdmin, magang.userId, { role: "SUPER_ADMIN" }))).toMatchObject(VALIDATION);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: magang.userId } })).role).toBe("EMPLOYEE");
  });

  it("level modul Training tidak dapat diberikan kepada Magang (semua level)", async () => {
    for (const level of ["VIEWER", "ADMIN_PROGRAM", "COORDINATOR"] as const) {
      expect(await fail(setAccessLevel(fx.superAdmin, { userId: magang.userId, level }))).toMatchObject(VALIDATION);
    }
    expect(await prisma.trainingAccess.count({ where: { userId: magang.userId } })).toBe(0);
  });

  it("peran proyek PIC / Admin Program / PJ Peserta ditolak untuk Magang; Staf, PJ Materi, PJ Dokumentasi diperbolehkan", async () => {
    for (const role of ["PROJECT_MANAGER", "ADMIN_PROGRAM", "PARTICIPANT_OWNER"] as const) {
      expect(await fail(addMember(fx.mgr, projectId, { employeeId: magangEmp, role }))).toMatchObject(VALIDATION);
    }
    await addMember(fx.mgr, projectId, { employeeId: magangEmp, role: "DOCUMENTATION_OWNER" });
    const m = (await listMembers(fx.mgr, projectId)).find((x) => x.employeeId === magangEmp)!;
    expect(await fail(updateMember(fx.mgr, projectId, m.id, { role: "ADMIN_PROGRAM" }))).toMatchObject(VALIDATION);
    expect(await fail(updateMember(fx.mgr, projectId, m.id, { role: "PARTICIPANT_OWNER" }))).toMatchObject(VALIDATION);
    await updateMember(fx.mgr, projectId, m.id, { role: "STAFF" });
  });

  it("Magang tidak boleh menjadi atasan langsung maupun pengganti peninjau pengajuan", async () => {
    expect(await fail(changeOrg(fx.hr, fx.empIds[0], { supervisorId: magangEmp, effectiveFrom: eff() }))).toMatchObject(VALIDATION);
    const start = TODAY();
    expect(await fail(createDelegation(fx.emp1, { delegateId: magangEmp, startDate: start, endDate: addDays(start, 3) }))).toMatchObject(VALIDATION);
  });
});

describe("aturan Magang: daftar peserta tertutup, angka agregat tetap tampil", () => {
  beforeEach(async () => {
    await addMember(fx.mgr, projectId, { employeeId: magangEmp, role: "STAFF" });
  });

  it("anggota Magang boleh melihat proyeknya, tetapi daftar peserta (per proyek & lintas proyek) menjawab 403", async () => {
    const p = await getProject(magang, projectId);
    expect(p.abilities).toContain("view");
    expect(p.abilities).not.toContain("view_participants");
    expect(await fail(listProjectParticipants(magang, projectId))).toMatchObject(FORBIDDEN);
    expect(await fail(listAllParticipants(magang))).toMatchObject(FORBIDDEN);
    // staf non-Magang pada proyek yang sama tetap boleh (tanpa kontak)
    expect(await listProjectParticipants(fx.emp2, projectId)).toHaveLength(1);
  });

  it("dashboard Training untuk Magang tetap memuat angka agregat", async () => {
    const d = await getTrainingDashboard(magang);
    expect(d).toBeTruthy();
    expect((await getModuleContext(magang)).caps.viewParticipants).toBe(false);
  });

  it("pertahanan saat berjalan: baris level yang disusupkan langsung ke tabel TIDAK berlaku bagi Magang", async () => {
    await prisma.trainingAccess.create({ data: { userId: magang.userId, level: "COORDINATOR", grantedById: fx.superAdmin.userId } });
    const ctx = await getModuleContext(magang);
    expect(ctx.level).toBeNull();
    expect(ctx.caps.fullAccess).toBe(false);
    expect(await fail(createProject(magang, { name: "Penyusup" }))).toBeTruthy();
    const p = await getProject(magang, projectId);
    expect(p.abilities).not.toContain("update");
    expect(p.abilities).not.toContain("manage_participants");
  });

  it("pertahanan saat berjalan: peran proyek PIC yang disusupkan langsung ke tabel dipangkas ke baca + unggah dokumen", async () => {
    await prisma.trainingProjectMember.updateMany({ where: { projectId, employeeId: magangEmp }, data: { role: "ADMIN_PROGRAM" } });
    const p = await getProject(magang, projectId);
    expect([...p.abilities].sort()).toEqual(["upload_document", "view"]);
    expect(await fail(listProjectParticipants(magang, projectId))).toMatchObject(FORBIDDEN);
  });
});

describe("mengubah status menjadi Magang diblok selama masih memegang fungsi", () => {
  const baseOf = async (employeeId: string) => {
    const e = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
    return { employeeNo: e.employeeNo, fullName: e.fullName, divisionId: e.divisionId, position: e.position, employmentStatus: e.employmentStatus, joinDate: "2025-01-01" };
  };

  it("diblok bila masih Koordinator Program / bertingkat Manajer / atasan langsung / peran proyek PIC — daftar fungsi disebut; lolos setelah dicabut", async () => {
    // Maya: Koordinator Program (level) + PIC? (PIC Ayu). Beri Maya tingkat Supervisor dan satu bawahan.
    await setJobLevel(fx.mgrEmp, "SUPERVISOR");
    await changeOrg(fx.hr, fx.empIds[2], { supervisorId: fx.mgrEmp, effectiveFrom: eff() });
    const e = await fail(changeOrg(fx.hr, fx.mgrEmp, { employmentStatus: "INTERN", effectiveFrom: eff() }));
    expect(e).toMatchObject(VALIDATION);
    expect(e?.message).toContain("Koordinator Program");
    expect(e?.message).toContain("tingkat jabatan Supervisor");
    expect(e?.message).toContain("atasan langsung");
    // lewat formulir data karyawan juga diblok
    expect(await fail(updateEmployee(fx.hr, fx.mgrEmp, { ...(await baseOf(fx.mgrEmp)), employmentStatus: "INTERN" }))).toMatchObject(VALIDATION);
    expect((await prisma.employee.findUniqueOrThrow({ where: { id: fx.mgrEmp } })).employmentStatus).toBe("PERMANENT"); // tidak ada yang berubah

    // cabut semuanya → lolos
    await prisma.trainingAccess.delete({ where: { userId: fx.mgr.userId } });
    await changeOrg(fx.hr, fx.empIds[2], { supervisorId: null, effectiveFrom: eff() });
    await setJobLevel(fx.mgrEmp, "STAFF");
    const p = await changeOrg(fx.hr, fx.mgrEmp, { employmentStatus: "INTERN", effectiveFrom: eff() });
    expect(p.employmentStatus).toBe("INTERN");
  });

  it("diblok bila masih memegang peran proyek penyetuju (Admin Program) atau menjadi pengganti peninjau", async () => {
    const e1 = await makeEmployee({ employeeNo: "TE-092", fullName: "Rani Calon Magang", divisionId: fx.divisionA });
    await makeUser("rani@uji.test", "Rani Calon Magang", "EMPLOYEE", e1.id);
    await addMember(fx.mgr, projectId, { employeeId: e1.id, role: "ADMIN_PROGRAM" });
    const blocked = await fail(changeOrg(fx.hr, e1.id, { employmentStatus: "INTERN", effectiveFrom: eff() }));
    expect(blocked).toMatchObject(VALIDATION);
    expect(blocked?.message).toContain("Admin Program");
    const m = (await listMembers(fx.mgr, projectId)).find((x) => x.employeeId === e1.id)!;
    await updateMember(fx.mgr, projectId, m.id, { role: "STAFF" });

    const start = TODAY();
    await createDelegation(fx.emp1, { delegateId: e1.id, startDate: start, endDate: addDays(start, 3) });
    expect((await fail(changeOrg(fx.hr, e1.id, { employmentStatus: "INTERN", effectiveFrom: eff() })))?.message).toContain("pengganti peninjau");
  });

  it("karyawan biasa tanpa fungsi apa pun boleh menjadi Magang", async () => {
    const e = await makeEmployee({ employeeNo: "TE-093", fullName: "Tia Staf Biasa", divisionId: fx.divisionA });
    const p = await changeOrg(fx.hr, e.id, { employmentStatus: "INTERN", effectiveFrom: eff() });
    expect(p.employmentStatus).toBe("INTERN");
  });
});
