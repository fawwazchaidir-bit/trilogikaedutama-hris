import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma, transaction, type Tx } from "../db";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import { assertCan, type Actor } from "../actor";
import { can } from "@/lib/permissions";
import { notifyUsers, reviewerUserIds } from "./notifications";
import { ensureTemplate } from "./employee-checklist-templates";
import { writeAudit } from "../audit";
import { dateToIso, isoToDate } from "../json";
import { env, trainingEnabled } from "../env";
import { balanceOf } from "./leave";
import { loadConfig } from "./training/indicator-config";
import { assetSignalData } from "./assets";
import { isoDate, optionalText, requiredText } from "@/lib/validation/common";
import { addDays, diffDays, todayIso } from "@/lib/time";
import { formatDateLong, formatDays } from "@/lib/format";
import { KIND_LABEL, type ChecklistItemStatus, type ChecklistKind, type Signal } from "@/lib/employee-checklist";

/**
 * CHECKLIST MASUK & BERHENTI karyawan — daftar centang sederhana agar prosesnya tidak bergantung pada ingatan satu orang.
 * Butir bawaan disalin dari template; HR menandai Selesai / Tidak berlaku (dengan alasan) dan dapat menambah butir. Sistem memberi SINYAL
 * (mis. "atasan belum ditetapkan", "masih memegang 3 tugas aktif") tetapi tidak mencentang sendiri: siapa dan kapan menyelesaikan selalu tercatat.
 * Dimulai otomatis saat karyawan baru ditambahkan (hanya yang baru bergabung) dan saat karyawan dinonaktifkan; dapat pula dimulai manual.
 */

type Db = Tx | typeof prisma;

export interface ChecklistItemDto {
  id: string; key: string; group: string; title: string; hint: string | null; required: boolean; status: ChecklistItemStatus;
  note: string | null; doneBy: string | null; doneAt: string | null; signal: Signal | null;
  assigneeId: string | null; assigneeName: string | null; dueDate: string | null; overdue: boolean;
}
export interface ChecklistProgress { total: number; done: number; notApplicable: number; requiredLeft: number }
export interface ChecklistDto {
  id: string; employeeId: string; employeeName: string; employeeNo: string; kind: ChecklistKind; status: "OPEN" | "COMPLETED" | "CANCELLED";
  targetDate: string | null; overdue: boolean; note: string | null; startedAt: string; startedBy: string; completedAt: string | null; completedBy: string | null;
  cancelReason: string | null; progress: ChecklistProgress; items: ChecklistItemDto[];
}
export interface ChecklistRow {
  id: string; employeeId: string; employeeName: string; employeeNo: string; position: string; division: string | null; kind: ChecklistKind;
  status: "OPEN" | "COMPLETED" | "CANCELLED"; targetDate: string | null; overdue: boolean; startedAt: string; progress: ChecklistProgress;
}

const today = () => todayIso(env().APP_TIMEZONE);

// ─────────────────────────── Sinyal otomatis ───────────────────────────

const plural = (n: number, one: string) => `${n} ${one}`;

