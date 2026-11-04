-- CreateEnum
CREATE TYPE "TrainingTrack" AS ENUM ('REGULAR', 'PARTNER');

-- CreateEnum
CREATE TYPE "TrainingAnchor" AS ENUM ('H', 'H_END', 'T', 'MILESTONE', 'MANUAL');

-- CreateEnum
CREATE TYPE "TrainingReadinessComponent" AS ENUM ('INSTRUCTOR', 'MATERIAL', 'LOGISTICS', 'ADMIN', 'CERTIFICATION');

-- CreateEnum
CREATE TYPE "TrainingReadinessStatus" AS ENUM ('OPEN', 'DONE', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "TrainingWorkloadStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');

-- AlterTable
ALTER TABLE "training_participants" ADD COLUMN     "confirmedAt" DATE;

-- AlterTable
ALTER TABLE "training_projects" ADD COLUMN     "bnsp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "indicatorsAppliedAt" TIMESTAMP(3),
ADD COLUMN     "participantsMax" INTEGER,
ADD COLUMN     "participantsMin" INTEGER,
ADD COLUMN     "registrationCloseDate" DATE,
ADD COLUMN     "requestDate" DATE,
ADD COLUMN     "track" "TrainingTrack" NOT NULL DEFAULT 'REGULAR';

-- CreateTable
CREATE TABLE "training_milestones" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "anchor" "TrainingAnchor" NOT NULL,
    "offsetDays" INTEGER NOT NULL DEFAULT 0,
    "offsetWork" BOOLEAN NOT NULL DEFAULT false,
    "refCode" TEXT,
    "manualDate" DATE,
    "weight" INTEGER NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "bnspOnly" BOOLEAN NOT NULL DEFAULT false,
    "assigneeId" UUID,
    "roleKey" TEXT,
    "doneAt" DATE,
    "doneById" UUID,
    "evidence" TEXT,
    "notApplicable" BOOLEAN NOT NULL DEFAULT false,
    "reference" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_readiness_items" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "component" "TrainingReadinessComponent" NOT NULL,
    "name" TEXT NOT NULL,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "anchor" "TrainingAnchor" NOT NULL,
    "offsetDays" INTEGER NOT NULL DEFAULT 0,
    "offsetWork" BOOLEAN NOT NULL DEFAULT false,
    "refCode" TEXT,
    "manualDate" DATE,
    "bnspOnly" BOOLEAN NOT NULL DEFAULT false,
    "status" "TrainingReadinessStatus" NOT NULL DEFAULT 'OPEN',
    "assigneeId" UUID,
    "roleKey" TEXT,
    "updatedById" UUID,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_readiness_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_workload_tasks" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "hours" DOUBLE PRECISION NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "TrainingWorkloadStatus" NOT NULL DEFAULT 'OPEN',
    "source" TEXT NOT NULL DEFAULT 'TEMPLATE',
    "roleKey" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_workload_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_staff_capacity" (
    "employeeId" UUID NOT NULL,
    "hoursPerDay" DOUBLE PRECISION,
    "workDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "note" TEXT,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_staff_capacity_pkey" PRIMARY KEY ("employeeId")
);

-- CreateTable
CREATE TABLE "training_indicator_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "note" TEXT,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_indicator_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_indicator_config_versions" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "note" TEXT,
    "changedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_indicator_config_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_milestones_projectId_sortOrder_idx" ON "training_milestones"("projectId", "sortOrder");

-- CreateIndex
CREATE INDEX "training_milestones_assigneeId_idx" ON "training_milestones"("assigneeId");

-- CreateIndex
CREATE UNIQUE INDEX "training_milestones_projectId_code_key" ON "training_milestones"("projectId", "code");

-- CreateIndex
CREATE INDEX "training_readiness_items_projectId_component_idx" ON "training_readiness_items"("projectId", "component");

-- CreateIndex
CREATE INDEX "training_readiness_items_assigneeId_idx" ON "training_readiness_items"("assigneeId");

