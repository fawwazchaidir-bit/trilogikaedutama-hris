import "server-only";
import { z } from "zod";
import type { Prisma, Role } from "@prisma/client";
import { prisma, transaction, type Tx } from "../../db";
import { trainingEnabled } from "../../env";
import { Errors } from "../../errors";
import { parseInput } from "../../validate";
import type { Actor } from "../../actor";
import { writeAudit } from "../../audit";
import { notifyUsers } from "../notifications";
import {
  canSeeModule, effectiveLevel, globalCaps, projectAbilities, type AccessSubject, type GlobalCaps, type LevelSource, type ProjectAbility,
} from "@/lib/training/access";
import { isFinalProject, type ProjectRole, type ProjectStatus, type TrainingLevel, TRAINING_LEVEL_LABEL } from "@/lib/training/types";
import { accessGrantSchema } from "@/lib/validation/training";
import type { JobLevelValue } from "@/lib/org-level";
import { assertUuid } from "./shared";
import { assertNotIntern } from "../function-guard";

/**
 * GERBANG KEAMANAN modul Training & Operations. Setiap service (dan halaman) wajib lewat sini.
 *
 * Aturan: (1) modul harus diaktifkan (TRAINING_MODULE_ENABLED); (2) proyek yang tidak boleh diakses menjawab 404, bukan 403
 * — keberadaan proyek orang lain tidak bocor dan mengganti ID di URL tidak memberi apa pun; (3) izin ubah diperiksa per
 * kemampuan (ability) yang dihitung dari level modul + peran proyek (lihat src/lib/training/access.ts).
 */

export function assertModuleEnabled(): void {
  if (!trainingEnabled()) throw Errors.notFound("Halaman");
}

type Db = Tx | typeof prisma;

export async function getLevel(db: Db, userId: string): Promise<TrainingLevel | null> {
  const row = await db.trainingAccess.findUnique({ where: { userId }, select: { level: true } });
  return row?.level ?? null;
}

export async function hasActiveMembership(db: Db, employeeId: string | null): Promise<boolean> {
  if (!employeeId) return false;
  return (await db.trainingProjectMember.count({ where: { employeeId, endedAt: null } })) > 0;
}

export interface ModuleContext {
  subject: AccessSubject;
  caps: GlobalCaps;
  hasMembership: boolean;
  /** Boleh melihat modul (menu & halaman). */
  canSee: boolean;
  /** Level yang BERLAKU (manual, atau Pemantau otomatis bagi tingkat Manajer; null untuk Magang/tanpa level). */
  level: TrainingLevel | null;
  levelSource: LevelSource;
}

/** Subjek akses: level manual + data karyawan tertaut (tingkat jabatan, status Magang). Satu sumber untuk semua pemeriksaan. */
export async function loadSubject(db: Db, who: { userId: string; role: Role; employeeId: string | null }): Promise<AccessSubject> {
  const [level, emp] = await Promise.all([
    getLevel(db, who.userId),
    who.employeeId ? db.employee.findUnique({ where: { id: who.employeeId }, select: { jobLevel: true, employmentStatus: true } }) : Promise.resolve(null),
  ]);
  return { role: who.role, level, jobLevel: emp?.jobLevel ?? null, intern: emp?.employmentStatus === "INTERN" };
}

/** Konteks akses modul untuk `actor`. Tidak melempar bila modul mati — pemanggil menu memeriksa `trainingEnabled()` sendiri. */
export async function getModuleContext(actor: Actor, db: Db = prisma): Promise<ModuleContext> {
  const [subject, hasMembership] = await Promise.all([loadSubject(db, actor), hasActiveMembership(db, actor.employeeId)]);
  const eff = effectiveLevel(subject);
  return { subject, caps: globalCaps(subject), hasMembership, canSee: canSeeModule(subject, hasMembership), level: eff.level, levelSource: eff.source };
}

/** Untuk halaman/API tingkat modul: modul hidup dan pengguna punya akses; selain itu 404 (tidak membocorkan keberadaan modul). */
export async function requireModule(actor: Actor, db: Db = prisma): Promise<ModuleContext> {
  assertModuleEnabled();
  const ctx = await getModuleContext(actor, db);
  if (!ctx.canSee) throw Errors.notFound("Halaman");
  return ctx;
}

