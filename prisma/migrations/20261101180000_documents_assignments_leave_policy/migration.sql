-- Tiga fitur baru (diminta pimpinan):
--  1. Kebijakan cuti PER KARYAWAN (kolom pada employees + masa kerja minimum bawaan pada company_settings).
--  2. Dokumen kepegawaian (kontrak kerja PDF bermaterai) + keputusan lanjut/tidak oleh pimpinan + pengingat H-3 bulan.
--  3. Surat Tugas + Bukti Penerimaan Uang Harian (berdiri sendiri, di luar slip gaji).
-- Bagian akhir berkas ini (setelah SQL yang dihasilkan Prisma) memuat constraint, indeks parsial, trigger integritas, dan pemeliharaan data lama.

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('CONTRACT', 'OTHER');

-- CreateEnum
CREATE TYPE "RenewalDecision" AS ENUM ('PENDING', 'CONTINUE', 'DISCONTINUE');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AllowanceMethod" AS ENUM ('CASH', 'TRANSFER');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('ACTIVE', 'VOIDED');

-- AlterEnum
ALTER TYPE "FileKind" ADD VALUE 'DOCUMENT';

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "leaveMinTenureMonths" INTEGER NOT NULL DEFAULT 12;

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "leaveAllowNegative" BOOLEAN,
ADD COLUMN     "leaveEligibleFrom" DATE,
ADD COLUMN     "leavePolicyNote" TEXT,
ADD COLUMN     "leaveQuotaDays" INTEGER;

-- CreateTable
CREATE TABLE "employee_documents" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "documentNo" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "fileId" UUID NOT NULL,
    "note" TEXT,
    "renewalDecision" "RenewalDecision" NOT NULL DEFAULT 'PENDING',
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "remindersSent" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "renewsDocumentId" UUID,
    "archivedAt" TIMESTAMP(3),
    "archivedById" UUID,
    "archiveReason" TEXT,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_letters" (
    "id" UUID NOT NULL,
    "seqYear" INTEGER NOT NULL,
    "seqNo" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'ISSUED',
    "purpose" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "details" TEXT,
    "issueDate" DATE NOT NULL,
    "snapshot" JSONB NOT NULL,
    "issuedById" UUID NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assignment_letters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assignment_assignees" (
    "id" UUID NOT NULL,
    "letterId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "days" INTEGER NOT NULL,
    "dailyRate" BIGINT NOT NULL,
    "total" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assignment_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_allowance_receipts" (
    "id" UUID NOT NULL,
    "seqYear" INTEGER NOT NULL,
    "seqNo" INTEGER NOT NULL,
    "number" TEXT NOT NULL,
    "letterId" UUID NOT NULL,
    "assigneeId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'ACTIVE',
    "days" INTEGER NOT NULL,
    "dailyRate" BIGINT NOT NULL,
    "total" BIGINT NOT NULL,
    "paidDate" DATE NOT NULL,
    "method" "AllowanceMethod" NOT NULL,
    "note" TEXT,
    "snapshot" JSONB NOT NULL,
    "issuedById" UUID NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" UUID,
    "voidReason" TEXT,

    CONSTRAINT "daily_allowance_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_documents_employeeId_kind_idx" ON "employee_documents"("employeeId", "kind");