/** Petunjuk dari data sistem untuk butir template. Hanya BACA; tidak pernah mengubah status butir. */
export async function signalsFor(db: Db, kind: ChecklistKind, employeeId: string, startedAt: Date): Promise<Record<string, Signal>> {
  const e = await db.employee.findUnique({ where: { id: employeeId }, include: { user: { select: { id: true, email: true, isActive: true, role: true } }, division: { select: { name: true } } } });
  if (!e) return {};
  const out: Record<string, Signal> = {};
  const now = isoToDate(today());
  if (kind === "ONBOARDING") {
    const missing = [!e.phone && "telepon", !e.address && "alamat", !e.bankAccountLast4 && "rekening gaji"].filter(Boolean) as string[];
    out.basic_data = missing.length ? { state: "WARN", text: `Belum diisi: ${missing.join(", ")}.` } : { state: "OK", text: "Telepon, alamat, dan rekening gaji sudah terisi." };
    out.emergency_contact = e.emergencyContactName && e.emergencyContactPhone
      ? { state: "OK", text: `${e.emergencyContactName}${e.emergencyContactRelation ? ` (${e.emergencyContactRelation})` : ""} · ${e.emergencyContactPhone}` }
      : { state: "WARN", text: "Kontak darurat belum lengkap (nama dan telepon)." };
    const contracts = await db.employeeDocument.count({ where: { employeeId, kind: "CONTRACT", archivedAt: null } });
    out.contract_docs = contracts ? { state: "OK", text: `${plural(contracts, "kontrak")} tercatat di menu Dokumen.` } : { state: "WARN", text: "Belum ada kontrak yang tercatat." };
    const gaps = [!e.supervisorId && "atasan langsung", !e.divisionId && "divisi"].filter(Boolean) as string[];
    out.placement = gaps.length ? { state: "WARN", text: `Belum ditetapkan: ${gaps.join(", ")}.` } : { state: "OK", text: `Divisi ${e.division?.name ?? "—"}; atasan langsung sudah ditetapkan.` };
    const sched = await db.scheduleAssignment.count({
      where: { startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gte: now } }], AND: [{ OR: [{ scope: "EMPLOYEE", employeeId }, ...(e.divisionId ? [{ scope: "DIVISION" as const, divisionId: e.divisionId }] : [])] }] },
    });
    out.schedule = sched ? { state: "OK", text: "Ada penugasan jadwal khusus yang berlaku." } : { state: "INFO", text: "Memakai jadwal bawaan perusahaan (tidak ada penugasan khusus)." };
    const base = await db.salaryComponent.count({ where: { employeeId, isActive: true, category: "BASE_SALARY" } });
    out.salary_components = base ? { state: "OK", text: "Gaji pokok sudah ditetapkan." } : { state: "WARN", text: "Belum ada komponen gaji pokok." };
    out.portal_account = e.user ? (e.user.isActive ? { state: "OK", text: `Akun ${e.user.email} aktif.` } : { state: "WARN", text: "Akun ada tetapi nonaktif." }) : { state: "WARN", text: "Belum ada akun portal yang tertaut." };
    if (e.user) {
      const [level, projects] = await Promise.all([
        db.trainingAccess.findUnique({ where: { userId: e.user.id }, select: { level: true } }),
        db.trainingProjectMember.count({ where: { employeeId, endedAt: null } }),
      ]);
      out.system_access = { state: "INFO", text: `Peran akun: ${e.user.role}; level Training: ${level?.level ?? "—"}; anggota ${projects} proyek aktif.` };
    } else out.system_access = { state: "INFO", text: "Belum ada akun, jadi belum ada hak akses." };
    return out;
  }
  // OFFBOARDING
  const live = { status: { notIn: ["COMPLETED", "CANCELLED"] as ("COMPLETED" | "CANCELLED")[] } };
  const docs = await db.employeeDocument.count({ where: { employeeId, archivedAt: null, kind: "OTHER", createdAt: { gte: startedAt } } });
  out.end_date_docs = e.endDate
    ? { state: docs ? "OK" : "WARN", text: `Berhenti ${formatDateLong(dateToIso(e.endDate))}; ${docs ? `${plural(docs, "dokumen")} dicatat sejak proses dimulai` : "belum ada dokumen penyelesaian yang dicatat"}.` }
    : { state: "INFO", text: "Karyawan masih aktif; tanggal berhenti dicatat saat karyawan dinonaktifkan." };
  const [tasks, projects, reports] = await Promise.all([
    db.trainingTask.count({ where: { assigneeId: employeeId, status: { in: ["TODO", "IN_PROGRESS", "IN_REVIEW"] }, project: live } }),
    db.trainingProjectMember.count({ where: { employeeId, endedAt: null, project: live } }),
    db.employee.count({ where: { supervisorId: employeeId, isActive: true } }),
  ]);
  let roles = 0;
  if (trainingEnabled()) roles = Object.values((await loadConfig(db)).config.roleHolders).filter((id) => id === employeeId).length;
  const parts = [tasks && `${plural(tasks, "tugas Training aktif")}`, projects && `${plural(projects, "keanggotaan proyek aktif")}`, reports && `${plural(reports, "bawahan langsung")}`, roles && `${plural(roles, "jabatan pada Rumus Indikator")}`].filter(Boolean);
  out.handover = parts.length ? { state: "WARN", text: `Masih memegang: ${parts.join(", ")}.` } : { state: "OK", text: "Tidak ada tugas, proyek, bawahan, atau jabatan indikator yang tersisa." };
  out.account_decision = e.user ? (e.user.isActive ? { state: "INFO", text: `Akun ${e.user.email} masih aktif; menonaktifkan karyawan akan menonaktifkan akun dan mengakhiri sesinya.` } : { state: "OK", text: "Akun sudah dinonaktifkan dan sesi diakhiri." }) : { state: "OK", text: "Karyawan tidak punya akun portal." };
  const ast = await assetSignalData(db, employeeId);
  out.assets = ast.holding.length
    ? { state: "WARN", text: `Belum dikembalikan: ${ast.holding.map((a) => `${a.name} (${a.code})`).join(", ")}.` }
    : ast.everHeld
      ? { state: "OK", text: `Semua aset yang tercatat sudah dikembalikan (${plural(ast.everHeld, "serah-terima")}${ast.problems ? `, ${plural(ast.problems, "dikembalikan rusak/hilang")}` : ""}).` }
      : { state: "INFO", text: "Tidak ada aset tercatat atas nama karyawan ini. Bila ada aset yang belum dicatat (laptop, kunci, seragam), catat dulu di menu Aset." };
  const year = Number(today().slice(0, 4));
  const [bal, allowances, loans] = await Promise.all([
    balanceOf(db, employeeId, year),
    db.assignmentAssignee.count({ where: { employeeId, letter: { status: "ISSUED" }, receipts: { none: { status: "ACTIVE" } } } }),
    db.salaryComponent.count({ where: { employeeId, isActive: true, category: "LOAN" } }),
  ]);
  const ob = [`sisa cuti ${year}: ${formatDays(bal.balance)} hari`, allowances && `${plural(allowances, "uang harian belum diterbitkan bukti penerimaannya")}`, loans && `${plural(loans, "kasbon/pinjaman aktif")}`].filter(Boolean);
  out.obligations = { state: allowances || loans ? "WARN" : "INFO", text: `${ob.join("; ")}.` };
  return out;
}

