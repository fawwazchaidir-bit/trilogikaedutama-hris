import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, transaction, type Tx } from "../db";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import { assertCan, type Actor } from "../actor";
import { writeAudit } from "../audit";
import { dateToIso, isoToDate } from "../json";
import { env } from "../env";
import { isoDate, optionalText, requiredText, uuid } from "@/lib/validation/common";
import { todayIso } from "@/lib/time";
import { ASSET_CATEGORIES, ASSET_CATEGORY_LABEL, ASSET_CONDITIONS, ASSET_STATUSES, type AssetCategoryValue, type AssetConditionValue, type AssetStatusValue } from "@/lib/assets";

/**
 * ASET PERUSAHAAN — daftar aset, serah-terima ke karyawan, dan pengembalian (kondisi + alasan bila rusak/hilang). Hanya HR/Super Admin
 * (`employee:manage` mengubah, `employee:view` melihat). Aset tidak dihapus; dinonaktifkan (RETIRED, terminal). Setiap pinjaman tercatat
 * sebagai satu baris riwayat yang terkunci setelah dikembalikan. Aset yang hilang TIDAK otomatis memotong gaji (potongan upah dibatasi hukum;
 * putusan itu urusan HR di penyelesaian akhir).
 */
type Db = Tx | typeof prisma;
const today = () => todayIso(env().APP_TIMEZONE);

export interface AssetHolder { assignmentId: string; employeeId: string; employeeName: string; employeeNo: string; assignedOn: string; note: string | null }
export interface AssetDto {
  id: string; code: string; name: string; category: AssetCategoryValue; categoryLabel: string; serialNo: string | null; note: string | null; status: AssetStatusValue;
  holder: AssetHolder | null; lastCondition: AssetConditionValue | null; lastReturnNote: string | null; retiredAt: string | null; retireReason: string | null; createdAt: string;
}
export interface AssetHistoryDto {
  id: string; employeeId: string; employeeName: string; assignedOn: string; assignedBy: string; note: string | null;
  returnedOn: string | null; returnedBy: string | null; returnCondition: AssetConditionValue | null; returnNote: string | null;
}
export interface EmployeeAssetDto {
  assignmentId: string; assetId: string; code: string; name: string; category: AssetCategoryValue; categoryLabel: string; serialNo: string | null;
  assignedOn: string; note: string | null; returnedOn: string | null; returnCondition: AssetConditionValue | null; returnNote: string | null;
}

// ─────────────────────────── Skema ───────────────────────────

export const assetCreateSchema = z.object({
  name: requiredText(2, 120, "Nama aset"),
  category: z.enum(ASSET_CATEGORIES, { error: "Kategori aset wajib dipilih" }),
  serialNo: optionalText(80, "Nomor seri"),
  note: optionalText(300, "Catatan"),
});
export const assetUpdateSchema = assetCreateSchema;
export const assignSchema = z.object({ employeeId: uuid, assignedOn: isoDate.optional(), note: optionalText(300, "Catatan") });
export const returnSchema = z.object({
  returnedOn: isoDate.optional(),
  condition: z.enum(ASSET_CONDITIONS, { error: "Kondisi saat dikembalikan wajib dipilih" }),
  note: optionalText(300, "Catatan"),
}).superRefine((v, ctx) => {
  if (v.condition !== "GOOD" && !(v.note ?? "").trim()) ctx.addIssue({ code: "custom", path: ["note"], message: "Jelaskan kerusakan atau kehilangannya" });
});
export const retireSchema = z.object({ reason: requiredText(3, 300, "Alasan") });
export const assetListQuery = z.object({
  status: z.enum(ASSET_STATUSES).optional(),
  category: z.enum(ASSET_CATEGORIES).optional(),
  q: z.string().trim().max(80).optional(),
});

// ─────────────────────────── Pembentukan DTO ───────────────────────────

const assetInclude = {
  assignments: { orderBy: { assignedOn: "desc" }, take: 1, include: { employee: { select: { fullName: true, employeeNo: true } } } },
} satisfies Prisma.AssetInclude;
type AssetRow = Prisma.AssetGetPayload<{ include: typeof assetInclude }>;

