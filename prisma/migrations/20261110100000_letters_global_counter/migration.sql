-- Nomor urut surat bersifat GLOBAL per tahun (semua seri & jenis), mengikuti Register Excel. Penghitung lama (per seri) digabung dengan nilai tertinggi.
CREATE TABLE "letter_counters_new" ("year" INTEGER NOT NULL, "lastSeq" INTEGER NOT NULL DEFAULT 0, CONSTRAINT "letter_counters_new_pkey" PRIMARY KEY ("year"));
INSERT INTO "letter_counters_new" ("year", "lastSeq") SELECT "year", MAX("lastSeq") FROM "letter_counters" GROUP BY "year";
DROP TABLE "letter_counters";
ALTER TABLE "letter_counters_new" RENAME TO "letter_counters";
ALTER TABLE "letter_counters" RENAME CONSTRAINT "letter_counters_new_pkey" TO "letter_counters_pkey";

-- Nomor unik per tahun lintas seri.
DROP INDEX "letter_documents_series_seqYear_seqNo_key";
CREATE UNIQUE INDEX "letter_documents_seqYear_seqNo_key" ON "letter_documents"("seqYear", "seqNo");
