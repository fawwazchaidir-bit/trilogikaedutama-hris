-- CreateEnum
CREATE TYPE "ReviewCapacity" AS ENUM ('SUPERVISOR', 'DELEGATE', 'ESCALATION', 'HR');

-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "positionEffectiveFrom" DATE,
ADD COLUMN     "supervisorId" UUID;

-- AlterTable
ALTER TABLE "leave_requests" ADD COLUMN     "reviewedAs" "ReviewCapacity";

-- AlterTable
ALTER TABLE "overtime_requests" ADD COLUMN     "reviewedAs" "ReviewCapacity";

-- CreateTable
CREATE TABLE "employee_org_history" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "divisionId" UUID,
    "divisionName" TEXT,
    "position" TEXT NOT NULL,
    "employmentStatus" "EmploymentStatus" NOT NULL,
    "supervisorId" UUID,
    "supervisorName" TEXT,
    "changes" TEXT[],
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_org_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supervisor_delegations" (
    "id" UUID NOT NULL,
    "supervisorId" UUID NOT NULL,
    "delegateId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "reason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,

    CONSTRAINT "supervisor_delegations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_org_history_employeeId_effectiveFrom_createdAt_idx" ON "employee_org_history"("employeeId", "effectiveFrom", "createdAt");

-- CreateIndex
CREATE INDEX "supervisor_delegations_supervisorId_startDate_endDate_idx" ON "supervisor_delegations"("supervisorId", "startDate", "endDate");

-- CreateIndex
CREATE INDEX "supervisor_delegations_delegateId_idx" ON "supervisor_delegations"("delegateId");

-- AddForeignKey
ALTER TABLE "employee_org_history" ADD CONSTRAINT "employee_org_history_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supervisor_delegations" ADD CONSTRAINT "supervisor_delegations_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supervisor_delegations" ADD CONSTRAINT "supervisor_delegations_delegateId_fkey" FOREIGN KEY ("delegateId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_supervisorId_fkey" FOREIGN KEY ("supervisorId") REFERENCES "employees"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─────────────────────────── Aturan & pengaman (aditif) ───────────────────────────
-- Struktur atasan langsung (kepegawaian; BUKAN PIC proyek Training). Kolom baru nullable: data lama tidak berubah dan alur
-- pengajuan karyawan tanpa atasan tetap seperti semula (diproses HR/Super Admin).
ALTER TABLE "employees" ADD CONSTRAINT "employees_supervisor_not_self" CHECK ("supervisorId" IS NULL OR "supervisorId" <> "id");
CREATE INDEX "employees_supervisorId_idx" ON "employees"("supervisorId");

-- Lapisan kedua melawan rantai atasan melingkar (lapisan pertama: validasi di service). Menelusuri ke atas dari atasan baru; bila bertemu
-- karyawan itu sendiri → ditolak. Batas 50 tingkat sebagai pengaman.
CREATE FUNCTION trg_employees_supervisor_cycle() RETURNS trigger AS $$
BEGIN
  IF NEW."supervisorId" IS NULL THEN RETURN NEW; END IF;
  IF EXISTS (
    WITH RECURSIVE up(id, depth) AS (
      SELECT NEW."supervisorId", 1
      UNION ALL
      SELECT e."supervisorId", up.depth + 1 FROM employees e JOIN up ON e.id = up.id WHERE e."supervisorId" IS NOT NULL AND up.depth < 50
    )
    SELECT 1 FROM up WHERE id = NEW."id"
  ) THEN
    RAISE EXCEPTION 'HRIS-GUARD: Atasan langsung tidak boleh membentuk rantai melingkar' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER employees_supervisor_cycle BEFORE INSERT OR UPDATE OF "supervisorId" ON "employees"
  FOR EACH ROW EXECUTE FUNCTION trg_employees_supervisor_cycle();

-- Riwayat jabatan: hanya tambah.
ALTER TABLE "employee_org_history" ADD CONSTRAINT "employee_org_history_values" CHECK (length(btrim("position")) > 0 AND cardinality("changes") > 0);
CREATE FUNCTION trg_employee_org_history_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'HRIS-GUARD: Riwayat jabatan bersifat tambah-saja (tidak dapat diubah atau dihapus)' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER employee_org_history_append_only BEFORE UPDATE OR DELETE ON "employee_org_history"
  FOR EACH ROW EXECUTE FUNCTION trg_employee_org_history_append_only();

-- Pengganti peninjau: rentang tanggal valid, bukan diri sendiri; tidak dihapus, hanya dibatalkan (satu kali, tanpa mengubah isi lain).
ALTER TABLE "supervisor_delegations" ADD CONSTRAINT "supervisor_delegations_values" CHECK (
  "startDate" <= "endDate" AND "supervisorId" <> "delegateId" AND (("cancelledAt" IS NULL) = ("cancelledById" IS NULL))
);
CREATE FUNCTION trg_supervisor_delegations_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Penunjukan pengganti tidak boleh dihapus (batalkan saja)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."cancelledAt" IS NOT NULL THEN
    RAISE EXCEPTION 'HRIS-GUARD: Penunjukan pengganti yang sudah dibatalkan tidak dapat diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."supervisorId" <> OLD."supervisorId" OR NEW."delegateId" <> OLD."delegateId" OR NEW."startDate" <> OLD."startDate"
     OR NEW."endDate" <> OLD."endDate" OR NEW."reason" IS DISTINCT FROM OLD."reason" OR NEW."createdById" <> OLD."createdById" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Isi penunjukan pengganti tidak dapat diubah (batalkan lalu buat baru)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER supervisor_delegations_guard BEFORE UPDATE OR DELETE ON "supervisor_delegations"
  FOR EACH ROW EXECUTE FUNCTION trg_supervisor_delegations_guard();
