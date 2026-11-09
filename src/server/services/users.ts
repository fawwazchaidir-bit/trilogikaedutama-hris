import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, transaction } from "../db";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import { actorCan, type Actor } from "../actor";
import { writeAudit } from "../audit";
import { hashPassword, validatePasswordStrength } from "../auth/password";
import { revokeAllSessions } from "../auth/session";
import { manageableRoles, ROLE_LABELS, type Role } from "@/lib/permissions";
import { normalizeEmail } from "./auth";
import { assertNotIntern } from "./function-guard";

const ROLES = ["SUPER_ADMIN", "HR_ADMIN", "EMPLOYEE"] as const;

export const userCreateSchema = z.object({
  email: z.string().trim().toLowerCase().email("Email tidak valid").max(200),
  name: z.string().trim().min(2, "Nama minimal 2 karakter").max(120),
  role: z.enum(ROLES),
  password: z.string().min(1, "Password wajib diisi").max(128),
  /** Tautkan ke data karyawan (wajib untuk peran Karyawan). */
  employeeId: z.string().uuid().nullable().optional(),
});

export const userUpdateSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(ROLES).optional(),
  isActive: z.boolean().optional(),
});

export const resetPasswordSchema = z.object({ password: z.string().min(1).max(128) });

export interface UserDto {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  isDemo: boolean;
  mustChangePassword: boolean;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
  employeeId: string | null;
  employeeNo: string | null;
}

type Row = Prisma.UserGetPayload<{ include: { employee: { select: { id: true; employeeNo: true } } } }>;
const toDto = (u: Row): UserDto => ({
  id: u.id, email: u.email, name: u.name, role: u.role, isActive: u.isActive, isDemo: u.isDemo, mustChangePassword: u.mustChangePassword, twoFactorEnabled: u.twoFactorEnabled,
  lastLoginAt: u.lastLoginAt?.toISOString() ?? null, employeeId: u.employee?.id ?? null, employeeNo: u.employee?.employeeNo ?? null,
});

function assertManages(actor: Actor, role: Role) {
  if (!manageableRoles(actor.role).includes(role)) {
    throw Errors.forbidden(role === "EMPLOYEE" ? undefined : "Hanya Super Admin yang dapat mengelola akun admin.");
  }
}

export async function listUsers(actor: Actor): Promise<UserDto[]> {
  const roles = manageableRoles(actor.role);
  if (roles.length === 0) throw Errors.forbidden();
  const rows = await prisma.user.findMany({
    where: { role: { in: roles } },
    include: { employee: { select: { id: true, employeeNo: true } } },
    orderBy: [{ role: "asc" }, { name: "asc" }],
  });
  return rows.map(toDto);
}

export async function createUser(actor: Actor, raw: unknown): Promise<UserDto> {
  const input = parseInput(userCreateSchema, raw);
  assertManages(actor, input.role);
  const email = normalizeEmail(input.email);
  const weak = validatePasswordStrength(input.password, { email, name: input.name });
  if (weak) throw Errors.validation(weak, { password: weak });
  if (input.role === "EMPLOYEE" && !input.employeeId) {
    throw Errors.validation("Akun Karyawan harus ditautkan ke data karyawan.", { employeeId: "Pilih karyawan" });
  }
  const passwordHash = await hashPassword(input.password);
  return transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { email } })) throw Errors.validation("Email sudah terdaftar.", { email: "Email sudah terdaftar" });
    if (input.employeeId) {
      const emp = await tx.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, userId: true, isActive: true, fullName: true, employmentStatus: true } });
      if (!emp) throw Errors.validation("Karyawan tidak ditemukan.", { employeeId: "Karyawan tidak ditemukan" });
      if (emp.userId) throw Errors.validation("Karyawan ini sudah memiliki akun.", { employeeId: "Sudah memiliki akun" });
      if (!emp.isActive) throw Errors.validation("Karyawan nonaktif tidak dapat diberi akun.", { employeeId: "Karyawan nonaktif" });
      if (input.role !== "EMPLOYEE" && emp.employmentStatus === "INTERN") await assertNotIntern(tx, emp.id, `diberi peran ${ROLE_LABELS[input.role]}`, "role");
    }
    const u = await tx.user.create({
      data: { email, name: input.name, role: input.role, passwordHash, mustChangePassword: true },
    });
    if (input.employeeId) await tx.employee.update({ where: { id: input.employeeId }, data: { userId: u.id } });
    await writeAudit(tx, actor, {
      action: "user.create", entityType: "User", entityId: u.id, summary: `Akun ${email} (${input.role}) dibuat`,
      after: { email, name: input.name, role: input.role, employeeId: input.employeeId ?? null },
    });
    const row = await tx.user.findUniqueOrThrow({ where: { id: u.id }, include: { employee: { select: { id: true, employeeNo: true } } } });
    return toDto(row);
  });
}

