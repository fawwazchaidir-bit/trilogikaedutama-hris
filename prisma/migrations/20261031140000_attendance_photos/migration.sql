-- Foto absensi bercap (lokasi + waktu server) menggantikan syarat jaringan kantor (Wi-Fi/IP).
-- Catatan: kolom officeNetworks/locationRequireOfficeNetwork ditambahkan pada migrasi Tahap 2 yang sama-sama belum dirilis ke produksi.


-- CreateEnum
CREATE TYPE "AttendancePhotoMode" AS ENUM ('OFF', 'OPTIONAL', 'REQUIRED');

-- AlterEnum
ALTER TYPE "FileKind" ADD VALUE 'ATTENDANCE_PHOTO';

-- AlterTable
ALTER TABLE "company_settings" DROP COLUMN "locationRequireOfficeNetwork",
DROP COLUMN "officeNetworks",
ADD COLUMN     "attendancePhotoMode" "AttendancePhotoMode" NOT NULL DEFAULT 'OFF',
ADD COLUMN     "attendancePhotoRequireLocation" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "attendance_photos" (
    "id" UUID NOT NULL,
    "attendanceId" UUID,
    "employeeId" UUID NOT NULL,
    "kind" "PunchKind" NOT NULL,
    "fileId" UUID NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracy" DOUBLE PRECISION,
    "stamp" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_photos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attendance_photos_fileId_key" ON "attendance_photos"("fileId");

-- CreateIndex
CREATE INDEX "attendance_photos_employeeId_capturedAt_idx" ON "attendance_photos"("employeeId", "capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_photos_attendanceId_kind_key" ON "attendance_photos"("attendanceId", "kind");

-- AddForeignKey
ALTER TABLE "attendance_photos" ADD CONSTRAINT "attendance_photos_attendanceId_fkey" FOREIGN KEY ("attendanceId") REFERENCES "attendances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_photos" ADD CONSTRAINT "attendance_photos_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_photos" ADD CONSTRAINT "attendance_photos_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Bukti tidak boleh diubah/dihapus. Satu-satunya perubahan yang diizinkan: attendanceId menjadi NULL
-- (aksi ON DELETE SET NULL saat HR menghapus catatan absensi lewat koreksi; foto tetap tersimpan sebagai bukti).
ALTER TABLE "attendance_photos" ADD CONSTRAINT "attendance_photos_coords" CHECK (
  ("lat" IS NULL) = ("lng" IS NULL)
  AND ("lat" IS NULL OR ("lat" BETWEEN -90 AND 90 AND "lng" BETWEEN -180 AND 180))
);

CREATE FUNCTION trg_attendance_photos_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Foto absensi tidak boleh dihapus' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."attendanceId" IS NOT NULL OR (to_jsonb(NEW) - 'attendanceId') IS DISTINCT FROM (to_jsonb(OLD) - 'attendanceId') THEN
    RAISE EXCEPTION 'HRIS-GUARD: Foto absensi tidak boleh diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER attendance_photos_guard BEFORE UPDATE OR DELETE ON "attendance_photos"
  FOR EACH ROW EXECUTE FUNCTION trg_attendance_photos_guard();
