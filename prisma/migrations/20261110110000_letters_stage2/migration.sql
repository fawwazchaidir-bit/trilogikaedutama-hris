-- Persuratan tahap 2a: nomor urut kembali PER SERI (EKS/INT terpisah, per tahun), atribut jenis (rahasia, HR, multi-penandatangan), penandatangan tambahan, berkas tanda tangan pribadi.
CREATE TYPE "SignatoryKind" AS ENUM ('INTERNAL', 'EXTERNAL');
ALTER TYPE "FileKind" ADD VALUE 'LETTER_SIGNATURE';

-- Penghitung per seri: nilai global lama disalin ke kedua seri (aman; tidak ada nomor ganda).
CREATE TABLE "letter_counters_new" ("series" "LetterSeries" NOT NULL, "year" INTEGER NOT NULL, "lastSeq" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "letter_counters_new_pkey" PRIMARY KEY ("series", "year"));
INSERT INTO "letter_counters_new" ("series", "year", "lastSeq") SELECT s.series, c."year", c."lastSeq" FROM "letter_counters" c CROSS JOIN (VALUES ('EKS'::"LetterSeries"), ('INT'::"LetterSeries")) AS s(series);
DROP TABLE "letter_counters";
ALTER TABLE "letter_counters_new" RENAME TO "letter_counters";
ALTER TABLE "letter_counters" RENAME CONSTRAINT "letter_counters_new_pkey" TO "letter_counters_pkey";
DROP INDEX "letter_documents_seqYear_seqNo_key";
CREATE UNIQUE INDEX "letter_documents_series_seqYear_seqNo_key" ON "letter_documents"("series", "seqYear", "seqNo");

ALTER TABLE "letter_types" ADD COLUMN "confidential" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "hrCanSign" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "hrCanView" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "multiSigner" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "letter_signatories" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "kind" "SignatoryKind" NOT NULL,
    "userId" UUID,
    "name" TEXT,
    "title" TEXT,
    "org" TEXT,
    "signedAt" TIMESTAMP(3),
    CONSTRAINT "letter_signatories_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "letter_signatories_documentId_position_idx" ON "letter_signatories"("documentId", "position");
ALTER TABLE "letter_signatories" ADD CONSTRAINT "letter_signatories_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "letter_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Penandatangan tambahan hanya dapat ditambah/diubah/dihapus saat induknya Draf/Dikembalikan; saat Menunggu hanya `signedAt` yang boleh diisi; setelah itu terkunci.
CREATE FUNCTION trg_letter_signatories_guard() RETURNS trigger AS $$
DECLARE st "LetterStatus"; did uuid;
BEGIN
  did := CASE WHEN TG_OP = 'DELETE' THEN OLD."documentId" ELSE NEW."documentId" END;
  SELECT "status" INTO st FROM "letter_documents" WHERE "id" = did;
  IF TG_OP = 'UPDATE' AND NEW."documentId" <> OLD."documentId" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Penandatangan tidak dapat dipindahkan antar surat' USING ERRCODE = 'restrict_violation';
  END IF;
  IF st IN ('DRAFT', 'RETURNED') THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  IF st = 'IN_REVIEW' AND TG_OP = 'UPDATE' AND OLD."signedAt" IS NULL AND NEW."signedAt" IS NOT NULL
     AND NEW."position" = OLD."position" AND NEW."kind" = OLD."kind" AND NEW."userId" IS NOT DISTINCT FROM OLD."userId"
     AND NEW."name" IS NOT DISTINCT FROM OLD."name" AND NEW."title" IS NOT DISTINCT FROM OLD."title" AND NEW."org" IS NOT DISTINCT FROM OLD."org" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'HRIS-GUARD: Penandatangan surat hanya dapat diubah saat surat berstatus Draf/Dikembalikan' USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER letter_signatories_guard BEFORE INSERT OR UPDATE OR DELETE ON "letter_signatories"
  FOR EACH ROW EXECUTE FUNCTION trg_letter_signatories_guard();
