/**
 * Model akses Training & Operations — logika MURNI (tanpa database), satu file yang dapat ditinjau & diuji.
 *
 * Tiga lapis, dan HANYA lapis 2–3 yang berkaitan dengan modul ini:
 *   1. Role global HRIS (SUPER_ADMIN / HR_ADMIN / EMPLOYEE) — TIDAK diubah oleh modul ini.
 *      HR_ADMIN tidak otomatis punya hak apa pun di sini ("admin HRIS" ≠ "Admin Program").
 *   2. Level modul per akun (`training_access`): VIEWER / ADMIN_PROGRAM / MANAGER, atau tidak ada.
 *   3. Peran proyek per penugasan (`training_project_members`): menentukan apa yang boleh dilakukan PADA proyek itu.
 *
 * Jabatan karyawan (teks `employees.position`) tidak pernah dipakai untuk izin: hak akses melekat pada orang +
 * penugasan, sehingga pergantian jabatan/rangkap tugas tidak mengubah izin secara diam-diam.
 *
 * Akses lintas proyek tanpa keanggotaan: SUPER_ADMIN (Direktur) dan MANAGER = kelola penuh; VIEWER = hanya lihat.
 * Keputusan pemilik sistem: Direktur boleh mengubah data proyek, dan jumlah pemegang level Koordinator Program TIDAK dibatasi (Direktur yang memberi akses).
 * Menyembunyikan menu hanya kosmetik; penegakan sebenarnya ada di service (lihat services/training/access.ts).
 */
import type { Role } from "@/lib/permissions";
import type { ProjectRole, TrainingLevel } from "./types";

export const PROJECT_ABILITIES = [
  "view",                // melihat proyek, tugas, jadwal, daftar peserta (tanpa kontak), dokumen non-sensitif
  "update",              // mengubah data proyek (nama, lokasi, tanggal, deskripsi, catatan)
  "change_status",       // Draf → Persiapan → Berjalan
  "close",               // menutup proyek (Selesai) — Koordinator Program
  "cancel",              // membatalkan proyek — Koordinator Program
  "reopen",              // membuka kembali proyek Selesai — Koordinator Program
  "manage_team",         // menambah/mengakhiri anggota (selain PIC)
  "manage_pic",          // menetapkan/mengganti Project Manager (PIC) — Koordinator Program
  "manage_tasks",        // membuat/mengubah/menugaskan semua tugas, memeriksa hasil tugas
  "manage_checklist",    // menerapkan template, menambah/mengubah/menghapus item checklist, mengubah status item mana pun
  "manage_participants", // mengelola peserta; juga: melihat KONTAK peserta & dokumen peserta
  "manage_schedule",     // mengelola jadwal
  "manage_instructors",  // menugaskan instruktur/asesor; juga: melihat KONTAK instruktur
  "upload_document",     // mengunggah dokumen
  "delete_document",     // menyembunyikan dokumen siapa pun (pengunggah selalu boleh menghapus miliknya)
  "link_references",     // menautkan surat tugas & referensi sistem lain
] as const;
export type ProjectAbility = (typeof PROJECT_ABILITIES)[number];

export interface AccessSubject {
  /** Role global HRIS akun. */
  role: Role;
  /** Level modul (null = tidak ada). */
  level: TrainingLevel | null;
}

export interface GlobalCaps {
  /** Kelola penuh lintas proyek: Super Admin (Direktur) atau Koordinator Program. */
  fullAccess: boolean;
  /** Melihat SEMUA proyek (bukan hanya yang diikuti). */
  viewAll: boolean;
  /** Membuat proyek baru. */
  createProject: boolean;
  /** Mengelola master program & template checklist. */
  managePrograms: boolean;
  /** Mengelola direktori instruktur/asesor. */
  manageDirectory: boolean;
  /** Melihat kontak pada direktori instruktur. */
  viewDirectoryContacts: boolean;
  /** Mengatur siapa memegang level modul (hanya Super Admin). */
  manageAccess: boolean;
  /** Punya akses modul tanpa harus menjadi anggota proyek. */
  hasModule: boolean;
}

export function globalCaps(s: AccessSubject): GlobalCaps {
  const isSuper = s.role === "SUPER_ADMIN";
  const full = isSuper || s.level === "COORDINATOR";
  return {
    fullAccess: full,
    viewAll: full || s.level === "VIEWER",
    createProject: full || s.level === "ADMIN_PROGRAM",
    managePrograms: full,
    manageDirectory: full || s.level === "ADMIN_PROGRAM",
    viewDirectoryContacts: full || s.level === "ADMIN_PROGRAM",
    manageAccess: isSuper,
    hasModule: isSuper || s.level !== null,
  };
}

const ALL: ReadonlySet<ProjectAbility> = new Set(PROJECT_ABILITIES);

/** Kemampuan menurut PERAN PROYEK. Peran proyek tidak pernah memberi hak di luar proyek itu. */
const BY_PROJECT_ROLE: Record<ProjectRole, readonly ProjectAbility[]> = {
  PROJECT_MANAGER: ["view", "update", "change_status", "manage_team", "manage_tasks", "manage_checklist", "manage_participants", "manage_schedule", "manage_instructors", "upload_document", "delete_document", "link_references"],
  ADMIN_PROGRAM: ["view", "update", "manage_tasks", "manage_checklist", "manage_participants", "manage_schedule", "manage_instructors", "upload_document", "delete_document"],
  PARTICIPANT_OWNER: ["view", "manage_participants", "upload_document"],
  MATERIAL_OWNER: ["view", "upload_document"],
  DOCUMENTATION_OWNER: ["view", "upload_document"],
  STAFF: ["view"],
};

/**
 * Kemampuan `s` pada SATU proyek, diberi peran proyek aktifnya (null = bukan anggota). Gabungan (union):
 *  - MANAGER dan SUPER_ADMIN (Direktur): semua.
 *  - VIEWER (Pemantau): hanya `view`.
 *  - peran proyek: sesuai tabel di atas.
 */
export function projectAbilities(s: AccessSubject, memberRole: ProjectRole | null): ReadonlySet<ProjectAbility> {
  if (globalCaps(s).fullAccess) return ALL;
  const out = new Set<ProjectAbility>();
  if (globalCaps(s).viewAll) out.add("view");
  if (memberRole) for (const a of BY_PROJECT_ROLE[memberRole]) out.add(a);
  return out;
}

/** Menu modul tampil bila akun punya level/Super Admin ATAU menjadi anggota aktif sedikitnya satu proyek. */
export function canSeeModule(s: AccessSubject, hasActiveMembership: boolean): boolean {
  return globalCaps(s).hasModule || hasActiveMembership;
}

/** Peran proyek mana yang boleh ditetapkan `abilities` (PIC khusus Koordinator Program). */
export function assignableRoles(abilities: ReadonlySet<ProjectAbility>): ProjectRole[] {
  const roles: ProjectRole[] = ["ADMIN_PROGRAM", "PARTICIPANT_OWNER", "MATERIAL_OWNER", "DOCUMENTATION_OWNER", "STAFF"];
  if (abilities.has("manage_pic")) roles.unshift("PROJECT_MANAGER");
  return roles;
}