/** Kemampuan tingkat modul tertentu (mis. membuat proyek). Tanpa akses modul sama sekali → 404; punya akses tapi kurang izin → 403. */
export async function requireGlobalCap(actor: Actor, cap: Exclude<keyof GlobalCaps, "hasModule">, db: Db = prisma): Promise<ModuleContext> {
  const ctx = await requireModule(actor, db);
  if (!ctx.caps[cap]) throw Errors.forbidden();
  return ctx;
}

export interface ProjectCore {
  id: string;
  code: string;
  name: string;
  status: ProjectStatus;
  startDate: Date | null;
  endDate: Date | null;
  programId: string | null;
}

export interface ProjectAccess {
  project: ProjectCore;
  module: ModuleContext;
  memberRole: ProjectRole | null;
  abilities: ReadonlySet<ProjectAbility>;
}

const projectCoreSelect = { id: true, code: true, name: true, status: true, startDate: true, endDate: true, programId: true } as const;

/**
 * Muat proyek + hitung kemampuan pelaku PADA proyek itu. Tanpa kemampuan `view` → 404 (bukan 403).
 * Dipanggil oleh SETIAP service yang menyentuh data proyek, termasuk unduh dokumen.
 */
export async function loadProjectAccess(actor: Actor, projectId: string, db: Db = prisma): Promise<ProjectAccess> {
  assertModuleEnabled();
  assertUuid(projectId, "Proyek");
  const [project, module] = await Promise.all([
    db.trainingProject.findUnique({ where: { id: projectId }, select: projectCoreSelect }),
    getModuleContext(actor, db),
  ]);
  if (!project) throw Errors.notFound("Proyek");
  let memberRole: ProjectRole | null = null;
  if (actor.employeeId) {
    const m = await db.trainingProjectMember.findFirst({ where: { projectId, employeeId: actor.employeeId, endedAt: null }, select: { role: true } });
    memberRole = m?.role ?? null;
  }
  const abilities = projectAbilities(module.subject, memberRole);
  if (!abilities.has("view")) throw Errors.notFound("Proyek");
  return { project, module, memberRole, abilities };
}

export function requireAbility(access: ProjectAccess, ability: ProjectAbility, message?: string): void {
  if (!access.abilities.has(ability)) throw Errors.forbidden(message ?? "Anda tidak memiliki izin untuk tindakan ini pada proyek ini.");
}

/** Proyek yang sudah ditutup/dibatalkan bersifat baca-saja; ubah data lewat "buka kembali" (khusus Koordinator Program). */
export function assertEditable(project: Pick<ProjectCore, "status">): void {
  if (isFinalProject(project.status)) {
    throw Errors.conflict(project.status === "COMPLETED"
      ? "Proyek sudah ditutup (Selesai) sehingga datanya dikunci. Koordinator Program dapat membukanya kembali dengan alasan."
      : "Proyek sudah dibatalkan sehingga datanya dikunci.");
  }
}

// ═════════ Serialisasi penutupan vs perubahan bersamaan ═════════
//
// Pemeriksaan `assertEditable(access.project)` di awal service membaca status proyek SEBELUM transaksi tulis, sedangkan penutupan membaca daftar tugas/checklist lalu mengubah
// status. Tanpa serialisasi, perubahan yang masuk di antaranya lolos diam-diam (tugas terbuka menggantung di proyek Selesai, checklist wajib tidak lagi lengkap pada proyek
// yang ditutup "bersih", pelonggaran belum diakui). Solusinya satu kunci advisory per proyek:
//   • PENULIS (tambah/ubah tugas, checklist, anggota, data proyek): kunci BERSAMA — banyak penulis berjalan paralel — lalu membaca ULANG status proyek (segar) dan menolak bila final.
//   • PENGUBAH STATUS (tutup, batal, buka kembali, ganti status): kunci EKSKLUSIF — menunggu penulis yang sedang berjalan selesai (sehingga data terbaru terbaca) dan menahan
//     penulis berikutnya sampai ia commit (sehingga mereka melihat status baru dan ditolak dengan pesan jelas).
// ATURAN: ambil kunci ini sebagai hal PERTAMA di transaksi (sebelum menulis/mengunci baris lain) agar urutan kunci seragam dan tidak ada deadlock. Kunci lepas otomatis saat commit/rollback.
const projectEditKey = (projectId: string) => `training:project-edit:${projectId}`;