// ─────────────────────────── Pembentukan DTO ───────────────────────────

const checklistInclude = { employee: { select: { fullName: true, employeeNo: true, position: true, division: { select: { name: true } } } }, items: { orderBy: { sortOrder: "asc" } } } satisfies Prisma.EmployeeChecklistInclude;
type Row = Prisma.EmployeeChecklistGetPayload<{ include: typeof checklistInclude }>;

const progressOf = (items: { required: boolean; status: string }[]): ChecklistProgress => ({
  total: items.length, done: items.filter((i) => i.status === "DONE").length, notApplicable: items.filter((i) => i.status === "NOT_APPLICABLE").length,
  requiredLeft: items.filter((i) => i.required && i.status === "TODO").length,
});
const isOverdue = (r: { status: string; targetDate: Date | null }) => r.status === "OPEN" && !!r.targetDate && dateToIso(r.targetDate) < today();

async function toDtos(rows: Row[], withSignals: boolean): Promise<ChecklistDto[]> {
  const ids = [...new Set(rows.flatMap((r) => [r.startedById, r.completedById, ...r.items.flatMap((i) => [i.doneById, i.assigneeId])]).filter((x): x is string => !!x))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name]));
  const out: ChecklistDto[] = [];
  for (const r of rows) {
    const sig = withSignals && r.status === "OPEN" ? await signalsFor(prisma, r.kind, r.employeeId, r.startedAt) : {};
    out.push({
      id: r.id, employeeId: r.employeeId, employeeName: r.employee.fullName, employeeNo: r.employee.employeeNo, kind: r.kind, status: r.status,
      targetDate: r.targetDate ? dateToIso(r.targetDate) : null, overdue: isOverdue(r), note: r.note, startedAt: r.startedAt.toISOString(), startedBy: name.get(r.startedById) ?? "—",
      completedAt: r.completedAt?.toISOString() ?? null, completedBy: r.completedById ? name.get(r.completedById) ?? "—" : null, cancelReason: r.cancelReason, progress: progressOf(r.items),
      items: r.items.map((i) => ({
        id: i.id, key: i.key, group: i.groupLabel, title: i.title, hint: i.hint, required: i.required, status: i.status, note: i.note,
        doneBy: i.doneById ? name.get(i.doneById) ?? "—" : null, doneAt: i.doneAt?.toISOString() ?? null, signal: sig[i.key] ?? null,
        assigneeId: i.assigneeId, assigneeName: i.assigneeId ? name.get(i.assigneeId) ?? "—" : null, dueDate: i.dueDate ? dateToIso(i.dueDate) : null,
        overdue: r.status === "OPEN" && i.status === "TODO" && !!i.dueDate && dateToIso(i.dueDate) < today(),
      })),
    });
  }
  return out;
}

