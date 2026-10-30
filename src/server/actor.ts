import "server-only";
import { can, type Permission, type Role } from "@/lib/permissions";
import { Errors } from "./errors";

/** Identitas pelaku sebuah operasi — diteruskan ke SETIAP service agar izin & audit konsisten. */
export interface Actor {
  userId: string;
  email: string;
  name: string;
  role: Role;
  /** ID data karyawan yang tertaut ke akun ini (null untuk admin yang bukan karyawan). Dari sesi, BUKAN dari input. */
  employeeId: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

export function assertCan(actor: Actor, permission: Permission): void {
  if (!can(actor.role, permission)) throw Errors.forbidden();
}

export function actorCan(actor: Actor, permission: Permission): boolean {
  return can(actor.role, permission);
}

/** Layanan mandiri: akun harus tertaut ke data karyawan. Mengembalikan ID karyawan milik pelaku. */
export function requireSelf(actor: Actor): string {
  if (!actor.employeeId) throw Errors.forbidden("Akun Anda belum tertaut ke data karyawan.");
  return actor.employeeId;
}
