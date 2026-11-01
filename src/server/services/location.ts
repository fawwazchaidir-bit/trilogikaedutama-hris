import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma, transaction } from "../db";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import { assertCan, type Actor } from "../actor";
import { writeAudit } from "../audit";
import { dateToIso, isoToDate } from "../json";
import { getSettings, geoPolicyOf } from "./settings";
import { notifyUsers } from "./notifications";
import { photoUrlsFor } from "./attendance-photo";
import { distanceMeters, evaluateGeofence, isValidReading } from "@/lib/geo";
import { assessRisk, blockedMessage, decide, RISK_FLAG_LABEL, type RiskFlag, type RiskReading } from "@/lib/location-risk";
import { formatDateShort } from "@/lib/format";
import { uuid } from "@/lib/validation/common";
import type { Paged } from "@/lib/types";

export const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).nullable().optional(),
  /** `position.timestamp` & `Date.now()` perangkat — dasar uji kesegaran pembacaan. */
  timestamp: z.number().nullable().optional(),
  clientNow: z.number().nullable().optional(),
  /** Hanya dapat dilaporkan aplikasi pembungkus (mis. Capacitor); browser biasa tidak mengirimnya. */
  mocked: z.boolean().nullable().optional(),
}).nullable().optional();

export type ParsedLocation = z.infer<typeof locationSchema>;

/** Konteks permintaan untuk penilaian: IP (hanya dicatat; bermakna bila TRUST_PROXY) dan token perangkat dari cookie server. */
export interface PunchContext {
  ip: string | null;
  deviceToken: string | null;
  /** Foto mentah dari kamera (belum dicap); dicap & dinormalisasi oleh server (lihat attendance-photo.ts). */
  photo?: Uint8Array | null;
}

export interface PendingCheck {
  decision: "ACCEPTED" | "FLAGGED";
  riskScore: number;
  flags: RiskFlag[];
  details: Record<string, string | number | boolean | null>;
  lat: number;
  lng: number;
  accuracy: number | null;
  distance: number | null;
  ip: string | null;
  deviceHash: string | null;
}

export interface LocationEvaluation {
  /** Koordinat untuk kolom absensi (null bila fitur lokasi nonaktif). */
  reading: { lat: number; lng: number; accuracy: number | null } | null;
  distance: number | null;
  check: PendingCheck | null;
}

const deviceHashOf = (token: string | null) => (token ? createHash("sha256").update(`device:${token}`).digest("hex") : null);
const GEO_FLAG = { LOCATION_REQUIRED: "NO_LOCATION", LOCATION_INVALID: "INVALID_LOCATION", LOCATION_INACCURATE: "LOW_ACCURACY", LOCATION_OUTSIDE: "OUTSIDE_RADIUS" } as const;
const HOURS = 3_600_000;

interface BlockedRecord { employeeId: string; kind: "CHECK_IN" | "CHECK_OUT"; workDate: string; reading: { lat: number; lng: number; accuracy: number | null } | null; distance: number | null; flags: RiskFlag[]; riskScore: number; details: PendingCheck["details"]; ip: string | null; deviceHash: string | null; needsReview: boolean }

/** Catat penolakan di luar transaksi punch (yang akan di-rollback oleh galat yang dilempar). */
async function recordBlocked(b: BlockedRecord, employeeName: string): Promise<void> {
  const row = await prisma.locationCheck.create({
    data: {
      employeeId: b.employeeId, kind: b.kind, date: isoToDate(b.workDate), lat: b.reading?.lat ?? null, lng: b.reading?.lng ?? null, accuracy: b.reading?.accuracy ?? null,
      distance: b.distance, decision: "BLOCKED", riskScore: b.riskScore, flags: b.flags, details: b.details as Prisma.InputJsonValue, ip: b.ip, deviceHash: b.deviceHash,
      reviewStatus: b.needsReview ? "OPEN" : null,
    },
  });
  if (b.needsReview) {
    await transaction(async (tx) => {
      const reviewers = await tx.user.findMany({ where: { isActive: true, role: { in: ["HR_ADMIN", "SUPER_ADMIN"] } }, select: { id: true } });
      await notifyUsers(tx, reviewers.map((r) => r.id), {
        type: "location.flagged", title: "Absensi lokasi ditolak (risiko tinggi)", body: `${employeeName} · ${b.kind === "CHECK_IN" ? "check-in" : "check-out"} · skor ${b.riskScore}`, href: "/lokasi",
      });
    });
  }
  void row;
}

