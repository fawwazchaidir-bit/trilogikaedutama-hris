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
import { getSettings } from "./settings";
import { notifyUsers, reviewerUserIds } from "./notifications";
import type { OvertimeApproval } from "@/lib/payroll";
import { addDays, timeToMinutes, todayIso, minutesToTime } from "@/lib/time";
import { formatDateShort, formatDuration } from "@/lib/format";
import { hhmm, isoDate, optionalText, requiredText, uuid } from "@/lib/validation/common";
import type { RequestStatus } from "@/lib/labels";
import type { Paged } from "@/lib/types";

/** Pengajuan lembur boleh dibuat sampai sekian hari ke depan (persetujuan di muka). */
export const OVERTIME_MAX_AHEAD_DAYS = 30;
export const OVERTIME_MAX_MINUTES = 720;

export const overtimeSubmitSchema = z.object({
  date: isoDate,
  startTime: hhmm,
  minutes: z.number({ error: "Durasi harus berupa angka (menit)" }).int("Durasi harus bilangan bulat (menit)")
    .min(15, "Durasi lembur minimal 15 menit").max(OVERTIME_MAX_MINUTES, `Durasi lembur maksimal ${OVERTIME_MAX_MINUTES / 60} jam per pengajuan`),
  reason: requiredText(5, 500, "Alasan / pekerjaan yang dilembur"),
});

