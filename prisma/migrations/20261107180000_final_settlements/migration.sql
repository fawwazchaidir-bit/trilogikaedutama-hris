-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SettlementBasis" AS ENUM ('WORKING_DAYS', 'CALENDAR_DAYS');

-- CreateEnum
CREATE TYPE "SettlementLineCategory" AS ENUM ('PRORATED_SALARY', 'LEAVE_PAYOUT', 'UNPAID_ALLOWANCE', 'SEVERANCE', 'SERVICE_AWARD', 'ENTITLEMENT', 'THR', 'OTHER_EARNING', 'TAX', 'BPJS', 'LOAN', 'ASSET', 'OTHER_DEDUCTION');

-- CreateEnum
CREATE TYPE "SettlementLineSource" AS ENUM ('SYSTEM', 'MANUAL');

-- CreateTable
CREATE TABLE "final_settlements" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'DRAFT',
    "lastWorkDate" DATE NOT NULL,
    "basis" "SettlementBasis" NOT NULL DEFAULT 'WORKING_DAYS',
    "leaveDivisor" INTEGER,
    "note" TEXT,
    "totalEarnings" BIGINT NOT NULL DEFAULT 0,
    "totalDeductions" BIGINT NOT NULL DEFAULT 0,
    "netPayable" BIGINT NOT NULL DEFAULT 0,
    "preparedById" UUID NOT NULL,
    "submittedById" UUID,
    "submittedAt" TIMESTAMP(3),
    "returnedNote" TEXT,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "approvalNote" TEXT,
    "paidById" UUID,
    "paidAt" TIMESTAMP(3),
    "paidOn" DATE,
    "payReference" TEXT,
    "cancelledById" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "final_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "final_settlement_lines" (
    "id" UUID NOT NULL,
    "settlementId" UUID NOT NULL,
    "kind" "ComponentKind" NOT NULL,
    "category" "SettlementLineCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "amount" BIGINT NOT NULL,
    "formula" TEXT,
    "source" "SettlementLineSource" NOT NULL DEFAULT 'MANUAL',
    "note" TEXT,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "final_settlement_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "final_settlements_employeeId_status_idx" ON "final_settlements"("employeeId", "status");

-- CreateIndex
CREATE INDEX "final_settlements_status_createdAt_idx" ON "final_settlements"("status", "createdAt");

-- CreateIndex
CREATE INDEX "final_settlement_lines_settlementId_sortOrder_idx" ON "final_settlement_lines"("settlementId", "sortOrder");

-- AddForeignKey
ALTER TABLE "final_settlements" ADD CONSTRAINT "final_settlements_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_settlement_lines" ADD CONSTRAINT "final_settlement_lines_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "final_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ─────────────────────────── Aturan & pengaman (aditif) ───────────────────────────
-- Satu penyelesaian akhir yang masih berlaku (bukan batal) per karyawan; yang dibatalkan tidak menghalangi yang baru.
CREATE UNIQUE INDEX "final_settlements_one_live" ON "final_settlements"("employeeId") WHERE "status" <> 'CANCELLED';

-- Nominal baris selalu positif; kelompok baris sesuai jenisnya (pendapatan vs potongan).
ALTER TABLE "final_settlement_lines" ADD CONSTRAINT "final_settlement_lines_values" CHECK (
  "amount" > 0 AND length(btrim("name")) > 0
  AND (
    ("kind" = 'EARNING' AND "category" IN ('PRORATED_SALARY', 'LEAVE_PAYOUT', 'UNPAID_ALLOWANCE', 'SEVERANCE', 'SERVICE_AWARD', 'ENTITLEMENT', 'THR', 'OTHER_EARNING'))
    OR ("kind" = 'DEDUCTION' AND "category" IN ('TAX', 'BPJS', 'LOAN', 'ASSET', 'OTHER_DEDUCTION'))
  )
);

-- Total konsisten; yang sudah diajukan tidak boleh bersih negatif; pembagi uang cuti masuk akal.
ALTER TABLE "final_settlements" ADD CONSTRAINT "final_settlements_totals" CHECK (
  "totalEarnings" >= 0 AND "totalDeductions" >= 0 AND "netPayable" = "totalEarnings" - "totalDeductions"
  AND ("status" IN ('DRAFT', 'CANCELLED') OR "netPayable" >= 0)
  AND ("leaveDivisor" IS NULL OR "leaveDivisor" BETWEEN 1 AND 31)
);

