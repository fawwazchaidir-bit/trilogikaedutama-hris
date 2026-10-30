import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { transaction, prisma } from "../db";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import { assertCan, type Actor } from "../actor";
import { writeAudit } from "../audit";
import { dateToIso, isoToDate } from "../json";
import { isoDate, optionalText, requiredText, rupiah, uuid } from "@/lib/validation/common";
import { CATEGORY_LABEL, DEDUCTION_CATEGORIES, EARNING_CATEGORIES, type ComponentCalc, type ComponentCategory, type ComponentKind, type ComponentRecurrence } from "@/lib/payroll";
import { rangesOverlap } from "@/lib/time";

const CATEGORIES = [...EARNING_CATEGORIES, ...DEDUCTION_CATEGORIES] as [ComponentCategory, ...ComponentCategory[]];

export const componentSchema = z.object({
  employeeId: uuid,
  category: z.enum(CATEGORIES, { error: "Kategori wajib dipilih" }),
  name: requiredText(2, 100, "Nama komponen"),
  calc: z.enum(["FIXED", "PER_PRESENT_DAY", "PERCENT_OF_BASE"]),
  amount: rupiah("Nominal").optional(),
  /** Persen (mis. 1,5) — disimpan sebagai basis point. Hanya untuk PERCENT_OF_BASE. */
  percent: z.number().min(0, "Persen tidak boleh negatif").max(100, "Persen maksimal 100").nullable().optional(),
  recurrence: z.enum(["RECURRING", "ONE_TIME"]),
  effectiveFrom: isoDate,
  effectiveTo: isoDate.nullable().optional(),
  description: optionalText(300, "Keterangan"),
}).superRefine((v, ctx) => {
  if (v.calc === "PERCENT_OF_BASE") {
    if (v.percent === null || v.percent === undefined) ctx.addIssue({ code: "custom", path: ["percent"], message: "Isi persen dari gaji pokok" });
    else if (Math.abs(Math.round(v.percent * 100) - v.percent * 100) > 1e-6) ctx.addIssue({ code: "custom", path: ["percent"], message: "Persen maksimal 2 angka desimal" });
  } else if (v.amount === undefined) ctx.addIssue({ code: "custom", path: ["amount"], message: "Nominal wajib diisi" });
  if (v.category === "BASE_SALARY" && v.calc === "PERCENT_OF_BASE") ctx.addIssue({ code: "custom", path: ["calc"], message: "Gaji pokok tidak dapat berupa persen dari gaji pokok" });
  if (v.recurrence === "ONE_TIME" && v.calc === "PER_PRESENT_DAY") ctx.addIssue({ code: "custom", path: ["calc"], message: "Komponen sekali tidak dapat dihitung per hari hadir" });
  if (v.effectiveTo && v.effectiveTo < v.effectiveFrom) ctx.addIssue({ code: "custom", path: ["effectiveTo"], message: "Tanggal berakhir tidak boleh sebelum tanggal mulai" });
});

export interface ComponentDto {
  id: string;
  employeeId: string;
  kind: ComponentKind;
  category: ComponentCategory;
  categoryLabel: string;
  name: string;
  calc: ComponentCalc;
  amount: number;
  percent: number | null;
  recurrence: ComponentRecurrence;
  effectiveFrom: string;
  effectiveTo: string | null;
  description: string | null;
  isActive: boolean;
}

type Row = Prisma.SalaryComponentGetPayload<object>;
const toDto = (c: Row): ComponentDto => ({
  id: c.id, employeeId: c.employeeId, kind: c.kind, category: c.category, categoryLabel: CATEGORY_LABEL[c.category], name: c.name, calc: c.calc,
  amount: Number(c.amount), percent: c.percentBp === null ? null : c.percentBp / 100, recurrence: c.recurrence,
  effectiveFrom: dateToIso(c.effectiveFrom), effectiveTo: c.effectiveTo ? dateToIso(c.effectiveTo) : null, description: c.description, isActive: c.isActive,
});

export async function listComponents(actor: Actor, employeeId: string): Promise<ComponentDto[]> {
  assertCan(actor, "payroll:components");
  const rows = await prisma.salaryComponent.findMany({ where: { employeeId }, orderBy: [{ isActive: "desc" }, { kind: "asc" }, { effectiveFrom: "desc" }] });
  return rows.map(toDto);
}

function toData(input: z.infer<typeof componentSchema>, actorId: string) {
  return {
    employeeId: input.employeeId,
    kind: (EARNING_CATEGORIES as string[]).includes(input.category) ? ("EARNING" as const) : ("DEDUCTION" as const),
    category: input.category, name: input.name, calc: input.calc,
    amount: BigInt(input.calc === "PERCENT_OF_BASE" ? 0 : input.amount ?? 0),
    percentBp: input.calc === "PERCENT_OF_BASE" ? Math.round((input.percent ?? 0) * 100) : null,
    recurrence: input.recurrence, effectiveFrom: isoToDate(input.effectiveFrom),
    // Komponen sekali berlaku tepat pada satu tanggal.
    effectiveTo: input.recurrence === "ONE_TIME" ? isoToDate(input.effectiveFrom) : input.effectiveTo ? isoToDate(input.effectiveTo) : null,
    description: input.description, createdById: actorId,
  };
}

