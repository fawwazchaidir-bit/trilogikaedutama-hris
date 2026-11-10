-- Persuratan tahap 3: data komersial penawaran (corong), bukti Deal, tautan proyek Training, target & produk.
-- CreateEnum
CREATE TYPE "CommercialStatus" AS ENUM ('SENT', 'FOLLOW_UP', 'NEGOTIATION', 'DEAL', 'REJECTED', 'DONE');

-- AlterEnum
ALTER TYPE "FileKind" ADD VALUE 'LETTER_EVIDENCE';

-- AlterTable
ALTER TABLE "letter_documents" ADD COLUMN     "clientName" TEXT,
ADD COLUMN     "clientRef" TEXT,
ADD COLUMN     "commercialNote" TEXT,
ADD COLUMN     "commercialStatus" "CommercialStatus",
ADD COLUMN     "dealEvidenceFileId" UUID,
ADD COLUMN     "dealEvidenceName" TEXT,
ADD COLUMN     "dealValue" BIGINT,
ADD COLUMN     "followUpAt" DATE,
ADD COLUMN     "lastReminderOn" DATE,
ADD COLUMN     "picId" UUID,
ADD COLUMN     "potentialValue" BIGINT,
ADD COLUMN     "product" TEXT,
ADD COLUMN     "sentAt" DATE;

-- AlterTable
ALTER TABLE "letter_settings" ADD COLUMN     "annualTarget" BIGINT NOT NULL DEFAULT 10000000000,
ADD COLUMN     "products" TEXT[] DEFAULT ARRAY['BNSP Training of Trainers', 'BNSP Tenaga Pemasaran', 'BNSP Pelayanan Prima / Excellent Service', 'BNSP Tata Boga / Food Production', 'AI & Pemasaran Digital', 'Desa Wisata & UMKM', 'Manajemen SDM', 'Paket In-House (campuran)', 'Lainnya']::TEXT[];

-- AlterTable
ALTER TABLE "letter_types" ADD COLUMN     "funnel" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "letter_project_links" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "letter_project_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "letter_project_links_projectId_idx" ON "letter_project_links"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "letter_project_links_documentId_projectId_key" ON "letter_project_links"("documentId", "projectId");

-- AddForeignKey
ALTER TABLE "letter_project_links" ADD CONSTRAINT "letter_project_links_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "letter_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