// ─────────────────────────── Memulai ───────────────────────────

export const startSchema = z.object({
  kind: z.enum(["ONBOARDING", "OFFBOARDING"], { error: "Jenis checklist wajib dipilih" }),
  targetDate: isoDate.nullable().optional(),
  note: optionalText(300, "Catatan"),
});

/** Mulai checklist bila belum ada yang terbuka untuk (karyawan, jenis). Dipakai juga oleh penambahan & penonaktifan karyawan (dalam transaksinya). */
export async function startChecklistIfNone(tx: Tx, actor: Actor, employeeId: string, kind: ChecklistKind, opts: { targetDate?: string | null; note?: string | null } = {}): Promise<string | null> {
  const emp = await tx.employee.findUnique({ where: { id: employeeId }, select: { fullName: true, isActive: true } });
  if (!emp) throw Errors.notFound("Karyawan");
  if (await tx.employeeChecklist.findFirst({ where: { employeeId, kind, status: "OPEN" }, select: { id: true } })) return null;
  // Butir disalin dari TEMPLATE (yang dapat diedit HR): tenggat = hari ini + selisih, penanggung jawab = bawaan template bila akunnya masih aktif.
  const tpl = (await ensureTemplate(tx, kind)).filter((t) => t.active);
  if (tpl.length === 0) throw Errors.validation("Template checklist tidak punya butir aktif.");
  const assigneeIds = [...new Set(tpl.map((t) => t.defaultAssigneeId).filter((x): x is string => !!x))];
  const activeAssignees = new Set((await tx.user.findMany({ where: { id: { in: assigneeIds }, isActive: true }, select: { id: true } })).map((u) => u.id));
  const base = today();
  const c = await tx.employeeChecklist.create({
    data: {
      employeeId, kind, targetDate: opts.targetDate ? isoToDate(opts.targetDate) : null, note: opts.note ?? null, startedById: actor.userId,
      items: { create: tpl.map((t, i) => ({
        key: t.key, groupLabel: t.groupLabel, title: t.title, hint: t.hint, required: t.required, sortOrder: i + 1,
        dueDate: t.dueOffsetDays !== null ? isoToDate(addDays(base, t.dueOffsetDays)) : null, assigneeId: t.defaultAssigneeId && activeAssignees.has(t.defaultAssigneeId) ? t.defaultAssigneeId : null,
      })) },
    },
    select: { id: true, items: { select: { assigneeId: true } } },
  });
  for (const uid of new Set(c.items.map((i) => i.assigneeId).filter((x): x is string => !!x))) {
    const n = c.items.filter((i) => i.assigneeId === uid).length;
    await notifyUsers(tx, [uid], { type: "checklist.assigned", title: "Anda ditunjuk sebagai penanggung jawab checklist", body: `${emp.fullName} · ${KIND_LABEL[kind]} · ${n} butir`, href: "/checklist-saya" });
  }
  await writeAudit(tx, actor, { action: "checklist.start", entityType: "EmployeeChecklist", entityId: c.id, summary: `Checklist "${KIND_LABEL[kind]}" untuk ${emp.fullName} dimulai`, after: { kind, targetDate: opts.targetDate ?? null } });
  return c.id;
}