-- CreateIndex
CREATE INDEX "employee_documents_kind_endDate_idx" ON "employee_documents"("kind", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_letters_number_key" ON "assignment_letters"("number");

-- CreateIndex
CREATE INDEX "assignment_letters_status_startDate_idx" ON "assignment_letters"("status", "startDate");

-- CreateIndex
CREATE INDEX "assignment_letters_issueDate_idx" ON "assignment_letters"("issueDate");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_letters_seqYear_seqNo_key" ON "assignment_letters"("seqYear", "seqNo");

-- CreateIndex
CREATE INDEX "assignment_assignees_employeeId_idx" ON "assignment_assignees"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "assignment_assignees_letterId_employeeId_key" ON "assignment_assignees"("letterId", "employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_allowance_receipts_number_key" ON "daily_allowance_receipts"("number");

-- CreateIndex
CREATE INDEX "daily_allowance_receipts_employeeId_paidDate_idx" ON "daily_allowance_receipts"("employeeId", "paidDate");

-- CreateIndex
CREATE INDEX "daily_allowance_receipts_letterId_idx" ON "daily_allowance_receipts"("letterId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_allowance_receipts_seqYear_seqNo_key" ON "daily_allowance_receipts"("seqYear", "seqNo");

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_documents" ADD CONSTRAINT "employee_documents_renewsDocumentId_fkey" FOREIGN KEY ("renewsDocumentId") REFERENCES "employee_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_assignees" ADD CONSTRAINT "assignment_assignees_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "assignment_letters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assignment_assignees" ADD CONSTRAINT "assignment_assignees_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_allowance_receipts" ADD CONSTRAINT "daily_allowance_receipts_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "assignment_letters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_allowance_receipts" ADD CONSTRAINT "daily_allowance_receipts_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "assignment_assignees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_allowance_receipts" ADD CONSTRAINT "daily_allowance_receipts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═════════════════════════════ Constraint, indeks parsial, trigger (tulisan tangan) ═════════════════════════════

-- Kebijakan cuti per karyawan
ALTER TABLE "company_settings"
  ADD CONSTRAINT "company_settings_leave_tenure" CHECK ("leaveMinTenureMonths" BETWEEN 0 AND 120);

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_leave_quota_range" CHECK ("leaveQuotaDays" IS NULL OR "leaveQuotaDays" BETWEEN 0 AND 366),
  ADD CONSTRAINT "employees_leave_policy_note" CHECK (
    ("leaveQuotaDays" IS NULL AND "leaveEligibleFrom" IS NULL AND "leaveAllowNegative" IS NULL)
    OR ("leavePolicyNote" IS NOT NULL AND length(btrim("leavePolicyNote")) > 0)
  );

-- Pertahankan hak yang sudah ada: karyawan yang SUDAH punya saldo awal cuti sebelum kebijakan per karyawan berlaku tidak tiba-tiba
-- "belum berhak" hanya karena masa kerjanya < masa kerja minimum bawaan. HR/pimpinan dapat meninjau & mengubahnya per karyawan.
UPDATE "employees" e
   SET "leaveEligibleFrom" = e."joinDate",
       "leavePolicyNote"   = 'Dipertahankan dari kebijakan sebelumnya: sudah memiliki saldo awal cuti sebelum kebijakan per karyawan diberlakukan. Mohon ditinjau.'
 WHERE EXISTS (SELECT 1 FROM "leave_balance_entries" b WHERE b."employeeId" = e."id" AND b."kind" = 'GRANT');

-- Dokumen kepegawaian
ALTER TABLE "employee_documents"
  ADD CONSTRAINT "employee_documents_contract_start" CHECK ("kind" <> 'CONTRACT' OR "startDate" IS NOT NULL),
  ADD CONSTRAINT "employee_documents_dates" CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "endDate" >= "startDate"),
  ADD CONSTRAINT "employee_documents_title" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "employee_documents_decision" CHECK (
    "renewalDecision" = 'PENDING' OR ("kind" = 'CONTRACT' AND "decidedById" IS NOT NULL AND "decidedAt" IS NOT NULL)
  ),
  ADD CONSTRAINT "employee_documents_archive" CHECK (
    "archivedAt" IS NULL OR ("archivedById" IS NOT NULL AND "archiveReason" IS NOT NULL AND length(btrim("archiveReason")) > 0)
  );

CREATE FUNCTION trg_employee_documents_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Dokumen kepegawaian tidak boleh dihapus (arsipkan dengan alasan)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."employeeId" <> OLD."employeeId" OR NEW."kind" <> OLD."kind" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Karyawan dan jenis dokumen tidak dapat diubah (arsipkan lalu unggah ulang)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."archivedAt" IS NOT NULL AND (NEW."archivedAt" IS NULL OR NEW."fileId" <> OLD."fileId" OR NEW."endDate" IS DISTINCT FROM OLD."endDate") THEN
    RAISE EXCEPTION 'HRIS-GUARD: Dokumen yang sudah diarsipkan tidak dapat diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER employee_documents_guard BEFORE UPDATE OR DELETE ON "employee_documents"
  FOR EACH ROW EXECUTE FUNCTION trg_employee_documents_guard();

-- Surat Tugas
ALTER TABLE "assignment_letters"
  ADD CONSTRAINT "assignment_letters_dates" CHECK ("endDate" >= "startDate"),
  ADD CONSTRAINT "assignment_letters_text" CHECK (length(btrim("purpose")) > 0 AND length(btrim("destination")) > 0),
  ADD CONSTRAINT "assignment_letters_cancel_info" CHECK (
    "status" <> 'CANCELLED' OR ("cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL AND "cancelReason" IS NOT NULL AND length(btrim("cancelReason")) > 0)
  );

CREATE FUNCTION trg_assignment_letters_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Surat tugas tidak boleh dihapus (batalkan dengan alasan)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'CANCELLED' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Surat tugas yang sudah dibatalkan tidak dapat diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."number" <> OLD."number" OR NEW."seqYear" <> OLD."seqYear" OR NEW."seqNo" <> OLD."seqNo"
     OR NEW."purpose" <> OLD."purpose" OR NEW."destination" <> OLD."destination"
     OR NEW."startDate" <> OLD."startDate" OR NEW."endDate" <> OLD."endDate" OR NEW."issueDate" <> OLD."issueDate"
     OR NEW."details" IS DISTINCT FROM OLD."details" OR NEW."snapshot" IS DISTINCT FROM OLD."snapshot" OR NEW."issuedAt" <> OLD."issuedAt" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Isi surat tugas yang sudah terbit tidak dapat diubah (batalkan lalu terbitkan yang baru)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assignment_letters_guard BEFORE UPDATE OR DELETE ON "assignment_letters"
  FOR EACH ROW EXECUTE FUNCTION trg_assignment_letters_guard();

-- Penerima tugas + uang harian
ALTER TABLE "assignment_assignees"
  ADD CONSTRAINT "assignment_assignees_amounts" CHECK (
    "days" BETWEEN 1 AND 366 AND "dailyRate" >= 0 AND "dailyRate" <= 100000000000 AND "total" = "days" * "dailyRate"
  );

CREATE FUNCTION trg_assignment_assignees_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'HRIS-GUARD: Penerima tugas dan uang harian pada surat tugas yang terbit tidak dapat diubah (batalkan surat tugas lalu terbitkan yang baru)' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER assignment_assignees_guard BEFORE UPDATE OR DELETE ON "assignment_assignees"
  FOR EACH ROW EXECUTE FUNCTION trg_assignment_assignees_guard();

-- Bukti Penerimaan Uang Harian
ALTER TABLE "daily_allowance_receipts"
  ADD CONSTRAINT "daily_allowance_receipts_amounts" CHECK (
    "days" BETWEEN 1 AND 366 AND "dailyRate" >= 0 AND "dailyRate" <= 100000000000 AND "total" = "days" * "dailyRate"
  ),
  ADD CONSTRAINT "daily_allowance_receipts_void_info" CHECK (
    "status" <> 'VOIDED' OR ("voidedAt" IS NOT NULL AND "voidedById" IS NOT NULL AND "voidReason" IS NOT NULL AND length(btrim("voidReason")) > 0)
  );

-- Paling banyak SATU bukti aktif per penerima tugas (bukti yang dibatalkan boleh diterbitkan ulang).
CREATE UNIQUE INDEX "daily_allowance_receipts_one_active" ON "daily_allowance_receipts" ("assigneeId") WHERE "status" = 'ACTIVE';

CREATE FUNCTION trg_daily_allowance_receipts_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Bukti penerimaan uang harian tidak boleh dihapus (batalkan dengan alasan)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'VOIDED' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Bukti penerimaan yang sudah dibatalkan tidak dapat diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."number" <> OLD."number" OR NEW."seqYear" <> OLD."seqYear" OR NEW."seqNo" <> OLD."seqNo"
     OR NEW."letterId" <> OLD."letterId" OR NEW."assigneeId" <> OLD."assigneeId" OR NEW."employeeId" <> OLD."employeeId"
     OR NEW."days" <> OLD."days" OR NEW."dailyRate" <> OLD."dailyRate" OR NEW."total" <> OLD."total"
     OR NEW."paidDate" <> OLD."paidDate" OR NEW."method" <> OLD."method" OR NEW."note" IS DISTINCT FROM OLD."note"
     OR NEW."snapshot" IS DISTINCT FROM OLD."snapshot" OR NEW."issuedAt" <> OLD."issuedAt" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Isi bukti penerimaan uang harian yang sudah terbit tidak dapat diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER daily_allowance_receipts_guard BEFORE UPDATE OR DELETE ON "daily_allowance_receipts"
  FOR EACH ROW EXECUTE FUNCTION trg_daily_allowance_receipts_guard();
