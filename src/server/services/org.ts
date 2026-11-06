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
import { can, type Permission } from "@/lib/permissions";
import { isoDate, optionalText, requiredText, uuid } from "@/lib/validation/common";
import { addDays, todayIso } from "@/lib/time";
import { formatDateLong } from "@/lib/format";
import { reviewCapacity, reviewableTargets, reviewersOf, wouldCreateCycle, type OrgGraph, type OrgNode, type SupervisorCapacity } from "@/lib/org-review";
import type { EmploymentStatus } from "@/lib/labels";
import { notifyUsers, reviewerUserIds } from "./notifications";

/**
 * STRUKTUR ORGANISASI kepegawaian: divisi, jabatan, status, ATASAN LANGSUNG, tanggal mulai berlaku, riwayat, dan pengganti peninjau.
 * Atasan langsung (kepegawaian) BERBEDA dari PIC proyek Training: menjadi anggota proyek yang dipimpin orang lain tidak mengubah atasan.
 * Kolom pada `employees` = keadaan SAAT INI; tiap perubahan juga dicatat di `employee_org_history` (tambah-saja). Karyawan lama yang belum
 * punya riwayat mendapat baris awal (BASELINE) tepat sebelum perubahan pertamanya — tanpa migrasi data massal.
 */

type Db = Tx | typeof prisma;
const MAX_DELEGATION_DAYS = 90;
const SELF_MESSAGE = {
  leave: "Anda tidak dapat memproses pengajuan Anda sendiri.",
  overtime: "Anda tidak dapat memproses pengajuan lembur Anda sendiri.",
} as const;

const orgInclude = { division: { select: { name: true } }, supervisor: { select: { fullName: true } } } satisfies Prisma.EmployeeInclude;
type OrgRow = Prisma.EmployeeGetPayload<{ include: typeof orgInclude }>;

const floorOf = (e: { positionEffectiveFrom: Date | null; joinDate: Date }) => dateToIso(e.positionEffectiveFrom ?? e.joinDate);
const today = () => todayIso(env().APP_TIMEZONE);

// ─────────────────────────── Graf organisasi (untuk keputusan wewenang) ───────────────────────────

/** Muat graf atasan + siapa yang tidak masuk hari ini + pengganti yang berlaku hari ini. Satu sumber untuk otorisasi, notifikasi, dan daftar tim. */
export async function loadOrgGraph(db: Db = prisma, on: string = today()): Promise<OrgGraph> {
  const d = isoToDate(on);
  const [emps, away, dels] = await Promise.all([
    db.employee.findMany({ select: { id: true, supervisorId: true, isActive: true } }),
    db.leaveRequest.findMany({ where: { status: "APPROVED", dayPart: "FULL", startDate: { lte: d }, endDate: { gte: d } }, select: { employeeId: true } }),
    db.supervisorDelegation.findMany({ where: { cancelledAt: null, startDate: { lte: d }, endDate: { gte: d } }, select: { supervisorId: true, delegateId: true } }),
  ]);
  const delegates = new Map<string, Set<string>>();
  for (const x of dels) delegates.set(x.supervisorId, (delegates.get(x.supervisorId) ?? new Set()).add(x.delegateId));
  return {
    nodes: new Map<string, OrgNode>(emps.map((e) => [e.id, { id: e.id, supervisorId: e.supervisorId, active: e.isActive }])),
    away: new Set(away.map((a) => a.employeeId)),
    delegates,
  };
}

export type ReviewAs = SupervisorCapacity | "HR";

/**
 * Otorisasi MENINJAU pengajuan milik `targetEmployeeId`. Mengembalikan kapasitas pelaku (untuk jejak audit) atau melempar galat.
 *  - Siapa pun: tidak boleh memproses pengajuannya sendiri. Satu-satunya pengecualian (perilaku lama): Super Admin yang berada di puncak
 *    organisasi (belum punya atasan langsung) — tanpa itu pengajuan pimpinan tidak akan pernah bisa diproses.
 *  - Atasan langsung, pengganti, atau atasan eskalasi: sesuai graf (kapasitas SUPERVISOR / DELEGATE / ESCALATION).
 *  - HR / Super Admin (izin peran): memproses bila diperlukan (kapasitas HR). Bila pelaku juga atasan sah, kapasitas atasan yang dicatat.
 *  - Selain itu: 404 (keberadaan pengajuan orang lain tidak bocor).
 */
