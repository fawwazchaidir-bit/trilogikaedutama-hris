-- Otomasi pemantauan Training & Operations: snapshot status harian, log pengingat (dedupe), catatan pemulihan. Murni penambahan; tidak menyentuh tabel yang sudah ada.
-- CreateEnum
CREATE TYPE "TrainingRecoveryKind" AS ENUM ('YELLOW_STREAK', 'RED', 'OVERDUE', 'OVERLOAD', 'OTHER');

-- CreateTable
CREATE TABLE "training_status_snapshots" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "overall" TEXT NOT NULL,
    "timeliness" TEXT,
    "readiness" TEXT,
    "load" TEXT,
    "triggers" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_status_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_reminder_log" (
    "id" BIGSERIAL NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "projectId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_reminder_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_recovery_notes" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "kind" "TrainingRecoveryKind" NOT NULL,
    "body" TEXT NOT NULL,
    "newDate" DATE,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_recovery_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "training_status_snapshots_date_idx" ON "training_status_snapshots"("date");

-- CreateIndex
CREATE UNIQUE INDEX "training_status_snapshots_projectId_date_key" ON "training_status_snapshots"("projectId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "training_reminder_log_dedupeKey_key" ON "training_reminder_log"("dedupeKey");

-- CreateIndex
CREATE INDEX "training_reminder_log_kind_createdAt_idx" ON "training_reminder_log"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "training_recovery_notes_projectId_createdAt_idx" ON "training_recovery_notes"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "training_status_snapshots" ADD CONSTRAINT "training_status_snapshots_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "training_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_recovery_notes" ADD CONSTRAINT "training_recovery_notes_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "training_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Penjaga nilai
ALTER TABLE "training_status_snapshots"
  ADD CONSTRAINT "training_status_snapshots_values" CHECK (
    "overall" IN ('GREEN', 'YELLOW', 'RED')
    AND ("timeliness" IS NULL OR "timeliness" IN ('GREEN', 'YELLOW', 'RED'))
    AND ("readiness" IS NULL OR "readiness" IN ('GREEN', 'YELLOW', 'RED'))
    AND ("load" IS NULL OR "load" IN ('GREEN', 'YELLOW', 'RED'))
  );

ALTER TABLE "training_reminder_log"
  ADD CONSTRAINT "training_reminder_log_values" CHECK (length(btrim("dedupeKey")) > 0 AND length(btrim("kind")) > 0);

ALTER TABLE "training_recovery_notes"
  ADD CONSTRAINT "training_recovery_notes_values" CHECK (length(btrim("body")) >= 5);

-- Catatan pemulihan = jejak keputusan: append-only (memakai fungsi yang sudah ada pada migrasi integrity_guards).
CREATE TRIGGER training_recovery_notes_append_only BEFORE UPDATE OR DELETE ON "training_recovery_notes"
  FOR EACH ROW EXECUTE FUNCTION trg_forbid_update_delete();
