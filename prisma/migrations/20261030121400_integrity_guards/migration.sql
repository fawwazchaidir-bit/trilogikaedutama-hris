-- ════════════════════════════════════════════════════════════════════════════
-- Integrity guards — defense in depth di level database.
--
-- Aplikasi sudah menegakkan aturan yang sama di service layer. Migrasi ini memastikan bahwa
-- bahkan bug aplikasi, skrip ad-hoc, atau akses SQL langsung TIDAK dapat:
--   * mengubah / menghapus audit log, riwayat koreksi absensi, dan buku saldo cuti (append-only),
--   * mengubah slip gaji yang sudah terbit (hanya ACTIVE → VOIDED dengan alasan),
--   * mengubah item/rincian penggajian di luar status DRAFT,
--   * melompati alur status penggajian atau pengajuan,
--   * menyimpan nilai yang tidak konsisten (tanggal terbalik, jam tidak valid, nominal negatif, dst.).
-- Semua pesan diawali "HRIS-GUARD:" agar aplikasi dapat menampilkannya apa adanya kepada pengguna.
-- ════════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── Keunikan tanpa membedakan huruf besar/kecil ───────────────────────────

CREATE UNIQUE INDEX "employees_employeeNo_ci" ON "employees" (lower("employeeNo"));
CREATE UNIQUE INDEX "divisions_name_ci" ON "divisions" (lower("name"));
CREATE UNIQUE INDEX "work_schedules_name_ci" ON "work_schedules" (lower("name"));
-- Tepat satu jadwal default.
CREATE UNIQUE INDEX "work_schedules_single_default" ON "work_schedules" ((true)) WHERE "isDefault" = true;

-- ─────────────────────────── CHECK constraints ───────────────────────────

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_dates" CHECK ("endDate" IS NULL OR "endDate" >= "joinDate"),
  ADD CONSTRAINT "employees_no_not_blank" CHECK (length(btrim("employeeNo")) > 0 AND length(btrim("fullName")) > 0);

ALTER TABLE "work_schedules"
  ADD CONSTRAINT "work_schedules_days" CHECK (
    cardinality("workDays") BETWEEN 1 AND 7 AND "workDays" <@ ARRAY[1,2,3,4,5,6,7]
  ),
  ADD CONSTRAINT "work_schedules_times" CHECK (
    "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "absentCutoffTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    AND "endTime" > "startTime"
    AND "absentCutoffTime" > "startTime"
  ),
  ADD CONSTRAINT "work_schedules_tolerance" CHECK ("lateToleranceMinutes" BETWEEN 0 AND 240);

ALTER TABLE "schedule_assignments"
  ADD CONSTRAINT "schedule_assignments_target" CHECK (
    ("scope" = 'ALL' AND "divisionId" IS NULL AND "employeeId" IS NULL)
    OR ("scope" = 'DIVISION' AND "divisionId" IS NOT NULL AND "employeeId" IS NULL)
    OR ("scope" = 'EMPLOYEE' AND "employeeId" IS NOT NULL AND "divisionId" IS NULL)
  ),
  ADD CONSTRAINT "schedule_assignments_dates" CHECK ("endDate" IS NULL OR "endDate" >= "startDate");

ALTER TABLE "attendances"
  ADD CONSTRAINT "attendances_out_after_in" CHECK ("checkOutAt" IS NULL OR "checkOutAt" > "checkInAt"),
  ADD CONSTRAINT "attendances_source" CHECK ("source" IN ('SELF', 'ADMIN')),
  ADD CONSTRAINT "attendances_distance_nonneg" CHECK (
    ("checkInDistance" IS NULL OR "checkInDistance" >= 0) AND ("checkOutDistance" IS NULL OR "checkOutDistance" >= 0)
  );