/**
 * Evaluasi lokasi satu punch. Urutan: (1) geofence & akurasi, (2) penilaian risiko berlapis.
 * Penolakan DICATAT (`location_checks`, keputusan BLOCKED) lalu dilempar sebagai galat validasi. Bila diterima, hasilnya
 * dikembalikan untuk disimpan DALAM transaksi punch (`persistLocationCheck`).
 * Fitur lokasi nonaktif → tidak ada koordinat/penilaian yang disimpan (privasi).
 */
export async function evaluatePunchLocation(args: {
  employeeId: string; employeeName: string; kind: "CHECK_IN" | "CHECK_OUT"; workDate: string; now: Date; location: ParsedLocation; ctx: PunchContext;
}): Promise<LocationEvaluation> {
  const settings = await getSettings();
  const policy = geoPolicyOf(settings);
  if (!policy.enabled || !policy.center) return { reading: null, distance: null, check: null };

  const { employeeId, employeeName, kind, workDate, now, ctx } = args;
  const loc = args.location ?? null;
  const reading = loc ? { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy ?? null } : null;
  const deviceHash = deviceHashOf(ctx.deviceToken);
  const base = { employeeId, kind, workDate, deviceHash, ip: ctx.ip };

  // 1. Geofence & akurasi (aturan lama).
  if (reading && !isValidReading(reading)) throw Errors.validation("Data lokasi dari perangkat tidak valid.");
  const verdict = evaluateGeofence(policy, reading);
  if (!verdict.ok) {
    await recordBlocked({ ...base, reading, distance: verdict.distance ?? null, flags: [GEO_FLAG[verdict.code]], riskScore: 0, details: {}, needsReview: false }, employeeName);
    throw Errors.validation(verdict.message);
  }
  const distance = verdict.distance;

  // 2. Penilaian risiko berlapis.
  const mode = settings.locationSpoofMode;
  if (mode === "OFF" || !reading) return { reading, distance, check: null };

  const nowMs = now.getTime();
  const since24h = new Date(nowMs - 24 * HOURS);
  const near = (v: number) => ({ gte: v - 5e-7, lte: v + 5e-7 });
  const [prev, sharedCoords, deviceCount, deviceSeen, sharedDevice] = await Promise.all([
    prisma.locationCheck.findFirst({ where: { employeeId, decision: { not: "BLOCKED" }, lat: { not: null }, createdAt: { gte: since24h } }, orderBy: { id: "desc" } }),
    prisma.locationCheck.findFirst({ where: { employeeId: { not: employeeId }, decision: { not: "BLOCKED" }, createdAt: { gte: new Date(nowMs - 15 * 60_000) }, lat: near(reading.lat), lng: near(reading.lng) }, select: { id: true } }),
    deviceHash ? prisma.locationCheck.count({ where: { employeeId, deviceHash: { not: null } } }) : Promise.resolve(0),
    deviceHash ? prisma.locationCheck.findFirst({ where: { employeeId, deviceHash }, select: { id: true } }) : Promise.resolve(null),
    deviceHash ? prisma.locationCheck.findFirst({ where: { deviceHash, employeeId: { not: employeeId }, createdAt: { gte: since24h } }, select: { id: true } }) : Promise.resolve(null),
  ]);
  const facts = {
    reading: { ...reading, timestamp: loc?.timestamp ?? null, clientNow: loc?.clientNow ?? null, mocked: loc?.mocked ?? null } satisfies RiskReading,
    serverNowMs: nowMs,
    distanceToCenter: policy.center ? distanceMeters(policy.center, reading) : null,
    prev: prev && prev.lat !== null && prev.lng !== null ? { lat: prev.lat, lng: prev.lng, accuracy: prev.accuracy, atMs: prev.createdAt.getTime() } : null,
    sharedCoordsWithOther: !!sharedCoords,
    sharedDeviceWithOther: !!sharedDevice,
    deviceKnown: !deviceHash || deviceCount === 0 ? null : !!deviceSeen,
  };
  const risk = assessRisk(facts);
  const decision = decide(mode, risk.score);
  if (decision === "BLOCKED") {
    await recordBlocked({ ...base, reading, distance, flags: risk.flags, riskScore: risk.score, details: risk.details, needsReview: true }, employeeName);
    throw Errors.validation(blockedMessage(risk.flags));
  }
  return {
    reading, distance,
    check: { decision, riskScore: risk.score, flags: risk.flags, details: risk.details, lat: reading.lat, lng: reading.lng, accuracy: reading.accuracy, distance, ip: ctx.ip, deviceHash },
  };
}