export async function authorizeReview(db: Db, actor: Actor, targetEmployeeId: string, permission: Permission, kind: keyof typeof SELF_MESSAGE): Promise<ReviewAs> {
  const hasRolePermission = can(actor.role, permission);
  if (actor.employeeId === targetEmployeeId) {
    const own = await db.employee.findUnique({ where: { id: targetEmployeeId }, select: { supervisorId: true } });
    if (actor.role === "SUPER_ADMIN" && hasRolePermission && !own?.supervisorId) return "HR";
    throw Errors.forbidden(`${SELF_MESSAGE[kind]} ${own?.supervisorId ? "Atasan langsung atau penggantinya yang memprosesnya." : "Minta Super Admin untuk memprosesnya."}`);
  }
  if (actor.employeeId) {
    const cap = reviewCapacity(await loadOrgGraph(db), actor.employeeId, targetEmployeeId);
    if (cap) return cap;
  }
  if (hasRolePermission) return "HR";
  throw Errors.notFound("Pengajuan");
}

/**
 * Siapa yang diberi tahu saat pengajuan masuk: atasan langsung + pengganti (+ eskalasi bila atasan tidak ada). Tanpa atasan, atau bila tak ada
 * yang punya akun aktif → HR & Super Admin seperti semula. `routed` = true bila yang diberi tahu adalah peninjau tim (bukan HR).
 */
export async function submitReviewers(db: Db, employeeId: string, exceptUserId: string): Promise<{ userIds: string[]; routed: boolean }> {
  const rs = reviewersOf(await loadOrgGraph(db), employeeId);
  if (rs.length) {
    const rows = await db.employee.findMany({ where: { id: { in: rs.map((r) => r.employeeId) } }, select: { user: { select: { id: true, isActive: true } } } });
    const ids = rows.map((r) => r.user).filter((u): u is { id: string; isActive: boolean } => !!u && u.isActive).map((u) => u.id).filter((id) => id !== exceptUserId);
    if (ids.length) return { userIds: ids, routed: true };
  }
  return { userIds: await reviewerUserIds(db, exceptUserId), routed: false };
}

/** Gerbang awal sebelum membaca pengajuan: harus punya izin peran, atau menjadi atasan/pengganti/eskalasi bagi seseorang. Selain itu 403 (perilaku lama). */
export async function assertMayReview(actor: Actor, permission: Permission): Promise<void> {
  if (can(actor.role, permission)) return;
  if ((await reviewableMap(actor)).size > 0) return;
  throw Errors.forbidden();
}

/** Jumlah pengajuan cuti + lembur yang MENUNGGU dari tim yang boleh ditinjau pelaku (lencana menu Persetujuan Tim). */
export async function teamPendingCount(actor: Actor, knownIds?: string[]): Promise<number> {
  const ids = knownIds ?? [...(await reviewableMap(actor)).keys()];
  if (!ids.length) return 0;
  const [leaves, overtimes] = await Promise.all([
    prisma.leaveRequest.count({ where: { status: "PENDING", employeeId: { in: ids } } }),
    prisma.overtimeRequest.count({ where: { status: "PENDING", employeeId: { in: ids } } }),
  ]);
  return leaves + overtimes;
}

/** Pengajuan siapa saja yang boleh ditinjau pelaku saat ini (selain lewat izin HR) beserta kapasitasnya. Kosong bila pelaku bukan atasan/pengganti. */
export async function reviewableMap(actor: Actor, db: Db = prisma): Promise<Map<string, SupervisorCapacity>> {
  if (!actor.employeeId) return new Map();
  return reviewableTargets(await loadOrgGraph(db), actor.employeeId);
}

// ─────────────────────────── Profil & riwayat ───────────────────────────

export interface PersonRef { id: string; name: string; position: string }
export interface OrgProfileDto {
  employeeId: string;
  divisionId: string | null;
  divisionName: string | null;
  position: string;
  employmentStatus: EmploymentStatus;
  /** Tanggal mulai berlaku divisi/jabatan/status saat ini. */
  effectiveFrom: string;
  /** true = belum pernah diubah (mengikuti tanggal mulai bekerja). */
  sinceJoin: boolean;
  supervisor: (PersonRef & { active: boolean }) | null;
  reports: PersonRef[];
}
export interface OrgHistoryDto {
  id: string; effectiveFrom: string; divisionName: string | null; position: string; employmentStatus: EmploymentStatus;
  supervisorName: string | null; changes: string[]; note: string | null; createdAt: string; createdBy: string;
}

