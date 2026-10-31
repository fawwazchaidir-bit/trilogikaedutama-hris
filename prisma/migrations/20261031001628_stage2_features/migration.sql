-- CreateEnum
CREATE TYPE "OvertimeRateMode" AS ENUM ('FIXED_PER_HOUR', 'SALARY_DIVISOR');

-- CreateEnum
CREATE TYPE "LeaveDayPart" AS ENUM ('FULL', 'MORNING', 'AFTERNOON');

-- CreateEnum
CREATE TYPE "TaxStatus" AS ENUM ('TK0', 'TK1', 'TK2', 'TK3', 'K0', 'K1', 'K2', 'K3');

-- CreateEnum
CREATE TYPE "DeliveryChannel" AS ENUM ('EMAIL', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "PunchKind" AS ENUM ('CHECK_IN', 'CHECK_OUT');

-- CreateEnum
CREATE TYPE "LocationPolicyMode" AS ENUM ('OFF', 'FLAG', 'BLOCK');

-- CreateEnum
CREATE TYPE "LocationDecision" AS ENUM ('ACCEPTED', 'FLAGGED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "LocationReviewStatus" AS ENUM ('OPEN', 'CLEARED', 'CONFIRMED');

-- AlterEnum
ALTER TYPE "LineSource" ADD VALUE 'RULE_STATUTORY';

-- AlterEnum
ALTER TYPE "OvertimeMode" ADD VALUE 'APPROVED';

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "locationRequireOfficeNetwork" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "locationSpoofMode" "LocationPolicyMode" NOT NULL DEFAULT 'FLAG',
ADD COLUMN     "officeNetworks" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "overtimeFirstHourBp" INTEGER NOT NULL DEFAULT 10000,
ADD COLUMN     "overtimeNextHoursBp" INTEGER NOT NULL DEFAULT 10000,
ADD COLUMN     "overtimeRateMode" "OvertimeRateMode" NOT NULL DEFAULT 'FIXED_PER_HOUR',
ADD COLUMN     "overtimeRequireAttendance" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "overtimeSalaryDivisor" INTEGER NOT NULL DEFAULT 173,
ADD COLUMN     "statutoryConfig" JSONB,
ADD COLUMN     "twoFactorRequiredForAdmins" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "bpjsEmploymentEnrolled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "bpjsHealthEnrolled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "hasNpwp" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "taxStatus" "TaxStatus" NOT NULL DEFAULT 'TK0';

-- AlterTable
ALTER TABLE "leave_balance_entries" ALTER COLUMN "days" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN     "dayPart" "LeaveDayPart" NOT NULL DEFAULT 'FULL',
ALTER COLUMN "workingDays" SET DATA TYPE DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "payroll_items" ADD COLUMN     "statutory" JSONB;

-- AlterTable
ALTER TABLE "salary_components" ADD COLUMN     "inBpjsBase" BOOLEAN,
ADD COLUMN     "taxable" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notifyEmail" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyWhatsapp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "twoFactorEnabledAt" TIMESTAMP(3),
ADD COLUMN     "twoFactorLastStep" INTEGER,
ADD COLUMN     "twoFactorSecretEnc" TEXT,
ADD COLUMN     "whatsappNumber" TEXT;

-- CreateTable
CREATE TABLE "two_factor_recovery_codes" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "two_factor_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_challenges" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip" TEXT,

    CONSTRAINT "login_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestIp" TEXT,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" BIGSERIAL NOT NULL,
    "notificationId" BIGINT,
    "userId" UUID,
    "channel" "DeliveryChannel" NOT NULL,
    "toAddress" TEXT NOT NULL,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "overtime_requests" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "approvedMinutes" INTEGER,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "overtime_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_checks" (
    "id" BIGSERIAL NOT NULL,
    "employeeId" UUID NOT NULL,
    "attendanceId" UUID,
    "kind" "PunchKind" NOT NULL,
    "date" DATE NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "distance" INTEGER,
    "decision" "LocationDecision" NOT NULL,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "details" JSONB,
    "ip" TEXT,
    "deviceHash" TEXT,
    "reviewStatus" "LocationReviewStatus",
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "location_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "two_factor_recovery_codes_userId_codeHash_key" ON "two_factor_recovery_codes"("userId", "codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "login_challenges_tokenHash_key" ON "login_challenges"("tokenHash");

-- CreateIndex
CREATE INDEX "login_challenges_userId_idx" ON "login_challenges"("userId");

-- CreateIndex
CREATE INDEX "login_challenges_expiresAt_idx" ON "login_challenges"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_tokenHash_key" ON "password_reset_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_userId_idx" ON "password_reset_tokens"("userId");

-- CreateIndex
CREATE INDEX "password_reset_tokens_expiresAt_idx" ON "password_reset_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_nextAttemptAt_idx" ON "notification_deliveries"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_userId_idx" ON "notification_deliveries"("userId");

-- CreateIndex
CREATE INDEX "overtime_requests_employeeId_date_idx" ON "overtime_requests"("employeeId", "date");

-- CreateIndex
CREATE INDEX "overtime_requests_status_createdAt_idx" ON "overtime_requests"("status", "createdAt");

-- CreateIndex
CREATE INDEX "overtime_requests_date_idx" ON "overtime_requests"("date");

-- CreateIndex
CREATE INDEX "location_checks_employeeId_createdAt_idx" ON "location_checks"("employeeId", "createdAt");

-- CreateIndex
CREATE INDEX "location_checks_decision_reviewStatus_idx" ON "location_checks"("decision", "reviewStatus");

-- CreateIndex
CREATE INDEX "location_checks_createdAt_idx" ON "location_checks"("createdAt");

-- AddForeignKey
ALTER TABLE "two_factor_recovery_codes" ADD CONSTRAINT "two_factor_recovery_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_challenges" ADD CONSTRAINT "login_challenges_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "overtime_requests" ADD CONSTRAINT "overtime_requests_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_checks" ADD CONSTRAINT "location_checks_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_checks" ADD CONSTRAINT "location_checks_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "attendances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ═══════════════════════════ Penyesuaian manual (tahap 2) ═══════════════════════════

-- Data lama: magang tidak otomatis peserta BPJS. Komponen lama: "inBpjsBase" NULL = bawaan menurut kategori
-- (gaji pokok & tunjangan jabatan adalah dasar upah BPJS).
UPDATE "employees" SET "bpjsHealthEnrolled" = false, "bpjsEmploymentEnrolled" = false WHERE "employmentStatus" = 'INTERN';

-- ─────────────────────────── Jadwal: shift lintas tengah malam ───────────────────────────
-- Jam pulang < jam masuk berarti shift berakhir keesokan harinya (mis. 22:00 → 06:00). Jam pulang = jam masuk ditolak.
-- Batas "tidak hadir": jadwal biasa harus setelah jam masuk; shift malam boleh sebelum jam masuk (= dini hari esoknya).
ALTER TABLE "work_schedules" DROP CONSTRAINT "work_schedules_times";
ALTER TABLE "work_schedules" ADD CONSTRAINT "work_schedules_times" CHECK (
  "startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  AND "endTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  AND "absentCutoffTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
  AND "endTime" <> "startTime"
  AND "absentCutoffTime" <> "startTime"
  AND ("endTime" < "startTime" OR "absentCutoffTime" > "startTime")
);

-- ─────────────────────────── Pengajuan: setengah hari ───────────────────────────
ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_day_part" CHECK ("dayPart" = 'FULL' OR "startDate" = "endDate"),
  ADD CONSTRAINT "leave_requests_working_days_step" CHECK (
    "workingDays" IS NULL OR ("workingDays" >= 0 AND "workingDays" * 2 = round("workingDays" * 2))
  );
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_half_day_working_days" CHECK (
  "dayPart" = 'FULL' OR "workingDays" IS NULL OR "workingDays" = 0.5 OR "workingDays" = 0
);

ALTER TABLE "leave_balance_entries" DROP CONSTRAINT "leave_balance_entries_values";
ALTER TABLE "leave_balance_entries" ADD CONSTRAINT "leave_balance_entries_values" CHECK (
  "year" BETWEEN 2000 AND 2200 AND "days" <> 0 AND "days" * 2 = round("days" * 2)
  AND ("kind" <> 'USAGE' OR ("days" < 0 AND "requestId" IS NOT NULL))
  AND ("kind" <> 'RESTORE' OR ("days" > 0 AND "requestId" IS NOT NULL))
);

CREATE OR REPLACE FUNCTION trg_leave_requests_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Pengajuan tidak boleh dihapus (batalkan dengan alasan)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'PENDING' THEN
    RETURN NEW; -- boleh menjadi APPROVED / REJECTED / CANCELLED
  END IF;
  -- Sudah diputuskan: isi pengajuan beku.
  IF NEW."employeeId" <> OLD."employeeId" OR NEW."type" <> OLD."type" OR NEW."startDate" <> OLD."startDate"
     OR NEW."endDate" <> OLD."endDate" OR NEW."reason" <> OLD."reason" OR NEW."dayPart" <> OLD."dayPart" THEN
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

-- ─────────────────────────── Lembur ───────────────────────────
ALTER TABLE "overtime_requests"
  ADD CONSTRAINT "overtime_requests_start_time" CHECK ("startTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  ADD CONSTRAINT "overtime_requests_minutes" CHECK ("minutes" BETWEEN 15 AND 1440),
  ADD CONSTRAINT "overtime_requests_reason" CHECK (length(btrim("reason")) > 0),
  ADD CONSTRAINT "overtime_requests_approved_minutes" CHECK ("approvedMinutes" IS NULL OR ("approvedMinutes" BETWEEN 1 AND "minutes")),
  ADD CONSTRAINT "overtime_requests_review_info" CHECK (
    "status" NOT IN ('APPROVED', 'REJECTED') OR ("reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND ("status" = 'REJECTED' OR "approvedMinutes" IS NOT NULL))
  ),
  ADD CONSTRAINT "overtime_requests_cancel_info" CHECK (
    "status" <> 'CANCELLED' OR ("cancelledAt" IS NOT NULL AND "cancelReason" IS NOT NULL AND length(btrim("cancelReason")) > 0)
  );

-- Satu pengajuan lembur terbuka (menunggu/disetujui) per karyawan per tanggal — dijaga database, bukan hanya aplikasi.
CREATE UNIQUE INDEX "overtime_requests_one_open_per_day" ON "overtime_requests" ("employeeId", "date")
  WHERE "status" IN ('PENDING', 'APPROVED');

CREATE FUNCTION trg_overtime_requests_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Pengajuan lembur tidak boleh dihapus (batalkan dengan alasan)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'PENDING' THEN
    RETURN NEW;
  END IF;
  IF NEW."employeeId" <> OLD."employeeId" OR NEW."date" <> OLD."date" OR NEW."startTime" <> OLD."startTime"
     OR NEW."minutes" <> OLD."minutes" OR NEW."reason" <> OLD."reason"
     OR NEW."approvedMinutes" IS DISTINCT FROM OLD."approvedMinutes" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Isi pengajuan lembur yang sudah diputuskan tidak dapat diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'APPROVED' AND NEW."status" IN ('APPROVED', 'CANCELLED') THEN
    RETURN NEW;
  END IF;
  IF NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Perubahan status pengajuan lembur % → % tidak diizinkan', OLD."status", NEW."status" USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER overtime_requests_guard BEFORE UPDATE OR DELETE ON "overtime_requests"
  FOR EACH ROW EXECUTE FUNCTION trg_overtime_requests_guard();

-- ─────────────────────────── Pengaturan: lembur & lokasi ───────────────────────────
ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_overtime_values" CHECK (
  "overtimeSalaryDivisor" BETWEEN 1 AND 1000
  AND "overtimeFirstHourBp" BETWEEN 10000 AND 50000
  AND "overtimeNextHoursBp" BETWEEN 10000 AND 50000
);

-- ─────────────────────────── Penilaian lokasi ───────────────────────────
ALTER TABLE "location_checks"
  ADD CONSTRAINT "location_checks_risk" CHECK ("riskScore" BETWEEN 0 AND 100),
  ADD CONSTRAINT "location_checks_review" CHECK (
    ("reviewStatus" IS NULL OR "decision" IN ('FLAGGED', 'BLOCKED'))
    AND ("reviewStatus" IS NULL OR "reviewStatus" = 'OPEN' OR ("reviewedById" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewNote" IS NOT NULL AND length(btrim("reviewNote")) > 0))
  );

-- ─────────────────────────── Outbox ───────────────────────────
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_values" CHECK ("attempts" >= 0 AND length(btrim("body")) > 0 AND length(btrim("toAddress")) > 0);
