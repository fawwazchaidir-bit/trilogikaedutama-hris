-- Penyelesaian akhir: satu SUMBER usulan hanya boleh menjadi SATU baris (mencegah hitungan ganda saat baris usulan dikoreksi lalu dihitung ulang),
-- dan usulan yang dihapus HR dikecualikan permanen dari penyelesaian itu.
ALTER TABLE "final_settlement_lines" ADD COLUMN "sourceKey" TEXT;

-- Penjaga di database: dalam satu penyelesaian, satu sourceKey = paling banyak satu baris (baris tanpa sourceKey — manual murni & data lama — tidak terikat).
CREATE UNIQUE INDEX "final_settlement_lines_one_per_source" ON "final_settlement_lines" ("settlementId", "sourceKey") WHERE "sourceKey" IS NOT NULL;

CREATE TABLE "final_settlement_exclusions" (
    "id" UUID NOT NULL,
    "settlementId" UUID NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "SettlementLineCategory" NOT NULL,
    "amount" BIGINT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "final_settlement_exclusions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "final_settlement_exclusions_settlementId_sourceKey_key" ON "final_settlement_exclusions"("settlementId", "sourceKey");
ALTER TABLE "final_settlement_exclusions" ADD CONSTRAINT "final_settlement_exclusions_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "final_settlements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Pengecualian hanya ditambah saat penyelesaian berstatus Draf dan tidak pernah diubah/dihapus (tambah-saja).
CREATE FUNCTION trg_final_settlement_exclusions_guard() RETURNS trigger AS $$
DECLARE st "SettlementStatus";
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Pengecualian usulan penyelesaian akhir bersifat tambah-saja (permanen)' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT "status" INTO st FROM "final_settlements" WHERE "id" = NEW."settlementId";
  IF st IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Pengecualian usulan hanya dapat ditambah saat penyelesaian akhir berstatus Draf' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER final_settlement_exclusions_guard BEFORE INSERT OR UPDATE OR DELETE ON "final_settlement_exclusions"
  FOR EACH ROW EXECUTE FUNCTION trg_final_settlement_exclusions_guard();