function assertCanSee(actor: Actor, employeeId: string): void {
  if (actor.employeeId === employeeId) return;
  assertCan(actor, "employee:view");
}

export async function getOrgProfile(actor: Actor, employeeId: string): Promise<OrgProfileDto> {
  assertCanSee(actor, employeeId);
  const e = await prisma.employee.findUnique({ where: { id: employeeId }, include: { division: { select: { name: true } }, supervisor: { select: { id: true, fullName: true, position: true, isActive: true } } } });
  if (!e) throw Errors.notFound("Karyawan");
  const reports = await prisma.employee.findMany({ where: { supervisorId: employeeId, isActive: true }, select: { id: true, fullName: true, position: true }, orderBy: { fullName: "asc" } });
  return {
    employeeId, divisionId: e.divisionId, divisionName: e.division?.name ?? null, position: e.position, employmentStatus: e.employmentStatus,
    effectiveFrom: floorOf(e), sinceJoin: !e.positionEffectiveFrom,
    supervisor: e.supervisor ? { id: e.supervisor.id, name: e.supervisor.fullName, position: e.supervisor.position, active: e.supervisor.isActive } : null,
    reports: reports.map((r) => ({ id: r.id, name: r.fullName, position: r.position })),
  };
}

export async function listOrgHistory(actor: Actor, employeeId: string): Promise<OrgHistoryDto[]> {
  assertCanSee(actor, employeeId);
  const rows = await prisma.employeeOrgHistory.findMany({ where: { employeeId }, orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }], take: 100 });
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } });
  const name = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id, effectiveFrom: dateToIso(r.effectiveFrom), divisionName: r.divisionName, position: r.position, employmentStatus: r.employmentStatus,
    supervisorName: r.supervisorName, changes: r.changes, note: r.note, createdAt: r.createdAt.toISOString(), createdBy: name.get(r.createdById) ?? "—",
  }));
}

// ─────────────────────────── Perubahan (satu jalur yang selalu mencatat riwayat) ───────────────────────────

function snapshot(e: OrgRow, effectiveFrom: string, changes: string[], note: string | null, userId: string): Prisma.EmployeeOrgHistoryUncheckedCreateInput {
  return {
    employeeId: e.id, effectiveFrom: isoToDate(effectiveFrom), divisionId: e.divisionId, divisionName: e.division?.name ?? null, position: e.position,
    employmentStatus: e.employmentStatus, supervisorId: e.supervisorId, supervisorName: e.supervisor?.fullName ?? null, changes, note, createdById: userId,
  };
}

/** Karyawan yang belum punya riwayat: catat keadaan SEKARANG sebagai baris awal sebelum diubah (panggil SEBELUM mengubah baris karyawan). */
export async function ensureOrgBaseline(tx: Tx, actor: Actor, employeeId: string): Promise<void> {
  if ((await tx.employeeOrgHistory.count({ where: { employeeId } })) > 0) return;
  const e = await tx.employee.findUnique({ where: { id: employeeId }, include: orgInclude });
  if (!e) return;
  await tx.employeeOrgHistory.create({ data: snapshot(e, floorOf(e), ["BASELINE"], "Data awal (sebelum riwayat dicatat)", actor.userId) });
}

/**
 * Dipakai `updateEmployee` (formulir data karyawan): bila divisi/jabatan/status berubah, catat riwayat berlaku HARI INI dan geser tanggal mulai
 * berlaku. `before` diambil sebelum pembaruan; baris awal sudah dijamin oleh `ensureOrgBaseline`.
 */
export async function recordOrgChangeFromUpdate(tx: Tx, actor: Actor, before: { divisionId: string | null; position: string; employmentStatus: EmploymentStatus }, employeeId: string): Promise<void> {
  const after = await tx.employee.findUniqueOrThrow({ where: { id: employeeId }, include: orgInclude });
  const changes: string[] = [];
  if (before.divisionId !== after.divisionId) changes.push("DIVISION");
  if (before.position !== after.position) changes.push("POSITION");
  if (before.employmentStatus !== after.employmentStatus) changes.push("STATUS");
  if (!changes.length) return;
  const on = today();
  const effective = on < floorOf(after) ? floorOf(after) : on;
  await tx.employeeOrgHistory.create({ data: snapshot(after, effective, changes, "Diubah melalui formulir data karyawan", actor.userId) });
  await tx.employee.update({ where: { id: employeeId }, data: { positionEffectiveFrom: isoToDate(effective) } });
}

