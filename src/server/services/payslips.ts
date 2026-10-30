import "server-only";
import { prisma } from "../db";
import { Errors } from "../errors";
import { actorCan, assertCan, requireSelf, type Actor } from "../actor";
import { writeAudit } from "../audit";
import { dateToIso } from "../json";
import type { PayslipSnapshot } from "@/lib/payslip";

export interface PayslipDto {
  id: string;
  runId: string;
  number: string;
  status: "ACTIVE" | "VOIDED";
  issueDate: string;
  issuedAt: string;
  netPay: number;
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  employeeId: string;
  employeeName: string;
  employeeNo: string;
  voidReason: string | null;
}

type Row = { id: string; runId: string; number: string; status: "ACTIVE" | "VOIDED"; issueDate: Date; issuedAt: Date; netPay: bigint; employeeId: string; snapshot: unknown; voidReason: string | null };

const toDto = (r: Row): PayslipDto => {
  const s = r.snapshot as PayslipSnapshot;
  return {
    id: r.id, runId: r.runId, number: r.number, status: r.status, issueDate: dateToIso(r.issueDate), issuedAt: r.issuedAt.toISOString(), netPay: Number(r.netPay),
    periodLabel: s.period.label, periodStart: s.period.start, periodEnd: s.period.end, employeeId: r.employeeId, employeeName: s.employee.name, employeeNo: s.employee.employeeNo, voidReason: r.voidReason,
  };
};

/** Slip milik pelaku sendiri yang AKTIF (slip dibatalkan tidak tampil untuk karyawan). */
export async function listMyPayslips(actor: Actor): Promise<PayslipDto[]> {
  const employeeId = requireSelf(actor);
  const rows = await prisma.payslip.findMany({ where: { employeeId, status: "ACTIVE", run: { status: "ISSUED" } }, orderBy: [{ issueDate: "desc" }, { number: "desc" }], take: 120 });
  return rows.map(toDto);
}

/**
 * Ambil satu slip dengan pemeriksaan akses:
 *  - Admin (payroll:view): semua slip, termasuk yang dibatalkan.
 *  - Karyawan: HANYA slip miliknya yang aktif. Slip orang lain dijawab "tidak ditemukan" (tidak membocorkan keberadaannya).
 */
export async function getPayslip(actor: Actor, id: string): Promise<{ dto: PayslipDto; snapshot: PayslipSnapshot }> {
  const row = await prisma.payslip.findUnique({ where: { id } });
  if (!row) throw Errors.notFound("Slip gaji");
  const admin = actorCan(actor, "payroll:view");
  if (!admin) {
    if (!actor.employeeId || row.employeeId !== actor.employeeId || row.status !== "ACTIVE") throw Errors.notFound("Slip gaji");
  }
  return { dto: toDto(row), snapshot: row.snapshot as unknown as PayslipSnapshot };
}

/** Seluruh slip satu periode (untuk unduh massal) — hanya admin. */
export async function getRunPayslips(actor: Actor, runId: string, opts: { includeVoided?: boolean } = {}) {
  assertCan(actor, "payslip:download_all");
  const rows = await prisma.payslip.findMany({
    where: { runId, ...(opts.includeVoided ? {} : { status: "ACTIVE" }) }, orderBy: { number: "asc" },
  });
  if (rows.length === 0) throw Errors.notFound("Slip gaji pada periode ini");
  return rows.map((r) => ({ dto: toDto(r), snapshot: r.snapshot as unknown as PayslipSnapshot, voided: r.status === "VOIDED" }));
}

/** Catat unduhan/pratinjau slip (privasi data gaji: siapa membuka slip siapa). */
export async function auditPayslipAccess(actor: Actor, payslipIds: string[], summary: string): Promise<void> {
  await writeAudit(prisma, actor, { action: "payslip.download", entityType: "Payslip", entityId: payslipIds.length === 1 ? payslipIds[0] : null, summary, after: { count: payslipIds.length } });
}