-- Status ⇔ jejak siapa & kapan (hanya yang relevan terisi). DIBATALKAN wajib beralasan; DIBAYAR wajib bertanggal.
ALTER TABLE "final_settlements" ADD CONSTRAINT "final_settlements_state" CHECK (
  ("status" = 'DRAFT' AND "submittedAt" IS NULL AND "approvedAt" IS NULL AND "paidAt" IS NULL AND "cancelledAt" IS NULL)
  OR ("status" = 'PENDING_APPROVAL' AND "submittedAt" IS NOT NULL AND "submittedById" IS NOT NULL AND "approvedAt" IS NULL AND "paidAt" IS NULL AND "cancelledAt" IS NULL)
  OR ("status" = 'APPROVED' AND "submittedAt" IS NOT NULL AND "approvedAt" IS NOT NULL AND "approvedById" IS NOT NULL AND "paidAt" IS NULL AND "cancelledAt" IS NULL)
  OR ("status" = 'PAID' AND "approvedAt" IS NOT NULL AND "paidAt" IS NOT NULL AND "paidById" IS NOT NULL AND "paidOn" IS NOT NULL AND "cancelledAt" IS NULL)
  OR ("status" = 'CANCELLED' AND "cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL AND "cancelReason" IS NOT NULL AND length(btrim("cancelReason")) > 0)
);

-- Penyelesaian tidak dihapus; karyawannya tidak berganti; DIBAYAR/DIBATALKAN terkunci; alur status hanya yang sah;
-- selain DRAFT, isi (tanggal, dasar, total) tidak boleh berubah diam-diam (mengubahnya = kembalikan ke DRAFT dulu).
CREATE FUNCTION trg_final_settlements_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Penyelesaian akhir tidak boleh dihapus (batalkan dengan alasan)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."employeeId" <> OLD."employeeId" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Karyawan pada penyelesaian akhir tidak dapat diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" IN ('PAID', 'CANCELLED') THEN
    RAISE EXCEPTION 'HRIS-GUARD: Penyelesaian akhir yang sudah dibayar/dibatalkan terkunci' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
       (OLD."status" = 'DRAFT' AND NEW."status" IN ('PENDING_APPROVAL', 'CANCELLED'))
    OR (OLD."status" = 'PENDING_APPROVAL' AND NEW."status" IN ('DRAFT', 'APPROVED', 'CANCELLED'))
    OR (OLD."status" = 'APPROVED' AND NEW."status" IN ('PAID', 'CANCELLED'))
  ) THEN
    RAISE EXCEPTION 'HRIS-GUARD: Perpindahan status penyelesaian akhir % -> % tidak diizinkan', OLD."status", NEW."status" USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" IN ('PENDING_APPROVAL', 'APPROVED') AND NEW."status" IN ('PENDING_APPROVAL', 'APPROVED', 'PAID') AND (
       NEW."lastWorkDate" <> OLD."lastWorkDate" OR NEW."basis" <> OLD."basis" OR NEW."leaveDivisor" IS DISTINCT FROM OLD."leaveDivisor"
    OR NEW."totalEarnings" <> OLD."totalEarnings" OR NEW."totalDeductions" <> OLD."totalDeductions" OR NEW."netPayable" <> OLD."netPayable"
  ) THEN
    RAISE EXCEPTION 'HRIS-GUARD: Isi penyelesaian akhir yang sudah diajukan tidak dapat diubah (kembalikan ke Draf lebih dulu)' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER final_settlements_guard BEFORE UPDATE OR DELETE ON "final_settlements"
  FOR EACH ROW EXECUTE FUNCTION trg_final_settlements_guard();

-- Baris hanya ditambah/diubah/dihapus saat induknya DRAFT; setelah diajukan terkunci.
CREATE FUNCTION trg_final_settlement_lines_guard() RETURNS trigger AS $$
DECLARE st "SettlementStatus"; sid uuid;
BEGIN
  sid := CASE WHEN TG_OP = 'DELETE' THEN OLD."settlementId" ELSE NEW."settlementId" END;
  IF TG_OP = 'UPDATE' AND NEW."settlementId" <> OLD."settlementId" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Baris penyelesaian akhir tidak dapat dipindahkan' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT "status" INTO st FROM "final_settlements" WHERE "id" = sid;
  IF st IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Baris penyelesaian akhir hanya dapat diubah saat berstatus Draf' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER final_settlement_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON "final_settlement_lines"
  FOR EACH ROW EXECUTE FUNCTION trg_final_settlement_lines_guard();
