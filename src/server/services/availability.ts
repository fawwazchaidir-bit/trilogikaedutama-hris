import "server-only";
import { z } from "zod";
import { prisma } from "../db";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import { actorCan, type Actor } from "../actor";
import { env, trainingEnabled } from "../env";
import { getModuleContext } from "./training/access";
import { computeEmployeePeriod, employeeLite, loadRangeContext } from "./context";
import { addDays, startOfIsoWeek, todayIso } from "@/lib/time";
import { isoDate, uuid } from "@/lib/validation/common";

/**
 * KETERSEDIAAN TIM: siapa sedang bertugas di luar (surat tugas), cuti/izin, libur, atau tersedia — per orang per hari.
 * Surat tugas HANYA penanda jadwal: kehadiran tetap dari catatan absensi (lihat `buildEmployeeDays`), jadi penugasan dan bukti hadir tidak tercampur.
 * Siapa yang boleh melihat: HR/Super Admin (assignment:view_all) dan pemegang level modul Training (Manajer, Admin Program, Pemantau). Anggota proyek
 * biasa tidak. Yang bukan HR hanya melihat tujuan dinas — bukan nomor/maksud surat — dan izin/sakit digabung agar alasan kesehatan tidak terbuka.
 */
export const availabilityQuerySchema = z.object({
  from: isoDate.optional(),
  days: z.coerce.number().int().min(1).max(31).optional(),
  divisionId: uuid.optional(),
  q: z.string().trim().max(100).optional(),
});

export interface AvailabilityCell {
  date: string;
  /** Alasan bukan hari kerja ("Libur mingguan", nama hari libur, "Di luar masa kerja") — null bila hari kerja. */
  off: string | null;
  leave: "CUTI" | "IZIN_SAKIT" | null;
  /** Cuti/izin setengah hari (pagi/siang). */
  half: boolean;
  duty: { destination: string; number: string | null } | null;
}
export interface AvailabilityRow { employeeId: string; name: string; position: string; division: string | null; cells: AvailabilityCell[] }
export interface AvailabilityDto {
  from: string;
  to: string;
  days: string[];
  today: string;
  rows: AvailabilityRow[];
  divisions: { id: string; name: string }[];
  /** Ringkasan HARI INI (null bila hari ini di luar rentang yang ditampilkan). */
  summary: { available: number; duty: number; leave: number; off: number } | null;
  /** Nomor surat tugas ditampilkan hanya kepada HR/Super Admin. */
  canSeeNumbers: boolean;
}

async function assertAccess(actor: Actor): Promise<{ canSeeNumbers: boolean }> {
  const hris = actorCan(actor, "assignment:view_all");
  if (hris) return { canSeeNumbers: true };
  if (trainingEnabled() && (await getModuleContext(actor)).caps.hasModule) return { canSeeNumbers: false };
  throw Errors.forbidden();
}

export async function getTeamAvailability(actor: Actor, raw: unknown = {}): Promise<AvailabilityDto> {
  const { canSeeNumbers } = await assertAccess(actor);
  const f = parseInput(availabilityQuerySchema, raw);
  const today = todayIso(env().APP_TIMEZONE);
  const from = f.from ?? startOfIsoWeek(today);
  const span = f.days ?? 14;
  const to = addDays(from, span - 1);
  const [emps, divisions] = await Promise.all([
    prisma.employee.findMany({
      where: { isActive: true, ...(f.divisionId ? { divisionId: f.divisionId } : {}), ...(f.q ? { OR: [{ fullName: { contains: f.q, mode: "insensitive" } }, { employeeNo: { contains: f.q, mode: "insensitive" } }] } : {}) },
      include: { division: { select: { name: true } } }, orderBy: { fullName: "asc" }, take: 300,
    }),
    prisma.division.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const ctx = await loadRangeContext(from, to, { employeeIds: emps.map((e) => e.id), withDuty: true });
  const rows: AvailabilityRow[] = emps.map((e) => ({
    employeeId: e.id, name: e.fullName, position: e.position, division: e.division?.name ?? null,
    cells: computeEmployeePeriod(employeeLite(e), ctx).days.map((d): AvailabilityCell => ({
      date: d.date,
      off: d.status === "DI_LUAR_MASA_KERJA" ? "Di luar masa kerja" : !d.scheduled ? d.offReason : null,
      leave: d.leaveType === "CUTI" ? "CUTI" : d.leaveType ? "IZIN_SAKIT" : null,
      half: d.dayPart === "MORNING" || d.dayPart === "AFTERNOON",
      duty: d.duty ? { destination: d.duty.destination, number: canSeeNumbers ? d.duty.number : null } : null,
    })),
  }));
  const idx = today >= from && today <= to ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) : -1;
  const summary = idx < 0 ? null : rows.reduce((a, r) => {
    const c = r.cells[idx]!;
    if (c.leave && !c.half) a.leave++; else if (c.duty) a.duty++; else if (c.off) a.off++; else a.available++;
    return a;
  }, { available: 0, duty: 0, leave: 0, off: 0 });
  return { from, to, days: Array.from({ length: span }, (_, i) => addDays(from, i)), today, rows, divisions, summary, canSeeNumbers };
}