export async function updateUser(actor: Actor, id: string, raw: unknown): Promise<UserDto> {
  const input = parseInput(userUpdateSchema, raw);
  return transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id }, include: { employee: { select: { id: true, employeeNo: true } } } });
    if (!user) throw Errors.notFound("Pengguna");
    assertManages(actor, user.role);
    if (input.role !== undefined) assertManages(actor, input.role);
    if (id === actor.userId && (input.role !== undefined || input.isActive === false)) {
      throw Errors.validation("Anda tidak dapat mengubah peran atau menonaktifkan akun sendiri.");
    }
    if (input.role !== undefined && input.role === "EMPLOYEE" && !user.employee) {
      throw Errors.validation("Akun yang tidak tertaut ke data karyawan tidak dapat dijadikan peran Karyawan.");
    }
    if (input.role !== undefined && input.role !== "EMPLOYEE" && input.role !== user.role) await assertNotIntern(tx, user.employee?.id, `diberi peran ${ROLE_LABELS[input.role]}`, "role");
    const leavingSuper = user.role === "SUPER_ADMIN" && ((input.role && input.role !== "SUPER_ADMIN") || input.isActive === false);
    if (leavingSuper) {
      const others = await tx.user.count({ where: { role: "SUPER_ADMIN", isActive: true, id: { not: id } } });
      if (others === 0) throw Errors.validation("Harus ada minimal satu Super Admin aktif.");
    }
    const data: Prisma.UserUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.role !== undefined) data.role = input.role;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    const updated = await tx.user.update({ where: { id }, data, include: { employee: { select: { id: true, employeeNo: true } } } });
    if (input.role !== undefined && input.role !== user.role) await revokeAllSessionsTx(tx, id);
    if (input.isActive === false) await revokeAllSessionsTx(tx, id);
    await writeAudit(tx, actor, {
      action: input.isActive === false ? "user.deactivate" : input.isActive === true && !user.isActive ? "user.activate" : "user.update",
      entityType: "User", entityId: id, summary: `Akun ${user.email} diperbarui`,
      before: { name: user.name, role: user.role, isActive: user.isActive },
      after: { name: updated.name, role: updated.role, isActive: updated.isActive },
    });
    return toDto(updated);
  });
}

async function revokeAllSessionsTx(tx: Prisma.TransactionClient, userId: string) {
  await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function resetUserPassword(actor: Actor, id: string, raw: unknown): Promise<void> {
  const input = parseInput(resetPasswordSchema, raw);
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) throw Errors.notFound("Pengguna");
  assertManages(actor, user.role);
  const weak = validatePasswordStrength(input.password, { email: user.email, name: user.name });
  if (weak) throw Errors.validation(weak, { password: weak });
  const passwordHash = await hashPassword(input.password);
  await transaction(async (tx) => {
    await tx.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true } });
    await writeAudit(tx, actor, { action: "user.reset_password", entityType: "User", entityId: id, summary: `Password ${user.email} direset oleh admin` });
  });
  await revokeAllSessions(id);
}

/** Dipakai layar karyawan: apakah pelaku boleh membuat akun untuk karyawan (HR/Super Admin)? */
export function canCreateEmployeeAccounts(actor: Actor): boolean {
  return actorCan(actor, "user:manage") || actorCan(actor, "user:manage_employee");
}