export const overtimeListSchema = z.object({
  status: z.enum(["PENDING", "APPROVED", "REJECTED", "CANCELLED"]).optional(),
  employeeId: uuid.optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

export interface OvertimeDto {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  division: string | null;
  date: string;
  startTime: string;
  endTime: string;
  /** Selesai di hari kalender berikutnya. */
  endsNextDay: boolean;
  minutes: number;
  reason: string;
  status: RequestStatus;
  approvedMinutes: number | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
}

const include = { employee: { select: { fullName: true, employeeNo: true, division: { select: { name: true } } } } } satisfies Prisma.OvertimeRequestInclude;
type Row = Prisma.OvertimeRequestGetPayload<{ include: typeof include }>;

async function toDtos(rows: Row[]): Promise<OvertimeDto[]> {
  const ids = [...new Set(rows.map((r) => r.reviewedById).filter((x): x is string => !!x))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => {
    const endMin = timeToMinutes(r.startTime) + r.minutes;
    return {
      id: r.id, employeeId: r.employeeId, employeeName: r.employee.fullName, employeeNo: r.employee.employeeNo, division: r.employee.division?.name ?? null,
      date: dateToIso(r.date), startTime: r.startTime, endTime: minutesToTime(endMin % 1440), endsNextDay: endMin >= 1440, minutes: r.minutes, reason: r.reason,
      status: r.status, approvedMinutes: r.approvedMinutes, reviewedBy: r.reviewedById ? name.get(r.reviewedById) ?? null : null,
      reviewedAt: r.reviewedAt?.toISOString() ?? null, reviewNote: r.reviewNote, cancelledAt: r.cancelledAt?.toISOString() ?? null,
      cancelReason: r.cancelReason, createdAt: r.createdAt.toISOString(),
    };
  });
}

// ─────────────────────────── Pengajuan ───────────────────────────

export async function submitOvertime(actor: Actor, raw: unknown): Promise<OvertimeDto> {
  const employeeId = requireSelf(actor);
  const input = parseInput(overtimeSubmitSchema, raw);
  const settings = await getSettings();
  const today = todayIso(env().APP_TIMEZONE);
  const earliest = addDays(today, -settings.requestBackdateDays);
  const latest = addDays(today, OVERTIME_MAX_AHEAD_DAYS);
  if (input.date < earliest) throw Errors.validation(`Tanggal lembur terlalu lampau. Pengajuan hanya dapat diajukan paling lama ${settings.requestBackdateDays} hari ke belakang.`, { date: "Terlalu lampau" });
  if (input.date > latest) throw Errors.validation(`Tanggal lembur maksimal ${OVERTIME_MAX_AHEAD_DAYS} hari ke depan.`, { date: "Terlalu jauh" });

  return transaction(async (tx) => {
    const emp = await tx.employee.findUnique({ where: { id: employeeId } });
    if (!emp || !emp.isActive) throw Errors.forbidden("Data karyawan Anda nonaktif.");
    if (input.date < dateToIso(emp.joinDate)) throw Errors.validation("Tanggal lembur sebelum tanggal Anda mulai bekerja.", { date: "Sebelum tanggal mulai bekerja" });
    if (emp.endDate && input.date > dateToIso(emp.endDate)) throw Errors.validation("Tanggal lembur setelah tanggal berhenti.", { date: "Setelah tanggal berhenti" });
    // Cuti/izin/sakit sehari penuh yang disetujui pada tanggal itu: tidak mungkin lembur.
    const leave = await tx.leaveRequest.findFirst({
      where: { employeeId, status: "APPROVED", dayPart: "FULL", startDate: { lte: isoToDate(input.date) }, endDate: { gte: isoToDate(input.date) } },
      select: { type: true },
    });
    if (leave) throw Errors.conflict(`Anda memiliki ${leave.type === "CUTI" ? "cuti" : leave.type === "SAKIT" ? "sakit" : "izin"} sehari penuh yang disetujui pada tanggal ini; lembur tidak dapat diajukan.`);
    let created: Row;
    try {
      created = await tx.overtimeRequest.create({
        data: { employeeId, date: isoToDate(input.date), startTime: input.startTime, minutes: input.minutes, reason: input.reason },
        include,
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw Errors.conflict("Sudah ada pengajuan lembur (menunggu/disetujui) untuk tanggal ini. Batalkan terlebih dulu bila ingin mengganti.");
      }
      throw e;
    }
    await writeAudit(tx, actor, {
      action: "overtime.submit", entityType: "OvertimeRequest", entityId: created.id,
      summary: `Lembur ${formatDateShort(input.date)} ${input.startTime} (${formatDuration(input.minutes)}) diajukan`, after: { date: input.date, startTime: input.startTime, minutes: input.minutes },
    });
    await notifyUsers(tx, await reviewerUserIds(tx, actor.userId), {
      type: "overtime.submitted", title: "Pengajuan lembur baru", body: `${emp.fullName} · ${formatDateShort(input.date)} · ${formatDuration(input.minutes)}`, href: "/lembur?status=PENDING",
    });
    return (await toDtos([created]))[0]!;
  });
}

export async function listMyOvertime(actor: Actor): Promise<OvertimeDto[]> {
  const employeeId = requireSelf(actor);
  const rows = await prisma.overtimeRequest.findMany({ where: { employeeId }, include, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 100 });
  return toDtos(rows);
}

export async function listOvertime(actor: Actor, raw: unknown = {}): Promise<Paged<OvertimeDto>> {
  assertCan(actor, "overtime:view_all");
  const f = parseInput(overtimeListSchema, raw);
  const pageSize = f.pageSize ?? 20;
  const page = f.page ?? 1;
  const where: Prisma.OvertimeRequestWhereInput = {
    ...(f.status ? { status: f.status } : {}), ...(f.employeeId ? { employeeId: f.employeeId } : {}),
    ...(f.from || f.to ? { date: { ...(f.from ? { gte: isoToDate(f.from) } : {}), ...(f.to ? { lte: isoToDate(f.to) } : {}) } } : {}),
    ...(f.q ? { employee: { OR: [{ fullName: { contains: f.q, mode: "insensitive" } }, { employeeNo: { contains: f.q, mode: "insensitive" } }] } } : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.overtimeRequest.count({ where }),
    prisma.overtimeRequest.findMany({
      where, include, skip: (page - 1) * pageSize, take: pageSize,
      orderBy: f.status === "PENDING" ? [{ createdAt: "asc" }] : [{ date: "desc" }, { createdAt: "desc" }],
    }),
  ]);
  return { items: await toDtos(rows), total, page, pageSize, pageCount: Math.max(Math.ceil(total / pageSize), 1) };
}

export async function pendingOvertimeCount(): Promise<number> {
  return prisma.overtimeRequest.count({ where: { status: "PENDING" } });
}

// ─────────────────────────── Persetujuan ───────────────────────────

const reviewSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  /** Menit yang disetujui (≤ diajukan). Kosong = sebanyak diajukan. */
  approvedMinutes: z.number().int("Menit harus bilangan bulat").min(1, "Menit disetujui minimal 1").optional(),
  note: optionalText(300, "Catatan"),
}).superRefine((v, ctx) => {
  if (v.decision === "REJECT" && !v.note) ctx.addIssue({ code: "custom", path: ["note"], message: "Catatan wajib diisi saat menolak pengajuan" });
});

/** Periode gaji yang sudah diajukan/disetujui/terbit dan mencakup tanggal ini — untuk catatan kepada pemroses. */
async function payrollNoticesFor(tx: Prisma.TransactionClient | typeof prisma, date: Date): Promise<string[]> {
  const runs = await tx.payrollRun.findMany({
    where: { status: { in: ["PENDING_APPROVAL", "APPROVED", "ISSUED"] }, attendanceStart: { lte: date }, attendanceEnd: { gte: date } },
    select: { label: true, status: true },
  });
  return runs.map((r) => r.status === "ISSUED"
    ? `Periode gaji "${r.label}" sudah diterbitkan: slip TIDAK berubah. Bila diperlukan, batalkan dan buat revisi.`
    : `Periode gaji "${r.label}" (${r.status === "APPROVED" ? "disetujui" : "menunggu persetujuan"}) memakai tanggal ini: kembalikan ke draf dan hitung ulang agar lembur ikut terhitung.`);
}

export interface OvertimeReviewResult { overtime: OvertimeDto; payrollNotices: string[] }

export async function reviewOvertime(actor: Actor, id: string, raw: unknown): Promise<OvertimeReviewResult> {
  assertCan(actor, "overtime:review");
  const input = parseInput(reviewSchema, raw);
  const req0 = await prisma.overtimeRequest.findUnique({ where: { id } });
  if (!req0) throw Errors.notFound("Pengajuan lembur");
  if (req0.employeeId === actor.employeeId && actor.role !== "SUPER_ADMIN") {
    throw Errors.forbidden("Anda tidak dapat memproses pengajuan lembur Anda sendiri. Minta Super Admin untuk memprosesnya.");
  }
  if (input.decision === "APPROVE" && input.approvedMinutes !== undefined && input.approvedMinutes > req0.minutes) {
    throw Errors.validation(`Menit disetujui tidak boleh melebihi yang diajukan (${req0.minutes} menit).`, { approvedMinutes: "Melebihi yang diajukan" });
  }
  return transaction(async (tx) => {
    const req = await tx.overtimeRequest.findUniqueOrThrow({ where: { id }, include });
    if (req.status !== "PENDING") {
      throw Errors.conflict(`Pengajuan sudah ${req.status === "APPROVED" ? "disetujui" : req.status === "REJECTED" ? "ditolak" : "dibatalkan"}.`);
    }
    const approved = input.decision === "APPROVE" ? input.approvedMinutes ?? req.minutes : null;
    const r = await tx.overtimeRequest.updateMany({
      where: { id, status: "PENDING" },
      data: { status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED", approvedMinutes: approved, reviewedById: actor.userId, reviewedAt: new Date(), reviewNote: input.note },
    });
    if (r.count === 0) throw Errors.conflict("Pengajuan sudah diproses oleh pengguna lain.");
    const dateIso = dateToIso(req.date);
    await writeAudit(tx, actor, {
      action: input.decision === "APPROVE" ? "overtime.approve" : "overtime.reject", entityType: "OvertimeRequest", entityId: id,
      summary: `Lembur ${req.employee.fullName} ${formatDateShort(dateIso)} ${input.decision === "APPROVE" ? `disetujui (${formatDuration(approved!)})` : "ditolak"}`,
      before: { status: "PENDING" }, after: { status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED", approvedMinutes: approved }, reason: input.note,
    });
    const owner = await tx.employee.findUnique({ where: { id: req.employeeId }, select: { userId: true } });
    if (owner?.userId) {
      await notifyUsers(tx, [owner.userId], {
        type: "overtime.reviewed", title: `Pengajuan lembur ${input.decision === "APPROVE" ? "disetujui" : "ditolak"}`,
        body: `${formatDateShort(dateIso)}${approved !== null ? ` · disetujui ${formatDuration(approved)}` : ""}${input.note ? ` · Catatan: ${input.note}` : ""}`, href: "/lembur-saya",
      });
    }
    const updated = await tx.overtimeRequest.findUniqueOrThrow({ where: { id }, include });
    return { overtime: (await toDtos([updated]))[0]!, payrollNotices: input.decision === "APPROVE" ? await payrollNoticesFor(tx, req.date) : [] };
  });
}

const cancelSchema = z.object({ reason: optionalText(300, "Alasan") });

/** Karyawan: hanya yang MENUNGGU. Admin: juga yang sudah disetujui, dengan alasan wajib. */
export async function cancelOvertime(actor: Actor, id: string, raw: unknown): Promise<OvertimeReviewResult> {
  const input = parseInput(cancelSchema, raw ?? {});
  const req0 = await prisma.overtimeRequest.findUnique({ where: { id } });
  if (!req0) throw Errors.notFound("Pengajuan lembur");
  const isOwner = req0.employeeId === actor.employeeId;
  const isReviewer = actorCan(actor, "overtime:review");
  if (!isOwner && !isReviewer) throw Errors.forbidden();
  if (isOwner && !isReviewer && req0.status !== "PENDING") throw Errors.forbidden("Pengajuan yang sudah diproses hanya dapat dibatalkan oleh HR.");
  if (req0.status === "APPROVED" && !input.reason) throw Errors.validation("Alasan pembatalan wajib diisi untuk pengajuan yang sudah disetujui.", { reason: "Wajib diisi" });

  return transaction(async (tx) => {
    const req = await tx.overtimeRequest.findUniqueOrThrow({ where: { id }, include });
    if (req.status !== "PENDING" && req.status !== "APPROVED") throw Errors.conflict("Pengajuan ini tidak dapat dibatalkan.");
    const reason = input.reason ?? "Dibatalkan oleh pengaju";
    const r = await tx.overtimeRequest.updateMany({ where: { id, status: req.status }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason } });
    if (r.count === 0) throw Errors.conflict("Pengajuan sudah berubah. Muat ulang halaman.");
    const dateIso = dateToIso(req.date);
    await writeAudit(tx, actor, {
      action: "overtime.cancel", entityType: "OvertimeRequest", entityId: id,
      summary: `Lembur ${req.employee.fullName} ${formatDateShort(dateIso)} dibatalkan`, before: { status: req.status }, after: { status: "CANCELLED" }, reason,
    });
    if (req.status === "APPROVED" && !isOwner) {
      const owner = await tx.employee.findUnique({ where: { id: req.employeeId }, select: { userId: true } });
      if (owner?.userId) await notifyUsers(tx, [owner.userId], { type: "overtime.cancelled", title: "Pengajuan lembur Anda dibatalkan oleh HR", body: reason, href: "/lembur-saya" });
    }
    const updated = await tx.overtimeRequest.findUniqueOrThrow({ where: { id }, include });
    return { overtime: (await toDtos([updated]))[0]!, payrollNotices: req.status === "APPROVED" ? await payrollNoticesFor(tx, req.date) : [] };
  });
}

// ─────────────────────────── Dipakai penggajian ───────────────────────────

/** Lembur DISETUJUI per karyawan dalam rentang tanggal (jam mulai + menit disetujui). */
export async function approvedOvertimeFor(employeeIds: string[], from: string, to: string): Promise<Map<string, OvertimeApproval[]>> {
  const out = new Map<string, OvertimeApproval[]>();
  if (!employeeIds.length) return out;
  const rows = await prisma.overtimeRequest.findMany({
    where: { employeeId: { in: employeeIds }, status: "APPROVED", date: { gte: isoToDate(from), lte: isoToDate(to) } },
    select: { employeeId: true, date: true, startTime: true, approvedMinutes: true }, orderBy: { date: "asc" },
  });
  for (const r of rows) {
    const arr = out.get(r.employeeId) ?? [];
    arr.push({ date: dateToIso(r.date), startTime: r.startTime, approvedMinutes: r.approvedMinutes ?? 0 });
    out.set(r.employeeId, arr);
  }
  return out;
}

/** Ciri kanonik lembur disetujui — ditambahkan ke hash sumber agar perubahan persetujuan terdeteksi sebagai "data berubah". */
export function overtimeTag(list: OvertimeApproval[] | undefined): string {
  return list && list.length ? list.map((a) => `${a.date}:${a.approvedMinutes}`).join(",") : "";
}
