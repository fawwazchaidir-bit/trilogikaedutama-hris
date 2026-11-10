-- Persuratan: pembatasan divisi penandatangan per jenis surat (kosong = semua divisi).
-- AlterTable
ALTER TABLE "letter_types" ADD COLUMN     "signerDivisionIds" UUID[];

