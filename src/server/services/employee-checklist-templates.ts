import "server-only";
import { z } from "zod";
import type { EmployeeChecklistTemplateItem } from "@prisma/client";
import { prisma, transaction, type Tx } from "../db";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import { assertCan, type Actor } from "../actor";
import { writeAudit } from "../audit";
import { optionalText, requiredText, uuid } from "@/lib/validation/common";
import { KIND_LABEL, templateOf, type ChecklistKind } from "@/lib/employee-checklist";

/**
 * TEMPLATE CHECKLIST yang dapat diedit HR. Butir bawaan dari kode menjadi data awal saat template pertama kali dipakai (kunci tetap, agar sinyal otomatis
 * tetap menempel). Perubahan hanya memengaruhi checklist BARU; checklist yang sudah berjalan tidak berubah. Butir tidak dihapus — dinonaktifkan.
 */
type Db = Tx | typeof prisma;

/** Template satu jenis (semua butir, termasuk nonaktif), diisi dari bawaan kode bila masih kosong. */
export async function ensureTemplate(db: Db, kind: ChecklistKind): Promise<EmployeeChecklistTemplateItem[]> {
  const find = () => db.employeeChecklistTemplateItem.findMany({ where: { kind }, orderBy: { sortOrder: "asc" } });
  const rows = await find();
  if (rows.length) return rows;
  await db.employeeChecklistTemplateItem.createMany({
    data: templateOf(kind).map((t, i) => ({ kind, key: t.key, groupLabel: t.group, title: t.title, hint: t.hint, required: true, sortOrder: i + 1, dueOffsetDays: t.dueDays })),
    skipDuplicates: true,
  });
  return find();
}

export interface TemplateItemDto {
  id: string; kind: ChecklistKind; key: string; group: string; title: string; hint: string | null; required: boolean; active: boolean;
  sortOrder: number; dueOffsetDays: number | null; defaultAssigneeId: string | null; defaultAssigneeName: string | null; builtin: boolean;
}
export interface AssignableUser { id: string; name: string; role: string }

const builtinKeys = (kind: ChecklistKind) => new Set(templateOf(kind).map((t) => t.key));

export async function listAssignableUsers(actor: Actor): Promise<AssignableUser[]> {
  assertCan(actor, "employee:view");
  const rows = await prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" }, take: 500 });
  return rows.map((u) => ({ id: u.id, name: u.name, role: u.role }));
}