export const orgChangeSchema = z.object({
  /** undefined = tidak diubah; null = kosongkan. */
  divisionId: uuid.nullable().optional(),
  position: requiredText(2, 100, "Jabatan").optional(),
  employmentStatus: z.enum(["PERMANENT", "CONTRACT", "INTERN"], { error: "Status karyawan tidak valid" }).optional(),
  /** undefined = tidak diubah; null = tanpa atasan langsung. */
  supervisorId: uuid.nullable().optional(),
  effectiveFrom: isoDate,
  note: optionalText(300, "Catatan"),
});

const CHANGE_LABEL: Record<string, string> = { DIVISION: "divisi", POSITION: "jabatan", STATUS: "status", SUPERVISOR: "atasan langsung" };

/** Ubah divisi / jabatan / status / atasan langsung dengan tanggal mulai berlaku, dalam satu transaksi, dan catat riwayatnya. HR (employee:manage). */
export async function changeOrg(actor: Actor, employeeId: string, raw: unknown): Promise<OrgProfileDto> {
  assertCan(actor, "employee:manage");
  const input = parseInput(orgChangeSchema, raw);
  const on = today();
  await transaction(async (tx) => {
    // Serialkan perubahan atasan antar-karyawan agar dua perubahan bersamaan tidak lolos pemeriksaan rantai melingkar (pengaman kedua ada di trigger DB).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('org:graph'))`;
    const before = await tx.employee.findUnique({ where: { id: employeeId }, include: orgInclude });
    if (!before) throw Errors.notFound("Karyawan");
    if (!before.isActive) throw Errors.conflict("Karyawan nonaktif: data organisasinya tidak dapat diubah.");
    const floor = floorOf(before);
    if (input.effectiveFrom > on) throw Errors.validation("Tanggal mulai berlaku tidak boleh di masa depan.", { effectiveFrom: "Di masa depan" });
    if (input.effectiveFrom < floor) throw Errors.validation(`Tanggal mulai berlaku tidak boleh sebelum ${formatDateLong(floor)} (berlaku sejak perubahan sebelumnya / tanggal mulai bekerja).`, { effectiveFrom: "Terlalu awal" });

    const next = {
      divisionId: input.divisionId === undefined ? before.divisionId : input.divisionId,
      position: input.position ?? before.position,
      employmentStatus: input.employmentStatus ?? before.employmentStatus,
      supervisorId: input.supervisorId === undefined ? before.supervisorId : input.supervisorId,
    };
    const changes: string[] = [];
    if (next.divisionId !== before.divisionId) changes.push("DIVISION");
    if (next.position !== before.position) changes.push("POSITION");
    if (next.employmentStatus !== before.employmentStatus) changes.push("STATUS");
    if (next.supervisorId !== before.supervisorId) changes.push("SUPERVISOR");
    if (!changes.length) throw Errors.validation("Tidak ada perubahan untuk disimpan.");

    if (next.divisionId) {
      const d = await tx.division.findUnique({ where: { id: next.divisionId }, select: { isActive: true } });
      if (!d || !d.isActive) throw Errors.validation("Divisi tidak ditemukan atau tidak aktif.", { divisionId: "Divisi tidak valid" });
    }
    if (next.supervisorId) {
      const s = await tx.employee.findUnique({ where: { id: next.supervisorId }, select: { isActive: true, fullName: true } });
      if (!s || !s.isActive) throw Errors.validation("Atasan harus karyawan aktif.", { supervisorId: "Atasan tidak valid" });
      if (wouldCreateCycle(await loadOrgGraph(tx, on), employeeId, next.supervisorId)) {
        throw Errors.validation(next.supervisorId === employeeId ? "Karyawan tidak dapat menjadi atasan dirinya sendiri." : `${s.fullName} berada di bawah karyawan ini; menjadikannya atasan akan membentuk rantai melingkar.`, { supervisorId: "Rantai atasan melingkar" });
      }
    }

    await ensureOrgBaseline(tx, actor, employeeId);
    const structural = changes.some((c) => c !== "SUPERVISOR");
    const updated = await tx.employee.update({
      where: { id: employeeId },
      data: { divisionId: next.divisionId, position: next.position, employmentStatus: next.employmentStatus, supervisorId: next.supervisorId, ...(structural ? { positionEffectiveFrom: isoToDate(input.effectiveFrom) } : {}) },
      include: orgInclude,
    });
    await tx.employeeOrgHistory.create({ data: snapshot(updated, input.effectiveFrom, changes, input.note, actor.userId) });
    const label = changes.map((c) => CHANGE_LABEL[c]).join(", ");
    await writeAudit(tx, actor, {
      action: "employee.org_change", entityType: "Employee", entityId: employeeId,
      summary: `Struktur organisasi ${updated.fullName} diubah (${label}), berlaku ${input.effectiveFrom}`,
      before: { divisionId: before.divisionId, position: before.position, employmentStatus: before.employmentStatus, supervisorId: before.supervisorId },
      after: { divisionId: next.divisionId, position: next.position, employmentStatus: next.employmentStatus, supervisorId: next.supervisorId, effectiveFrom: input.effectiveFrom }, reason: input.note,
    });
    const own = updated.userId ? await tx.user.findFirst({ where: { id: updated.userId, isActive: true }, select: { id: true } }) : null;
    if (own) {
      await notifyUsers(tx, [own.id], {
        type: "org.changed", title: "Data organisasi Anda diperbarui",
        body: `${label} · berlaku ${formatDateLong(input.effectiveFrom)}${updated.supervisor ? ` · atasan langsung: ${updated.supervisor.fullName}` : ""}`, href: "/profil",
      });
    }
    if (changes.includes("SUPERVISOR") && next.supervisorId) {
      const sup = await tx.employee.findUnique({ where: { id: next.supervisorId }, select: { user: { select: { id: true, isActive: true } } } });
      if (sup?.user?.isActive) await notifyUsers(tx, [sup.user.id], { type: "org.report_added", title: "Bawahan langsung baru", body: `${updated.fullName} kini menjadi bawahan langsung Anda. Pengajuan cuti dan lembur mereka Anda tinjau di Persetujuan Tim.`, href: "/persetujuan-tim" });
    }
  });
  return getOrgProfile(actor, employeeId);
}

