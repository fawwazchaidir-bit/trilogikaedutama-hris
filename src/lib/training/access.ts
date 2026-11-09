/**
 * Model akses Training & Operations — logika MURNI (tanpa database), satu file yang dapat ditinjau & diuji.
 *
 * Tiga lapis, dan HANYA lapis 2–3 yang berkaitan dengan modul ini:
 *   1. Role global HRIS (SUPER_ADMIN / HR_ADMIN / EMPLOYEE) — TIDAK diubah oleh modul ini.
 *      HR_ADMIN tidak otomatis punya hak apa pun di sini ("admin HRIS" ≠ "Admin Program").
 *   2. Level modul per akun (`training_access`): VIEWER / ADMIN_PROGRAM / COORDINATOR, atau tidak ada. Tingkat jabatan Manajer otomatis = Pemantau.
 *   3. Peran proyek per penugasan (`training_project_members`): menentukan apa yang boleh dilakukan PADA proyek itu.
 *
 * Jabatan karyawan (teks `employees.position`) tidak pernah dipakai untuk izin: hak akses melekat pada orang +
 * penugasan, sehingga pergantian jabatan/rangkap tugas tidak mengubah izin secara diam-diam.
 *
 * Akses lintas proyek tanpa keanggotaan: SUPER_ADMIN (Direktur) dan COORDINATOR (Koordinator Program) = kelola penuh; VIEWER = hanya lihat.
 * Akun berstatus Magang: tanpa level, tanpa daftar peserta, tanpa wewenang persetujuan (SOP Rev 0.5).
 * Keputusan pemilik sistem: Direktur boleh mengubah data proyek, dan jumlah pemegang level Koordinator Program TIDAK dibatasi (Direktur yang memberi akses).
 * Menyembunyikan menu hanya kosmetik; penegakan sebenarnya ada di service (lihat services/training/access.ts).
 */
import type { Role } from "@/lib/permissions";
import type { JobLevelValue } from "@/lib/org-level";
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
  "view_participants",   // melihat DAFTAR peserta (tanpa kontak). Tidak dimiliki akun berstatus Magang.
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
  /** Level modul yang DIBERIKAN secara manual (null = tidak ada). */
  level: TrainingLevel | null;
  /** Tingkat jabatan karyawan tertaut (Manajer otomatis berhak sebagai Pemantau). */
  jobLevel?: JobLevelValue | null;
  /** Karyawan tertaut berstatus Magang: tanpa level, tanpa wewenang persetujuan, tanpa akses daftar peserta (SOP Rev 0.5). */
  intern?: boolean;
}

export type LevelSource = "MANUAL" | "AUTO_MANAGER" | null;

/** Level yang BERLAKU: manual bila ada; bila tidak, tingkat Manajer = Pemantau; Magang selalu tanpa level. */
export function effectiveLevel(s: AccessSubject): { level: TrainingLevel | null; source: LevelSource } {
  if (s.intern) return { level: null, source: null };
  if (s.level) return { level: s.level, source: "MANUAL" };
  if (s.jobLevel === "MANAGER") return { level: "VIEWER", source: "AUTO_MANAGER" };
  return { level: null, source: null };
}

/** Peran proyek yang TIDAK boleh dipegang akun Magang (penyetuju / pemegang data peserta). */
export const INTERN_FORBIDDEN_PROJECT_ROLES: readonly ProjectRole[] = ["PROJECT_MANAGER", "ADMIN_PROGRAM", "PARTICIPANT_OWNER"];
/** Satu-satunya kemampuan proyek yang tersisa bagi akun Magang. */
const INTERN_ABILITIES: ReadonlySet<ProjectAbility> = new Set<ProjectAbility>(["view", "upload_document"]);

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
  /** Boleh melihat daftar peserta (menu Peserta). Tidak untuk akun Magang. */
  viewParticipants: boolean;
}

export function globalCaps(s: AccessSubject): GlobalCaps {
  const isSuper = s.role === "SUPER_ADMIN" && !s.intern;
  const lvl = effectiveLevel(s).level;
  const full = isSuper || lvl === "COORDINATOR";
  return {
    fullAccess: full,
    viewAll: full || lvl === "VIEWER",
    createProject: full || lvl === "ADMIN_PROGRAM",
    managePrograms: full,
    manageDirectory: full || lvl === "ADMIN_PROGRAM",
    viewDirectoryContacts: full || lvl === "ADMIN_PROGRAM",
    manageAccess: isSuper,
    hasModule: isSuper || lvl !== null,
    viewParticipants: !s.intern,
  };
}

const ALL: ReadonlySet<ProjectAbility> = new Set(PROJECT_ABILITIES);

/** Kemampuan menurut PERAN PROYEK. Peran proyek tidak pernah memberi hak di luar proyek itu. */
const BY_PROJECT_ROLE: Record<ProjectRole, readonly ProjectAbility[]> = {
  PROJECT_MANAGER: ["view", "view_participants", "update", "change_status", "manage_team", "manage_tasks", "manage_checklist", "manage_participants", "manage_schedule", "manage_instructors", "upload_document", "delete_document", "link_references"],
  ADMIN_PROGRAM: ["view", "view_participants", "update", "manage_tasks", "manage_checklist", "manage_participants", "manage_schedule", "manage_instructors", "upload_document", "delete_document"],
  PARTICIPANT_OWNER: ["view", "view_participants", "manage_participants", "upload_document"],
  MATERIAL_OWNER: ["view", "view_participants", "upload_document"],
  DOCUMENTATION_OWNER: ["view", "view_participants", "upload_document"],
  STAFF: ["view", "view_participants"],
};

/**
 * Kemampuan `s` pada SATU proyek, diberi peran proyek aktifnya (null = bukan anggota). Gabungan (union):
 *  - COORDINATOR dan SUPER_ADMIN (Direktur): semua.
 *  - VIEWER (Pemantau, termasuk otomatis untuk tingkat Manajer): hanya `view` (+ daftar peserta tanpa kontak).
 *  - Magang: hanya `view` dan `upload_document`.
 *  - peran proyek: sesuai tabel di atas.
 */
export function projectAbilities(s: AccessSubject, memberRole: ProjectRole | null): ReadonlySet<ProjectAbility> {
  const caps = globalCaps(s);
  let out: Set<ProjectAbility>;
  if (caps.fullAccess) out = new Set(ALL);
  else {
    out = new Set<ProjectAbility>();
    if (caps.viewAll) { out.add("view"); out.add("view_participants"); }
    if (memberRole) for (const a of BY_PROJECT_ROLE[memberRole]) out.add(a);
  }
  // Akun Magang: pertahanan berlapis — walau data menyimpang, tidak ada kemampuan selain melihat proyek & mengunggah dokumen.
  if (s.intern) for (const a of [...out]) if (!INTERN_ABILITIES.has(a)) out.delete(a);
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