export async function getTemplate(actor: Actor, kind: ChecklistKind): Promise<TemplateItemDto[]> {
  assertCan(actor, "employee:view");
  const rows = await ensureTemplate(prisma, kind);
  const users = await prisma.user.findMany({ where: { id: { in: rows.map((r) => r.defaultAssigneeId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  const builtin = builtinKeys(kind);
  return rows.map((r) => ({
    id: r.id, kind: r.kind, key: r.key, group: r.groupLabel, title: r.title, hint: r.hint, required: r.required, active: r.active, sortOrder: r.sortOrder,
    dueOffsetDays: r.dueOffsetDays, defaultAssigneeId: r.defaultAssigneeId, defaultAssigneeName: r.defaultAssigneeId ? name.get(r.defaultAssigneeId) ?? null : null, builtin: builtin.has(r.key),
  }));
}

const fields = {
  title: requiredText(3, 160, "Judul butir"),
  hint: optionalText(300, "Keterangan"),
  group: requiredText(2, 60, "Kelompok"),
  required: z.boolean(),
  dueOffsetDays: z.number().int("Tenggat harus bilangan bulat").min(0, "Tenggat tidak boleh negatif").max(365, "Tenggat maksimal 365 hari").nullable(),
  defaultAssigneeId: uuid.nullable(),
  active: z.boolean(),
};
export const templateAddSchema = z.object({
  kind: z.enum(["ONBOARDING", "OFFBOARDING"], { error: "Jenis checklist wajib dipilih" }),
  title: fields.title, hint: fields.hint, group: fields.group.default("Tambahan HR"), required: fields.required.default(true),
  dueOffsetDays: fields.dueOffsetDays.default(null), defaultAssigneeId: fields.defaultAssigneeId.default(null),
});
export const templatePatchSchema = z.object({
  title: fields.title.optional(), hint: fields.hint, group: fields.group.optional(), required: fields.required.optional(),
  dueOffsetDays: fields.dueOffsetDays.optional(), defaultAssigneeId: fields.defaultAssigneeId.optional(), active: fields.active.optional(),
});

async function assertAssignee(tx: Tx, id: string | null | undefined): Promise<void> {
  if (!id) return;
  const u = await tx.user.findUnique({ where: { id }, select: { isActive: true } });
  if (!u?.isActive) throw Errors.validation("Penanggung jawab harus akun pengguna yang aktif.", { defaultAssigneeId: "Tidak valid" });
}

export async function addTemplateItem(actor: Actor, raw: unknown): Promise<{ id: string }> {
  assertCan(actor, "employee:manage");
  const input = parseInput(templateAddSchema, raw);
  return transaction(async (tx) => {
    const rows = await ensureTemplate(tx, input.kind);
    await assertAssignee(tx, input.defaultAssigneeId);
    const row = await tx.employeeChecklistTemplateItem.create({
      data: { kind: input.kind, key: `custom-${crypto.randomUUID().slice(0, 8)}`, groupLabel: input.group, title: input.title, hint: input.hint, required: input.required, sortOrder: Math.max(0, ...rows.map((r) => r.sortOrder)) + 1, dueOffsetDays: input.dueOffsetDays, defaultAssigneeId: input.defaultAssigneeId },
    });
    await writeAudit(tx, actor, { action: "checklist.template.add", entityType: "EmployeeChecklistTemplateItem", entityId: row.id, summary: `Butir "${input.title}" ditambahkan pada template "${KIND_LABEL[input.kind]}"`, after: { title: input.title, required: input.required, dueOffsetDays: input.dueOffsetDays } });
    return { id: row.id };
  });
}

export async function updateTemplateItem(actor: Actor, id: string, raw: unknown): Promise<void> {
  assertCan(actor, "employee:manage");
  const patch = parseInput(templatePatchSchema, raw);
  await transaction(async (tx) => {
    const cur = await tx.employeeChecklistTemplateItem.findUnique({ where: { id } });
    if (!cur) throw Errors.notFound("Butir template");
    await assertAssignee(tx, patch.defaultAssigneeId);
    const data = {
      ...(patch.title !== undefined ? { title: patch.title } : {}), ...(patch.hint !== undefined ? { hint: patch.hint } : {}), ...(patch.group !== undefined ? { groupLabel: patch.group } : {}),
      ...(patch.required !== undefined ? { required: patch.required } : {}), ...(patch.dueOffsetDays !== undefined ? { dueOffsetDays: patch.dueOffsetDays } : {}),
      ...(patch.defaultAssigneeId !== undefined ? { defaultAssigneeId: patch.defaultAssigneeId } : {}), ...(patch.active !== undefined ? { active: patch.active } : {}),
    };
    if (!Object.keys(data).length) throw Errors.validation("Tidak ada perubahan untuk disimpan.");
    if (patch.active === false && cur.active) {
      const left = await tx.employeeChecklistTemplateItem.count({ where: { kind: cur.kind, active: true, id: { not: id } } });
      if (left === 0) throw Errors.validation("Template harus punya setidaknya satu butir aktif.");
    }
    await tx.employeeChecklistTemplateItem.update({ where: { id }, data });
    await writeAudit(tx, actor, {
      action: "checklist.template.update", entityType: "EmployeeChecklistTemplateItem", entityId: id, summary: `Butir template "${cur.title}" (${KIND_LABEL[cur.kind]}) diubah${patch.active === false ? " — dinonaktifkan" : ""}`,
      before: { title: cur.title, required: cur.required, active: cur.active, dueOffsetDays: cur.dueOffsetDays, defaultAssigneeId: cur.defaultAssigneeId }, after: data,
    });
  });
}

/** Geser butir satu posisi ke atas/bawah (menukar urutan dengan tetangganya). */
export async function moveTemplateItem(actor: Actor, id: string, raw: unknown): Promise<void> {
  assertCan(actor, "employee:manage");
  const { direction } = parseInput(z.object({ direction: z.enum(["UP", "DOWN"], { error: "Arah tidak valid" }) }), raw);
  await transaction(async (tx) => {
    const cur = await tx.employeeChecklistTemplateItem.findUnique({ where: { id } });
    if (!cur) throw Errors.notFound("Butir template");
    const rows = await tx.employeeChecklistTemplateItem.findMany({ where: { kind: cur.kind }, orderBy: { sortOrder: "asc" } });
    const i = rows.findIndex((r) => r.id === id), j = direction === "UP" ? i - 1 : i + 1;
    if (j < 0 || j >= rows.length) return;
    const a = rows[i]!, b = rows[j]!;
    await tx.employeeChecklistTemplateItem.update({ where: { id: a.id }, data: { sortOrder: b.sortOrder } });
    await tx.employeeChecklistTemplateItem.update({ where: { id: b.id }, data: { sortOrder: a.sortOrder } });
    await writeAudit(tx, actor, { action: "checklist.template.move", entityType: "EmployeeChecklistTemplateItem", entityId: id, summary: `Butir template "${a.title}" digeser ${direction === "UP" ? "ke atas" : "ke bawah"}` });
  });
}
