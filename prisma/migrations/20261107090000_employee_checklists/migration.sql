-- CreateEnum
CREATE TYPE "ChecklistKind" AS ENUM ('ONBOARDING', 'OFFBOARDING');

-- CreateEnum
CREATE TYPE "ChecklistStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChecklistItemStatus" AS ENUM ('TODO', 'DONE', 'NOT_APPLICABLE');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactPhone" TEXT,
ADD COLUMN     "emergencyContactRelation" TEXT;

-- CreateTable
CREATE TABLE "employee_checklists" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "kind" "ChecklistKind" NOT NULL,
    "status" "ChecklistStatus" NOT NULL DEFAULT 'OPEN',
    "targetDate" DATE,
    "note" TEXT,
    "startedById" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedById" UUID,
    "completedAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,

    CONSTRAINT "employee_checklists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_checklist_items" (
    "id" UUID NOT NULL,
    "checklistId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "groupLabel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hint" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "status" "ChecklistItemStatus" NOT NULL DEFAULT 'TODO',
    "note" TEXT,
    "doneById" UUID,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_checklists_employeeId_kind_status_idx" ON "employee_checklists"("employeeId", "kind", "status");

-- CreateIndex
CREATE INDEX "employee_checklists_status_targetDate_idx" ON "employee_checklists"("status", "targetDate");

-- CreateIndex
CREATE UNIQUE INDEX "employee_checklist_items_checklistId_key_key" ON "employee_checklist_items"("checklistId", "key");

-- AddForeignKey
ALTER TABLE "employee_checklists" ADD CONSTRAINT "employee_checklists_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_checklist_items" ADD CONSTRAINT "employee_checklist_items_checklistId_fkey" FOREIGN KEY ("checklistId") REFERENCES "employee_checklists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────────────────── Aturan & pengaman (aditif) ───────────────────────────
-- Satu proses TERBUKA per (karyawan, jenis): yang selesai/dibatalkan tidak menghalangi proses baru (mis. karyawan kembali bekerja).
CREATE UNIQUE INDEX "employee_checklists_one_open" ON "employee_checklists"("employeeId", "kind") WHERE "status" = 'OPEN';
ALTER TABLE "employee_checklists" ADD CONSTRAINT "employee_checklists_state" CHECK (
  ("status" = 'OPEN' AND "completedAt" IS NULL AND "cancelledAt" IS NULL)
  OR ("status" = 'COMPLETED' AND "completedAt" IS NOT NULL AND "completedById" IS NOT NULL AND "cancelledAt" IS NULL)
  OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL AND "cancelReason" IS NOT NULL AND length(btrim("cancelReason")) > 0)
);
-- Butir yang diputuskan wajib mencatat siapa & kapan; "Tidak berlaku" wajib beralasan.
ALTER TABLE "employee_checklist_items" ADD CONSTRAINT "employee_checklist_items_state" CHECK (
  ("status" = 'TODO' AND "doneAt" IS NULL AND "doneById" IS NULL)
  OR ("status" <> 'TODO' AND "doneAt" IS NOT NULL AND "doneById" IS NOT NULL)
);
ALTER TABLE "employee_checklist_items" ADD CONSTRAINT "employee_checklist_items_na_reason" CHECK (
  "status" <> 'NOT_APPLICABLE' OR ("note" IS NOT NULL AND length(btrim("note")) > 0)
);

-- Checklist tidak dihapus; yang sudah selesai/dibatalkan terkunci (hanya OPEN yang berubah).
CREATE FUNCTION trg_employee_checklists_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Checklist karyawan tidak boleh dihapus (batalkan dengan alasan)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" <> 'OPEN' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Checklist yang sudah selesai/dibatalkan terkunci' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."employeeId" <> OLD."employeeId" OR NEW."kind" <> OLD."kind" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Karyawan dan jenis checklist tidak dapat diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER employee_checklists_guard BEFORE UPDATE OR DELETE ON "employee_checklists"
  FOR EACH ROW EXECUTE FUNCTION trg_employee_checklists_guard();

-- Butir: tidak dihapus; tidak ditambah/diubah setelah checklist tidak lagi terbuka.
CREATE FUNCTION trg_employee_checklist_items_guard() RETURNS trigger AS $$
DECLARE st "ChecklistStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Butir checklist tidak boleh dihapus (tandai Tidak berlaku dengan alasan)' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT "status" INTO st FROM "employee_checklists" WHERE "id" = NEW."checklistId";
  IF st <> 'OPEN' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Checklist sudah selesai/dibatalkan; butirnya terkunci' USING ERRCODE = 'restrict_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW."checklistId" <> OLD."checklistId" OR NEW."key" <> OLD."key") THEN
    RAISE EXCEPTION 'HRIS-GUARD: Kunci butir checklist tidak dapat diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER employee_checklist_items_guard BEFORE INSERT OR UPDATE OR DELETE ON "employee_checklist_items"
  FOR EACH ROW EXECUTE FUNCTION trg_employee_checklist_items_guard();
