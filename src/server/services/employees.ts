import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, transaction, type Tx } from "../db";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import { actorCan, assertCan, type Actor } from "../actor";
import { manageableRoles, type Role } from "@/lib/permissions";
import { diffFields, writeAudit } from "../audit";
import { dateToIso, isoToDate } from "../json";
import { decryptField, encryptField } from "../crypto";
import { env } from "../env";
import type { ReportTable } from "../export";
import { isoDate, optionalEmail, optionalPhone, optionalText, requiredText, uuid } from "@/lib/validation/common";
import { maskAccount } from "@/lib/payroll";
import { TAX_STATUSES, type TaxStatus } from "@/lib/statutory";
import { EMPLOYMENT_LABEL, type EmploymentStatus } from "@/lib/labels";
import { addDays, todayIso } from "@/lib/time";
import { ensureOrgBaseline, recordOrgChangeFromUpdate } from "./org";
import { assertMayBecomeIntern } from "./function-guard";
import type { JobLevelValue } from "@/lib/org-level";
import { autoTarget, startChecklistIfNone } from "./employee-checklists";
import { handoverFor, notifyHandover, type HandoverDto } from "./training/handover";
import type { Paged } from "@/lib/types";

// ─────────────────────────── Skema ───────────────────────────

const accountNo = z.preprocess(
  (v) => (typeof v === "string" ? (v.trim() === "" ? null : v.trim()) : v),
  z.string().regex(/^[0-9][0-9 .\-]{3,38}[0-9]$/, "Nomor rekening hanya boleh berisi angka (4–40 karakter)").nullable().optional(),
);

export const employeeSchema = z.object({
  employeeNo: z.string().trim().min(1, "Nomor induk wajib diisi").max(30, "Nomor induk maksimal 30 karakter")
    .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "Nomor induk hanya boleh huruf, angka, titik, garis miring, dan strip"),
  fullName: requiredText(2, 120, "Nama lengkap"),
  divisionId: uuid.nullable().optional(),
  position: requiredText(2, 100, "Jabatan"),
  employmentStatus: z.enum(["PERMANENT", "CONTRACT", "INTERN"], { error: "Status karyawan wajib dipilih" }),
  joinDate: isoDate,
  phone: optionalPhone,
  email: optionalEmail,
  address: optionalText(400, "Alamat"),
  bankName: optionalText(60, "Nama bank"),
  /** undefined = tidak diubah; null = hapus; string = ganti (dienkripsi). */
  bankAccountNo: accountNo,
  bankAccountHolder: optionalText(120, "Nama pemilik rekening"),
  notes: optionalText(500, "Catatan"),
  /** Kontak darurat (dilengkapi saat karyawan masuk). undefined/kosong = tidak ada. */
  emergencyContactName: optionalText(100, "Nama kontak darurat"),
  emergencyContactRelation: optionalText(50, "Hubungan kontak darurat"),
  emergencyContactPhone: optionalPhone,
  // Atribut statutori (dipakai bila BPJS/PPh 21 otomatis aktif). undefined = tidak diubah (bawaan saat membuat).
  taxStatus: z.enum(TAX_STATUSES as unknown as [TaxStatus, ...TaxStatus[]]).optional(),
  hasNpwp: z.boolean().optional(),
  bpjsHealthEnrolled: z.boolean().optional(),
  bpjsEmploymentEnrolled: z.boolean().optional(),
});

