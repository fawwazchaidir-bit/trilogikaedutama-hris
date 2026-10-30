import "server-only";
import { z } from "zod";
import type { CompanySettings } from "@prisma/client";
import { prisma, transaction } from "../db";
import { Errors } from "../errors";
import { parseInput } from "../validate";
import { assertCan, type Actor } from "../actor";
import { diffFields, writeAudit } from "../audit";
import { optionalEmail, optionalPhone, optionalText, requiredText } from "@/lib/validation/common";
import type { PayrollRules } from "@/lib/payroll";
import type { GeoPolicy } from "@/lib/geo";

/** Baris pengaturan tunggal; dibuat dengan nilai awal AMAN bila belum ada (mis. database baru tanpa seed). */
export async function getSettings(): Promise<CompanySettings> {
  const row = await prisma.companySettings.findUnique({ where: { id: 1 } });
  if (row) return row;
  return prisma.companySettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1, name: "Trilogika Edutama" } });
}

export async function getBrand(): Promise<{ name: string; logoUrl: string }> {
  const s = await getSettings();
  return { name: s.name, logoUrl: s.logoFileId ? `/api/files/${s.logoFileId}` : "/brand/logo.png" };
}

export function payrollRulesOf(s: CompanySettings): PayrollRules {
  return {
    lateMode: s.lateDeductionMode,
    lateAmount: Number(s.lateDeductionAmount),
    absenceMode: s.absenceDeductionMode,
    absenceAmount: Number(s.absenceDeductionAmount),
    absenceDivisor: s.absenceSalaryDivisor,
    izinDeductsPay: s.izinDeductsPay,
    sakitDeductsPay: s.sakitDeductsPay,
    cutiDeductsPay: s.cutiDeductsPay,
    overtimeMode: s.overtimeMode,
    overtimeRatePerHour: Number(s.overtimeRatePerHour),
    overtimeMinMinutes: s.overtimeMinMinutes,
    overtimeMaxMinutesPerDay: s.overtimeMaxMinutesPerDay,
  };
}

export function geoPolicyOf(s: CompanySettings): GeoPolicy {
  return {
    enabled: s.locationEnabled,
    name: s.locationName,
    center: s.locationLat !== null && s.locationLng !== null ? { lat: s.locationLat, lng: s.locationLng } : null,
    radiusMeters: s.locationRadiusMeters,
    maxAccuracyMeters: s.locationMaxAccuracyMeters,
  };
}

export interface SettingsDto {
  company: { name: string; legalName: string | null; tagline: string | null; address: string | null; phone: string | null; email: string | null; website: string | null; logoUrl: string | null };
  slip: { showAttendance: boolean; footerNote: string | null; numberPrefix: string };
  attendance: {
    lateMinutesAfterTolerance: boolean; locationEnabled: boolean; locationName: string | null; locationLat: number | null; locationLng: number | null;
    locationRadiusMeters: number; locationMaxAccuracyMeters: number; requestBackdateDays: number; confirmedAt: string | null;
  };
  leave: { annualLeaveQuota: number; allowNegativeLeaveBalance: boolean };
  payroll: PayrollRules & { confirmedAt: string | null };
}

export async function getSettingsDto(actor: Actor): Promise<SettingsDto> {
  assertCan(actor, "settings:view");
  const s = await getSettings();
  return {
    company: { name: s.name, legalName: s.legalName, tagline: s.tagline, address: s.address, phone: s.phone, email: s.email, website: s.website, logoUrl: s.logoFileId ? `/api/files/${s.logoFileId}` : null },
    slip: { showAttendance: s.slipShowAttendance, footerNote: s.slipFooterNote, numberPrefix: s.slipNumberPrefix },
    attendance: {
      lateMinutesAfterTolerance: s.lateMinutesAfterTolerance, locationEnabled: s.locationEnabled, locationName: s.locationName,
      locationLat: s.locationLat, locationLng: s.locationLng, locationRadiusMeters: s.locationRadiusMeters,
      locationMaxAccuracyMeters: s.locationMaxAccuracyMeters, requestBackdateDays: s.requestBackdateDays,
      confirmedAt: s.attendancePolicyConfirmedAt?.toISOString() ?? null,
    },
    leave: { annualLeaveQuota: s.annualLeaveQuota, allowNegativeLeaveBalance: s.allowNegativeLeaveBalance },
    payroll: { ...payrollRulesOf(s), confirmedAt: s.payrollRulesConfirmedAt?.toISOString() ?? null },
  };
}

