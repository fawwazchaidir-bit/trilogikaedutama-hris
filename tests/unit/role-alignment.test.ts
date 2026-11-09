/**
 * Penyelarasan peran dengan SOP Rev 0.5 (logika murni): tingkat Manajer = Pemantau otomatis, level manual menang, akun Magang tanpa
 * level/daftar peserta/wewenang proyek, dan petunjuk hierarki tingkat jabatan.
 */
import { describe, expect, it } from "vitest";
import { effectiveLevel, globalCaps, projectAbilities, INTERN_FORBIDDEN_PROJECT_ROLES, type AccessSubject } from "@/lib/training/access";
import { hierarchyHints, JOB_LEVELS } from "@/lib/org-level";
import { PROJECT_ROLES } from "@/lib/training/types";

const emp = (over: Partial<AccessSubject> = {}): AccessSubject => ({ role: "EMPLOYEE", level: null, jobLevel: "STAFF", intern: false, ...over });

describe("level yang berlaku", () => {
  it("tingkat Manajer tanpa level manual = Pemantau otomatis; Staf/Supervisor tidak", () => {
    expect(effectiveLevel(emp({ jobLevel: "MANAGER" }))).toEqual({ level: "VIEWER", source: "AUTO_MANAGER" });
    expect(effectiveLevel(emp({ jobLevel: "SUPERVISOR" }))).toEqual({ level: null, source: null });
    expect(effectiveLevel(emp({ jobLevel: "STAFF" }))).toEqual({ level: null, source: null });
    expect(effectiveLevel(emp({ jobLevel: null }))).toEqual({ level: null, source: null });
  });
  it("level manual menang atas otomatis (Manajer yang perlu melihat kontak diberi level manual)", () => {
    expect(effectiveLevel(emp({ jobLevel: "MANAGER", level: "ADMIN_PROGRAM" }))).toEqual({ level: "ADMIN_PROGRAM", source: "MANUAL" });
    expect(effectiveLevel(emp({ jobLevel: "MANAGER", level: "COORDINATOR" }))).toEqual({ level: "COORDINATOR", source: "MANUAL" });
  });
  it("akun Magang tidak pernah punya level, walau ada level manual atau tingkat Manajer yang menyimpang", () => {
    expect(effectiveLevel(emp({ intern: true, level: "ADMIN_PROGRAM" }))).toEqual({ level: null, source: null });
    expect(effectiveLevel(emp({ intern: true, jobLevel: "MANAGER" }))).toEqual({ level: null, source: null });
  });
});

describe("kemampuan lintas proyek", () => {
  it("Manajer otomatis: melihat seluruh proyek & modul, tetapi tidak membuat/mengelola", () => {
    const c = globalCaps(emp({ jobLevel: "MANAGER" }));
    expect(c).toMatchObject({ hasModule: true, viewAll: true, viewParticipants: true, fullAccess: false, createProject: false, managePrograms: false, manageAccess: false, viewDirectoryContacts: false });
  });
  it("Koordinator Program = kelola penuh; Direktur = kelola penuh + atur akses", () => {
    expect(globalCaps(emp({ level: "COORDINATOR" }))).toMatchObject({ fullAccess: true, managePrograms: true, manageAccess: false });
    expect(globalCaps({ role: "SUPER_ADMIN", level: null })).toMatchObject({ fullAccess: true, manageAccess: true });
  });
  it("Magang: tanpa modul, tanpa daftar peserta; Super Admin yang berstatus Magang (data menyimpang) kehilangan kelola penuh", () => {
    expect(globalCaps(emp({ intern: true }))).toMatchObject({ hasModule: false, viewAll: false, viewParticipants: false });
    expect(globalCaps(emp({ intern: true, level: "COORDINATOR" }))).toMatchObject({ hasModule: false, fullAccess: false });
    expect(globalCaps({ role: "SUPER_ADMIN", level: null, intern: true })).toMatchObject({ fullAccess: false, manageAccess: false });
  });
});

describe("kemampuan pada satu proyek", () => {
  it("Pemantau otomatis melihat proyek & DAFTAR peserta tetapi bukan kontak (manage_participants)", () => {
    const a = projectAbilities(emp({ jobLevel: "MANAGER" }), null);
    expect(a.has("view")).toBe(true);
    expect(a.has("view_participants")).toBe(true);
    expect(a.has("manage_participants")).toBe(false);
    expect(a.has("update")).toBe(false);
  });
  it("Magang berperan Staf Pelaksana / PJ Dokumentasi: hanya lihat proyek (+ unggah dokumen untuk PJ Dokumentasi); tidak ada daftar peserta", () => {
    const staf = projectAbilities(emp({ intern: true }), "STAFF");
    expect([...staf].sort()).toEqual(["view"]);
    const dok = projectAbilities(emp({ intern: true }), "DOCUMENTATION_OWNER");
    expect([...dok].sort()).toEqual(["upload_document", "view"]);
    expect(dok.has("view_participants")).toBe(false);
  });
  it("pertahanan berlapis: Magang yang (karena data menyimpang) memegang peran terlarang tetap tidak mendapat wewenangnya", () => {
    for (const role of INTERN_FORBIDDEN_PROJECT_ROLES) {
      const a = projectAbilities(emp({ intern: true }), role);
      expect(a.has("manage_participants")).toBe(false);
      expect(a.has("view_participants")).toBe(false);
      expect(a.has("manage_tasks")).toBe(false);
      expect(a.has("change_status")).toBe(false);
    }
  });
  it("semua peran proyek non-Magang mempertahankan akses daftar peserta (tidak ada regresi)", () => {
    for (const role of PROJECT_ROLES) expect(projectAbilities(emp(), role).has("view_participants")).toBe(true);
  });
});

describe("tingkat jabatan & petunjuk hierarki", () => {
  it("tiga tingkat eksplisit", () => { expect([...JOB_LEVELS]).toEqual(["STAFF", "SUPERVISOR", "MANAGER"]); });
  it("petunjuk lunak: Manajer di bawah non-Direktur, Supervisor di bawah Staf, Staf di bawah Staf", () => {
    expect(hierarchyHints({ level: "MANAGER", supervisor: { level: "MANAGER", isDirector: false } })).toHaveLength(1);
    expect(hierarchyHints({ level: "MANAGER", supervisor: { level: "STAFF", isDirector: true } })).toEqual([]);
    expect(hierarchyHints({ level: "MANAGER", supervisor: null })).toEqual([]);
    expect(hierarchyHints({ level: "SUPERVISOR", supervisor: { level: "MANAGER", isDirector: false } })).toEqual([]);
    expect(hierarchyHints({ level: "SUPERVISOR", supervisor: { level: "STAFF", isDirector: false } })).toHaveLength(1);
    expect(hierarchyHints({ level: "STAFF", supervisor: { level: "STAFF", isDirector: false } })).toHaveLength(1);
    expect(hierarchyHints({ level: "STAFF", supervisor: { level: "SUPERVISOR", isDirector: false } })).toEqual([]);
  });
});