/** Kunci BERSAMA (penulis). Panggil sebagai langkah pertama di transaksi tulis. */
export const lockProjectShared = (tx: Tx, projectId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${projectEditKey(projectId)}, 0))`;
/** Kunci EKSKLUSIF (tutup/batal/buka kembali/ganti status). Panggil sebagai langkah pertama di transaksi. */
export const lockProjectExclusive = (tx: Tx, projectId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${projectEditKey(projectId)}, 0))`;

/**
 * Untuk PENULIS: ambil kunci bersama lalu baca ulang status proyek yang SEGAR dan tolak bila sudah final (pesan sama dengan `assertEditable`). Hanya pemeriksaan di dalam transaksi
 * inilah yang otoritatif; `assertEditable` di awal service hanya penolakan dini (bisa basi).
 */
export async function assertEditableLocked(tx: Tx, projectId: string): Promise<ProjectStatus> {
  await lockProjectShared(tx, projectId);
  const p = await tx.trainingProject.findUnique({ where: { id: projectId }, select: { status: true } });
  if (!p) throw Errors.notFound("Proyek");
  assertEditable(p);
  return p.status;
}

/**
 * Apakah akun ini MASIH boleh membuka proyek? Untuk pekerja latar belakang yang tidak punya `Actor` (mis. penerima pengingat).
 * Aturannya identik dengan `loadProjectAccess`: kemampuan `view` dari level modul / Super Admin atau dari peran proyek yang masih AKTIF
 * (keanggotaan yang sudah diakhiri tidak dihitung).
 */
export async function canUserViewProject(db: Db, subject: { userId: string; role: Role; employeeId: string | null }, projectId: string): Promise<boolean> {
  const accessSubject = await loadSubject(db, subject);
  let memberRole: ProjectRole | null = null;
  if (subject.employeeId) {
    const m = await db.trainingProjectMember.findFirst({ where: { projectId, employeeId: subject.employeeId, endedAt: null }, select: { role: true } });
    memberRole = m?.role ?? null;
  }
  return projectAbilities(accessSubject, memberRole).has("view");
}

/** Klausa `where` Prisma: proyek yang boleh dilihat pelaku. Dipakai SEMUA daftar/dashboard/laporan. */
export function accessibleProjectWhere(actor: Actor, module: ModuleContext): Prisma.TrainingProjectWhereInput {
  if (module.caps.viewAll) return {};
  if (!actor.employeeId) return { id: { in: [] } };
  return { members: { some: { employeeId: actor.employeeId, endedAt: null } } };
}

// ─────────────────────────── Pengelolaan level akses (Super Admin) ───────────────────────────

export interface AccessRowDto {
  userId: string;
  name: string;
  email: string;
  globalRole: string;
  employeeId: string | null;
  position: string | null;
  division: string | null;
  level: TrainingLevel | null;
  note: string | null;
  isActive: boolean;
  /** Tingkat jabatan karyawan tertaut (Manajer otomatis berhak sebagai Pemantau). */
  jobLevel: JobLevelValue | null;
  /** Karyawan berstatus Magang: tidak boleh diberi level modul. */
  intern: boolean;
}

/** Daftar akun aktif beserta level modulnya. Jabatan ditampilkan HANYA sebagai petunjuk bagi Super Admin; tidak menentukan izin. */
export async function listAccessRows(actor: Actor): Promise<AccessRowDto[]> {
  assertModuleEnabled();
  const ctx = await getModuleContext(actor);
  if (!ctx.caps.manageAccess) throw Errors.notFound("Halaman");
  const users = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: {
      id: true, name: true, email: true, role: true, trainingAccess: { select: { level: true, note: true } },
      employee: { select: { id: true, position: true, jobLevel: true, employmentStatus: true, division: { select: { name: true } } } },
    },
  });
  return users.map((u) => ({
    userId: u.id, name: u.name, email: u.email, globalRole: u.role, employeeId: u.employee?.id ?? null,
    position: u.employee?.position ?? null, division: u.employee?.division?.name ?? null,
    level: u.trainingAccess?.level ?? null, note: u.trainingAccess?.note ?? null, isActive: true,
    jobLevel: u.employee?.jobLevel ?? null, intern: u.employee?.employmentStatus === "INTERN",
  }));
}

