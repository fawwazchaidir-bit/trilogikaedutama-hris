import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, transaction } from "../db";
import { env } from "../env";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import { actorCan, assertCan, requireSelf, type Actor } from "../actor";
import { writeAudit } from "../audit";
import { dateToIso, isoToDate } from "../json";
import { countScheduledDays } from "@/lib/attendance";
import { employeeLite, loadRangeContext } from "./context";
import { getSettings } from "./settings";
import { notifyUsers, reviewerUserIds } from "./notifications";
import { diffDays, rangesOverlap, todayIso } from "@/lib/time";
import { isoDate, optionalText, requiredText, uuid } from "@/lib/validation/common";
import { LEAVE_TYPE_LABEL, type LeaveType, type RequestStatus } from "@/lib/labels";
import { formatDateRange } from "@/lib/format";
import type { Paged } from "@/lib/types";

export const MAX_LEAVE_RANGE_DAYS = 90;

export const leaveSubmitSchema = z.object({
  type: z.enum(["IZIN", "SAKIT", "CUTI"], { error: "Jenis pengajuan wajib dipilih" }),
  startDate: isoDate,
  endDate: isoDate,
  reason: requiredText(5, 500, "Alasan"),
  attachmentFileId: uuid.nullable().optional(),
}).superRefine((v, ctx) => {
  if (v.endDate < v.startDate) ctx.addIssue({ code: "custom", path: ["endDate"], message: "Tanggal selesai tidak boleh sebelum tanggal mulai" });
  else if (diffDays(v.endDate, v.startDate) + 1 > MAX_LEAVE_RANGE_DAYS) ctx.addIssue({ code: "custom", path: ["endDate"], message: `Rentang pengajuan maksimal ${MAX_LEAVE_RANGE_DAYS} hari` });
});

export const leaveListSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  type: z.enum(["IZIN", "SAKIT", "CUTI"]).optional(),
  employeeId: uuid.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export interface LeaveDto {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  division: string | null;
  type: LeaveType;
  startDate: string;
  endDate: string;
  reason: string;
  status: RequestStatus;
  workingDays: number | null;
  attachmentUrl: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

const include = {
  employee: { select: { fullName: true, employeeNo: true, division: { select: { name: true } } } },
} satisfies Prisma.LeaveRequestInclude;
type Row = Prisma.LeaveRequestGetPayload<{ include: typeof include }>;

async function toDtos(rows: Row[]): Promise<LeaveDto[]> {
  const ids = [...new Set(rows.map((r) => r.reviewedById).filter((x): x is string => !!x))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id, employeeId: r.employeeId, employeeName: r.employee.fullName, employeeNo: r.employee.employeeNo, division: r.employee.division?.name ?? null,
    type: r.type, startDate: dateToIso(r.startDate), endDate: dateToIso(r.endDate), reason: r.reason, status: r.status, workingDays: r.workingDays,
    attachmentUrl: r.attachmentFileId ? `/api/files/${r.attachmentFileId}` : null,
    reviewedBy: r.reviewedById ? name.get(r.reviewedById) ?? null : null, reviewedAt: r.reviewedAt?.toISOString() ?? null, reviewNote: r.reviewNote,
    cancelledAt: r.cancelledAt?.toISOString() ?? null, cancelReason: r.cancelReason, createdAt: r.createdAt.toISOString(),
  }));
}

// ─────────────────────────── Hari kerja yang tercakup ───────────────────────────

async function workingDaysOf(employeeId: string, start: string, end: string) {
  const emp = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
  const ctx = await loadRangeContext(start, end, { employeeIds: [employeeId] });
  return countScheduledDays(employeeLite(emp), start, end, {
    now: ctx.now, timeZone: ctx.timeZone, lateAfterTolerance: ctx.lateAfterTolerance, schedules: ctx.schedules,
    defaultSchedule: ctx.defaultSchedule, assignments: ctx.assignments, calendar: ctx.calendar,
  });
}

// ─────────────────────────── Saldo cuti ───────────────────────────

export interface BalanceDto {
  year: number;
  granted: number;
  adjustments: number;
  used: number;
  restored: number;
  balance: number;
  /** Cuti yang masih menunggu persetujuan (mengurangi saldo yang tersedia). */
  reserved: number;
  available: number;
}