// ─────────────────────────── Profil lembaga & slip ───────────────────────────

export const companySchema = z.object({
  name: requiredText(2, 120, "Nama lembaga"),
  legalName: optionalText(160, "Nama badan hukum"),
  tagline: optionalText(120, "Tagline"),
  address: optionalText(400, "Alamat"),
  phone: optionalPhone,
  email: optionalEmail,
  website: optionalText(160, "Situs web"),
  slipShowAttendance: z.boolean(),
  slipFooterNote: optionalText(400, "Catatan kaki slip"),
  slipNumberPrefix: z.string().trim().regex(/^[A-Za-z0-9]{1,8}$/, "Awalan nomor slip: 1–8 huruf/angka").transform((v) => v.toUpperCase()),
});

export async function updateCompany(actor: Actor, raw: unknown): Promise<void> {
  assertCan(actor, "settings:manage");
  const input = parseInput(companySchema, raw);
  await transaction(async (tx) => {
    const before = await tx.companySettings.findUniqueOrThrow({ where: { id: 1 } });
    await tx.companySettings.update({ where: { id: 1 }, data: input });
    const d = diffFields(before as unknown as Record<string, unknown>, input as Record<string, unknown>);
    if (d.changed.length) await writeAudit(tx, actor, { action: "settings.company_update", entityType: "CompanySettings", entityId: "1", summary: "Profil lembaga/slip diubah", before: d.before, after: d.after });
  });
}

export async function setLogo(actor: Actor, fileId: string): Promise<void> {
  assertCan(actor, "settings:manage");
  await transaction(async (tx) => {
    const f = await tx.storedFile.findUnique({ where: { id: fileId }, select: { kind: true } });
    if (f?.kind !== "LOGO") throw Errors.validation("File logo tidak valid.");
    const before = await tx.companySettings.findUniqueOrThrow({ where: { id: 1 }, select: { logoFileId: true } });
    await tx.companySettings.update({ where: { id: 1 }, data: { logoFileId: fileId } });
    await writeAudit(tx, actor, { action: "settings.logo_update", entityType: "CompanySettings", entityId: "1", summary: "Logo diganti", before: { logoFileId: before.logoFileId }, after: { logoFileId: fileId } });
  });
}

// ─────────────────────────── Kebijakan absensi & cuti (Super Admin) ───────────────────────────

export const attendancePolicySchema = z.object({
  lateMinutesAfterTolerance: z.boolean(),
  locationEnabled: z.boolean(),
  locationName: optionalText(120, "Nama lokasi"),
  locationLat: z.number().min(-90, "Lintang harus -90 s.d. 90").max(90, "Lintang harus -90 s.d. 90").nullable(),
  locationLng: z.number().min(-180, "Bujur harus -180 s.d. 180").max(180, "Bujur harus -180 s.d. 180").nullable(),
  locationRadiusMeters: z.number().int().min(10, "Radius minimal 10 m").max(100_000),
  locationMaxAccuracyMeters: z.number().int().min(5, "Akurasi maksimal minimal 5 m").max(5000),
  requestBackdateDays: z.number().int().min(0).max(365),
  annualLeaveQuota: z.number().int().min(0).max(366),
  allowNegativeLeaveBalance: z.boolean(),
}).superRefine((v, ctx) => {
  if (v.locationEnabled && (v.locationLat === null || v.locationLng === null)) {
    ctx.addIssue({ code: "custom", path: ["locationLat"], message: "Isi titik lokasi (lintang & bujur) sebelum mengaktifkan absensi berbasis lokasi" });
  }
});

export async function updateAttendancePolicy(actor: Actor, raw: unknown): Promise<void> {
  assertCan(actor, "settings:manage");
  const input = parseInput(attendancePolicySchema, raw);
  await transaction(async (tx) => {
    const before = await tx.companySettings.findUniqueOrThrow({ where: { id: 1 } });
    await tx.companySettings.update({ where: { id: 1 }, data: { ...input, attendancePolicyConfirmedAt: new Date() } });
    const d = diffFields(before as unknown as Record<string, unknown>, input as Record<string, unknown>);
    await writeAudit(tx, actor, { action: "settings.attendance_policy_update", entityType: "CompanySettings", entityId: "1", summary: "Kebijakan absensi/cuti diubah", before: d.before, after: d.after });
  });
}

// ─────────────────────────── Aturan penggajian (Super Admin) ───────────────────────────

