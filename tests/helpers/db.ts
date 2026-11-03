import { prisma } from "@/server/db";
import type { Actor } from "@/server/actor";
import { hashPassword } from "@/server/auth/password";
import { encryptField } from "@/server/crypto";
import { isoToDate } from "@/server/json";
import type { Role } from "@/lib/permissions";
import { invalidateSecurityPolicyCache } from "@/server/auth/session";

const TABLES = [
  // Training & Operations (tabel baru; CASCADE tetap menjangkau sisanya, tetapi program/template berdiri sendiri sehingga disebut eksplisit).
  "training_project_assignment_links", "training_external_refs", "training_project_documents", "training_participants", "training_schedules", "training_project_instructors", "training_instructors",
  "training_project_checklist_items", "training_checklist_template_items", "training_checklist_templates", "training_task_comments", "training_tasks", "training_project_members", "training_projects", "training_programs", "training_access",
  "audit_logs", "daily_allowance_receipts", "assignment_assignees", "assignment_letters", "employee_documents", "notification_deliveries", "notifications", "overtime_requests", "location_checks", "two_factor_recovery_codes", "login_challenges", "password_reset_tokens", "payslips", "payroll_item_lines", "payroll_items", "payroll_runs", "salary_components",
  "leave_balance_entries", "leave_requests", "attendance_corrections", "attendances", "calendar_days", "schedule_assignments", "work_schedules",
  "employees", "divisions", "stored_files", "sessions", "rate_limit_buckets", "company_settings", "users",
];

/** TRUNCATE tidak memicu trigger baris (append-only), sehingga aman untuk reset test. */
export async function resetDb(): Promise<void> {
  invalidateSecurityPolicyCache();
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export const TEST_PASSWORD = "Test-Password-123!";

export async function makeUser(email: string, name: string, role: Role, employeeId: string | null = null): Promise<Actor> {
  const u = await prisma.user.create({ data: { email, name, role, passwordHash: await hashPassword(TEST_PASSWORD) } });
  if (employeeId) await prisma.employee.update({ where: { id: employeeId }, data: { userId: u.id } });
  return { userId: u.id, email: u.email, name: u.name, role: u.role, employeeId, ip: "127.0.0.1", userAgent: "vitest" };
}

export async function makeEmployee(over: Partial<{ employeeNo: string; fullName: string; divisionId: string | null; joinDate: string; position: string }> = {}) {
  return prisma.employee.create({
    data: {
      employeeNo: over.employeeNo ?? `EMP-${Math.random().toString(36).slice(2, 8)}`, fullName: over.fullName ?? "Karyawan Uji",
      position: over.position ?? "Staf", employmentStatus: "PERMANENT", joinDate: isoToDate(over.joinDate ?? "2025-01-01"), divisionId: over.divisionId ?? null,
    },
  });
}

export interface Fixtures {
  superAdmin: Actor;
  hr: Actor;
  /** Tiga karyawan dengan akun (peran Karyawan). */
  emp1: Actor; emp2: Actor; emp3: Actor;
  empIds: [string, string, string];
  divisionA: string; divisionB: string;
  scheduleId: string;
}

/** Perusahaan + jadwal default (Sen–Jum 08:00–16:00, toleransi 15 mnt, batas tidak hadir 12:00) + pengguna & karyawan. */
export async function seedFixtures(): Promise<Fixtures> {
  await prisma.companySettings.create({ data: { id: 1, name: "TRILOGIKA EDUTAMA (UJI)", address: "Alamat uji", phone: "0274-000000", email: "hr@trilogika.test" } });
  const schedule = await prisma.workSchedule.create({
    data: { name: "Reguler", workDays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "16:00", lateToleranceMinutes: 15, absentCutoffTime: "12:00", isDefault: true },
  });
  const a = await prisma.division.create({ data: { name: "Operasional" } });
  const b = await prisma.division.create({ data: { name: "Pemasaran" } });
  const e1 = await makeEmployee({ employeeNo: "TE-001", fullName: "Ayu Lestari", divisionId: a.id });
  const e2 = await makeEmployee({ employeeNo: "TE-002", fullName: "Budi Santoso", divisionId: a.id });
  const e3 = await makeEmployee({ employeeNo: "TE-003", fullName: "Citra Dewi", divisionId: b.id });
  const superAdmin = await makeUser("pimpinan@uji.test", "Pimpinan Uji", "SUPER_ADMIN");
  const hr = await makeUser("hr@uji.test", "HR Uji", "HR_ADMIN");
  const emp1 = await makeUser("ayu@uji.test", "Ayu Lestari", "EMPLOYEE", e1.id);
  const emp2 = await makeUser("budi@uji.test", "Budi Santoso", "EMPLOYEE", e2.id);
  const emp3 = await makeUser("citra@uji.test", "Citra Dewi", "EMPLOYEE", e3.id);
  return { superAdmin, hr, emp1, emp2, emp3, empIds: [e1.id, e2.id, e3.id], divisionA: a.id, divisionB: b.id, scheduleId: schedule.id };
}

/** Catatan absensi langsung (tanpa lewat check-in) untuk skenario historis. Jam dalam WIB (UTC+7). */
export async function addAttendance(employeeId: string, date: string, inT: string | null, outT: string | null) {
  if (!inT) return;
  const at = (t: string) => new Date(`${date}T${t}:00+07:00`);
  await prisma.attendance.create({ data: { employeeId, date: isoToDate(date), checkInAt: at(inT), checkOutAt: outT ? at(outT) : null, source: "SELF" } });
}

export async function addComponent(employeeId: string, createdById: string, c: {
  category: "BASE_SALARY" | "POSITION_ALLOWANCE" | "TRANSPORT_ALLOWANCE" | "MEAL_ALLOWANCE" | "INCENTIVE" | "BPJS" | "LOAN" | "TAX" | "OTHER_EARNING" | "OTHER_DEDUCTION";
  name: string; amount?: number; calc?: "FIXED" | "PER_PRESENT_DAY" | "PERCENT_OF_BASE"; percentBp?: number; from?: string; to?: string | null; recurrence?: "RECURRING" | "ONE_TIME";
}) {
  const earning = ["BASE_SALARY", "POSITION_ALLOWANCE", "TRANSPORT_ALLOWANCE", "MEAL_ALLOWANCE", "INCENTIVE", "OTHER_EARNING"].includes(c.category);
  return prisma.salaryComponent.create({
    data: {
      employeeId, kind: earning ? "EARNING" : "DEDUCTION", category: c.category, name: c.name, calc: c.calc ?? "FIXED",
      amount: BigInt(c.calc === "PERCENT_OF_BASE" ? 0 : c.amount ?? 0), percentBp: c.calc === "PERCENT_OF_BASE" ? c.percentBp ?? 0 : null,
      recurrence: c.recurrence ?? "RECURRING", effectiveFrom: isoToDate(c.from ?? "2025-01-01"),
      effectiveTo: c.recurrence === "ONE_TIME" ? isoToDate(c.from ?? "2025-01-01") : c.to ? isoToDate(c.to) : null, createdById,
    },
  });
}

export { encryptField };
