/**
 * Verifikasi cepat sebuah database HRIS (mis. hasil latihan pemulihan): jumlah baris per tabel inti + pemeriksaan integritas
 * yang tidak boleh gagal (slip terbit vs item, saldo cuti, trigger append-only masih terpasang).
 *   DATABASE_URL=postgresql://…/hris_restore_check npm run db:verify
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
async function main() {
  const tables = ["users", "employees", "attendances", "attendance_corrections", "attendance_photos", "stored_files", "leave_requests", "leave_balance_entries", "overtime_requests", "location_checks", "salary_components", "payroll_runs", "payroll_items", "payslips", "employee_documents", "assignment_letters", "assignment_assignees", "daily_allowance_receipts", "training_access", "training_programs", "training_projects", "training_project_members", "training_tasks", "training_project_checklist_items", "training_schedules", "training_participants", "training_project_documents", "training_project_assignment_links", "training_milestones", "training_readiness_items", "training_workload_tasks", "training_staff_capacity", "training_indicator_config", "training_indicator_config_versions", "notification_deliveries", "push_subscriptions", "employee_org_history", "supervisor_delegations", "employee_checklists", "employee_checklist_items", "employee_checklist_template_items", "employee_checklist_reminder_log", "assets", "asset_assignments", "final_settlements", "final_settlement_lines", "audit_logs"];
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
  const EXPECTED_TRIGGERS = ["audit_logs_append_only", "payslips_guard", "payroll_runs_guard", "payroll_items_guard", "payroll_item_lines_guard", "leave_balance_entries_append_only", "attendance_corrections_append_only", "leave_requests_guard", "overtime_requests_guard", "attendance_photos_guard", "employee_documents_guard", "assignment_letters_guard", "assignment_assignees_guard", "daily_allowance_receipts_guard", "training_projects_guard", "training_project_documents_guard", "training_task_comments_append_only", "training_indicator_config_versions_append_only", "employee_org_history_append_only", "supervisor_delegations_guard", "employees_supervisor_cycle", "employee_checklists_guard", "employee_checklist_items_guard", "assets_guard", "asset_assignments_guard", "final_settlements_guard", "final_settlement_lines_guard", "chat_messages_guard", "chat_message_revisions_append_only"];
  const present = new Set((await prisma.$queryRaw<{ tgname: string }[]>`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal`).map((t) => t.tgname));
  const missing = EXPECTED_TRIGGERS.filter((t) => !present.has(t));
  if (missing.length) problems.push(`Trigger integritas tidak lengkap (hilang: ${missing.join(", ")}) — pemulihan harus menyertakan trigger.`);
  // Foto absensi: tiap baris punya berkas ATAU sudah dihapus retensi (tidak keduanya, tidak tidak-keduanya); berkas foto tanpa catatan = yatim.
  const photoState = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM attendance_photos WHERE ("purgedAt" IS NULL) <> ("fileId" IS NOT NULL)`;
  if (Number(photoState[0]!.n) > 0) problems.push("Ada foto absensi dengan status berkas/retensi tidak konsisten.");
  const orphanFiles = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM stored_files f WHERE f.kind = 'ATTENDANCE_PHOTO' AND NOT EXISTS (SELECT 1 FROM attendance_photos p WHERE p."fileId" = f.id)`;
  if (Number(orphanFiles[0]!.n) > 0) problems.push("Ada berkas foto absensi tanpa catatan (yatim).");
  const sums = await prisma.$queryRaw<{ bad: bigint }[]>`SELECT count(*) AS bad FROM payroll_items WHERE "netPay" <> "totalEarnings" - "totalDeductions"`;
  if (Number(sums[0]!.bad) > 0) problems.push("Ada item dengan gaji bersih ≠ pendapatan − potongan.");
  // Surat Tugas & Bukti Penerimaan Uang Harian: paling banyak satu bukti aktif per penerima; nominal bukti = nominal penerima tugas.
  const dupActive = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM (SELECT "assigneeId" FROM daily_allowance_receipts WHERE status = 'ACTIVE' GROUP BY 1 HAVING count(*) > 1) x`;
  if (Number(dupActive[0]!.n) > 0) problems.push("Ada penerima tugas dengan lebih dari satu bukti penerimaan uang harian aktif.");
  const receiptMismatch = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM daily_allowance_receipts r JOIN assignment_assignees a ON a.id = r."assigneeId" WHERE r."total" <> a."total" OR r."days" <> a."days" OR r."dailyRate" <> a."dailyRate"`;
  if (Number(receiptMismatch[0]!.n) > 0) problems.push("Ada bukti penerimaan uang harian yang nominalnya berbeda dari surat tugasnya.");
  const activeOnCancelled = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM daily_allowance_receipts r JOIN assignment_letters l ON l.id = r."letterId" WHERE r.status = 'ACTIVE' AND l.status = 'CANCELLED'`;
  if (Number(activeOnCancelled[0]!.n) > 0) problems.push("Ada bukti penerimaan aktif pada surat tugas yang dibatalkan.");
  // Dokumen proyek Training & Operations: tiap baris harus menunjuk berkas bertipe TRAINING_DOCUMENT yang ada.
  const trainingDocNoFile = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM training_project_documents d LEFT JOIN stored_files f ON f.id = d."fileId" WHERE f.id IS NULL OR f.kind <> 'TRAINING_DOCUMENT'`;
  if (Number(trainingDocNoFile[0]!.n) > 0) problems.push("Ada dokumen proyek Training & Operations tanpa berkas yang sah.");
  const docNoFile = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM employee_documents d LEFT JOIN stored_files f ON f.id = d."fileId" WHERE f.id IS NULL OR f.kind <> 'DOCUMENT'`;
  if (Number(docNoFile[0]!.n) > 0) problems.push("Ada dokumen kepegawaian tanpa berkas PDF yang valid.");
  // Aturan Magang (SOP Rev 0.5): karyawan Magang tidak boleh memegang role Admin/HR, level modul Training, peran proyek penyetuju, atau menjadi atasan.
  const internFunctions = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM employees e WHERE e."employmentStatus" = 'INTERN' AND e."isActive" AND (
    EXISTS (SELECT 1 FROM users u WHERE u.id = e."userId" AND (u.role <> 'EMPLOYEE' OR EXISTS (SELECT 1 FROM training_access a WHERE a."userId" = u.id)))
    OR EXISTS (SELECT 1 FROM training_project_members m WHERE m."employeeId" = e.id AND m."endedAt" IS NULL AND m.role IN ('PROJECT_MANAGER', 'ADMIN_PROGRAM', 'PARTICIPANT_OWNER'))
    OR EXISTS (SELECT 1 FROM employees r WHERE r."supervisorId" = e.id AND r."isActive"))`;
  if (Number(internFunctions[0]!.n) > 0) problems.push("Ada karyawan Magang aktif yang memegang fungsi penyetuju/akses data peserta (role Admin/HR, level Training, peran proyek PIC/Admin Program/PJ Peserta, atau atasan langsung). Cabut fungsinya.");
  // Obrolan: japri harus tepat dua anggota; nomor urut ruang tidak boleh kurang dari pesan terakhirnya.
  const dmShape = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM chat_rooms r WHERE r.kind = 'DIRECT' AND (SELECT count(*) FROM chat_members m WHERE m."roomId" = r.id) <> 2`;
  if (Number(dmShape[0]!.n) > 0) problems.push("Ada japri obrolan yang anggotanya bukan tepat dua orang.");
  const seqGap = await prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM chat_rooms r WHERE r."lastSeq" < COALESCE((SELECT max(m.seq) FROM chat_messages m WHERE m."roomId" = r.id), 0)`;
  if (Number(seqGap[0]!.n) > 0) problems.push("Ada ruang obrolan yang nomor urut terakhirnya lebih kecil dari pesan terakhirnya.");
  if (problems.length) { console.error("\nMASALAH:\n- " + problems.join("\n- ")); process.exitCode = 1; } else console.log("\n✔ Pemeriksaan integritas lulus.");
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