export async function balanceOf(db: Prisma.TransactionClient | typeof prisma, employeeId: string, year: number): Promise<BalanceDto> {
  const rows = await db.leaveBalanceEntry.groupBy({ by: ["kind"], where: { employeeId, year }, _sum: { days: true } });
  const sum = (k: string) => rows.find((r) => r.kind === k)?._sum.days ?? 0;
  const granted = sum("GRANT"), adjustments = sum("ADJUSTMENT"), used = sum("USAGE"), restored = sum("RESTORE");
  const balance = granted + adjustments + used + restored;
  const pending = await db.leaveRequest.findMany({ where: { employeeId, type: "CUTI", status: "PENDING" }, select: { startDate: true, endDate: true, workingDays: true } });
  // Cuti yang menunggu dicadangkan pada tahun tanggal mulainya (sama dengan aturan pemotongan saat disetujui, disederhanakan per pengajuan).
  const reserved = pending.filter((p) => p.startDate.getUTCFullYear() === year).reduce((a, p) => a + (p.workingDays ?? 0), 0);
  return { year, granted, adjustments, used, restored, balance, reserved, available: balance - reserved };
}

export async function getBalance(actor: Actor, employeeId: string, year?: number): Promise<BalanceDto> {
  if (actor.employeeId !== employeeId) assertCan(actor, "leave:view_all");
  const y = year ?? Number(todayIso(env().APP_TIMEZONE).slice(0, 4));
  return balanceOf(prisma, employeeId, y);
}

export interface LedgerDto { id: string; year: number; kind: string; days: number; note: string | null; requestId: string | null; createdAt: string; createdBy: string }

export async function getLedger(actor: Actor, employeeId: string, year?: number): Promise<LedgerDto[]> {
  if (actor.employeeId !== employeeId) assertCan(actor, "leave:view_all");
  const rows = await prisma.leaveBalanceEntry.findMany({ where: { employeeId, ...(year ? { year } : {}) }, orderBy: { id: "desc" }, take: 200 });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({ id: r.id.toString(), year: r.year, kind: r.kind, days: r.days, note: r.note, requestId: r.requestId, createdAt: r.createdAt.toISOString(), createdBy: name.get(r.createdById) ?? "—" }));
}

const setBalanceSchema = z.object({
  employeeId: uuid,
  year: z.number().int().min(2000).max(2200),
  targetDays: z.number({ error: "Saldo harus berupa angka" }).int("Saldo harus bilangan bulat (hari)").min(-366).max(366),
  note: requiredText(5, 300, "Catatan"),
});

/**
 * Atur saldo cuti tahun tertentu ke angka target. Pertama kali → baris GRANT (saldo awal); selanjutnya → ADJUSTMENT
 * sebesar selisih. Selalu menambah baris baru di buku saldo (append-only) dengan catatan wajib.
 */