export async function startChecklist(actor: Actor, employeeId: string, raw: unknown): Promise<ChecklistDto> {
  assertCan(actor, "employee:manage");
  const input = parseInput(startSchema, raw);
  const id = await transaction(async (tx) => {
    const emp = await tx.employee.findUnique({ where: { id: employeeId }, select: { isActive: true } });
    if (!emp) throw Errors.notFound("Karyawan");
    if (input.kind === "ONBOARDING" && !emp.isActive) throw Errors.conflict("Karyawan nonaktif: checklist masuk tidak dapat dimulai.");
    if (input.targetDate && input.targetDate < today()) throw Errors.validation("Target selesai tidak boleh di masa lalu.", { targetDate: "Di masa lalu" });
    const created = await startChecklistIfNone(tx, actor, employeeId, input.kind, { targetDate: input.targetDate, note: input.note });
    if (!created) throw Errors.conflict(`Checklist "${KIND_LABEL[input.kind]}" untuk karyawan ini sudah berjalan.`);
    return created;
  });
  return (await listEmployeeChecklists(actor, employeeId)).find((c) => c.id === id)!;
}

// ─────────────────────────── Membaca ───────────────────────────

/** Checklist satu karyawan: yang terbuka lebih dulu (dengan sinyal), lalu beberapa yang sudah selesai/dibatalkan. HR (employee:view). */
export async function listEmployeeChecklists(actor: Actor, employeeId: string): Promise<ChecklistDto[]> {
  assertCan(actor, "employee:view");
  const rows = await prisma.employeeChecklist.findMany({ where: { employeeId }, include: checklistInclude, orderBy: { startedAt: "desc" }, take: 20 });
  const sorted = [...rows.filter((r) => r.status === "OPEN"), ...rows.filter((r) => r.status !== "OPEN").slice(0, 5)];
  return toDtos(sorted, true);
}