function toDto(a: AssetRow): AssetDto {
  const last = a.assignments[0] ?? null;
  const holder = last && last.returnedOn === null ? { assignmentId: last.id, employeeId: last.employeeId, employeeName: last.employee.fullName, employeeNo: last.employee.employeeNo, assignedOn: dateToIso(last.assignedOn), note: last.note } : null;
  return {
    id: a.id, code: a.code, name: a.name, category: a.category, categoryLabel: ASSET_CATEGORY_LABEL[a.category], serialNo: a.serialNo, note: a.note, status: a.status, holder,
    lastCondition: last?.returnCondition ?? null, lastReturnNote: last?.returnNote ?? null,
    retiredAt: a.retiredAt ? a.retiredAt.toISOString() : null, retireReason: a.retireReason, createdAt: a.createdAt.toISOString(),
  };
}

async function loadAsset(db: Db, id: string): Promise<AssetRow> {
  const a = await db.asset.findUnique({ where: { id }, include: assetInclude });
  if (!a) throw Errors.notFound("Aset");
  return a;
}

// ─────────────────────────── Baca ───────────────────────────

export async function listAssets(actor: Actor, raw: unknown = {}): Promise<AssetDto[]> {
  assertCan(actor, "employee:view");
  const q = parseInput(assetListQuery, raw);
  const where: Prisma.AssetWhereInput = {
    ...(q.status ? { status: q.status } : {}),
    ...(q.category ? { category: q.category } : {}),
    ...(q.q ? { OR: [{ name: { contains: q.q, mode: "insensitive" } }, { code: { contains: q.q, mode: "insensitive" } }, { serialNo: { contains: q.q, mode: "insensitive" } }, { assignments: { some: { returnedOn: null, employee: { fullName: { contains: q.q, mode: "insensitive" } } } } }] } : {}),
  };
  const rows = await prisma.asset.findMany({ where, include: assetInclude, orderBy: [{ code: "asc" }], take: 500 });
  return rows.map(toDto);
}

export async function getAsset(actor: Actor, id: string): Promise<{ asset: AssetDto; history: AssetHistoryDto[] }> {
  assertCan(actor, "employee:view");
  const asset = toDto(await loadAsset(prisma, id));
  const rows = await prisma.assetAssignment.findMany({ where: { assetId: id }, orderBy: [{ assignedOn: "desc" }, { createdAt: "desc" }], include: { employee: { select: { fullName: true } } } });
  const ids = [...new Set(rows.flatMap((r) => [r.assignedById, r.returnedById]).filter((x): x is string => !!x))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name]));
  return {
    asset,
    history: rows.map((r) => ({
      id: r.id, employeeId: r.employeeId, employeeName: r.employee.fullName, assignedOn: dateToIso(r.assignedOn), assignedBy: name.get(r.assignedById) ?? "—", note: r.note,
      returnedOn: r.returnedOn ? dateToIso(r.returnedOn) : null, returnedBy: r.returnedById ? name.get(r.returnedById) ?? "—" : null, returnCondition: r.returnCondition, returnNote: r.returnNote,
    })),
  };
}

/** Aset yang sedang dipegang (dan riwayat) satu karyawan. */
export async function listEmployeeAssets(actor: Actor, employeeId: string): Promise<{ holding: EmployeeAssetDto[]; history: EmployeeAssetDto[] }> {
  assertCan(actor, "employee:view");
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
  if (!emp) throw Errors.notFound("Karyawan");
  const rows = await prisma.assetAssignment.findMany({ where: { employeeId }, orderBy: [{ assignedOn: "desc" }, { createdAt: "desc" }], include: { asset: { select: { code: true, name: true, category: true, serialNo: true } } }, take: 200 });
  const dto = (r: (typeof rows)[number]): EmployeeAssetDto => ({
    assignmentId: r.id, assetId: r.assetId, code: r.asset.code, name: r.asset.name, category: r.asset.category, categoryLabel: ASSET_CATEGORY_LABEL[r.asset.category], serialNo: r.asset.serialNo,
    assignedOn: dateToIso(r.assignedOn), note: r.note, returnedOn: r.returnedOn ? dateToIso(r.returnedOn) : null, returnCondition: r.returnCondition, returnNote: r.returnNote,
  });
  return { holding: rows.filter((r) => r.returnedOn === null).map(dto), history: rows.filter((r) => r.returnedOn !== null).map(dto) };
}

