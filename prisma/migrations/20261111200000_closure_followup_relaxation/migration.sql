-- Penutupan proyek Training & Operations: (1) tugas terbuka wajib diputuskan saat tutup — "tindak lanjut" tetap dapat dikerjakan setelah proyek Selesai;
-- (2) pelonggaran item checklist WAJIB (dijadikan tidak wajib / dihapus) tercatat beralasan dan harus diakui saat menutup. Aditif.

-- CreateEnum
CREATE TYPE "TrainingChecklistRelaxKind" AS ENUM ('DEMOTED', 'DELETED');

-- AlterTable
ALTER TABLE "training_tasks" ADD COLUMN     "isFollowUp" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "training_checklist_relaxations" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "itemTitle" TEXT NOT NULL,
    "phase" "TrainingChecklistPhase" NOT NULL,
    "kind" "TrainingChecklistRelaxKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" UUID,

    CONSTRAINT "training_checklist_relaxations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "training_checklist_relaxations_itemId_key" ON "training_checklist_relaxations"("itemId");

-- CreateIndex
CREATE INDEX "training_checklist_relaxations_projectId_idx" ON "training_checklist_relaxations"("projectId");

-- AddForeignKey
ALTER TABLE "training_checklist_relaxations" ADD CONSTRAINT "training_checklist_relaxations_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "training_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