const rp = (label: string) => z.number({ error: `${label} harus berupa angka` }).int(`${label} harus bilangan bulat Rupiah`).min(0, `${label} tidak boleh negatif`).max(100_000_000_000, `${label} terlalu besar`);

export const payrollRulesSchema = z.object({
  lateMode: z.enum(["NONE", "PER_OCCURRENCE", "PER_MINUTE"]),
  lateAmount: rp("Nominal potongan keterlambatan"),
  absenceMode: z.enum(["NONE", "FIXED_PER_DAY", "SALARY_DIVISOR"]),
  absenceAmount: rp("Nominal potongan ketidakhadiran"),
  absenceDivisor: z.number().int().min(1, "Pembagi 1–31").max(31, "Pembagi 1–31").nullable(),
  izinDeductsPay: z.boolean(),
  sakitDeductsPay: z.boolean(),
  cutiDeductsPay: z.boolean(),
  overtimeMode: z.enum(["MANUAL", "AUTO"]),
  overtimeRatePerHour: rp("Tarif lembur per jam"),
  overtimeMinMinutes: z.number().int().min(0).max(1440),
  overtimeMaxMinutesPerDay: z.number().int().min(0).max(1440),
}).superRefine((v, ctx) => {
  if (v.lateMode !== "NONE" && v.lateAmount <= 0) ctx.addIssue({ code: "custom", path: ["lateAmount"], message: "Isi nominal potongan keterlambatan (> 0) atau pilih 'Tidak ada potongan'" });
  if (v.absenceMode === "FIXED_PER_DAY" && v.absenceAmount <= 0) ctx.addIssue({ code: "custom", path: ["absenceAmount"], message: "Isi nominal potongan per hari (> 0)" });
  if (v.absenceMode === "SALARY_DIVISOR" && !v.absenceDivisor) ctx.addIssue({ code: "custom", path: ["absenceDivisor"], message: "Isi pembagi gaji pokok (mis. jumlah hari kerja per bulan)" });
  if (v.overtimeMode === "AUTO" && v.overtimeRatePerHour <= 0) ctx.addIssue({ code: "custom", path: ["overtimeRatePerHour"], message: "Isi tarif lembur per jam (> 0) untuk mode otomatis" });
});

/** Mengubah aturan MEMBATALKAN konfirmasi sebelumnya: Super Admin harus memverifikasi ulang sebelum gaji dapat disetujui. */
export async function updatePayrollRules(actor: Actor, raw: unknown): Promise<void> {
  assertCan(actor, "payroll:rules");
  const input = parseInput(payrollRulesSchema, raw);
  await transaction(async (tx) => {
    const before = await tx.companySettings.findUniqueOrThrow({ where: { id: 1 } });
    await tx.companySettings.update({
      where: { id: 1 },
      data: {
        lateDeductionMode: input.lateMode, lateDeductionAmount: BigInt(input.lateAmount),
        absenceDeductionMode: input.absenceMode, absenceDeductionAmount: BigInt(input.absenceAmount), absenceSalaryDivisor: input.absenceDivisor,
        izinDeductsPay: input.izinDeductsPay, sakitDeductsPay: input.sakitDeductsPay, cutiDeductsPay: input.cutiDeductsPay,
        overtimeMode: input.overtimeMode, overtimeRatePerHour: BigInt(input.overtimeRatePerHour),
        overtimeMinMinutes: input.overtimeMinMinutes, overtimeMaxMinutesPerDay: input.overtimeMaxMinutesPerDay,
        payrollRulesConfirmedAt: null, payrollRulesConfirmedById: null,
      },
    });
    await writeAudit(tx, actor, {
      action: "settings.payroll_rules_update", entityType: "CompanySettings", entityId: "1", summary: "Aturan penggajian diubah (konfirmasi dicabut)",
      before: payrollRulesOf(before), after: input,
    });
  });
}

export async function confirmPayrollRules(actor: Actor): Promise<void> {
  assertCan(actor, "payroll:rules");
  await transaction(async (tx) => {
    await tx.companySettings.update({ where: { id: 1 }, data: { payrollRulesConfirmedAt: new Date(), payrollRulesConfirmedById: actor.userId } });
    await writeAudit(tx, actor, { action: "settings.payroll_rules_confirm", entityType: "CompanySettings", entityId: "1", summary: "Aturan penggajian dikonfirmasi sesuai kebijakan perusahaan" });
  });
}