/** Ringkasan untuk sinyal checklist berhenti (tanpa pemeriksaan izin — dipanggil dari service yang sudah memeriksanya). */
export async function assetSignalData(db: Db, employeeId: string): Promise<{ holding: { code: string; name: string }[]; everHeld: number; problems: number }> {
  const rows = await db.assetAssignment.findMany({ where: { employeeId }, select: { returnedOn: true, returnCondition: true, asset: { select: { code: true, name: true } } } });
  return {
    holding: rows.filter((r) => r.returnedOn === null).map((r) => r.asset),
    everHeld: rows.length,
    problems: rows.filter((r) => r.returnCondition === "DAMAGED" || r.returnCondition === "LOST").length,
  };
}

// ─────────────────────────── Tulis ───────────────────────────

export async function createAsset(actor: Actor, raw: unknown): Promise<AssetDto> {
  assertCan(actor, "employee:manage");
  const input = parseInput(assetCreateSchema, raw);
  return transaction(async (tx) => {
    const seq = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('asset_code_seq') AS n`;
    const code = `AST-${String(seq[0]?.n ?? 0).padStart(4, "0")}`;
    const a = await tx.asset.create({ data: { code, name: input.name, category: input.category, serialNo: input.serialNo, note: input.note, createdById: actor.userId } });
    await writeAudit(tx, actor, { action: "asset.create", entityType: "Asset", entityId: a.id, summary: `Aset ${code}: ${input.name}`, after: { code, name: input.name, category: input.category, serialNo: input.serialNo } });
    return toDto(await loadAsset(tx, a.id));
  });
}

export async function updateAsset(actor: Actor, id: string, raw: unknown): Promise<AssetDto> {
  assertCan(actor, "employee:manage");
  const input = parseInput(assetUpdateSchema, raw);
  return transaction(async (tx) => {
    const before = await loadAsset(tx, id);
    if (before.status === "RETIRED") throw Errors.conflict("Aset yang sudah dinonaktifkan tidak dapat diubah.");
    await tx.asset.update({ where: { id }, data: { name: input.name, category: input.category, serialNo: input.serialNo, note: input.note } });
    await writeAudit(tx, actor, { action: "asset.update", entityType: "Asset", entityId: id, summary: `Ubah aset ${before.code}`, before: { name: before.name, category: before.category, serialNo: before.serialNo, note: before.note }, after: input });
    return toDto(await loadAsset(tx, id));
  });
}

export async function assignAsset(actor: Actor, id: string, raw: unknown): Promise<AssetDto> {
  assertCan(actor, "employee:manage");
  const input = parseInput(assignSchema, raw);
  const on = input.assignedOn ?? today();
  if (on > today()) throw Errors.validation("Tanggal serah-terima tidak boleh di masa depan.", { assignedOn: "Tidak boleh di masa depan" });
  return transaction(async (tx) => {
    const a = await loadAsset(tx, id);
    if (a.status !== "AVAILABLE") throw Errors.conflict(a.status === "ASSIGNED" ? "Aset ini sedang dipinjam; catat pengembaliannya lebih dulu." : a.status === "LOST" ? "Aset ini tercatat hilang." : "Aset ini sudah dinonaktifkan.");
    const emp = await tx.employee.findUnique({ where: { id: input.employeeId }, select: { fullName: true, isActive: true } });
    if (!emp) throw Errors.notFound("Karyawan");
    if (!emp.isActive) throw Errors.validation("Aset hanya dapat diserahkan kepada karyawan yang aktif.", { employeeId: "Karyawan tidak aktif" });
    // Kunci baris aset: dua serah-terima bersamaan tidak lolos dua-duanya (indeks unik parsial = jaring pengaman terakhir).
    const claimed = await tx.asset.updateMany({ where: { id, status: "AVAILABLE" }, data: { status: "ASSIGNED" } });
    if (claimed.count !== 1) throw Errors.conflict("Status aset baru saja berubah. Muat ulang lalu coba lagi.");
    const row = await tx.assetAssignment.create({ data: { assetId: id, employeeId: input.employeeId, assignedOn: isoToDate(on), assignedById: actor.userId, note: input.note } });
    await writeAudit(tx, actor, { action: "asset.assign", entityType: "Asset", entityId: id, summary: `${a.code} ${a.name} diserahkan kepada ${emp.fullName}`, after: { assignmentId: row.id, employeeId: input.employeeId, assignedOn: on } });
    return toDto(await loadAsset(tx, id));
  });
}

export async function returnAsset(actor: Actor, id: string, raw: unknown): Promise<AssetDto> {
  assertCan(actor, "employee:manage");
  const input = parseInput(returnSchema, raw);
  const on = input.returnedOn ?? today();
  if (on > today()) throw Errors.validation("Tanggal pengembalian tidak boleh di masa depan.", { returnedOn: "Tidak boleh di masa depan" });
  return transaction(async (tx) => {
    const a = await loadAsset(tx, id);
    const open = await tx.assetAssignment.findFirst({ where: { assetId: id, returnedOn: null }, include: { employee: { select: { fullName: true } } } });
    if (!open || a.status !== "ASSIGNED") throw Errors.conflict("Aset ini tidak sedang dipinjam.");
    if (on < dateToIso(open.assignedOn)) throw Errors.validation("Tanggal pengembalian tidak boleh sebelum tanggal serah-terima.", { returnedOn: "Sebelum tanggal serah-terima" });
    await tx.assetAssignment.update({ where: { id: open.id }, data: { returnedOn: isoToDate(on), returnedById: actor.userId, returnCondition: input.condition, returnNote: input.note } });
    await tx.asset.update({ where: { id }, data: { status: input.condition === "LOST" ? "LOST" : "AVAILABLE" } });
    await writeAudit(tx, actor, { action: "asset.return", entityType: "Asset", entityId: id, summary: `${a.code} ${a.name} dikembalikan oleh ${open.employee.fullName} (${input.condition})`, after: { assignmentId: open.id, returnedOn: on, condition: input.condition, note: input.note } });
    return toDto(await loadAsset(tx, id));
  });
}

/** Aset hilang yang ditemukan kembali → tersedia lagi. */
export async function foundAsset(actor: Actor, id: string): Promise<AssetDto> {
  assertCan(actor, "employee:manage");
  return transaction(async (tx) => {
    const a = await loadAsset(tx, id);
    if (a.status !== "LOST") throw Errors.conflict("Hanya aset yang tercatat hilang yang dapat ditandai ditemukan.");
    await tx.asset.update({ where: { id }, data: { status: "AVAILABLE" } });
    await writeAudit(tx, actor, { action: "asset.found", entityType: "Asset", entityId: id, summary: `${a.code} ${a.name} ditemukan kembali` });
    return toDto(await loadAsset(tx, id));
  });
}

/** Nonaktifkan aset (rusak berat, dijual, dll.). Hanya yang tersedia atau hilang; yang sedang dipinjam harus dikembalikan dulu. Terminal. */
export async function retireAsset(actor: Actor, id: string, raw: unknown): Promise<AssetDto> {
  assertCan(actor, "employee:manage");
  const input = parseInput(retireSchema, raw);
  return transaction(async (tx) => {
    const a = await loadAsset(tx, id);
    if (a.status === "ASSIGNED") throw Errors.conflict("Aset ini sedang dipinjam; catat pengembaliannya lebih dulu.");
    if (a.status === "RETIRED") throw Errors.conflict("Aset ini sudah dinonaktifkan.");
    await tx.asset.update({ where: { id }, data: { status: "RETIRED", retiredAt: new Date(), retiredById: actor.userId, retireReason: input.reason } });
    await writeAudit(tx, actor, { action: "asset.retire", entityType: "Asset", entityId: id, summary: `${a.code} ${a.name} dinonaktifkan`, reason: input.reason });
    return toDto(await loadAsset(tx, id));
  });
}