export async function setBalance(actor: Actor, raw: unknown): Promise<BalanceDto> {
  assertCan(actor, "leave_balance:manage");
  const input = parseInput(setBalanceSchema, raw);
  return transaction(async (tx) => {
    const emp = await tx.employee.findUnique({ where: { id: input.employeeId }, select: { fullName: true } });
    if (!emp) throw Errors.notFound("Karyawan");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"leave:" + input.employeeId}))`;
    const before = await balanceOf(tx, input.employeeId, input.year);
    const delta = input.targetDays - before.balance;
    if (delta === 0) throw Errors.validation("Saldo sudah sama dengan nilai tersebut.");
    const hasGrant = (await tx.leaveBalanceEntry.count({ where: { employeeId: input.employeeId, year: input.year, kind: "GRANT" } })) > 0;
    if (!hasGrant && delta < 0) throw Errors.validation("Saldo awal tidak boleh negatif.");
    await tx.leaveBalanceEntry.create({
      data: { employeeId: input.employeeId, year: input.year, kind: hasGrant ? "ADJUSTMENT" : "GRANT", days: delta, note: input.note, createdById: actor.userId },
    });
    await writeAudit(tx, actor, {
      action: "leave_balance.set", entityType: "Employee", entityId: input.employeeId,
      summary: `Saldo cuti ${emp.fullName} ${input.year}: ${before.balance} → ${input.targetDays} hari`, before: { balance: before.balance }, after: { balance: input.targetDays }, reason: input.note,
    });
    return balanceOf(tx, input.employeeId, input.year);
  });
}

/** Terapkan kuota tahunan (kebijakan) ke semua karyawan aktif yang BELUM punya saldo awal tahun tsb. Aman dijalankan ulang. */
export async function grantAnnualQuota(actor: Actor, raw: unknown): Promise<{ granted: number; skipped: number; quota: number }> {
  assertCan(actor, "leave_balance:manage");
  const { year } = parseInput(z.object({ year: z.number().int().min(2000).max(2200) }), raw);
  const settings = await getSettings();
  const quota = settings.annualLeaveQuota;
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('leave:grant'))`;
    const emps = await tx.employee.findMany({ where: { isActive: true }, select: { id: true } });
    const have = await tx.leaveBalanceEntry.findMany({ where: { year, kind: "GRANT", employeeId: { in: emps.map((e) => e.id) } }, select: { employeeId: true } });
    const haveSet = new Set(have.map((h) => h.employeeId));
    const todo = emps.filter((e) => !haveSet.has(e.id));
    if (quota > 0 && todo.length) {
      await tx.leaveBalanceEntry.createMany({
        data: todo.map((e) => ({ employeeId: e.id, year, kind: "GRANT" as const, days: quota, note: `Kuota cuti tahunan ${year} (kebijakan: ${quota} hari)`, createdById: actor.userId })),
      });
    }
    await writeAudit(tx, actor, { action: "leave_balance.grant_annual", entityType: "LeaveBalance", summary: `Kuota cuti ${year} (${quota} hari) diterapkan ke ${quota > 0 ? todo.length : 0} karyawan`, after: { year, quota, granted: todo.length } });
    return { granted: quota > 0 ? todo.length : 0, skipped: haveSet.size, quota };
  });
}

// ─────────────────────────── Pengajuan ───────────────────────────