// ─────────────────────────── Pengganti peninjau ───────────────────────────

export interface DelegationDto {
  id: string; supervisorId: string; supervisorName: string; delegateId: string; delegateName: string;
  startDate: string; endDate: string; reason: string | null; active: boolean; createdAt: string;
}

export const delegationSchema = z.object({
  /** Kosong = diri sendiri. HR boleh menunjuk untuk atasan mana pun. */
  supervisorId: uuid.optional(),
  delegateId: uuid,
  startDate: isoDate,
  endDate: isoDate,
  reason: optionalText(200, "Keterangan"),
});

async function toDelegationDtos(rows: Prisma.SupervisorDelegationGetPayload<{ include: { supervisor: { select: { fullName: true } }; delegate: { select: { fullName: true } } } }>[]): Promise<DelegationDto[]> {
  const on = today();
  return rows.map((r) => ({
    id: r.id, supervisorId: r.supervisorId, supervisorName: r.supervisor.fullName, delegateId: r.delegateId, delegateName: r.delegate.fullName,
    startDate: dateToIso(r.startDate), endDate: dateToIso(r.endDate), reason: r.reason, active: dateToIso(r.startDate) <= on && on <= dateToIso(r.endDate), createdAt: r.createdAt.toISOString(),
  }));
}
const delegationInclude = { supervisor: { select: { fullName: true } }, delegate: { select: { fullName: true } } } as const;

