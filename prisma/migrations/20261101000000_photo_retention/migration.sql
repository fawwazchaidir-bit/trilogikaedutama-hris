-- Retensi foto absensi: foto lebih tua dari N bulan (bawaan 6) dihapus otomatis; jejak teks cap (waktu, koordinat, nama) tetap.


-- AlterTable
ALTER TABLE "attendance_photos" ADD COLUMN     "purgedAt" TIMESTAMP(3),
ALTER COLUMN "fileId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "attendancePhotoRetentionMonths" INTEGER NOT NULL DEFAULT 6;

-- CreateIndex
CREATE INDEX "attendance_photos_capturedAt_idx" ON "attendance_photos"("capturedAt");


ALTER TABLE "company_settings" ADD CONSTRAINT "company_settings_photo_retention" CHECK ("attendancePhotoRetentionMonths" BETWEEN 0 AND 120);

-- Satu baris selalu salah satu: masih punya berkas (purgedAt kosong) ATAU sudah dihapus retensi (fileId kosong, purgedAt terisi).
ALTER TABLE "attendance_photos" ADD CONSTRAINT "attendance_photos_purge_state" CHECK (("purgedAt" IS NULL) = ("fileId" IS NOT NULL));

-- Bukti tetap tidak boleh diubah/dihapus, KECUALI tiga perubahan sempit:
--   attendanceId → NULL (catatan absensi dihapus HR), serta fileId → NULL bersamaan purgedAt NULL → waktu (retensi).
-- Teks cap, koordinat, waktu, jenis, dan pemilik tidak pernah boleh berubah.
CREATE OR REPLACE FUNCTION trg_attendance_photos_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Foto absensi tidak boleh dihapus' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'attendanceId' - 'fileId' - 'purgedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'attendanceId' - 'fileId' - 'purgedAt')
     OR (NEW."attendanceId" IS NOT NULL AND NEW."attendanceId" IS DISTINCT FROM OLD."attendanceId")
     OR (NEW."fileId" IS NOT NULL AND NEW."fileId" IS DISTINCT FROM OLD."fileId")
     OR (NEW."purgedAt" IS DISTINCT FROM OLD."purgedAt" AND (OLD."purgedAt" IS NOT NULL OR NEW."purgedAt" IS NULL)) THEN
    RAISE EXCEPTION 'HRIS-GUARD: Foto absensi tidak boleh diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
