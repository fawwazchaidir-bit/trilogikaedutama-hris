-- CreateEnum
CREATE TYPE "LetterSeries" AS ENUM ('EKS', 'INT');

-- CreateEnum
CREATE TYPE "LetterStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'RETURNED', 'ISSUED', 'REJECTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "letter_types" (
    "id" UUID NOT NULL,
    "series" "LetterSeries" NOT NULL,
    "code" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'SURAT',
    "directorOnly" BOOLEAN NOT NULL DEFAULT false,
    "signerJobLevels" "JobLevel"[],
    "internAllowed" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "templateBody" JSONB NOT NULL,
    "defaultSalutation" TEXT,
    "defaultClosing" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "letter_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "letter_counters" (
    "series" "LetterSeries" NOT NULL,
    "year" INTEGER NOT NULL,
    "lastSeq" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "letter_counters_pkey" PRIMARY KEY ("series","year")
);

-- CreateTable
CREATE TABLE "letter_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "place" TEXT NOT NULL DEFAULT 'Sleman',
    "idLine" TEXT,
    "footerText" TEXT,
    "stampFileId" UUID,
    "escalationDays" INTEGER NOT NULL DEFAULT 2,

    CONSTRAINT "letter_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "letter_signers" (
    "userId" UUID NOT NULL,
    "signatureFileId" UUID,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "letter_signers_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "letter_documents" (
    "id" UUID NOT NULL,
    "typeId" UUID NOT NULL,
    "status" "LetterStatus" NOT NULL DEFAULT 'DRAFT',
    "creatorId" UUID NOT NULL,
    "signerId" UUID,
    "subject" TEXT NOT NULL,
    "recipientLines" TEXT[],
    "recipientPlace" TEXT,
    "attachmentCount" INTEGER,
    "attachmentUnit" TEXT,
    "salutation" TEXT,
    "closing" TEXT,
    "cc" TEXT[],
    "body" JSONB NOT NULL,
    "variables" JSONB,
    "submittedAt" TIMESTAMP(3),
    "returnNote" TEXT,
    "cancelNote" TEXT,
    "rejectNote" TEXT,
    "issueDate" DATE,
    "issuedAt" TIMESTAMP(3),
    "series" "LetterSeries" NOT NULL,
    "seqYear" INTEGER,
    "seqNo" INTEGER,
    "number" TEXT,
    "verifyToken" TEXT NOT NULL,
    "pdfFileId" UUID,
    "pdfSha256" TEXT,
    "snapshot" JSONB,
    "issuedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "letter_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "letter_events" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "letter_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "letter_types_series_code_key" ON "letter_types"("series", "code");

-- CreateIndex
CREATE UNIQUE INDEX "letter_documents_number_key" ON "letter_documents"("number");

-- CreateIndex
CREATE UNIQUE INDEX "letter_documents_verifyToken_key" ON "letter_documents"("verifyToken");

-- CreateIndex
CREATE INDEX "letter_documents_creatorId_status_idx" ON "letter_documents"("creatorId", "status");

-- CreateIndex
CREATE INDEX "letter_documents_signerId_status_idx" ON "letter_documents"("signerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "letter_documents_series_seqYear_seqNo_key" ON "letter_documents"("series", "seqYear", "seqNo");

-- CreateIndex
CREATE INDEX "letter_events_documentId_at_idx" ON "letter_events"("documentId", "at");

-- AddForeignKey
ALTER TABLE "letter_documents" ADD CONSTRAINT "letter_documents_typeId_fkey" FOREIGN KEY ("typeId") REFERENCES "letter_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "letter_events" ADD CONSTRAINT "letter_events_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "letter_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Baris pengaturan tunggal.
INSERT INTO "letter_settings" ("id") VALUES (1);

-- ───────────── Penjaga integritas (HRIS-GUARD) ─────────────
-- Dokumen surat tidak dihapus; alur status hanya yang sah; nomor/PDF/hash/isi terkunci sejak TERBIT (satu-satunya perubahan: batal dengan alasan).
CREATE FUNCTION trg_letter_documents_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Dokumen surat tidak boleh dihapus (batalkan dengan alasan)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."creatorId" <> OLD."creatorId" OR NEW."typeId" <> OLD."typeId" OR NEW."series" <> OLD."series" OR NEW."verifyToken" <> OLD."verifyToken" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Pembuat, jenis, seri, dan token verifikasi dokumen surat tidak dapat diubah' USING ERRCODE = 'restrict_violation';
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
    OR NEW."pdfFileId" IS DISTINCT FROM OLD."pdfFileId" OR NEW."pdfSha256" IS DISTINCT FROM OLD."pdfSha256" OR NEW."issueDate" IS DISTINCT FROM OLD."issueDate"
    OR NEW."subject" IS DISTINCT FROM OLD."subject" OR NEW."body"::text IS DISTINCT FROM OLD."body"::text OR NEW."snapshot"::text IS DISTINCT FROM OLD."snapshot"::text
    OR NEW."signerId" IS DISTINCT FROM OLD."signerId" OR NEW."recipientLines" IS DISTINCT FROM OLD."recipientLines" OR NEW."cc" IS DISTINCT FROM OLD."cc"
  ) THEN
    RAISE EXCEPTION 'HRIS-GUARD: Isi, nomor, dan PDF surat yang sudah terbit terkunci (batalkan lalu buat surat baru)' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" = 'ISSUED' AND OLD."status" <> 'ISSUED' AND (NEW."number" IS NULL OR NEW."pdfFileId" IS NULL OR NEW."pdfSha256" IS NULL OR NEW."seqNo" IS NULL) THEN
    RAISE EXCEPTION 'HRIS-GUARD: Surat terbit wajib memiliki nomor, PDF, dan hash' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."number" IS NOT NULL AND NEW."number" IS DISTINCT FROM OLD."number" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Nomor surat tidak dapat diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER letter_documents_guard BEFORE UPDATE OR DELETE ON "letter_documents"
  FOR EACH ROW EXECUTE FUNCTION trg_letter_documents_guard();

-- Jejak siklus: tambah-saja.
CREATE FUNCTION trg_letter_events_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'HRIS-GUARD: Jejak siklus surat bersifat tambah-saja' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER letter_events_append_only BEFORE UPDATE OR DELETE ON "letter_events"
  FOR EACH ROW EXECUTE FUNCTION trg_letter_events_append_only();
