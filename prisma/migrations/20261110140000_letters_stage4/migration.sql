-- Persuratan tahap 4: Surat Tugas (INT-002) diterbitkan lewat mesin dokumen. Data penugasan terstruktur ada di dokumen; surat tugas lama tetap utuh.
ALTER TABLE "assignment_letters" ADD COLUMN "letterDocumentId" UUID, ALTER COLUMN "seqYear" DROP NOT NULL, ALTER COLUMN "seqNo" DROP NOT NULL;
ALTER TABLE "letter_documents" ADD COLUMN "assignment" JSONB;
ALTER TABLE "letter_types" ADD COLUMN "adminCreateOnly" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "assignment_letters_letterDocumentId_key" ON "assignment_letters"("letterDocumentId");

-- Data penugasan ikut dibekukan sejak surat terbit.
CREATE OR REPLACE FUNCTION trg_letter_documents_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Dokumen surat tidak boleh dihapus (batalkan dengan alasan)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."creatorId" <> OLD."creatorId" OR NEW."typeId" <> OLD."typeId" OR NEW."series" <> OLD."series" OR NEW."verifyToken" <> OLD."verifyToken" OR NEW."archiveOnly" <> OLD."archiveOnly" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Pembuat, jenis, seri, token verifikasi, dan mode arsip dokumen surat tidak dapat diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" IN ('REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'HRIS-GUARD: Dokumen surat yang ditolak/dibatalkan terkunci' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" <> OLD."status" AND NOT (
       (OLD."status" IN ('DRAFT', 'RETURNED') AND NEW."status" = 'IN_REVIEW')
    OR (OLD."status" = 'IN_REVIEW' AND NEW."status" IN ('DRAFT', 'RETURNED', 'ISSUED', 'REJECTED'))
    OR (OLD."status" = 'ISSUED' AND NEW."status" = 'CANCELLED')
  ) THEN
    RAISE EXCEPTION 'HRIS-GUARD: Perpindahan status surat % -> % tidak diizinkan', OLD."status", NEW."status" USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" = 'ISSUED' AND (
       NEW."number" IS DISTINCT FROM OLD."number" OR NEW."seqNo" IS DISTINCT FROM OLD."seqNo" OR NEW."seqYear" IS DISTINCT FROM OLD."seqYear"
    OR NEW."issueDate" IS DISTINCT FROM OLD."issueDate" OR NEW."assignment"::text IS DISTINCT FROM OLD."assignment"::text
    OR NEW."subject" IS DISTINCT FROM OLD."subject" OR NEW."body"::text IS DISTINCT FROM OLD."body"::text OR NEW."snapshot"::text IS DISTINCT FROM OLD."snapshot"::text
    OR NEW."signerId" IS DISTINCT FROM OLD."signerId" OR NEW."recipientLines" IS DISTINCT FROM OLD."recipientLines" OR NEW."cc" IS DISTINCT FROM OLD."cc"
  ) THEN
    RAISE EXCEPTION 'HRIS-GUARD: Isi, nomor, dan PDF surat yang sudah terbit terkunci (batalkan lalu buat surat baru)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."status" IN ('ISSUED', 'CANCELLED') AND (NEW."pdfFileId" IS DISTINCT FROM OLD."pdfFileId" OR NEW."pdfSha256" IS DISTINCT FROM OLD."pdfSha256")
     AND NOT (OLD."archiveOnly" AND OLD."pdfFileId" IS NULL AND OLD."pdfSha256" IS NULL AND NEW."pdfFileId" IS NOT NULL AND NEW."pdfSha256" IS NOT NULL) THEN
    RAISE EXCEPTION 'HRIS-GUARD: PDF dan hash surat yang sudah terbit terkunci' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" = 'ISSUED' AND OLD."status" <> 'ISSUED' AND (NEW."number" IS NULL OR NEW."seqNo" IS NULL OR (NOT NEW."archiveOnly" AND (NEW."pdfFileId" IS NULL OR NEW."pdfSha256" IS NULL))) THEN
    RAISE EXCEPTION 'HRIS-GUARD: Surat terbit wajib memiliki nomor, PDF, dan hash' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."number" IS NOT NULL AND NEW."number" IS DISTINCT FROM OLD."number" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Nomor surat tidak dapat diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