export async function submitLeave(actor: Actor, raw: unknown): Promise<LeaveDto> {
  const employeeId = requireSelf(actor);
  const input = parseInput(leaveSubmitSchema, raw);
  const settings = await getSettings();
  const tz = env().APP_TIMEZONE;
  const today = todayIso(tz);
  const earliest = new Date(Date.parse(`${today}T00:00:00Z`) - settings.requestBackdateDays * 86_400_000).toISOString().slice(0, 10);
  if (input.startDate < earliest) {
    throw Errors.validation(`Tanggal mulai terlalu lampau. Pengajuan hanya dapat diajukan paling lama ${settings.requestBackdateDays} hari ke belakang.`, { startDate: "Terlalu lampau" });
  }
  const wd = await workingDaysOf(employeeId, input.startDate, input.endDate);
  if (wd.total === 0) {
    throw Errors.validation("Rentang tanggal tidak mencakup hari kerja terjadwal (semua hari libur/akhir pekan).", { startDate: "Tidak ada hari kerja" });
  }

  return transaction(async (tx) => {
    const emp = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!emp || !emp.isActive) throw Errors.forbidden("Data karyawan Anda nonaktif.");
    if (input.startDate < dateToIso(emp.joinDate)) throw Errors.validation("Tanggal mulai sebelum tanggal Anda mulai bekerja.", { startDate: "Sebelum tanggal mulai bekerja" });
    // Kunci per-karyawan: dua pengajuan bersamaan tidak boleh sama-sama lolos cek tumpang tindih/saldo.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"leave:" + employeeId}))`;

    const open = await tx.leaveRequest.findMany({ where: { employeeId, status: { in: ["PENDING", "APPROVED"] } }, select: { startDate: true, endDate: true, type: true, status: true } });
    const clash = open.find((o) => rangesOverlap(dateToIso(o.startDate), dateToIso(o.endDate), input.startDate, input.endDate));
    if (clash) {
      throw Errors.conflict(`Tanggal bertabrakan dengan pengajuan ${LEAVE_TYPE_LABEL[clash.type].toLowerCase()} lain yang ${clash.status === "PENDING" ? "masih menunggu" : "sudah disetujui"} (${formatDateRange(dateToIso(clash.startDate), dateToIso(clash.endDate))}).`);
    }
    if (input.attachmentFileId) {
      const f = await tx.storedFile.findUnique({ where: { id: input.attachmentFileId }, select: { kind: true, uploadedById: true } });
      if (!f || f.kind !== "LEAVE_ATTACHMENT" || f.uploadedById !== actor.userId) throw Errors.validation("Lampiran tidak valid.", { attachmentFileId: "Lampiran tidak valid" });
    }
    if (input.type === "CUTI" && !settings.allowNegativeLeaveBalance) {
      for (const [year, days] of wd.byYear) {
        const b = await balanceOf(tx, employeeId, year);
        if (days > b.available) {
          throw Errors.validation(`Saldo cuti ${year} tidak cukup: tersedia ${b.available} hari (saldo ${b.balance}, menunggu persetujuan ${b.reserved}), diminta ${days} hari kerja.`, { type: "Saldo cuti tidak cukup" });
        }
      }
    }
    const created = await tx.leaveRequest.create({
      data: {
        employeeId, type: input.type, startDate: isoToDate(input.startDate), endDate: isoToDate(input.endDate), reason: input.reason,
        attachmentFileId: input.attachmentFileId ?? null, workingDays: wd.total,
      },
      include,
    });
    await writeAudit(tx, actor, {
      action: "leave.submit", entityType: "LeaveRequest", entityId: created.id,
      summary: `${LEAVE_TYPE_LABEL[input.type]} ${formatDateRange(input.startDate, input.endDate)} (${wd.total} hari kerja) diajukan`, after: { type: input.type, startDate: input.startDate, endDate: input.endDate, workingDays: wd.total },
    });
    await notifyUsers(tx, await reviewerUserIds(tx, actor.userId), {
      type: "leave.submitted", title: `Pengajuan ${LEAVE_TYPE_LABEL[input.type].toLowerCase()} baru`,
      body: `${emp.fullName} · ${formatDateRange(input.startDate, input.endDate)}`, href: "/pengajuan?status=PENDING",
    });
    return (await toDtos([created]))[0]!;
  });
}

export async function listMyLeaves(actor: Actor): Promise<LeaveDto[]> {
  const employeeId = requireSelf(actor);
  const rows = await prisma.leaveRequest.findMany({ where: { employeeId }, include, orderBy: { createdAt: "desc" }, take: 100 });
  return toDtos(rows);
}

export async function listLeaves(actor: Actor, raw: unknown = {}): Promise<Paged<LeaveDto>> {
  assertCan(actor, "leave:view_all");
  const f = parseInput(leaveListSchema, raw);
  const pageSize = f.pageSize ?? 20;
  const page = f.page ?? 1;
  const where: Prisma.LeaveRequestWhereInput = {
    ...(f.status ? { status: f.status } : {}), ...(f.type ? { type: f.type } : {}), ...(f.employeeId ? { employeeId: f.employeeId } : {}),
    ...(f.q ? { employee: { OR: [{ fullName: { contains: f.q, mode: "insensitive" } }, { employeeNo: { contains: f.q, mode: "insensitive" } }] } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.leaveRequest.count({ where }),
    prisma.leaveRequest.findMany({
      where, include, skip: (page - 1) * pageSize, take: pageSize,
      orderBy: f.status === "PENDING" ? [{ createdAt: "asc" }] : [{ createdAt: "desc" }],
    }),
  ]);
  return { items: await toDtos(rows), total, page, pageSize, pageCount: Math.max(Math.ceil(total / pageSize), 1) };
}

const reviewSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: optionalText(300, "Catatan"),
}).superRefine((v, ctx) => {
  if (v.decision === "REJECT" && !v.note) ctx.addIssue({ code: "custom", path: ["note"], message: "Catatan wajib diisi saat menolak pengajuan" });
});

/**
 * Setujui / tolak. Aturan: tidak boleh memproses pengajuan sendiri kecuali Super Admin (pimpinan);
 * penyetujuan cuti memotong saldo per tahun (USAGE) dalam transaksi yang sama.
 */