/** Simpan hasil evaluasi bersama baris absensinya (satu transaksi). Yang ditandai membuat notifikasi untuk peninjau. */
export async function persistLocationCheck(
  tx: Prisma.TransactionClient, ev: LocationEvaluation,
  at: { employeeId: string; employeeName: string; attendanceId: string; kind: "CHECK_IN" | "CHECK_OUT"; workDate: string },
): Promise<void> {
  const c = ev.check;
  if (!c) return;
  await tx.locationCheck.create({
    data: {
      employeeId: at.employeeId, attendanceId: at.attendanceId, kind: at.kind, date: isoToDate(at.workDate), lat: c.lat, lng: c.lng, accuracy: c.accuracy, distance: c.distance,
      decision: c.decision, riskScore: c.riskScore, flags: c.flags, details: c.details as Prisma.InputJsonValue, ip: c.ip, deviceHash: c.deviceHash,
      reviewStatus: c.decision === "FLAGGED" ? "OPEN" : null,
    },
  });
  if (c.decision === "FLAGGED") {
    const reviewers = await tx.user.findMany({ where: { isActive: true, role: { in: ["HR_ADMIN", "SUPER_ADMIN"] } }, select: { id: true } });
    await notifyUsers(tx, reviewers.map((r) => r.id), {
      type: "location.flagged", title: "Absensi lokasi perlu ditinjau",
      body: `${at.employeeName} · ${at.kind === "CHECK_IN" ? "check-in" : "check-out"} ${formatDateShort(at.workDate)} · skor ${c.riskScore}`, href: "/lokasi",
    });
  }
}

// ─────────────────────────── Antrean tinjauan (HR) ───────────────────────────

export interface LocationCheckDto {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  kind: "CHECK_IN" | "CHECK_OUT";
  date: string;
  decision: "ACCEPTED" | "FLAGGED" | "BLOCKED";
  riskScore: number;
  flags: { code: RiskFlag; label: string }[];
  distance: number | null;
  accuracy: number | null;
  mapUrl: string | null;
  /** Foto absensi bercap untuk punch ini (bila ada) — bukti utama saat meninjau. */
  photoUrl: string | null;
  reviewStatus: "OPEN" | "CLEARED" | "CONFIRMED" | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
}

export const locationListSchema = z.object({
  status: z.enum(["OPEN", "CLEARED", "CONFIRMED", "ALL"]).optional(),
  employeeId: uuid.optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
});

const include = { employee: { select: { fullName: true, employeeNo: true } } } satisfies Prisma.LocationCheckInclude;