-- CreateIndex
CREATE INDEX "training_workload_tasks_projectId_status_idx" ON "training_workload_tasks"("projectId", "status");

-- CreateIndex
CREATE INDEX "training_workload_tasks_employeeId_startDate_endDate_idx" ON "training_workload_tasks"("employeeId", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "training_indicator_config_versions_version_key" ON "training_indicator_config_versions"("version");

-- AddForeignKey
ALTER TABLE "training_milestones" ADD CONSTRAINT "training_milestones_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "training_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_milestones" ADD CONSTRAINT "training_milestones_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_readiness_items" ADD CONSTRAINT "training_readiness_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "training_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_readiness_items" ADD CONSTRAINT "training_readiness_items_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_workload_tasks" ADD CONSTRAINT "training_workload_tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "training_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_workload_tasks" ADD CONSTRAINT "training_workload_tasks_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_staff_capacity" ADD CONSTRAINT "training_staff_capacity_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════
-- Penjagaan integritas indikator pemantauan (hanya tabel training_* ; defense in depth).
-- ═════════════════════════════════════════════════════════════════════════════

ALTER TABLE "training_projects"
  ADD CONSTRAINT "training_projects_participants" CHECK (
    ("participantsMin" IS NULL OR "participantsMin" >= 0) AND ("participantsMax" IS NULL OR "participantsMax" >= 0)
    AND ("participantsMin" IS NULL OR "participantsMax" IS NULL OR "participantsMax" >= "participantsMin")
  );

ALTER TABLE "training_milestones"
  ADD CONSTRAINT "training_milestones_values" CHECK (
    length(btrim("code")) > 0 AND length(btrim("name")) > 0 AND "weight" BETWEEN 0 AND 1000 AND "offsetDays" BETWEEN -730 AND 730
  ),
  ADD CONSTRAINT "training_milestones_ref" CHECK ("anchor" <> 'MILESTONE' OR "refCode" IS NOT NULL),
  -- Selesai dan "Tidak berlaku" saling lepas; milestone selesai wajib mencatat siapa & kapan.
  ADD CONSTRAINT "training_milestones_state" CHECK (
    NOT ("notApplicable" AND "doneAt" IS NOT NULL) AND (("doneAt" IS NULL) = ("doneById" IS NULL))
  );

ALTER TABLE "training_readiness_items"
  ADD CONSTRAINT "training_readiness_items_values" CHECK (length(btrim("name")) > 0 AND "offsetDays" BETWEEN -730 AND 730),
  ADD CONSTRAINT "training_readiness_items_ref" CHECK ("anchor" <> 'MILESTONE' OR "refCode" IS NOT NULL);

ALTER TABLE "training_workload_tasks"
  ADD CONSTRAINT "training_workload_tasks_values" CHECK (length(btrim("name")) > 0 AND "hours" >= 0 AND "hours" <= 2000 AND "endDate" >= "startDate"),
  ADD CONSTRAINT "training_workload_tasks_source" CHECK ("source" IN ('TEMPLATE', 'MANUAL'));

ALTER TABLE "training_staff_capacity"
  ADD CONSTRAINT "training_staff_capacity_values" CHECK (
    ("hoursPerDay" IS NULL OR ("hoursPerDay" > 0 AND "hoursPerDay" <= 24))
    AND cardinality("workDays") BETWEEN 1 AND 7 AND "workDays" <@ ARRAY[1,2,3,4,5,6,7]
  );

ALTER TABLE "training_indicator_config" ADD CONSTRAINT "training_indicator_config_singleton" CHECK ("id" = 1 AND "version" >= 1);
ALTER TABLE "training_indicator_config_versions" ADD CONSTRAINT "training_indicator_config_versions_values" CHECK ("version" >= 1);

-- Riwayat versi konfigurasi: append-only (memakai fungsi yang sudah ada pada migrasi integrity_guards).
CREATE TRIGGER training_indicator_config_versions_append_only BEFORE UPDATE OR DELETE ON "training_indicator_config_versions"
  FOR EACH ROW EXECUTE FUNCTION trg_forbid_update_delete();
