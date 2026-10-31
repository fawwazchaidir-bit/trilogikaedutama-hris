import "server-only";
import { randomUUID } from "node:crypto";
import type { CompanySettings, Prisma } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { Errors } from "../errors";
import type { Actor } from "../actor";
import { dateToIso, isoToDate } from "../json";
import { stampPhoto } from "../photo/stamp";
import { storeFile } from "./files";
import { stampLines } from "@/lib/photo-stamp";
import type { ParsedLocation } from "./location";

/**
 * Foto absensi bercap lokasi & waktu SERVER.
 * Kebijakan: OFF (tanpa foto) · OPTIONAL (boleh) · REQUIRED (wajib pada check-in & check-out). Tidak ada syarat jaringan/Wi-Fi:
 * karyawan dinas luar cukup memotret di tempat tugas; cap pada foto memuat waktu server dan koordinat perangkat.
 */
export type PhotoMode = "OFF" | "OPTIONAL" | "REQUIRED";
export interface PhotoPolicy { mode: PhotoMode; requireLocation: boolean }

export const photoPolicyOf = (s: Pick<CompanySettings, "attendancePhotoMode" | "attendancePhotoRequireLocation">): PhotoPolicy => ({
  mode: s.attendancePhotoMode, requireLocation: s.attendancePhotoRequireLocation,
});

export interface PreparedPhoto {
  id: string; jpeg: Buffer; stamp: string; capturedAt: Date; kind: "CHECK_IN" | "CHECK_OUT";
  lat: number | null; lng: number | null; accuracy: number | null;
}

/**
 * Validasi + cap foto SEBELUM transaksi punch (pemrosesan gambar tidak boleh menahan transaksi basis data).
 * null = tidak ada foto (mode mati, atau opsional dan tidak dilampirkan).
 */
export async function preparePunchPhoto(args: {
  policy: PhotoPolicy; raw: Uint8Array | null | undefined; kind: "CHECK_IN" | "CHECK_OUT"; at: Date; location: ParsedLocation;
  employee: { fullName: string; employeeNo: string };
}): Promise<PreparedPhoto | null> {
  const { policy, raw, kind, at, employee } = args;
  if (policy.mode === "OFF") return null;
  if (!raw || raw.byteLength === 0) {
    if (policy.mode === "REQUIRED") throw Errors.validation("Foto absensi wajib. Ambil foto langsung dengan kamera lalu coba lagi.", { photo: "Foto wajib diambil" });
    return null;
  }
  const maxBytes = env().MAX_UPLOAD_MB * 1024 * 1024;
  if (raw.byteLength > maxBytes) throw Errors.validation(`Ukuran foto maksimal ${env().MAX_UPLOAD_MB} MB.`, { photo: "Foto terlalu besar" });
  const loc = args.location ?? null;
  if (policy.requireLocation && !loc) {
    throw Errors.validation("Foto absensi harus disertai lokasi. Izinkan akses lokasi untuk situs ini lalu coba lagi.", { photo: "Lokasi diperlukan untuk cap foto" });
  }
  const id = randomUUID();
  const location = loc ? { lat: loc.lat, lng: loc.lng, accuracy: loc.accuracy ?? null } : null;
  const lines = stampLines({ at, timeZone: env().APP_TIMEZONE, kind, employeeName: employee.fullName, employeeNo: employee.employeeNo, photoId: id, location });
  const { jpeg } = await stampPhoto(raw, lines);
  return { id, jpeg, stamp: lines.join("\n"), capturedAt: at, kind, lat: location?.lat ?? null, lng: location?.lng ?? null, accuracy: location?.accuracy ?? null };
}

/** Simpan foto bercap bersama baris absensinya (satu transaksi). */
export async function persistPunchPhoto(tx: Prisma.TransactionClient, actor: Actor, p: PreparedPhoto, at: { attendanceId: string; employeeId: string }): Promise<void> {
  const file = await storeFile(actor, "ATTENDANCE_PHOTO", { name: `absensi-${p.kind === "CHECK_IN" ? "masuk" : "pulang"}-${p.id.slice(0, 8)}.jpg`, bytes: p.jpeg }, tx);
  await tx.attendancePhoto.create({
    data: { id: p.id, attendanceId: at.attendanceId, employeeId: at.employeeId, kind: p.kind, fileId: file.id, capturedAt: p.capturedAt, lat: p.lat, lng: p.lng, accuracy: p.accuracy, stamp: p.stamp },
  });
}

// ─────────────────────────── Tampilan untuk peninjau / pemilik ───────────────────────────

export interface PunchPhotoDto {
  kind: "CHECK_IN" | "CHECK_OUT";
  url: string;
  capturedAt: string;
  lat: number | null; lng: number | null; accuracy: number | null;
  mapUrl: string | null;
}

export const mapUrlOf = (lat: number | null, lng: number | null): string | null =>
  lat !== null && lng !== null ? `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=18/${lat}/${lng}` : null;

/** Foto absensi satu karyawan per tanggal kerja. PEMANGGIL wajib sudah memeriksa hak akses (admin atau pemilik). */
export async function photosForRange(employeeId: string, from: string, to: string): Promise<Record<string, PunchPhotoDto[]>> {
  const rows = await prisma.attendancePhoto.findMany({
    where: { employeeId, attendance: { date: { gte: isoToDate(from), lte: isoToDate(to) } } },
    include: { attendance: { select: { date: true } } },
    orderBy: [{ capturedAt: "asc" }],
  });
  const out: Record<string, PunchPhotoDto[]> = {};
  for (const r of rows) {
    if (!r.attendance) continue;
    (out[dateToIso(r.attendance.date)] ??= []).push({
      kind: r.kind, url: `/api/files/${r.fileId}`, capturedAt: r.capturedAt.toISOString(), lat: r.lat, lng: r.lng, accuracy: r.accuracy, mapUrl: mapUrlOf(r.lat, r.lng),
    });
  }
  return out;
}

/** Foto menurut (attendanceId, kind) — untuk antrean tinjauan lokasi. */
export async function photoUrlsFor(pairs: { attendanceId: string | null; kind: "CHECK_IN" | "CHECK_OUT" }[]): Promise<Map<string, string>> {
  const ids = [...new Set(pairs.map((p) => p.attendanceId).filter((x): x is string => !!x))];
  if (ids.length === 0) return new Map();
  const rows = await prisma.attendancePhoto.findMany({ where: { attendanceId: { in: ids } }, select: { attendanceId: true, kind: true, fileId: true } });
  return new Map(rows.map((r) => [`${r.attendanceId}:${r.kind}`, `/api/files/${r.fileId}`]));
}
