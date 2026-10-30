/**
 * Verifikasi cepat sebuah database HRIS (mis. hasil latihan pemulihan): jumlah baris per tabel inti + pemeriksaan integritas
 * yang tidak boleh gagal (slip terbit vs item, saldo cuti, trigger append-only masih terpasang).
 *   DATABASE_URL=postgresql://…/hris_restore_check npm run db:verify
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
async function main() {
  const tables = ["users", "employees", "attendances", "attendance_corrections", "leave_requests", "leave_balance_entries", "salary_components", "payroll_runs", "payroll_items", "payslips", "audit_logs"];
  console.log("Jumlah baris:");
  for (const t of tables) {
    const rows = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${t}"`);
    console.log(`  ${t.padEnd(26)} ${rows[0]?.n ?? 0}`);
  }
  const problems: string[] = [];
  const orphan = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM payslips s JOIN payroll_items i ON i.id = s."itemId" WHERE s."netPay" <> i."netPay" AND s.status = 'ACTIVE'`;
  if (Number(orphan[0]!.n) > 0) problems.push("Ada slip aktif yang nilainya berbeda dari item penggajiannya.");
  const issuedNoSlip = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM payroll_items i JOIN payroll_runs r ON r.id = i."runId" LEFT JOIN payslips s ON s."itemId" = i.id WHERE r.status = 'ISSUED' AND s.id IS NULL`;
  if (Number(issuedNoSlip[0]!.n) > 0) problems.push("Ada item pada periode terbit yang tidak memiliki slip.");
  const triggers = await prisma.$queryRaw<{ tgname: string }[]>`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('audit_logs_append_only','payslips_guard','payroll_runs_guard','leave_balance_entries_append_only','attendance_corrections_append_only')`;
  if (triggers.length < 5) problems.push(`Trigger integritas tidak lengkap (${triggers.length}/5) — pemulihan harus menyertakan trigger.`);
  const sums = await prisma.$queryRaw<{ bad: bigint }[]>`SELECT count(*) AS bad FROM payroll_items WHERE "netPay" <> "totalEarnings" - "totalDeductions"`;
  if (Number(sums[0]!.bad) > 0) problems.push("Ada item dengan gaji bersih ≠ pendapatan − potongan.");
  if (problems.length) { console.error("\nMASALAH:\n- " + problems.join("\n- ")); process.exitCode = 1; } else console.log("\n✔ Pemeriksaan integritas lulus.");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