export async function listLocationChecks(actor: Actor, raw: unknown = {}): Promise<Paged<LocationCheckDto>> {
  assertCan(actor, "location:review");
  const f = parseInput(locationListSchema, raw);
  const status = f.status ?? "OPEN";
  const where: Prisma.LocationCheckWhereInput = {
    ...(status === "ALL" ? { reviewStatus: { not: null } } : { reviewStatus: status }), ...(f.employeeId ? { employeeId: f.employeeId } : {}),
  };
  const pageSize = f.pageSize ?? 20, page = f.page ?? 1;
  const [total, rows] = await Promise.all([
    prisma.locationCheck.count({ where }),
    prisma.locationCheck.findMany({ where, include, orderBy: { id: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
  ]);
  const photos = await photoUrlsFor(rows.map((r) => ({ attendanceId: r.attendanceId, kind: r.kind })));
  const ids = [...new Set(rows.map((r) => r.reviewedById).filter((x): x is string => !!x))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.name]));
  return {
    items: rows.map((r) => ({
      id: r.id.toString(), employeeId: r.employeeId, employeeName: r.employee.fullName, employeeNo: r.employee.employeeNo, kind: r.kind, date: dateToIso(r.date),
      decision: r.decision, riskScore: r.riskScore, flags: r.flags.map((c) => ({ code: c as RiskFlag, label: RISK_FLAG_LABEL[c as RiskFlag] ?? c })), distance: r.distance, accuracy: r.accuracy,
      mapUrl: r.lat !== null && r.lng !== null ? `https://www.openstreetmap.org/?mlat=${r.lat}&mlon=${r.lng}#map=18/${r.lat}/${r.lng}` : null,
      photoUrl: r.attendanceId ? photos.get(`${r.attendanceId}:${r.kind}`) ?? null : null,
      reviewStatus: r.reviewStatus, reviewedBy: r.reviewedById ? name.get(r.reviewedById) ?? null : null, reviewedAt: r.reviewedAt?.toISOString() ?? null, reviewNote: r.reviewNote,
      createdAt: r.createdAt.toISOString(),
    })),
    total, page, pageSize, pageCount: Math.max(Math.ceil(total / pageSize), 1),
  };
}

export async function openLocationReviewCount(): Promise<number> {
  return prisma.locationCheck.count({ where: { reviewStatus: "OPEN" } });
}

const reviewSchema = z.object({
  decision: z.enum(["CLEARED", "CONFIRMED"]),
  note: z.string().trim().min(5, "Catatan tinjauan wajib diisi (min. 5 karakter)").max(300),
});

/** CLEARED = wajar (alarm palsu); CONFIRMED = indikasi manipulasi terkonfirmasi. Keduanya wajib beralasan & masuk audit. */
export async function reviewLocationCheck(actor: Actor, id: string, raw: unknown): Promise<void> {
  assertCan(actor, "location:review");
  const input = parseInput(reviewSchema, raw);
  if (!/^\d+$/.test(id)) throw Errors.notFound("Catatan lokasi");
  await transaction(async (tx) => {
    const row = await tx.locationCheck.findUnique({ where: { id: BigInt(id) }, include });
    if (!row) throw Errors.notFound("Catatan lokasi");
    const r = await tx.locationCheck.updateMany({
      where: { id: row.id, reviewStatus: "OPEN" },
      data: { reviewStatus: input.decision, reviewedById: actor.userId, reviewedAt: new Date(), reviewNote: input.note },
    });
    if (r.count === 0) throw Errors.conflict("Catatan ini sudah ditinjau atau tidak memerlukan tinjauan.");
    await writeAudit(tx, actor, {
      action: input.decision === "CONFIRMED" ? "location.confirm" : "location.clear", entityType: "LocationCheck", entityId: id,
      summary: `Tinjauan lokasi ${row.employee.fullName} ${dateToIso(row.date)}: ${input.decision === "CONFIRMED" ? "indikasi manipulasi terkonfirmasi" : "dinyatakan wajar"}`,
      before: { reviewStatus: "OPEN", riskScore: row.riskScore, flags: row.flags }, after: { reviewStatus: input.decision }, reason: input.note,
    });
  });
}

/** Ringkasan sinyal lokasi untuk laporan: jumlah ditandai/ditolak per karyawan pada rentang tanggal. */
export async function locationSummary(from: string, to: string): Promise<{ total: number; flagged: number; blocked: number; confirmed: number; topFlags: { code: RiskFlag; label: string; count: number }[] }> {
  const rows = await prisma.locationCheck.findMany({ where: { date: { gte: isoToDate(from), lte: isoToDate(to) } }, select: { decision: true, reviewStatus: true, flags: true } });
  const counts = new Map<string, number>();
  for (const r of rows) for (const f of r.flags) counts.set(f, (counts.get(f) ?? 0) + 1);
  return {
    total: rows.length, flagged: rows.filter((r) => r.decision === "FLAGGED").length, blocked: rows.filter((r) => r.decision === "BLOCKED").length,
    confirmed: rows.filter((r) => r.reviewStatus === "CONFIRMED").length,
    topFlags: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([code, count]) => ({ code: code as RiskFlag, label: RISK_FLAG_LABEL[code as RiskFlag] ?? code, count })),
  };
}