/** Ringkasan semua proses: yang terbuka (terlambat dulu) + yang baru ditutup. */
export async function listChecklistOverview(actor: Actor): Promise<{ open: ChecklistRow[]; recent: ChecklistRow[] }> {
  assertCan(actor, "employee:view");
  const [open, recent] = await Promise.all([
    prisma.employeeChecklist.findMany({ where: { status: "OPEN" }, include: checklistInclude, take: 200 }),
    prisma.employeeChecklist.findMany({ where: { status: { not: "OPEN" } }, include: checklistInclude, orderBy: { startedAt: "desc" }, take: 15 }),
  ]);
  const row = (r: Row): ChecklistRow => ({
    id: r.id, employeeId: r.employeeId, employeeName: r.employee.fullName, employeeNo: r.employee.employeeNo, position: r.employee.position, division: r.employee.division?.name ?? null,
    kind: r.kind, status: r.status, targetDate: r.targetDate ? dateToIso(r.targetDate) : null, overdue: isOverdue(r), startedAt: r.startedAt.toISOString(), progress: progressOf(r.items),
  });
  return { open: open.map(row).sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999")), recent: recent.map(row) };
}

/** Jumlah proses terbuka (lencana menu HR). */
export async function openChecklistCount(): Promise<number> {
  return prisma.employeeChecklist.count({ where: { status: "OPEN" } });
}

// ─────────────────────────── Mengubah butir & proses ───────────────────────────

export const itemSchema = z.object({
  status: z.enum(["TODO", "DONE", "NOT_APPLICABLE"], { error: "Status butir tidak valid" }),
  note: optionalText(500, "Catatan"),
}).superRefine((v, ctx) => {
  if (v.status === "NOT_APPLICABLE" && !v.note) ctx.addIssue({ code: "custom", path: ["note"], message: "Alasan wajib diisi bila butir tidak berlaku" });
});

async function openItem(tx: Tx, itemId: string) {
  const item = await tx.employeeChecklistItem.findUnique({ where: { id: itemId }, include: { checklist: { include: { employee: { select: { fullName: true } } } } } });
  if (!item) throw Errors.notFound("Butir checklist");
  if (item.checklist.status !== "OPEN") throw Errors.conflict("Checklist ini sudah selesai atau dibatalkan; butirnya terkunci.");
  return item;
}

/** HR/Super Admin (employee:manage) atau penanggung jawab butir itu sendiri boleh menandai butir. Selain itu 403. */
export async function setChecklistItem(actor: Actor, itemId: string, raw: unknown): Promise<void> {
  if (!can(actor.role, "employee:manage")) {
    const mine = await prisma.employeeChecklistItem.findUnique({ where: { id: itemId }, select: { assigneeId: true } });
    if (!mine || mine.assigneeId !== actor.userId) throw Errors.forbidden();
  }
  const input = parseInput(itemSchema, raw);
  await transaction(async (tx) => {
    const item = await openItem(tx, itemId);
    const decided = input.status !== "TODO";
    await tx.employeeChecklistItem.update({
      where: { id: itemId },
      data: { status: input.status, note: input.note ?? (decided ? item.note : null), doneById: decided ? actor.userId : null, doneAt: decided ? new Date() : null },
    });
    await writeAudit(tx, actor, {
      action: "checklist.item", entityType: "EmployeeChecklistItem", entityId: itemId,
      summary: `Butir "${item.title}" (${item.checklist.employee.fullName}) → ${{ TODO: "belum", DONE: "selesai", NOT_APPLICABLE: "tidak berlaku" }[input.status]}`,
      before: { status: item.status }, after: { status: input.status }, reason: input.note,
    });
  });
}

export const addItemSchema = z.object({
  title: requiredText(3, 160, "Judul butir"),
  hint: optionalText(300, "Keterangan"),
  required: z.boolean().default(false),
});

/** Tambah butir khusus pada checklist yang sedang berjalan (mis. "Serahkan laptop ke IT"). */
export async function addChecklistItem(actor: Actor, checklistId: string, raw: unknown): Promise<void> {
  assertCan(actor, "employee:manage");
  const input = parseInput(addItemSchema, raw);
  await transaction(async (tx) => {
    const c = await tx.employeeChecklist.findUnique({ where: { id: checklistId }, include: { employee: { select: { fullName: true } }, items: { select: { sortOrder: true } } } });
    if (!c) throw Errors.notFound("Checklist");
    if (c.status !== "OPEN") throw Errors.conflict("Checklist ini sudah selesai atau dibatalkan.");
    const sortOrder = Math.max(0, ...c.items.map((i) => i.sortOrder)) + 1;
    await tx.employeeChecklistItem.create({ data: { checklistId, key: `custom-${randomUUID().slice(0, 8)}`, groupLabel: "Tambahan HR", title: input.title, hint: input.hint, required: input.required, sortOrder } });
    await writeAudit(tx, actor, { action: "checklist.item_add", entityType: "EmployeeChecklist", entityId: checklistId, summary: `Butir "${input.title}" ditambahkan pada checklist ${c.employee.fullName}` });
  });
}

const completeSchema = z.object({ note: optionalText(300, "Catatan") });

/** Selesaikan proses: semua butir wajib harus Selesai atau Tidak berlaku (dengan alasan). */
export async function completeChecklist(actor: Actor, checklistId: string, raw: unknown = {}): Promise<void> {
  assertCan(actor, "employee:manage");
  const { note } = parseInput(completeSchema, raw ?? {});
  await transaction(async (tx) => {
    const c = await tx.employeeChecklist.findUnique({ where: { id: checklistId }, include: { employee: { select: { fullName: true } }, items: true } });
    if (!c) throw Errors.notFound("Checklist");
    if (c.status !== "OPEN") throw Errors.conflict("Checklist ini sudah selesai atau dibatalkan.");
    const left = c.items.filter((i) => i.required && i.status === "TODO");
    if (left.length) throw Errors.validation(`Masih ada ${left.length} butir wajib yang belum diselesaikan: ${left.slice(0, 3).map((i) => `"${i.title}"`).join(", ")}${left.length > 3 ? ", …" : ""}.`);
    await tx.employeeChecklist.update({ where: { id: checklistId }, data: { status: "COMPLETED", completedAt: new Date(), completedById: actor.userId, ...(note ? { note } : {}) } });
    await writeAudit(tx, actor, { action: "checklist.complete", entityType: "EmployeeChecklist", entityId: checklistId, summary: `Checklist "${KIND_LABEL[c.kind]}" ${c.employee.fullName} diselesaikan`, reason: note });
  });
}

const cancelSchema = z.object({ reason: requiredText(5, 300, "Alasan pembatalan") });

export async function cancelChecklist(actor: Actor, checklistId: string, raw: unknown): Promise<void> {
  assertCan(actor, "employee:manage");
  const { reason } = parseInput(cancelSchema, raw);
  await transaction(async (tx) => {
    const c = await tx.employeeChecklist.findUnique({ where: { id: checklistId }, include: { employee: { select: { fullName: true } } } });
    if (!c) throw Errors.notFound("Checklist");
    if (c.status !== "OPEN") throw Errors.conflict("Checklist ini sudah selesai atau dibatalkan.");
    await tx.employeeChecklist.update({ where: { id: checklistId }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: actor.userId, cancelReason: reason } });
    await writeAudit(tx, actor, { action: "checklist.cancel", entityType: "EmployeeChecklist", entityId: checklistId, summary: `Checklist "${KIND_LABEL[c.kind]}" ${c.employee.fullName} dibatalkan`, reason });
  });
}

