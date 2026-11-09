import { describe, expect, it } from "vitest";
import { PERMISSIONS, NAV_ITEMS, ROLE_PERMISSIONS, type Role } from "@/lib/permissions";
import { PROJECT_ABILITIES, assignableRoles, canSeeModule, globalCaps, projectAbilities, type AccessSubject, type ProjectAbility } from "@/lib/training/access";
import { PROJECT_ROLES, TRAINING_LEVELS, type ProjectRole, type TrainingLevel } from "@/lib/training/types";
import { trainingNav } from "@/lib/training/nav";
import { suggestLevel } from "@/lib/training/suggest";

const ROLES: Role[] = ["SUPER_ADMIN", "HR_ADMIN", "EMPLOYEE"];
const subj = (role: Role, level: TrainingLevel | null = null): AccessSubject => ({ role, level });
const A = (s: AccessSubject, m: ProjectRole | null = null) => [...projectAbilities(s, m)].sort();

describe("model akses Training & Operations (murni)", () => {
  it("MANAGER memiliki SEMUA kemampuan pada semua proyek, apa pun role globalnya; Super Admin (Direktur) juga memiliki semuanya tanpa perlu level", () => {
    expect(A(subj("SUPER_ADMIN"))).toEqual([...PROJECT_ABILITIES].sort());
    for (const r of ROLES) expect(A(subj(r, "COORDINATOR"))).toEqual([...PROJECT_ABILITIES].sort());
  });

  it("role global HRIS (selain Super Admin) TIDAK memberi kemampuan apa pun tanpa level modul/keanggotaan ('admin HRIS' ≠ 'Admin Program')", () => {
    expect(A(subj("HR_ADMIN"))).toEqual([]);
    expect(A(subj("EMPLOYEE"))).toEqual([]);
    expect(globalCaps(subj("HR_ADMIN"))).toMatchObject({ viewAll: false, createProject: false, managePrograms: false, manageAccess: false, hasModule: false });
  });

  it("Direktur (Super Admin): akses penuh lintas proyek + mengatur akses; Pemantau tetap hanya melihat", () => {
    expect(globalCaps(subj("SUPER_ADMIN"))).toMatchObject({ fullAccess: true, viewAll: true, createProject: true, managePrograms: true, manageDirectory: true, manageAccess: true });
    expect(A(subj("EMPLOYEE", "VIEWER"))).toEqual(["view"]);
    expect(globalCaps(subj("EMPLOYEE", "VIEWER"))).toMatchObject({ fullAccess: false, viewAll: true, manageAccess: false, createProject: false, managePrograms: false });
    // Role HRIS lain TIDAK mendapat akses penuh walau mengatur akun: hanya Super Admin atau pemegang level Koordinator Program.
    expect(globalCaps(subj("HR_ADMIN")).fullAccess).toBe(false);
    expect(globalCaps(subj("EMPLOYEE", "COORDINATOR")).fullAccess).toBe(true);
  });

  it("hanya Super Admin yang mengatur akses modul; level Manajer tidak cukup", () => {
    for (const r of ROLES) for (const l of [null, ...TRAINING_LEVELS]) expect(globalCaps(subj(r, l)).manageAccess).toBe(r === "SUPER_ADMIN");
  });

  it("Admin Program (level): boleh membuat proyek, tetapi tanpa keanggotaan tidak punya kemampuan atas proyek mana pun", () => {
    expect(globalCaps(subj("EMPLOYEE", "ADMIN_PROGRAM"))).toMatchObject({ createProject: true, manageDirectory: true, viewAll: false, managePrograms: false });
    expect(A(subj("EMPLOYEE", "ADMIN_PROGRAM"))).toEqual([]);
  });

  it("kemampuan peran proyek: PIC kuat tetapi tidak boleh menutup/membatalkan/membuka kembali/mengganti PIC", () => {
    const pm = new Set(A(subj("EMPLOYEE"), "PROJECT_MANAGER"));
    for (const a of ["view", "update", "change_status", "manage_team", "manage_tasks", "manage_checklist", "manage_participants", "manage_schedule", "manage_instructors", "upload_document", "link_references"] as ProjectAbility[]) expect(pm.has(a)).toBe(true);
    for (const a of ["close", "cancel", "reopen", "manage_pic"] as ProjectAbility[]) expect(pm.has(a)).toBe(false);
  });

  it("Admin Program (peran proyek) tidak mengatur tim/status; Staf hanya melihat; PJ Peserta mengelola peserta saja", () => {
    const adm = new Set(A(subj("EMPLOYEE"), "ADMIN_PROGRAM"));
    expect(adm.has("manage_team")).toBe(false);
    expect(adm.has("change_status")).toBe(false);
    expect(adm.has("manage_participants")).toBe(true);
    expect(A(subj("EMPLOYEE"), "STAFF")).toEqual(["view"]);
    expect(A(subj("EMPLOYEE"), "PARTICIPANT_OWNER")).toEqual(["manage_participants", "upload_document", "view"]);
    expect(A(subj("EMPLOYEE"), "MATERIAL_OWNER")).toEqual(["upload_document", "view"]);
    expect(A(subj("EMPLOYEE"), "DOCUMENTATION_OWNER")).toEqual(["upload_document", "view"]);
  });

  it("level + peran digabung (union) dan peran proyek tidak pernah melebihi proyeknya", () => {
    const viewerAsStaff = A(subj("EMPLOYEE", "VIEWER"), "PARTICIPANT_OWNER");
    expect(viewerAsStaff).toEqual(["manage_participants", "upload_document", "view"]);
    // Peran proyek tidak memberi kemampuan tingkat-modul: tanpa level, akun tetap bukan pemegang modul (menu tampil karena keanggotaan).
    expect(globalCaps(subj("EMPLOYEE", null))).toMatchObject({ hasModule: false, viewAll: false, createProject: false, manageDirectory: false });
    for (const role of PROJECT_ROLES) expect(projectAbilities(subj("EMPLOYEE", null), role).has("manage_pic")).toBe(false);
  });

  it("menu modul tampil untuk Super Admin, pemegang level, atau anggota proyek; tidak untuk selain itu", () => {
    expect(canSeeModule(subj("HR_ADMIN"), false)).toBe(false);
    expect(canSeeModule(subj("EMPLOYEE"), false)).toBe(false);
    expect(canSeeModule(subj("EMPLOYEE"), true)).toBe(true);
    expect(canSeeModule(subj("EMPLOYEE", "VIEWER"), false)).toBe(true);
    expect(canSeeModule(subj("SUPER_ADMIN"), false)).toBe(true);
  });

  it("PIC hanya dapat ditetapkan oleh yang memiliki manage_pic", () => {
    expect(assignableRoles(projectAbilities(subj("EMPLOYEE", "COORDINATOR"), null))).toContain("PROJECT_MANAGER");
    expect(assignableRoles(projectAbilities(subj("EMPLOYEE"), "PROJECT_MANAGER"))).not.toContain("PROJECT_MANAGER");
  });

  it("menu: Akses Training hanya untuk Super Admin; Tugas Saya butuh data karyawan", () => {
    const labels = (s: AccessSubject, emp: boolean) => trainingNav(globalCaps(s), emp).map((i) => i.label);
    expect(labels(subj("SUPER_ADMIN"), false)).toContain("Akses Training");
    expect(labels(subj("SUPER_ADMIN"), false)).not.toContain("Tugas Saya");
    expect(labels(subj("EMPLOYEE", "COORDINATOR"), true)).not.toContain("Akses Training");
    expect(labels(subj("EMPLOYEE", "COORDINATOR"), true)).toContain("Tugas Saya");
    expect(trainingNav(globalCaps(subj("EMPLOYEE")), true).every((i) => i.href.startsWith("/training"))).toBe(true);
  });

  it("izin & menu HRIS TIDAK diubah: tidak ada izin/menu training pada matriks HRIS (modul ini independen)", () => {
    expect(PERMISSIONS.some((p) => /training/i.test(p))).toBe(false);
    expect(NAV_ITEMS.some((i) => i.href.startsWith("/training"))).toBe(false);
    expect([...ROLE_PERMISSIONS.HR_ADMIN].some((p) => /training/i.test(p))).toBe(false);
  });
});

describe("usulan level dari jabatan (bagan organisasi) — hanya petunjuk", () => {
  const level = (p: string | null) => suggestLevel(p).level;
  it("memetakan jabatan pada bagan organisasi", () => {
    expect(level("Manajer Operasional & Keuangan")).toBe("VIEWER");
    expect(level("Supervisor Administrasi & Kurikulum")).toBe("COORDINATOR");
    expect(level("Staf Adm. & Kurikulum")).toBe("ADMIN_PROGRAM");
    expect(level("Staf Administrasi & Kurikulum")).toBe("ADMIN_PROGRAM");
    expect(level("Manajer Marketing & Relations")).toBe("VIEWER");
  });
  it("jabatan lain/kosong tidak mendapat usulan level; Direktur = Super Admin", () => {
    for (const p of ["Staf Administrasi Umum", "Supervisor IT & Web Development", "Staf Administrasi Keuangan", "Staf Admisi 1", "Staf Social Media Specialist", "Peserta Magang Sosial Media", "", null, undefined]) expect(level(p as string | null)).toBeNull();
    expect(level("Direktur Utama")).toBeNull();
    expect(suggestLevel("Direktur Utama").reason).toContain("Super Admin");
  });
});