/** Tunjuk pengganti peninjau untuk rentang tanggal. Atasan menunjuk untuk dirinya sendiri; HR (employee:manage) dapat menunjuk untuk atasan mana pun. */
export async function createDelegation(actor: Actor, raw: unknown): Promise<DelegationDto> {
  const input = parseInput(delegationSchema, raw);
  const supervisorId = input.supervisorId ?? actor.employeeId;
  if (!supervisorId) throw Errors.forbidden("Akun Anda belum tertaut ke data karyawan.");
  if (supervisorId !== actor.employeeId) assertCan(actor, "employee:manage");
  const on = today();
  if (input.startDate > input.endDate) throw Errors.validation("Tanggal selesai tidak boleh sebelum tanggal mulai.", { endDate: "Sebelum tanggal mulai" });
  if (input.endDate < on) throw Errors.validation("Rentang pengganti sudah lewat.", { endDate: "Sudah lewat" });
  if (input.delegateId === supervisorId) throw Errors.validation("Pengganti tidak boleh orang yang sama dengan atasan.", { delegateId: "Tidak valid" });
  if (addDays(input.startDate, MAX_DELEGATION_DAYS) < input.endDate) throw Errors.validation(`Rentang pengganti maksimal ${MAX_DELEGATION_DAYS} hari; perpanjang dengan penunjukan baru.`, { endDate: "Terlalu panjang" });
  return transaction(async (tx) => {
    const [sup, del] = await Promise.all([
      tx.employee.findUnique({ where: { id: supervisorId }, select: { isActive: true, fullName: true } }),
      tx.employee.findUnique({ where: { id: input.delegateId }, select: { isActive: true, fullName: true, user: { select: { id: true, isActive: true } } } }),
    ]);
    if (!sup?.isActive) throw Errors.validation("Atasan tidak ditemukan atau nonaktif.", { supervisorId: "Tidak valid" });
    if (!del?.isActive || !del.user?.isActive) throw Errors.validation("Pengganti harus karyawan aktif yang punya akun aktif.", { delegateId: "Tidak valid" });
    const row = await tx.supervisorDelegation.create({
      data: { supervisorId, delegateId: input.delegateId, startDate: isoToDate(input.startDate), endDate: isoToDate(input.endDate), reason: input.reason, createdById: actor.userId },
      include: delegationInclude,
    });
    await writeAudit(tx, actor, {
      action: "org.delegation.create", entityType: "SupervisorDelegation", entityId: row.id,
      summary: `${sup.fullName} menunjuk ${del.fullName} sebagai pengganti peninjau ${input.startDate} s.d. ${input.endDate}`, after: { supervisorId, delegateId: input.delegateId, startDate: input.startDate, endDate: input.endDate },
    });
    await notifyUsers(tx, [del.user.id], { type: "org.delegation", title: "Anda ditunjuk sebagai pengganti peninjau", body: `Menggantikan ${sup.fullName}, ${input.startDate} s.d. ${input.endDate}. Pengajuan bawahannya muncul di Persetujuan Tim pada rentang itu.`, href: "/persetujuan-tim" });
    return (await toDelegationDtos([row]))[0]!;
  });
}

export async function cancelDelegation(actor: Actor, id: string): Promise<void> {
  await transaction(async (tx) => {
    const d = await tx.supervisorDelegation.findUnique({ where: { id }, include: delegationInclude });
    if (!d) throw Errors.notFound("Penunjukan pengganti");
    if (d.supervisorId !== actor.employeeId && !can(actor.role, "employee:manage")) throw Errors.notFound("Penunjukan pengganti");
    if (d.cancelledAt) throw Errors.conflict("Penunjukan ini sudah dibatalkan.");
    await tx.supervisorDelegation.update({ where: { id }, data: { cancelledAt: new Date(), cancelledById: actor.userId } });
    await writeAudit(tx, actor, { action: "org.delegation.cancel", entityType: "SupervisorDelegation", entityId: id, summary: `Penunjukan ${d.delegate.fullName} sebagai pengganti ${d.supervisor.fullName} dibatalkan` });
  });
}

/** Penunjukan yang masih berlaku atau akan datang. Atasan melihat miliknya (sebagai atasan maupun pengganti); HR dapat memilih karyawan lain / semua. */
export async function listDelegations(actor: Actor, opts: { supervisorId?: string } = {}): Promise<DelegationDto[]> {
  const own = actor.employeeId;
  const wantAll = can(actor.role, "employee:view");
  const where: Prisma.SupervisorDelegationWhereInput = { cancelledAt: null, endDate: { gte: isoToDate(today()) } };
  if (opts.supervisorId) {
    if (opts.supervisorId !== own && !wantAll) throw Errors.forbidden();
    where.supervisorId = opts.supervisorId;
  } else if (!wantAll) {
    if (!own) return [];
    where.OR = [{ supervisorId: own }, { delegateId: own }];
  }
  const rows = await prisma.supervisorDelegation.findMany({ where, include: delegationInclude, orderBy: [{ startDate: "asc" }, { createdAt: "asc" }], take: 200 });
  return toDelegationDtos(rows);
}

/** Karyawan aktif berakun yang dapat dipilih sebagai pengganti (tanpa atasan itu sendiri). */
export async function listDelegateCandidates(actor: Actor, supervisorId?: string): Promise<PersonRef[]> {
  const sup = supervisorId ?? actor.employeeId;
  if (!sup) return [];
  if (sup !== actor.employeeId) assertCan(actor, "employee:manage");
  const rows = await prisma.employee.findMany({ where: { isActive: true, id: { not: sup }, user: { is: { isActive: true } } }, select: { id: true, fullName: true, position: true }, orderBy: { fullName: "asc" }, take: 500 });
  return rows.map((r) => ({ id: r.id, name: r.fullName, position: r.position }));
}