export const employeeListSchema = z.object({
  q: z.string().trim().max(100).optional(),
  divisionId: uuid.optional(),
  employmentStatus: z.enum(["PERMANENT", "CONTRACT", "INTERN"]).optional(),
  active: z.enum(["active", "inactive", "all"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});

// ─────────────────────────── DTO ───────────────────────────

export interface EmployeeDto {
  id: string;
  employeeNo: string;
  fullName: string;
  divisionId: string | null;
  divisionName: string | null;
  position: string;
  employmentStatus: EmploymentStatus;
  /** Tingkat jabatan (Staf / Supervisor / Manajer). */
  jobLevel: JobLevelValue;
  joinDate: string;
  endDate: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  bankName: string | null;
  bankAccountMasked: string | null;
  bankAccountHolder: string | null;
  photoUrl: string | null;
  isActive: boolean;
  notes: string | null;
  emergencyContactName: string | null;
  emergencyContactRelation: string | null;
  emergencyContactPhone: string | null;
  userId: string | null;
  userEmail: string | null;
  taxStatus: TaxStatus;
  hasNpwp: boolean;
  bpjsHealthEnrolled: boolean;
  bpjsEmploymentEnrolled: boolean;
}

const include = { division: { select: { name: true } }, user: { select: { id: true, email: true } } } satisfies Prisma.EmployeeInclude;
type Row = Prisma.EmployeeGetPayload<{ include: typeof include }>;

export const toEmployeeDto = (e: Row): EmployeeDto => ({
  id: e.id, employeeNo: e.employeeNo, fullName: e.fullName, divisionId: e.divisionId, divisionName: e.division?.name ?? null,
  position: e.position, employmentStatus: e.employmentStatus, jobLevel: e.jobLevel, joinDate: dateToIso(e.joinDate), endDate: e.endDate ? dateToIso(e.endDate) : null,
  phone: e.phone, email: e.email, address: e.address, bankName: e.bankName, bankAccountMasked: maskAccount(e.bankAccountLast4),
  bankAccountHolder: e.bankAccountHolder, photoUrl: e.photoFileId ? `/api/files/${e.photoFileId}` : null,
  isActive: e.isActive, notes: e.notes, emergencyContactName: e.emergencyContactName, emergencyContactRelation: e.emergencyContactRelation, emergencyContactPhone: e.emergencyContactPhone, userId: e.userId, userEmail: e.user?.email ?? null,
  taxStatus: e.taxStatus, hasNpwp: e.hasNpwp, bpjsHealthEnrolled: e.bpjsHealthEnrolled, bpjsEmploymentEnrolled: e.bpjsEmploymentEnrolled,
});

// ─────────────────────────── Divisi ───────────────────────────

export interface DivisionDto { id: string; name: string; isActive: boolean; employeeCount: number }

export async function listDivisions(actor: Actor, opts: { includeInactive?: boolean } = {}): Promise<DivisionDto[]> {
  // Daftar divisi dipakai di filter/form; cukup bisa melihat karyawan atau mengelola jadwal.
  if (!actorCan(actor, "employee:view") && !actorCan(actor, "schedule:manage") && !actorCan(actor, "recap:view_all")) throw Errors.forbidden();
  const rows = await prisma.division.findMany({
    where: opts.includeInactive ? {} : { isActive: true },
    include: { _count: { select: { employees: { where: { isActive: true } } } } },
    orderBy: { name: "asc" },
  });
  return rows.map((d) => ({ id: d.id, name: d.name, isActive: d.isActive, employeeCount: d._count.employees }));
}

const divisionSchema = z.object({ name: requiredText(2, 80, "Nama divisi"), isActive: z.boolean().optional() });

export async function createDivision(actor: Actor, raw: unknown): Promise<DivisionDto> {
  assertCan(actor, "employee:manage");
  const input = parseInput(divisionSchema, raw);
  return transaction(async (tx) => {
    const dup = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM divisions WHERE lower(name) = lower(${input.name}) LIMIT 1`;
    if (dup.length) throw Errors.validation("Nama divisi sudah ada.", { name: "Nama divisi sudah ada" });
    const d = await tx.division.create({ data: { name: input.name } });
    await writeAudit(tx, actor, { action: "division.create", entityType: "Division", entityId: d.id, summary: `Divisi "${d.name}" dibuat`, after: { name: d.name } });
    return { id: d.id, name: d.name, isActive: d.isActive, employeeCount: 0 };
  });
}

export async function updateDivision(actor: Actor, id: string, raw: unknown): Promise<void> {
  assertCan(actor, "employee:manage");
  const input = parseInput(divisionSchema.partial(), raw);
  await transaction(async (tx) => {
    const before = await tx.division.findUnique({ where: { id } });
    if (!before) throw Errors.notFound("Divisi");
    if (input.name && input.name.toLowerCase() !== before.name.toLowerCase()) {
      const dup = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM divisions WHERE lower(name) = lower(${input.name}) AND id <> ${id}::uuid LIMIT 1`;
      if (dup.length) throw Errors.validation("Nama divisi sudah ada.", { name: "Nama divisi sudah ada" });
    }
    await tx.division.update({ where: { id }, data: { ...(input.name ? { name: input.name } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) } });
    await writeAudit(tx, actor, { action: "division.update", entityType: "Division", entityId: id, summary: `Divisi "${before.name}" diperbarui`, before: { name: before.name, isActive: before.isActive }, after: input });
  });
}

// ─────────────────────────── Karyawan ───────────────────────────

function buildWhere(f: z.infer<typeof employeeListSchema>): Prisma.EmployeeWhereInput {
  const active = f.active ?? "active";
  return {
    ...(active === "active" ? { isActive: true } : active === "inactive" ? { isActive: false } : {}),
    ...(f.divisionId ? { divisionId: f.divisionId } : {}),
    ...(f.employmentStatus ? { employmentStatus: f.employmentStatus } : {}),
    ...(f.q ? { OR: [
      { fullName: { contains: f.q, mode: "insensitive" } },
      { employeeNo: { contains: f.q, mode: "insensitive" } },
      { position: { contains: f.q, mode: "insensitive" } },
      { email: { contains: f.q, mode: "insensitive" } },
    ] } : {}),
  };
}

export async function listEmployees(actor: Actor, raw: unknown = {}): Promise<Paged<EmployeeDto>> {
  assertCan(actor, "employee:view");
  const f = parseInput(employeeListSchema, raw);
  const pageSize = f.pageSize ?? 20;
  const page = f.page ?? 1;
  const where = buildWhere(f);
  const [total, rows] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.findMany({ where, include, orderBy: [{ fullName: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  return { items: rows.map(toEmployeeDto), total, page, pageSize, pageCount: Math.max(Math.ceil(total / pageSize), 1) };
}

/** Karyawan untuk dropdown (id, nama, nomor induk) — tanpa data pribadi. */
export async function listEmployeeOptions(actor: Actor, opts: { includeInactive?: boolean } = {}) {
  if (!actorCan(actor, "employee:view") && !actorCan(actor, "attendance:view_all") && !actorCan(actor, "recap:view_all") && !actorCan(actor, "leave:view_all")) throw Errors.forbidden();
  const rows = await prisma.employee.findMany({
    where: opts.includeInactive ? {} : { isActive: true },
    select: { id: true, employeeNo: true, fullName: true, divisionId: true, isActive: true, userId: true },
    orderBy: { fullName: "asc" },
  });
  return rows;
}

/** Detail karyawan. Karyawan biasa hanya boleh membuka datanya SENDIRI. */
export async function getEmployee(actor: Actor, id: string): Promise<EmployeeDto> {
  if (!actorCan(actor, "employee:view") && actor.employeeId !== id) throw Errors.forbidden();
  const e = await prisma.employee.findUnique({ where: { id }, include });
  if (!e) throw Errors.notFound("Karyawan");
  return toEmployeeDto(e);
}

async function assertUnique(tx: Prisma.TransactionClient, employeeNo: string, exceptId?: string) {
  const dup = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM employees WHERE lower("employeeNo") = lower(${employeeNo}) ${exceptId ? Prisma.sql`AND id <> ${exceptId}::uuid` : Prisma.empty} LIMIT 1`;
  if (dup.length) throw Errors.validation("Nomor induk karyawan sudah dipakai.", { employeeNo: "Nomor induk sudah dipakai" });
}

async function assertDivision(tx: Prisma.TransactionClient, divisionId: string | null | undefined) {
  if (!divisionId) return;
  const d = await tx.division.findUnique({ where: { id: divisionId }, select: { isActive: true } });
  if (!d) throw Errors.validation("Divisi tidak ditemukan.", { divisionId: "Divisi tidak ditemukan" });
}

function bankFields(input: z.infer<typeof employeeSchema>) {
  const out: { bankAccountEnc?: string | null; bankAccountLast4?: string | null } = {};
  if (input.bankAccountNo !== undefined) {
    if (input.bankAccountNo === null) { out.bankAccountEnc = null; out.bankAccountLast4 = null; }
    else {
      const digits = input.bankAccountNo.replace(/\D/g, "");
      out.bankAccountEnc = encryptField(digits);
      out.bankAccountLast4 = digits.slice(-4);
    }
  }
  return out;
}

/** Atribut statutori yang diisi pengguna (yang tidak diisi dibiarkan / memakai bawaan). */
function statutoryFields(input: z.infer<typeof employeeSchema>, defaults: { bpjsHealthEnrolled?: boolean; bpjsEmploymentEnrolled?: boolean } = {}) {
  return {
    ...(input.taxStatus !== undefined ? { taxStatus: input.taxStatus } : {}),
    ...(input.hasNpwp !== undefined ? { hasNpwp: input.hasNpwp } : {}),
    ...(input.bpjsHealthEnrolled !== undefined ? { bpjsHealthEnrolled: input.bpjsHealthEnrolled } : defaults.bpjsHealthEnrolled !== undefined ? { bpjsHealthEnrolled: defaults.bpjsHealthEnrolled } : {}),
    ...(input.bpjsEmploymentEnrolled !== undefined ? { bpjsEmploymentEnrolled: input.bpjsEmploymentEnrolled } : defaults.bpjsEmploymentEnrolled !== undefined ? { bpjsEmploymentEnrolled: defaults.bpjsEmploymentEnrolled } : {}),
  };
}

export async function createEmployee(actor: Actor, raw: unknown): Promise<EmployeeDto> {
  assertCan(actor, "employee:manage");
  const input = parseInput(employeeSchema, raw);
  return transaction(async (tx) => {
    await assertUnique(tx, input.employeeNo);
    await assertDivision(tx, input.divisionId);
    const e = await tx.employee.create({
      data: {
        employeeNo: input.employeeNo, fullName: input.fullName, divisionId: input.divisionId ?? null, position: input.position,
        employmentStatus: input.employmentStatus, joinDate: isoToDate(input.joinDate), phone: input.phone, email: input.email,
        address: input.address, bankName: input.bankName, bankAccountHolder: input.bankAccountHolder, notes: input.notes,
        emergencyContactName: input.emergencyContactName, emergencyContactRelation: input.emergencyContactRelation, emergencyContactPhone: input.emergencyContactPhone,
        ...bankFields(input),
        ...statutoryFields(input, input.employmentStatus === "INTERN" ? { bpjsHealthEnrolled: false, bpjsEmploymentEnrolled: false } : {}),
      },
      include,
    });
    await writeAudit(tx, actor, {
      action: "employee.create", entityType: "Employee", entityId: e.id, summary: `Karyawan ${e.fullName} (${e.employeeNo}) ditambahkan`,
      after: { employeeNo: e.employeeNo, fullName: e.fullName, position: e.position, employmentStatus: e.employmentStatus, joinDate: input.joinDate },
    });
    await ensureOrgBaseline(tx, actor, e.id); // riwayat jabatan dimulai dari data awal
    // Karyawan yang BARU bergabung langsung mendapat checklist masuk (data lama/impor tidak dibanjiri checklist).
    if (input.joinDate >= addDays(todayIso(env().APP_TIMEZONE), -30)) await startChecklistIfNone(tx, actor, e.id, "ONBOARDING", { targetDate: autoTarget(input.joinDate, 14), note: "Dimulai otomatis saat karyawan ditambahkan" });
    return toEmployeeDto(e);
  });
}

export async function updateEmployee(actor: Actor, id: string, raw: unknown): Promise<EmployeeDto> {
  assertCan(actor, "employee:manage");
  const input = parseInput(employeeSchema, raw);
  return transaction(async (tx) => {
    const before = await tx.employee.findUnique({ where: { id }, include });
    if (!before) throw Errors.notFound("Karyawan");
    await assertUnique(tx, input.employeeNo, id);
    await assertDivision(tx, input.divisionId);
    if (before.endDate && input.joinDate > dateToIso(before.endDate)) throw Errors.validation("Tanggal mulai tidak boleh setelah tanggal berhenti.", { joinDate: "Setelah tanggal berhenti" });
    if (input.employmentStatus === "INTERN" && before.employmentStatus !== "INTERN") await assertMayBecomeIntern(tx, id);
    await ensureOrgBaseline(tx, actor, id); // jejak "sebelum" untuk karyawan lama yang belum punya riwayat
    const data = {
      employeeNo: input.employeeNo, fullName: input.fullName, divisionId: input.divisionId ?? null, position: input.position,
      employmentStatus: input.employmentStatus, joinDate: isoToDate(input.joinDate), phone: input.phone, email: input.email,
      address: input.address, bankName: input.bankName, bankAccountHolder: input.bankAccountHolder, notes: input.notes,
      emergencyContactName: input.emergencyContactName, emergencyContactRelation: input.emergencyContactRelation, emergencyContactPhone: input.emergencyContactPhone,
      ...bankFields(input),
      ...statutoryFields(input),
    } satisfies Prisma.EmployeeUncheckedUpdateInput;
    const e = await tx.employee.update({ where: { id }, data, include });
    await recordOrgChangeFromUpdate(tx, actor, { divisionId: before.divisionId, position: before.position, employmentStatus: before.employmentStatus }, id);
    const flat = (r: Row) => ({
      employeeNo: r.employeeNo, fullName: r.fullName, divisionId: r.divisionId, position: r.position, employmentStatus: r.employmentStatus,
      joinDate: dateToIso(r.joinDate), phone: r.phone, email: r.email, address: r.address, bankName: r.bankName,
      bankAccountHolder: r.bankAccountHolder, bankAccountLast4: r.bankAccountLast4, notes: r.notes,
      emergencyContactName: r.emergencyContactName, emergencyContactRelation: r.emergencyContactRelation, emergencyContactPhone: r.emergencyContactPhone,
      taxStatus: r.taxStatus, hasNpwp: r.hasNpwp, bpjsHealthEnrolled: r.bpjsHealthEnrolled, bpjsEmploymentEnrolled: r.bpjsEmploymentEnrolled,
    });
    const d = diffFields(flat(before), flat(e));
    if (d.changed.length) {
      await writeAudit(tx, actor, { action: "employee.update", entityType: "Employee", entityId: id, summary: `Data karyawan ${e.fullName} diperbarui (${d.changed.join(", ")})`, before: d.before, after: d.after });
    }
    // Nama akun mengikuti nama karyawan agar konsisten.
    if (e.userId && before.fullName !== e.fullName) await tx.user.update({ where: { id: e.userId }, data: { name: e.fullName } });
    return toEmployeeDto(e);
  });
}

/** `outer`: transaksi rute unggah (berkas baru belum ter-commit) — lihat catatan pada `setLogo`. */
export async function setEmployeePhoto(actor: Actor, id: string, fileId: string, outer?: Tx): Promise<void> {
  assertCan(actor, "employee:manage");
  await (outer ? (fn: (t: Tx) => Promise<void>) => fn(outer) : transaction)(async (tx) => {
    const f = await tx.storedFile.findUnique({ where: { id: fileId }, select: { kind: true } });
    if (f?.kind !== "EMPLOYEE_PHOTO") throw Errors.validation("File foto tidak valid.");
    const e = await tx.employee.findUnique({ where: { id }, select: { fullName: true } });
    if (!e) throw Errors.notFound("Karyawan");
    await tx.employee.update({ where: { id }, data: { photoFileId: fileId } });
    await writeAudit(tx, actor, { action: "employee.photo", entityType: "Employee", entityId: id, summary: `Foto profil ${e.fullName} diganti` });
  });
}

const deactivateSchema = z.object({ endDate: isoDate.optional(), reason: optionalText(300, "Alasan") });

/** Akun login yang tertaut ke karyawan, untuk keputusan menonaktifkan/mengaktifkan. */
type LinkedAccount = { id: string; role: Role; isActive: boolean; email: string };
const linkedAccount = (tx: Tx, userId: string | null): Promise<LinkedAccount | null> =>
  userId ? tx.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true, email: true } }) : Promise.resolve(null);

/**
 * Nonaktifkan: tidak menghapus data. Mengisi tanggal berhenti dan — untuk akun Karyawan — menonaktifkan akun login serta mengakhiri sesinya.
 * Jalur ini TIDAK boleh melewati aturan modul Akun Pengguna:
 *   · akun ADMIN (HR/Super Admin) yang aktif hanya boleh disentuh Super Admin (HR ditolak);
 *   · akun SUPER ADMIN yang aktif TIDAK ikut dinonaktifkan di sini — dua langkah terpisah: nonaktifkan akunnya dulu di Akun Pengguna
 *     (di sana dijaga "minimal satu Super Admin aktif"), baru nonaktifkan data karyawannya;
 *   · akun admin yang sudah nonaktif dibiarkan apa adanya.
 */
export async function deactivateEmployee(actor: Actor, id: string, raw: unknown): Promise<{ handover: HandoverDto }> {
  assertCan(actor, "employee:manage");
  const input = parseInput(deactivateSchema, raw ?? {});
  await transaction(async (tx) => {
    const e = await tx.employee.findUnique({ where: { id } });
    if (!e) throw Errors.notFound("Karyawan");
    if (!e.isActive) throw Errors.conflict("Karyawan sudah nonaktif.");
    if (e.userId === actor.userId) throw Errors.validation("Anda tidak dapat menonaktifkan data karyawan akun Anda sendiri.");
    const acct = await linkedAccount(tx, e.userId);
    if (acct?.isActive && acct.role !== "EMPLOYEE") {
      if (!manageableRoles(actor.role).includes(acct.role)) throw Errors.forbidden("Karyawan ini memiliki akun admin yang masih aktif; hanya Super Admin yang dapat mengelolanya.");
      if (acct.role === "SUPER_ADMIN") throw Errors.conflict("Karyawan ini memiliki akun Super Admin yang masih aktif. Nonaktifkan akunnya lebih dulu di Akun Pengguna (oleh Super Admin lain; sistem memastikan masih ada Super Admin aktif), lalu nonaktifkan data karyawannya.");
    }
    const endDate = input.endDate ?? todayIso(env().APP_TIMEZONE);
    if (endDate < dateToIso(e.joinDate)) throw Errors.validation("Tanggal berhenti tidak boleh sebelum tanggal mulai bekerja.", { endDate: "Sebelum tanggal mulai" });
    await tx.employee.update({ where: { id }, data: { isActive: false, endDate: isoToDate(endDate) } });
    if (acct) {
      if (acct.isActive) await tx.user.update({ where: { id: acct.id }, data: { isActive: false } });
      await tx.session.updateMany({ where: { userId: acct.id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    await writeAudit(tx, actor, { action: "employee.deactivate", entityType: "Employee", entityId: id, summary: `Karyawan ${e.fullName} dinonaktifkan (berhenti ${endDate})`, reason: input.reason, after: { endDate } });
    // Proses berhenti tidak boleh terlupa: checklist berhenti dimulai otomatis bila belum ada yang berjalan.
    await startChecklistIfNone(tx, actor, id, "OFFBOARDING", { targetDate: autoTarget(endDate, 14), note: "Dimulai otomatis saat karyawan dinonaktifkan" });
    // Serah terima Training: PIC (atau Koordinator Program & Direktur bila PIC-nya yang berhenti) diberi tahu SEKALI per proyek yang masih memegang pekerjaannya.
    // Tidak ada yang dialihkan/diakhiri otomatis; penandanya dihitung dari status karyawan sehingga hilang sendiri bila diaktifkan kembali.
    await notifyHandover(tx, id);
  });
  return { handover: await handoverFor(actor, id) };
}

/** Hasil mengaktifkan kembali karyawan terhadap akun loginnya. */
export type ReactivateAccountResult = "NO_ACCOUNT" | "REACTIVATED" | "ALREADY_ACTIVE" | "ADMIN_KEPT_INACTIVE";

/**
 * Aktifkan kembali data karyawan. Akun login ikut aktif HANYA bila akun berperan Karyawan. Akun admin (HR/Super Admin) tidak pernah ikut hidup dari sini —
 * diaktifkan eksplisit oleh Super Admin di Akun Pengguna — sehingga jalur ini tidak bisa dipakai membuka kembali akun admin yang sengaja dimatikan.
 */
export async function reactivateEmployee(actor: Actor, id: string): Promise<{ account: ReactivateAccountResult }> {
  assertCan(actor, "employee:manage");
  return transaction(async (tx) => {
    const e = await tx.employee.findUnique({ where: { id } });
    if (!e) throw Errors.notFound("Karyawan");
    if (e.isActive) throw Errors.conflict("Karyawan sudah aktif.");
    const acct = await linkedAccount(tx, e.userId);
    await tx.employee.update({ where: { id }, data: { isActive: true, endDate: null } });
    let account: ReactivateAccountResult = "NO_ACCOUNT";
    if (acct) {
      if (acct.isActive) account = "ALREADY_ACTIVE";
      else if (acct.role === "EMPLOYEE") { await tx.user.update({ where: { id: acct.id }, data: { isActive: true } }); account = "REACTIVATED"; }
      else account = "ADMIN_KEPT_INACTIVE";
    }
    const note = account === "REACTIVATED" ? " (akun login ikut diaktifkan)" : account === "ADMIN_KEPT_INACTIVE" ? " (akun admin tetap nonaktif — diaktifkan terpisah oleh Super Admin di Akun Pengguna)" : "";
    await writeAudit(tx, actor, { action: "employee.reactivate", entityType: "Employee", entityId: id, summary: `Karyawan ${e.fullName} diaktifkan kembali${note}` });
    return { account };
  });
}

/** Tampilkan nomor rekening lengkap — hanya HR/Super Admin, SETIAP pembukaan dicatat di audit log. */
export async function revealBankAccount(actor: Actor, id: string): Promise<{ bankName: string | null; accountNo: string | null; holder: string | null }> {
  assertCan(actor, "employee:manage");
  const e = await prisma.employee.findUnique({ where: { id }, select: { fullName: true, bankName: true, bankAccountEnc: true, bankAccountHolder: true } });
  if (!e) throw Errors.notFound("Karyawan");
  await writeAudit(prisma, actor, { action: "employee.reveal_bank", entityType: "Employee", entityId: id, summary: `Nomor rekening ${e.fullName} dibuka` });
  return { bankName: e.bankName, accountNo: e.bankAccountEnc ? decryptField(e.bankAccountEnc) : null, holder: e.bankAccountHolder };
}

// ─────────────────────────── Ekspor ───────────────────────────

export async function employeesTable(actor: Actor, raw: unknown = {}): Promise<ReportTable> {
  assertCan(actor, "employee:export");
  const f = parseInput(employeeListSchema, raw);
  const rows = await prisma.employee.findMany({ where: buildWhere(f), include, orderBy: { fullName: "asc" }, take: 5000 });
  await writeAudit(prisma, actor, { action: "employee.export", entityType: "Employee", summary: `Ekspor data karyawan (${rows.length} baris)` });
  return {
    type: "Karyawan",
    title: "Daftar Karyawan",
    description: "Data karyawan",
    disclaimer: "Dokumen berisi data pribadi karyawan — jaga kerahasiaannya. Nomor rekening hanya ditampilkan 4 digit terakhir.",
    periodLabel: `Per ${todayIso(env().APP_TIMEZONE)}`,
    generatedAt: new Date().toISOString(),
    columns: [
      { key: "employeeNo", label: "No. Induk", type: "text", width: 14 },
      { key: "fullName", label: "Nama Lengkap", type: "text", width: 28 },
      { key: "division", label: "Divisi", type: "text", width: 18 },
      { key: "position", label: "Jabatan", type: "text", width: 22 },
      { key: "status", label: "Status", type: "text", width: 10 },
      { key: "joinDate", label: "Mulai Bekerja", type: "date", width: 13 },
      { key: "phone", label: "Telepon", type: "text", width: 16 },
      { key: "email", label: "Email", type: "text", width: 26 },
      { key: "address", label: "Alamat", type: "text", width: 34 },
      { key: "bank", label: "Bank", type: "text", width: 14 },
      { key: "account", label: "Rekening", type: "text", width: 18 },
      { key: "active", label: "Aktif", type: "text", width: 8 },
    ],
    rows: rows.map((e) => ({
      employeeNo: e.employeeNo, fullName: e.fullName, division: e.division?.name ?? "", position: e.position,
      status: EMPLOYMENT_LABEL[e.employmentStatus], joinDate: dateToIso(e.joinDate), phone: e.phone ?? "", email: e.email ?? "",
      address: e.address ?? "", bank: e.bankName ?? "", account: maskAccount(e.bankAccountLast4) ?? "", active: e.isActive ? "Ya" : "Tidak",
    })),
    totals: null,
  };
}