/** Target bawaan saat dimulai otomatis: minggu-minggu pertama, tidak pernah di masa lalu. */
export const autoTarget = (base: string, days: number): string => { const t = addDays(base, days), min = addDays(today(), 7); return t < min ? min : t; };

// ─────────────────────────── Penanggung jawab & tenggat per butir ───────────────────────────

export const assignSchema = z.object({ assigneeId: z.string().uuid("Penanggung jawab tidak valid").nullable(), dueDate: isoDate.nullable().optional() });

/** HR menunjuk/mengganti penanggung jawab dan tenggat sebuah butir. Penanggung jawab diberi tahu. */
export async function assignChecklistItem(actor: Actor, itemId: string, raw: unknown): Promise<void> {
  assertCan(actor, "employee:manage");
  const input = parseInput(assignSchema, raw);
  await transaction(async (tx) => {
    const item = await openItem(tx, itemId);
    if (input.assigneeId) {
      const u = await tx.user.findUnique({ where: { id: input.assigneeId }, select: { isActive: true } });
      if (!u?.isActive) throw Errors.validation("Penanggung jawab harus akun pengguna yang aktif.", { assigneeId: "Tidak valid" });
    }
    await tx.employeeChecklistItem.update({ where: { id: itemId }, data: { assigneeId: input.assigneeId, ...(input.dueDate !== undefined ? { dueDate: input.dueDate ? isoToDate(input.dueDate) : null } : {}) } });
    await writeAudit(tx, actor, {
      action: "checklist.item_assign", entityType: "EmployeeChecklistItem", entityId: itemId, summary: `Butir "${item.title}" (${item.checklist.employee.fullName}): penanggung jawab/tenggat diubah`,
      before: { assigneeId: item.assigneeId, dueDate: item.dueDate ? dateToIso(item.dueDate) : null }, after: { assigneeId: input.assigneeId, dueDate: input.dueDate ?? null },
    });
    if (input.assigneeId && input.assigneeId !== item.assigneeId) {
      await notifyUsers(tx, [input.assigneeId], { type: "checklist.assigned", title: "Anda ditunjuk sebagai penanggung jawab butir checklist", body: `${item.checklist.employee.fullName} · ${item.title}${input.dueDate ? ` · tenggat ${formatDateLong(input.dueDate)}` : ""}`, href: "/checklist-saya" });
    }
  });
}

export interface MyChecklistItemDto { itemId: string; checklistId: string; employeeName: string; kind: ChecklistKind; group: string; title: string; hint: string | null; dueDate: string | null; overdue: boolean }

/** Butir yang menjadi tanggung jawab pelaku dan belum selesai (tanpa data sinyal — hanya yang perlu untuk mengerjakannya). */
export async function listMyChecklistItems(actor: Actor): Promise<MyChecklistItemDto[]> {
  const rows = await prisma.employeeChecklistItem.findMany({
    where: { assigneeId: actor.userId, status: "TODO", checklist: { status: "OPEN" } },
    include: { checklist: { select: { id: true, kind: true, employee: { select: { fullName: true } } } } }, orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }, { sortOrder: "asc" }], take: 200,
  });
  return rows.map((r) => ({
    itemId: r.id, checklistId: r.checklist.id, employeeName: r.checklist.employee.fullName, kind: r.checklist.kind, group: r.groupLabel, title: r.title, hint: r.hint,
    dueDate: r.dueDate ? dateToIso(r.dueDate) : null, overdue: !!r.dueDate && dateToIso(r.dueDate) < today(),
  }));
}