export async function reviewLeave(actor: Actor, id: string, raw: unknown): Promise<LeaveDto> {
  assertCan(actor, "leave:review");
  const input = parseInput(reviewSchema, raw);
  const req0 = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!req0) throw Errors.notFound("Pengajuan");
  if (req0.employeeId === actor.employeeId && actor.role !== "SUPER_ADMIN") {
    throw Errors.forbidden("Anda tidak dapat memproses pengajuan Anda sendiri. Minta Super Admin untuk memprosesnya.");
  }
  const start = dateToIso(req0.startDate), end = dateToIso(req0.endDate);
  const wd = input.decision === "APPROVE" ? await workingDaysOf(req0.employeeId, start, end) : null;
  if (wd && wd.total === 0) throw Errors.validation("Rentang pengajuan tidak lagi mencakup hari kerja terjadwal (jadwal/kalender berubah). Tolak atau minta pengajuan ulang.");
  const settings = await getSettings();

  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"leave:" + req0.employeeId}))`;
    const req = await tx.leaveRequest.findUniqueOrThrow({ where: { id }, include });
    if (req.status !== "PENDING") throw Errors.conflict(`Pengajuan sudah ${req.status === "APPROVED" ? "disetujui" : req.status === "REJECTED" ? "ditolak" : "dibatalkan"}.`);
    const now = new Date();
    if (input.decision === "APPROVE") {
      // Pengajuan lain yang sudah disetujui pada rentang yang sama (mis. dibuat sebelum aturan tumpang tindih) menghalangi.
      const others = await tx.leaveRequest.findMany({ where: { employeeId: req.employeeId, status: "APPROVED", id: { not: id } }, select: { startDate: true, endDate: true } });
      if (others.some((o) => rangesOverlap(dateToIso(o.startDate), dateToIso(o.endDate), start, end))) throw Errors.conflict("Bertabrakan dengan pengajuan lain yang sudah disetujui.");
      if (req.type === "CUTI") {
        for (const [year, days] of wd!.byYear) {
          const b = await balanceOf(tx, req.employeeId, year);
          // Pengajuan ini sendiri sedang "menunggu" dan sudah tercadang di `reserved`; cek terhadap saldo riil.
          if (!settings.allowNegativeLeaveBalance && days > b.balance) {
            throw Errors.validation(`Saldo cuti ${year} ${req.employee.fullName} tidak cukup: saldo ${b.balance} hari, diminta ${days} hari kerja. Atur saldo terlebih dulu atau tolak pengajuan.`);
          }
        }
        await tx.leaveBalanceEntry.createMany({
          data: [...wd!.byYear].map(([year, days]) => ({
            employeeId: req.employeeId, year, kind: "USAGE" as const, days: -days, requestId: id,
            note: `Cuti ${formatDateRange(start, end)}`, createdById: actor.userId,
          })),
        });
      }
    }
    const r = await tx.leaveRequest.updateMany({
      where: { id, status: "PENDING" },
      data: {
        status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED", reviewedById: actor.userId, reviewedAt: now, reviewNote: input.note,
        ...(wd ? { workingDays: wd.total } : {}),
      },
    });
    if (r.count === 0) throw Errors.conflict("Pengajuan sudah diproses oleh pengguna lain.");
    await writeAudit(tx, actor, {
      action: input.decision === "APPROVE" ? "leave.approve" : "leave.reject", entityType: "LeaveRequest", entityId: id,
      summary: `${LEAVE_TYPE_LABEL[req.type]} ${req.employee.fullName} ${formatDateRange(start, end)} ${input.decision === "APPROVE" ? "disetujui" : "ditolak"}`,
      before: { status: "PENDING" }, after: { status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED", workingDays: wd?.total ?? null }, reason: input.note,
    });
    const owner = await tx.employee.findUnique({ where: { id: req.employeeId }, select: { userId: true } });
    if (owner?.userId) {
      await notifyUsers(tx, [owner.userId], {
        type: "leave.reviewed", title: `Pengajuan ${LEAVE_TYPE_LABEL[req.type].toLowerCase()} ${input.decision === "APPROVE" ? "disetujui" : "ditolak"}`,
        body: `${formatDateRange(start, end)}${input.note ? ` · Catatan: ${input.note}` : ""}`, href: "/pengajuan-saya",
      });
    }
    const updated = await tx.leaveRequest.findUniqueOrThrow({ where: { id }, include });
    return (await toDtos([updated]))[0]!;
  });
}

const cancelSchema = z.object({ reason: optionalText(300, "Alasan") });

/**
 * Pembatalan. Karyawan: hanya pengajuan miliknya yang MENUNGGU. Admin (leave:review): juga yang sudah DISETUJUI,
 * dengan alasan wajib — saldo cuti dikembalikan (RESTORE) dan rekap kembali mengikuti jadwal.
 */
export async function cancelLeave(actor: Actor, id: string, raw: unknown): Promise<LeaveDto> {
  const input = parseInput(cancelSchema, raw ?? {});
  const req0 = await prisma.leaveRequest.findUnique({ where: { id } });
  if (!req0) throw Errors.notFound("Pengajuan");
  const isOwner = req0.employeeId === actor.employeeId;
  const isReviewer = actorCan(actor, "leave:review");
  if (!isOwner && !isReviewer) throw Errors.forbidden();
  if (isOwner && !isReviewer && req0.status !== "PENDING") throw Errors.forbidden("Pengajuan yang sudah diproses hanya dapat dibatalkan oleh HR.");
  if (req0.status === "APPROVED" && !input.reason) throw Errors.validation("Alasan pembatalan wajib diisi untuk pengajuan yang sudah disetujui.", { reason: "Wajib diisi" });

  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"leave:" + req0.employeeId}))`;
    const req = await tx.leaveRequest.findUniqueOrThrow({ where: { id }, include });
    if (req.status !== "PENDING" && req.status !== "APPROVED") throw Errors.conflict("Pengajuan ini tidak dapat dibatalkan.");
    const reason = input.reason ?? "Dibatalkan oleh pengaju";
    if (req.status === "APPROVED" && req.type === "CUTI") {
      const used = await tx.leaveBalanceEntry.findMany({ where: { requestId: id, kind: "USAGE" } });
      const restored = await tx.leaveBalanceEntry.findMany({ where: { requestId: id, kind: "RESTORE" } });
      if (restored.length === 0 && used.length) {
        await tx.leaveBalanceEntry.createMany({
          data: used.map((u) => ({ employeeId: u.employeeId, year: u.year, kind: "RESTORE" as const, days: -u.days, requestId: id, note: `Pembatalan cuti: ${reason}`, createdById: actor.userId })),
        });
      }
    }
    const wasApproved = req.status === "APPROVED";
    const r = await tx.leaveRequest.updateMany({ where: { id, status: req.status }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason } });
    if (r.count === 0) throw Errors.conflict("Pengajuan sudah berubah. Muat ulang halaman.");
    await writeAudit(tx, actor, {
      action: "leave.cancel", entityType: "LeaveRequest", entityId: id,
      summary: `${LEAVE_TYPE_LABEL[req.type]} ${req.employee.fullName} ${formatDateRange(dateToIso(req.startDate), dateToIso(req.endDate))} dibatalkan`,
      before: { status: req.status }, after: { status: "CANCELLED" }, reason,
    });
    if (wasApproved && !isOwner) {
      const owner = await tx.employee.findUnique({ where: { id: req.employeeId }, select: { userId: true } });
      if (owner?.userId) await notifyUsers(tx, [owner.userId], { type: "leave.cancelled", title: `Pengajuan ${LEAVE_TYPE_LABEL[req.type].toLowerCase()} Anda dibatalkan oleh HR`, body: reason, href: "/pengajuan-saya" });
    }
    const updated = await tx.leaveRequest.findUniqueOrThrow({ where: { id }, include });
    return (await toDtos([updated]))[0]!;
  });
}

/** Jumlah pengajuan menunggu (badge menu / dashboard). */
export async function pendingLeaveCount(): Promise<number> {
  return prisma.leaveRequest.count({ where: { status: "PENDING" } });
}
