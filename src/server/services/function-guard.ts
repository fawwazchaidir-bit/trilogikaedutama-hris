import "server-only";
import { prisma, type Tx } from "../db";
import { env } from "../env";
import { Errors } from "../errors";
import { INTERN_FORBIDDEN_PROJECT_ROLES } from "@/lib/training/access";
import { PROJECT_ROLE_LABEL, TRAINING_LEVEL_LABEL } from "@/lib/training/types";
import { JOB_LEVEL_LABEL } from "@/lib/org-level";
import { todayIso } from "@/lib/time";
import { ROLE_LABELS } from "@/lib/permissions";

/**
 * ATURAN MAGANG (SOP Rev 0.5): karyawan berstatus Magang tidak boleh memegang fungsi penyetuju maupun akses data peserta.
 * Satu tempat untuk semua pintu pemberian (role akun, level Training, peran proyek, atasan/pengganti, tingkat jabatan) dan untuk
 * pemeriksaan sebaliknya (mengubah status menjadi Magang diblok selama masih memegang fungsi). Pemeriksaan saat berjalan ada di
 * `src/lib/training/access.ts` (akun Magang kehilangan level, daftar peserta, dan wewenang proyek walau data menyimpang).
 */
type Db = Tx | typeof prisma;

export const INTERN_RULE = "Karyawan berstatus Magang tidak dapat memegang fungsi penyetuju atau akses data peserta (SOP Rev 0.5).";

export async function isInternEmployee(db: Db, employeeId: string | null | undefined): Promise<boolean> {
  if (!employeeId) return false;
  const e = await db.employee.findUnique({ where: { id: employeeId }, select: { employmentStatus: true } });
  return e?.employmentStatus === "INTERN";
}

/** Tolak bila karyawan itu Magang. `what` melengkapi kalimat "…tidak dapat {what}". */
export async function assertNotIntern(db: Db, employeeId: string | null | undefined, what: string, field?: string): Promise<void> {
  if (!(await isInternEmployee(db, employeeId))) return;
  throw Errors.validation(`Karyawan berstatus Magang tidak dapat ${what}. ${INTERN_RULE}`, field ? { [field]: "Tidak berlaku bagi Magang" } : undefined);
}

/** Daftar fungsi yang SEDANG dipegang karyawan dan terlarang bagi Magang (kosong = boleh menjadi Magang). */
export async function internConflicts(db: Db, employeeId: string): Promise<string[]> {
  const on = new Date(`${todayIso(env().APP_TIMEZONE)}T00:00:00.000Z`);
  const e = await db.employee.findUnique({ where: { id: employeeId }, select: { jobLevel: true, userId: true, user: { select: { role: true, isActive: true, trainingAccess: { select: { level: true } } } } } });
  if (!e) return [];
  const out: string[] = [];
  if (e.user && e.user.role !== "EMPLOYEE") out.push(`akun berperan ${ROLE_LABELS[e.user.role]}`);
  if (e.user?.trainingAccess) out.push(`level modul Training: ${TRAINING_LEVEL_LABEL[e.user.trainingAccess.level]}`);
  if (e.jobLevel !== "STAFF") out.push(`tingkat jabatan ${JOB_LEVEL_LABEL[e.jobLevel]}`);
  const reports = await db.employee.count({ where: { supervisorId: employeeId, isActive: true } });
  if (reports > 0) out.push(`atasan langsung bagi ${reports} karyawan`);
  const dels = await db.supervisorDelegation.count({ where: { delegateId: employeeId, cancelledAt: null, endDate: { gte: on } } });
  if (dels > 0) out.push("pengganti peninjau pengajuan");
  const roles = await db.trainingProjectMember.findMany({ where: { employeeId, endedAt: null, role: { in: [...INTERN_FORBIDDEN_PROJECT_ROLES] } }, select: { role: true, project: { select: { code: true } } } });
  for (const r of roles) out.push(`${PROJECT_ROLE_LABEL[r.role]} pada ${r.project.code}`);
  return out;
}

/** Dipanggil sebelum status karyawan diubah menjadi Magang. */
export async function assertMayBecomeIntern(db: Db, employeeId: string): Promise<void> {
  const held = await internConflicts(db, employeeId);
  if (held.length) throw Errors.validation(`Status tidak dapat diubah menjadi Magang karena masih memegang: ${held.join("; ")}. Cabut terlebih dahulu. ${INTERN_RULE}`, { employmentStatus: "Masih memegang fungsi" });
}