ALTER TABLE "attendance_corrections"
  ADD CONSTRAINT "attendance_corrections_reason" CHECK (length(btrim("reason")) > 0);

ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_dates" CHECK ("endDate" >= "startDate"),
  ADD CONSTRAINT "leave_requests_reason" CHECK (length(btrim("reason")) > 0),
  ADD CONSTRAINT "leave_requests_review_info" CHECK (
    "status" NOT IN ('APPROVED', 'REJECTED') OR ("reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND ("status" = 'REJECTED' OR "workingDays" IS NOT NULL))
  ),
  ADD CONSTRAINT "leave_requests_cancel_info" CHECK (
    "status" <> 'CANCELLED' OR ("cancelledAt" IS NOT NULL AND "cancelReason" IS NOT NULL AND length(btrim("cancelReason")) > 0)
  );

ALTER TABLE "leave_balance_entries"
  ADD CONSTRAINT "leave_balance_entries_values" CHECK (
    "year" BETWEEN 2000 AND 2200 AND "days" <> 0
    AND ("kind" <> 'USAGE' OR ("days" < 0 AND "requestId" IS NOT NULL))
    AND ("kind" <> 'RESTORE' OR ("days" > 0 AND "requestId" IS NOT NULL))
  );

ALTER TABLE "salary_components"
  ADD CONSTRAINT "salary_components_amount" CHECK ("amount" >= 0 AND "amount" <= 100000000000),
  ADD CONSTRAINT "salary_components_dates" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  ADD CONSTRAINT "salary_components_percent" CHECK (
    ("calc" = 'PERCENT_OF_BASE' AND "percentBp" IS NOT NULL AND "percentBp" BETWEEN 0 AND 10000 AND "amount" = 0)
    OR ("calc" <> 'PERCENT_OF_BASE' AND "percentBp" IS NULL)
  ),
  ADD CONSTRAINT "salary_components_kind_category" CHECK (
    ("kind" = 'EARNING' AND "category" IN ('BASE_SALARY', 'POSITION_ALLOWANCE', 'TRANSPORT_ALLOWANCE', 'MEAL_ALLOWANCE', 'INCENTIVE', 'OVERTIME', 'OTHER_EARNING'))
    OR ("kind" = 'DEDUCTION' AND "category" IN ('LATE_DEDUCTION', 'ABSENCE_DEDUCTION', 'LOAN', 'BPJS', 'TAX', 'OTHER_DEDUCTION'))
  ),
  ADD CONSTRAINT "salary_components_one_time" CHECK ("recurrence" = 'RECURRING' OR "effectiveTo" IS NULL OR "effectiveTo" = "effectiveFrom"),
  ADD CONSTRAINT "salary_components_name" CHECK (length(btrim("name")) > 0);

ALTER TABLE "payroll_runs"
  ADD CONSTRAINT "payroll_runs_period" CHECK ("periodEnd" >= "periodStart" AND "attendanceEnd" >= "attendanceStart"),
  ADD CONSTRAINT "payroll_runs_status_info" CHECK (
    ("status" NOT IN ('PENDING_APPROVAL', 'APPROVED', 'ISSUED') OR "calculatedAt" IS NOT NULL)
    AND ("status" NOT IN ('APPROVED', 'ISSUED') OR ("approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL))
    AND ("status" <> 'ISSUED' OR ("issuedAt" IS NOT NULL AND "issuedById" IS NOT NULL AND "issueDate" IS NOT NULL))
    AND ("status" <> 'CANCELLED' OR ("cancelledAt" IS NOT NULL AND "cancelReason" IS NOT NULL AND length(btrim("cancelReason")) > 0))
  );

ALTER TABLE "payroll_items"
  ADD CONSTRAINT "payroll_items_amounts" CHECK (
    "baseSalary" >= 0 AND "totalEarnings" >= 0 AND "totalDeductions" >= 0
    AND "netPay" = "totalEarnings" - "totalDeductions"
  );

ALTER TABLE "payroll_item_lines"
  ADD CONSTRAINT "payroll_item_lines_amount" CHECK ("amount" >= 0 AND "amount" <= 100000000000),
  ADD CONSTRAINT "payroll_item_lines_adjustment_reason" CHECK (
    "source" <> 'ADJUSTMENT' OR ("reason" IS NOT NULL AND length(btrim("reason")) > 0)
  );

ALTER TABLE "payslips"
  ADD CONSTRAINT "payslips_void_info" CHECK (
    "status" <> 'VOIDED' OR ("voidedAt" IS NOT NULL AND "voidReason" IS NOT NULL AND length(btrim("voidReason")) > 0)
  );

ALTER TABLE "company_settings"
  ADD CONSTRAINT "company_settings_singleton" CHECK ("id" = 1),
  ADD CONSTRAINT "company_settings_values" CHECK (
    "locationRadiusMeters" BETWEEN 10 AND 100000
    AND "locationMaxAccuracyMeters" BETWEEN 5 AND 5000
    AND "requestBackdateDays" BETWEEN 0 AND 365
    AND "annualLeaveQuota" BETWEEN 0 AND 366
    AND "lateDeductionAmount" >= 0 AND "absenceDeductionAmount" >= 0 AND "overtimeRatePerHour" >= 0
    AND ("absenceSalaryDivisor" IS NULL OR "absenceSalaryDivisor" BETWEEN 1 AND 31)
    AND "overtimeMinMinutes" >= 0 AND "overtimeMaxMinutesPerDay" >= 0
    AND ("locationEnabled" = false OR ("locationLat" IS NOT NULL AND "locationLng" IS NOT NULL))
    AND ("locationLat" IS NULL OR "locationLat" BETWEEN -90 AND 90)
    AND ("locationLng" IS NULL OR "locationLng" BETWEEN -180 AND 180)
  );

-- ─────────────────────────── Append-only: audit_logs, attendance_corrections, leave_balance_entries ───────────────────────────

CREATE FUNCTION trg_forbid_update_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'HRIS-GUARD: % bersifat append-only; % dilarang (buat catatan koreksi baru)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION trg_forbid_update_delete();
CREATE TRIGGER attendance_corrections_append_only BEFORE UPDATE OR DELETE ON "attendance_corrections"
  FOR EACH ROW EXECUTE FUNCTION trg_forbid_update_delete();
CREATE TRIGGER leave_balance_entries_append_only BEFORE UPDATE OR DELETE ON "leave_balance_entries"
  FOR EACH ROW EXECUTE FUNCTION trg_forbid_update_delete();

-- ─────────────────────────── Pengajuan: setelah diputuskan, tidak boleh diubah (kecuali batal) ───────────────────────────

CREATE FUNCTION trg_leave_requests_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Pengajuan tidak boleh dihapus (batalkan dengan alasan)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'PENDING' THEN
    RETURN NEW; -- boleh menjadi APPROVED / REJECTED / CANCELLED
  END IF;
  -- Sudah diputuskan: isi pengajuan beku.
  IF NEW."employeeId" <> OLD."employeeId" OR NEW."type" <> OLD."type" OR NEW."startDate" <> OLD."startDate"
     OR NEW."endDate" <> OLD."endDate" OR NEW."reason" <> OLD."reason" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Isi pengajuan yang sudah diputuskan tidak dapat diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'APPROVED' AND NEW."status" IN ('APPROVED', 'CANCELLED') THEN
    RETURN NEW; -- persetujuan boleh dibatalkan dengan alasan
  END IF;
  IF NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Perubahan status pengajuan % → % tidak diizinkan', OLD."status", NEW."status" USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leave_requests_guard BEFORE UPDATE OR DELETE ON "leave_requests"
  FOR EACH ROW EXECUTE FUNCTION trg_leave_requests_guard();

-- ─────────────────────────── Penggajian: alur status & kunci ───────────────────────────

CREATE FUNCTION trg_payroll_runs_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Periode penggajian tidak boleh dihapus (batalkan dengan alasan)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" <> OLD."status" THEN
    IF NOT (
      (OLD."status" = 'DRAFT' AND NEW."status" IN ('PENDING_APPROVAL', 'CANCELLED'))
      OR (OLD."status" = 'PENDING_APPROVAL' AND NEW."status" IN ('DRAFT', 'APPROVED', 'CANCELLED'))
      OR (OLD."status" = 'APPROVED' AND NEW."status" IN ('DRAFT', 'ISSUED', 'CANCELLED'))
      OR (OLD."status" = 'ISSUED' AND NEW."status" = 'CANCELLED')
    ) THEN
      RAISE EXCEPTION 'HRIS-GUARD: Perubahan status penggajian % → % tidak diizinkan', OLD."status", NEW."status" USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  -- Di luar DRAFT, definisi periode & aturan yang dipakai tidak boleh berubah.
  IF OLD."status" <> 'DRAFT' AND (
       NEW."periodStart" <> OLD."periodStart" OR NEW."periodEnd" <> OLD."periodEnd"
       OR NEW."attendanceStart" <> OLD."attendanceStart" OR NEW."attendanceEnd" <> OLD."attendanceEnd"
       OR NEW."rulesSnapshot" IS DISTINCT FROM OLD."rulesSnapshot" OR NEW."label" <> OLD."label"
     ) THEN
    RAISE EXCEPTION 'HRIS-GUARD: Periode dan aturan penggajian terkunci setelah diajukan' USING ERRCODE = 'restrict_violation';
  END IF;
  -- Data penerbitan terkunci setelah terbit.
  IF OLD."status" = 'ISSUED' AND (
       NEW."issuedAt" IS DISTINCT FROM OLD."issuedAt" OR NEW."issueDate" IS DISTINCT FROM OLD."issueDate"
       OR NEW."issuedById" IS DISTINCT FROM OLD."issuedById" OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
       OR NEW."approvedById" IS DISTINCT FROM OLD."approvedById"
     ) THEN
    RAISE EXCEPTION 'HRIS-GUARD: Data penerbitan terkunci' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payroll_runs_guard BEFORE UPDATE OR DELETE ON "payroll_runs"
  FOR EACH ROW EXECUTE FUNCTION trg_payroll_runs_guard();

-- Item & rincian hanya dapat berubah saat periode berstatus DRAFT.
CREATE FUNCTION trg_payroll_items_guard() RETURNS trigger AS $$
DECLARE
  run_id uuid;
  run_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN run_id := OLD."runId"; ELSE run_id := NEW."runId"; END IF;
  SELECT "status"::text INTO run_status FROM "payroll_runs" WHERE "id" = run_id;
  IF run_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Rincian penggajian hanya dapat diubah saat berstatus Draf (status saat ini: %)', run_status
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payroll_items_guard BEFORE INSERT OR UPDATE OR DELETE ON "payroll_items"
  FOR EACH ROW EXECUTE FUNCTION trg_payroll_items_guard();

CREATE FUNCTION trg_payroll_lines_guard() RETURNS trigger AS $$
DECLARE
  item_id uuid;
  run_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN item_id := OLD."itemId"; ELSE item_id := NEW."itemId"; END IF;
  SELECT r."status"::text INTO run_status
    FROM "payroll_items" i JOIN "payroll_runs" r ON r."id" = i."runId" WHERE i."id" = item_id;
  -- Item sedang dihapus bersama induknya (run_status NULL) → izinkan hanya bila memang DELETE dari item DRAFT.
  IF run_status IS DISTINCT FROM 'DRAFT' AND NOT (TG_OP = 'DELETE' AND run_status IS NULL) THEN
    RAISE EXCEPTION 'HRIS-GUARD: Rincian penggajian hanya dapat diubah saat berstatus Draf (status saat ini: %)', run_status
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payroll_item_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON "payroll_item_lines"
  FOR EACH ROW EXECUTE FUNCTION trg_payroll_lines_guard();

-- ─────────────────────────── Slip terbit: snapshot tak berubah ───────────────────────────

CREATE FUNCTION trg_payslips_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Slip gaji tidak boleh dihapus (batalkan penerbitan dengan alasan)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'VOIDED' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Slip yang sudah dibatalkan tidak dapat diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."runId" <> OLD."runId" OR NEW."itemId" <> OLD."itemId" OR NEW."employeeId" <> OLD."employeeId"
     OR NEW."number" <> OLD."number" OR NEW."issueDate" <> OLD."issueDate" OR NEW."issuedAt" <> OLD."issuedAt"
     OR NEW."netPay" <> OLD."netPay" OR NEW."snapshot" IS DISTINCT FROM OLD."snapshot" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Isi slip gaji yang sudah terbit tidak dapat diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payslips_guard BEFORE UPDATE OR DELETE ON "payslips"
  FOR EACH ROW EXECUTE FUNCTION trg_payslips_guard();
