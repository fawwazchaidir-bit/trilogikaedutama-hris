-- Uang harian di penyelesaian akhir ditautkan ke PENERIMA surat tugas, sehingga satu uang harian tidak dibayar dua kali
-- (lewat penyelesaian akhir DAN lewat Bukti Penerimaan Uang Harian terpisah).
ALTER TABLE "final_settlement_lines" ADD COLUMN     "assigneeId" UUID;
CREATE INDEX "final_settlement_lines_assigneeId_idx" ON "final_settlement_lines"("assigneeId");
ALTER TABLE "final_settlement_lines" ADD CONSTRAINT "final_settlement_lines_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "assignment_assignees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Penjaga 1: Bukti Penerimaan AKTIF tidak dapat diterbitkan untuk uang harian yang sudah termasuk penyelesaian akhir yang masih berlaku (bukan Dibatalkan).
CREATE FUNCTION trg_daily_allowance_receipts_settlement_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'ACTIVE' AND EXISTS (
    SELECT 1 FROM "final_settlement_lines" l JOIN "final_settlements" s ON s."id" = l."settlementId"
    WHERE l."assigneeId" = NEW."assigneeId" AND s."status" <> 'CANCELLED'
  ) THEN
    RAISE EXCEPTION 'HRIS-GUARD: Uang harian ini sudah termasuk penyelesaian akhir yang masih berlaku; bukti penerimaan terpisah tidak dapat diterbitkan agar tidak dibayar dua kali' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER daily_allowance_receipts_settlement_guard BEFORE INSERT ON "daily_allowance_receipts"
  FOR EACH ROW EXECUTE FUNCTION trg_daily_allowance_receipts_settlement_guard();

-- Penjaga 2: baris penyelesaian akhir tidak dapat memuat uang harian yang sudah punya Bukti Penerimaan AKTIF.
CREATE FUNCTION trg_final_settlement_lines_allowance_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."assigneeId" IS NOT NULL AND EXISTS (
    SELECT 1 FROM "daily_allowance_receipts" r WHERE r."assigneeId" = NEW."assigneeId" AND r."status" = 'ACTIVE'
  ) THEN
    RAISE EXCEPTION 'HRIS-GUARD: Uang harian ini sudah memiliki Bukti Penerimaan aktif; tidak dapat dimasukkan ke penyelesaian akhir' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER final_settlement_lines_allowance_guard BEFORE INSERT ON "final_settlement_lines"
  FOR EACH ROW EXECUTE FUNCTION trg_final_settlement_lines_allowance_guard();

-- BACKFILL:START
-- Data lama: tautkan baris uang harian yang sudah ada (hanya mengisi kolom penanda baru; nominal/status tidak diubah). Penjaga "hanya Draf" dimatikan SEMENTARA
-- agar baris pada penyelesaian yang sudah diajukan/disetujui/dibayar juga ikut tertaut, lalu dinyalakan kembali di akhir.
ALTER TABLE "final_settlement_lines" DISABLE TRIGGER "final_settlement_lines_guard";

-- (a) baris yang sudah punya kunci ALLOWANCE:<id> (dibuat setelah pembaruan identitas sumber)
UPDATE "final_settlement_lines" l SET "assigneeId" = a."id"
FROM "assignment_assignees" a
WHERE l."assigneeId" IS NULL AND l."sourceKey" LIKE 'ALLOWANCE:%' AND a."id"::text = substring(l."sourceKey" from 11);

-- (b) baris usulan sistem lama (tanpa kunci): cocokkan penerima tugas milik karyawan yang sama, nominal sama, dan nomor surat tugas tercantum pada rumus baris.
--     Hanya dipakai bila kecocokannya TUNGGAL (satu baris ↔ satu penerima, satu penerima ↔ satu baris per penyelesaian); yang meragukan dibiarkan.
WITH cand AS (
  SELECT l."id" AS line_id, l."settlementId" AS settlement_id, a."id" AS assignee_id
  FROM "final_settlement_lines" l
  JOIN "final_settlements" s ON s."id" = l."settlementId" AND s."status" <> 'CANCELLED'
  JOIN "assignment_assignees" a ON a."employeeId" = s."employeeId" AND a."total" = l."amount"
  JOIN "assignment_letters" t ON t."id" = a."letterId" AND position(t."number" in l."formula") > 0
  WHERE l."category" = 'UNPAID_ALLOWANCE' AND l."source" = 'SYSTEM' AND l."assigneeId" IS NULL AND l."sourceKey" IS NULL AND l."formula" IS NOT NULL
), uniq AS (
  SELECT line_id, settlement_id, assignee_id FROM (
    SELECT c.*, count(*) OVER (PARTITION BY line_id) AS per_line, count(*) OVER (PARTITION BY settlement_id, assignee_id) AS per_assignee FROM cand c
  ) x WHERE per_line = 1 AND per_assignee = 1
)
UPDATE "final_settlement_lines" l SET "assigneeId" = u.assignee_id, "sourceKey" = 'ALLOWANCE:' || u.assignee_id::text
FROM uniq u
WHERE l."id" = u.line_id
  AND NOT EXISTS (SELECT 1 FROM "final_settlement_lines" x WHERE x."settlementId" = l."settlementId" AND x."sourceKey" = 'ALLOWANCE:' || u.assignee_id::text);

ALTER TABLE "final_settlement_lines" ENABLE TRIGGER "final_settlement_lines_guard";
-- BACKFILL:END
