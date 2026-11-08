-- CreateEnum
CREATE TYPE "AssetCategory" AS ENUM ('LAPTOP', 'PHONE', 'ACCESS_CARD', 'KEY', 'UNIFORM', 'VEHICLE', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'LOST', 'RETIRED');

-- CreateEnum
CREATE TYPE "AssetCondition" AS ENUM ('GOOD', 'DAMAGED', 'LOST');

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "AssetCategory" NOT NULL,
    "serialNo" TEXT,
    "note" TEXT,
    "status" "AssetStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdById" UUID NOT NULL,
    "retiredAt" TIMESTAMP(3),
    "retiredById" UUID,
    "retireReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_assignments" (
    "id" UUID NOT NULL,
    "assetId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "assignedOn" DATE NOT NULL,
    "assignedById" UUID NOT NULL,
    "note" TEXT,
    "returnedOn" DATE,
    "returnedById" UUID,
    "returnCondition" "AssetCondition",
    "returnNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assets_code_key" ON "assets"("code");

-- CreateIndex
CREATE INDEX "assets_status_category_idx" ON "assets"("status", "category");

-- CreateIndex
CREATE INDEX "asset_assignments_employeeId_returnedOn_idx" ON "asset_assignments"("employeeId", "returnedOn");

-- CreateIndex
CREATE INDEX "asset_assignments_assetId_assignedOn_idx" ON "asset_assignments"("assetId", "assignedOn");

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- ─────────────────────────── Aturan & pengaman (aditif) ───────────────────────────
-- Kode aset urut "AST-0001" dari sequence (atomik; tidak bentrok saat dua orang mendaftar bersamaan).
CREATE SEQUENCE "asset_code_seq" START 1;

ALTER TABLE "assets" ADD CONSTRAINT "assets_values" CHECK (
  length(btrim("name")) > 0
  AND ("status" <> 'RETIRED' OR ("retiredAt" IS NOT NULL AND "retiredById" IS NOT NULL AND "retireReason" IS NOT NULL AND length(btrim("retireReason")) > 0))
  AND ("status" = 'RETIRED' OR ("retiredAt" IS NULL AND "retiredById" IS NULL AND "retireReason" IS NULL))
);

-- Satu penugasan AKTIF (belum dikembalikan) per aset: tidak bisa dipinjamkan ganda.
CREATE UNIQUE INDEX "asset_assignments_one_active" ON "asset_assignments"("assetId") WHERE "returnedOn" IS NULL;

-- Pengembalian mencatat siapa, kapan, dan kondisinya (semua atau tidak sama sekali); rusak/hilang wajib beralasan; tidak mundur sebelum serah-terima.
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_return_state" CHECK (
  ("returnedOn" IS NULL AND "returnedById" IS NULL AND "returnCondition" IS NULL AND "returnNote" IS NULL)
  OR ("returnedOn" IS NOT NULL AND "returnedById" IS NOT NULL AND "returnCondition" IS NOT NULL AND "returnedOn" >= "assignedOn")
);
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_return_note" CHECK (
  "returnCondition" IS NULL OR "returnCondition" = 'GOOD' OR ("returnNote" IS NOT NULL AND length(btrim("returnNote")) > 0)
);

-- Aset tidak dihapus; kode tidak berubah; yang sudah RETIRED terkunci.
CREATE FUNCTION trg_assets_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Aset tidak boleh dihapus (nonaktifkan dengan alasan)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'RETIRED' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Aset yang sudah dinonaktifkan terkunci' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."code" <> OLD."code" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Kode aset tidak dapat diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER assets_guard BEFORE UPDATE OR DELETE ON "assets"
  FOR EACH ROW EXECUTE FUNCTION trg_assets_guard();

-- Serah-terima: tidak dihapus; hanya boleh diubah SEKALI untuk mengisi pengembalian; setelah itu terkunci. Data serah-terima tidak berubah.
CREATE FUNCTION trg_asset_assignments_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Riwayat serah-terima aset tidak boleh dihapus' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."returnedOn" IS NOT NULL THEN
    RAISE EXCEPTION 'HRIS-GUARD: Serah-terima yang sudah dikembalikan terkunci' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."assetId" <> OLD."assetId" OR NEW."employeeId" <> OLD."employeeId" OR NEW."assignedOn" <> OLD."assignedOn" OR NEW."assignedById" <> OLD."assignedById" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Data serah-terima aset tidak dapat diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER asset_assignments_guard BEFORE UPDATE OR DELETE ON "asset_assignments"
  FOR EACH ROW EXECUTE FUNCTION trg_asset_assignments_guard();