/** Gaji pokok aktif pada employee yang sama tidak boleh beririsan periode (agar gaji pokok tak ganda). */
async function assertNoBaseOverlap(tx: Prisma.TransactionClient, input: z.infer<typeof componentSchema>, exceptId?: string) {
  if (input.category !== "BASE_SALARY") return;
  const others = await tx.salaryComponent.findMany({ where: { employeeId: input.employeeId, category: "BASE_SALARY", isActive: true, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  const to = input.recurrence === "ONE_TIME" ? input.effectiveFrom : input.effectiveTo ?? null;
  const clash = others.find((o) => rangesOverlap(dateToIso(o.effectiveFrom), o.effectiveTo ? dateToIso(o.effectiveTo) : null, input.effectiveFrom, to));
  if (clash) {
    throw Errors.validation(`Sudah ada gaji pokok aktif pada periode yang beririsan (${dateToIso(clash.effectiveFrom)} s.d. ${clash.effectiveTo ? dateToIso(clash.effectiveTo) : "seterusnya"}). Akhiri gaji pokok lama dengan tanggal berakhir terlebih dulu.`, { effectiveFrom: "Beririsan dengan gaji pokok lain" });
  }
}

export async function createComponent(actor: Actor, raw: unknown): Promise<ComponentDto> {
  assertCan(actor, "payroll:components");
  const input = parseInput(componentSchema, raw);
  return transaction(async (tx) => {
    const emp = await tx.employee.findUnique({ where: { id: input.employeeId }, select: { fullName: true, joinDate: true } });
    if (!emp) throw Errors.notFound("Karyawan");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"component:" + input.employeeId}))`;
    await assertNoBaseOverlap(tx, input);
    const c = await tx.salaryComponent.create({ data: toData(input, actor.userId) });
    await writeAudit(tx, actor, {
      action: "component.create", entityType: "SalaryComponent", entityId: c.id,
      summary: `Komponen gaji "${c.name}" (${CATEGORY_LABEL[c.category]}) ditambahkan untuk ${emp.fullName}`, after: toDto(c),
    });
    return toDto(c);
  });
}

export async function updateComponent(actor: Actor, id: string, raw: unknown): Promise<ComponentDto> {
  assertCan(actor, "payroll:components");
  const input = parseInput(componentSchema, raw);
  return transaction(async (tx) => {
    const before = await tx.salaryComponent.findUnique({ where: { id }, include: { employee: { select: { fullName: true } } } });
    if (!before) throw Errors.notFound("Komponen");
    if (before.employeeId !== input.employeeId) throw Errors.validation("Komponen tidak dapat dipindahkan ke karyawan lain.");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"component:" + input.employeeId}))`;
    await assertNoBaseOverlap(tx, input, id);
    const { createdById: _createdById, employeeId: _employeeId, ...data } = toData(input, actor.userId);
    const c = await tx.salaryComponent.update({ where: { id }, data });
    await writeAudit(tx, actor, {
      action: "component.update", entityType: "SalaryComponent", entityId: id,
      summary: `Komponen gaji "${c.name}" ${before.employee.fullName} diperbarui. Periode gaji yang sudah diterbitkan tidak terpengaruh.`, before: toDto(before), after: toDto(c),
    });
    return toDto(c);
  });
}

/** Nonaktifkan (bukan hapus) — riwayat komponen tetap tersimpan. */
export async function setComponentActive(actor: Actor, id: string, active: boolean): Promise<void> {
  assertCan(actor, "payroll:components");
  await transaction(async (tx) => {
    const c = await tx.salaryComponent.findUnique({ where: { id }, include: { employee: { select: { fullName: true } } } });
    if (!c) throw Errors.notFound("Komponen");
    if (c.isActive === active) return;
    if (active && c.category === "BASE_SALARY") {
      await assertNoBaseOverlap(tx, {
        employeeId: c.employeeId, category: c.category, name: c.name, calc: c.calc, recurrence: c.recurrence, effectiveFrom: dateToIso(c.effectiveFrom),
        effectiveTo: c.effectiveTo ? dateToIso(c.effectiveTo) : null, amount: Number(c.amount), percent: null, description: c.description,
      }, id);
    }
    await tx.salaryComponent.update({ where: { id }, data: { isActive: active } });
    await writeAudit(tx, actor, {
      action: active ? "component.activate" : "component.deactivate", entityType: "SalaryComponent", entityId: id,
      summary: `Komponen gaji "${c.name}" ${c.employee.fullName} ${active ? "diaktifkan" : "dinonaktifkan"}`, before: { isActive: c.isActive }, after: { isActive: active },
    });
  });
}