const revokeSchema = z.object({ userId: z.string().uuid("ID tidak valid") });

/** Beri/ubah level modul. Hanya Super Admin; tercatat di audit dan pemilik akun diberi tahu. */
export async function setAccessLevel(actor: Actor, raw: unknown): Promise<{ userId: string; level: TrainingLevel }> {
  assertModuleEnabled();
  if (actor.role !== "SUPER_ADMIN") throw Errors.forbidden("Hanya Super Admin yang dapat mengatur level akses Training & Operations.");
  const input = parseInput(accessGrantSchema, raw);
  return transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { id: true, name: true, isActive: true } });
    if (!user || !user.isActive) throw Errors.notFound("Akun");
    const target = await tx.employee.findFirst({ where: { userId: input.userId }, select: { id: true } });
    await assertNotIntern(tx, target?.id, "diberi level modul Training & Operations", "level");
    const before = await tx.trainingAccess.findUnique({ where: { userId: input.userId }, select: { level: true } });
    await tx.trainingAccess.upsert({
      where: { userId: input.userId },
      create: { userId: input.userId, level: input.level, note: input.note, grantedById: actor.userId },
      update: { level: input.level, note: input.note, grantedById: actor.userId },
    });
    await writeAudit(tx, actor, {
      action: before ? "training.access.change" : "training.access.grant", entityType: "TrainingAccess", entityId: input.userId,
      summary: `Level akses Training & Operations ${user.name}: ${before ? `${TRAINING_LEVEL_LABEL[before.level]} → ` : ""}${TRAINING_LEVEL_LABEL[input.level]}`,
      before: before ? { level: before.level } : null, after: { level: input.level },
    });
    if (input.userId !== actor.userId) {
      await notifyUsers(tx, [input.userId], { type: "training.access", title: "Akses Training & Operations diperbarui", body: `Level Anda sekarang: ${TRAINING_LEVEL_LABEL[input.level]}`, href: "/training" });
    }
    return { userId: input.userId, level: input.level };
  });
}

export async function revokeAccessLevel(actor: Actor, raw: unknown): Promise<void> {
  assertModuleEnabled();
  if (actor.role !== "SUPER_ADMIN") throw Errors.forbidden("Hanya Super Admin yang dapat mengatur level akses Training & Operations.");
  const { userId } = parseInput(revokeSchema, raw);
  await transaction(async (tx) => {
    const before = await tx.trainingAccess.findUnique({ where: { userId }, include: { user: { select: { name: true } } } });
    if (!before) throw Errors.notFound("Level akses");
    await tx.trainingAccess.delete({ where: { userId } });
    await writeAudit(tx, actor, {
      action: "training.access.revoke", entityType: "TrainingAccess", entityId: userId,
      summary: `Level akses Training & Operations ${before.user.name} dicabut (sebelumnya ${TRAINING_LEVEL_LABEL[before.level]})`, before: { level: before.level }, after: null,
    });
  });
}

// ─────────────────────────── Direktori karyawan minimal ───────────────────────────

export interface DirectoryEmployee { id: string; employeeNo: string; fullName: string; position: string; division: string | null }

/**
 * Daftar karyawan AKTIF untuk memilih anggota tim/PIC. Sengaja minimal (nama, no. induk, jabatan, divisi): tanpa telepon,
 * alamat, rekening, atau data HR lain — pemanggil tidak memerlukan izin HRIS `employee:view` dan tidak mendapatkannya.
 */
export async function listDirectory(actor: Actor): Promise<DirectoryEmployee[]> {
  const ctx = await requireModule(actor);
  let allowed = ctx.caps.createProject || ctx.caps.manageDirectory;
  if (!allowed && actor.employeeId) {
    allowed = (await prisma.trainingProjectMember.count({ where: { employeeId: actor.employeeId, endedAt: null, role: "PROJECT_MANAGER" } })) > 0;
  }
  if (!allowed) throw Errors.forbidden();
  const rows = await prisma.employee.findMany({
    where: { isActive: true }, orderBy: { fullName: "asc" },
    select: { id: true, employeeNo: true, fullName: true, position: true, division: { select: { name: true } } },
  });
  return rows.map((e) => ({ id: e.id, employeeNo: e.employeeNo, fullName: e.fullName, position: e.position, division: e.division?.name ?? null }));
}
