-- Persuratan tahap 2b: lampiran (editor / PDF digabung / PDF terpisah) dan mode arsip-saja (surat dibuat di luar portal).
CREATE TYPE "AttachmentKind" AS ENUM ('EDITOR', 'UPLOAD_MERGED', 'UPLOAD_SEPARATE');
ALTER TYPE "FileKind" ADD VALUE 'LETTER_ATTACHMENT';
ALTER TABLE "letter_documents" ADD COLUMN "archiveOnly" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "letter_attachments" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "AttachmentKind" NOT NULL,
    "title" TEXT NOT NULL,
    "body" JSONB,
    "fileId" UUID,
    "fileName" TEXT,
    "sha256" TEXT,
    "size" INTEGER,
    "pages" INTEGER,
    CONSTRAINT "letter_attachments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "letter_attachments_documentId_position_idx" ON "letter_attachments"("documentId", "position");
ALTER TABLE "letter_attachments" ADD CONSTRAINT "letter_attachments_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "letter_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lampiran hanya dapat ditambah/diubah/dihapus saat surat Draf/Dikembalikan; sesudah diajukan terkunci (hash lampiran termasuk dalam isi yang dibekukan).
CREATE FUNCTION trg_letter_attachments_guard() RETURNS trigger AS $$
DECLARE st "LetterStatus"; did uuid;
BEGIN
  did := CASE WHEN TG_OP = 'DELETE' THEN OLD."documentId" ELSE NEW."documentId" END;
  IF TG_OP = 'UPDATE' AND NEW."documentId" <> OLD."documentId" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Lampiran tidak dapat dipindahkan antar surat' USING ERRCODE = 'restrict_violation';
  END IF;
  SELECT "status" INTO st FROM "letter_documents" WHERE "id" = did;
  IF st IN ('DRAFT', 'RETURNED') THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  RAISE EXCEPTION 'HRIS-GUARD: Lampiran surat hanya dapat diubah saat surat berstatus Draf/Dikembalikan' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER letter_attachments_guard BEFORE INSERT OR UPDATE OR DELETE ON "letter_attachments"
  FOR EACH ROW EXECUTE FUNCTION trg_letter_attachments_guard();

-- Penjaga dokumen diperbarui: surat arsip-saja boleh terbit tanpa PDF, dan PDF pindaiannya boleh diisi SATU KALI sesudah terbit.
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
    OR NEW."issueDate" IS DISTINCT FROM OLD."issueDate"
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