export async function myChecklistCount(userId: string): Promise<number> {
  return prisma.employeeChecklistItem.count({ where: { assigneeId: userId, status: "TODO", checklist: { status: "OPEN" } } });
}

// ─────────────────────────── Pengingat otomatis ───────────────────────────

/**
 * Pengingat butir checklist: H-1, hari-H, dan terlambat (sekali per pekan keterlambatan). Penerima: penanggung jawab; bila tidak ada → HR & Super Admin;
 * keterlambatan juga dikabarkan ke HR. IDEMPOTEN: kunci dedupe per butir/fase/penerima di `employee_checklist_reminder_log` (aman dijalankan tiap jam, banyak instance).
 */
export async function runChecklistReminders(now: Date = new Date()): Promise<{ checked: number; sent: number }> {
  const t = todayIso(env().APP_TIMEZONE, now), tomorrow = addDays(t, 1);
  const items = await prisma.employeeChecklistItem.findMany({
    where: { status: "TODO", dueDate: { not: null, lte: isoToDate(tomorrow) }, checklist: { status: "OPEN" } },
    include: { checklist: { select: { employeeId: true, kind: true, employee: { select: { fullName: true } } } } }, take: 2000,
  });
  if (!items.length) return { checked: 0, sent: 0 };
  const hr = await reviewerUserIds(prisma);
  const activeAssignees = new Set((await prisma.user.findMany({ where: { id: { in: [...new Set(items.map((i) => i.assigneeId).filter((x): x is string => !!x))] }, isActive: true }, select: { id: true } })).map((u) => u.id));
  type Out = { key: string; itemId: string; userId: string; title: string; body: string; href: string };
  const out: Out[] = [];
  for (const it of items) {
    const due = dateToIso(it.dueDate!);
    const late = due < t ? diffDays(t, due) : 0;
    const phase = due === tomorrow ? "H-1" : due === t ? "H" : late > 0 ? `T${Math.floor((late - 1) / 7)}` : null;
    if (!phase) continue;
    const owner = it.assigneeId && activeAssignees.has(it.assigneeId) ? it.assigneeId : null;
    const to = new Map<string, string>();
    if (owner) to.set(owner, "/checklist-saya");
    if (!owner || late > 0) for (const u of hr) if (!to.has(u)) to.set(u, `/karyawan/${it.checklist.employeeId}`);
    const title = phase === "H-1" ? "Butir checklist jatuh tempo besok" : phase === "H" ? "Butir checklist jatuh tempo hari ini" : `Butir checklist terlambat ${late} hari`;
    const body = `${it.checklist.employee.fullName} · ${KIND_LABEL[it.checklist.kind]} · ${it.title}`;
    for (const [userId, href] of to) out.push({ key: `chk:${it.id}:${phase}:${due}:${userId}`, itemId: it.id, userId, title, body, href });
  }
  if (!out.length) return { checked: items.length, sent: 0 };
  const sent = await transaction(async (tx) => {
    const created = await tx.employeeChecklistReminderLog.createManyAndReturn({ data: out.map((o) => ({ dedupeKey: o.key, itemId: o.itemId })), skipDuplicates: true, select: { dedupeKey: true } });
    const fresh = new Set(created.map((c) => c.dedupeKey));
    const send = out.filter((o) => fresh.has(o.key));
    const groups = new Map<string, { o: Out; users: string[] }>();
    for (const o of send) { const k = `${o.title}|${o.body}|${o.href}`; const g = groups.get(k) ?? { o, users: [] }; g.users.push(o.userId); groups.set(k, g); }
    for (const g of groups.values()) await notifyUsers(tx, g.users, { type: "checklist.reminder", title: g.o.title, body: g.o.body, href: g.o.href });
    return send.length;
  });
  return { checked: items.length, sent };
}
