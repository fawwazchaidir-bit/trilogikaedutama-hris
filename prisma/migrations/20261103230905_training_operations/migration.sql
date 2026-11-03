-- CreateEnum
CREATE TYPE "TrainingLevel" AS ENUM ('VIEWER', 'ADMIN_PROGRAM', 'MANAGER');

-- CreateEnum
CREATE TYPE "TrainingActivityKind" AS ENUM ('REGULAR', 'CERTIFICATION', 'IN_HOUSE', 'OTHER');

-- CreateEnum
CREATE TYPE "TrainingDeliveryMode" AS ENUM ('ONSITE', 'ONLINE', 'HYBRID');

-- CreateEnum
CREATE TYPE "TrainingProjectStatus" AS ENUM ('DRAFT', 'PREPARATION', 'RUNNING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TrainingProjectRole" AS ENUM ('PROJECT_MANAGER', 'ADMIN_PROGRAM', 'PARTICIPANT_OWNER', 'MATERIAL_OWNER', 'DOCUMENTATION_OWNER', 'STAFF');

-- CreateEnum
CREATE TYPE "TrainingTaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TrainingTaskPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "TrainingChecklistPhase" AS ENUM ('PREPARATION', 'EXECUTION', 'CLOSING');

-- CreateEnum
CREATE TYPE "TrainingScheduleStatus" AS ENUM ('PLANNED', 'CONFIRMED', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TrainingParticipantStatus" AS ENUM ('REGISTERED', 'INCOMPLETE_DOCS', 'READY', 'ATTENDING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TrainingInstructorKind" AS ENUM ('INSTRUCTOR', 'ASSESSOR', 'SPEAKER', 'FACILITATOR');

-- CreateEnum
CREATE TYPE "TrainingConfirmation" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED');

-- CreateEnum
CREATE TYPE "TrainingDocCategory" AS ENUM ('PROPOSAL', 'INVITATION', 'MATERIAL', 'ATTENDANCE', 'PARTICIPANT_DOC', 'DOCUMENTATION', 'FINAL_REPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "TrainingExternalSystem" AS ENUM ('WEBSITE', 'HALOAI', 'FINANCE');

-- AlterEnum
ALTER TYPE "FileKind" ADD VALUE 'TRAINING_DOCUMENT';

-- CreateTable
CREATE TABLE "training_access" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "level" "TrainingLevel" NOT NULL,
    "note" TEXT,
    "grantedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_programs" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TrainingActivityKind" NOT NULL DEFAULT 'REGULAR',
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_projects" (
    "id" UUID NOT NULL,
    "seqYear" INTEGER NOT NULL,
    "seqNo" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "programId" UUID,
    "kind" "TrainingActivityKind" NOT NULL DEFAULT 'REGULAR',
    "clientName" TEXT,
    "deliveryMode" "TrainingDeliveryMode" NOT NULL DEFAULT 'ONSITE',
    "location" TEXT,
    "startDate" DATE,
    "endDate" DATE,
    "status" "TrainingProjectStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "notes" TEXT,
    "checklistTemplateName" TEXT,
    "closedAt" TIMESTAMP(3),
    "closedById" UUID,
    "closureSummary" TEXT,
    "closureFollowUp" TEXT,
    "closureOverrideReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_project_members" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "role" "TrainingProjectRole" NOT NULL,
    "note" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endedById" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_project_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_tasks" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "assigneeId" UUID,
    "dueDate" DATE,
    "priority" "TrainingTaskPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "TrainingTaskStatus" NOT NULL DEFAULT 'TODO',
    "requiresReview" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "completedById" UUID,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_task_comments" (
    "id" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_task_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_checklist_templates" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_checklist_template_items" (
    "id" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "phase" "TrainingChecklistPhase" NOT NULL,
    "title" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "training_checklist_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_project_checklist_items" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "phase" "TrainingChecklistPhase" NOT NULL,
    "title" TEXT NOT NULL,
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "assigneeId" UUID,
    "isDone" BOOLEAN NOT NULL DEFAULT false,
    "doneAt" TIMESTAMP(3),
    "doneById" UUID,
    "note" TEXT,
    "sourceTemplateName" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_project_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_instructors" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "TrainingInstructorKind" NOT NULL DEFAULT 'INSTRUCTOR',
    "employeeId" UUID,
    "organization" TEXT,
    "expertise" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_instructors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_project_instructors" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "instructorId" UUID NOT NULL,
    "kind" "TrainingInstructorKind" NOT NULL,
    "confirmation" "TrainingConfirmation" NOT NULL DEFAULT 'PENDING',
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_project_instructors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_schedules" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "location" TEXT,
    "room" TEXT,
    "inchargeId" UUID,
    "projectInstructorId" UUID,
    "status" "TrainingScheduleStatus" NOT NULL DEFAULT 'PLANNED',
    "note" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_participants" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "fullName" TEXT NOT NULL,
    "organization" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "status" "TrainingParticipantStatus" NOT NULL DEFAULT 'REGISTERED',
    "note" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "training_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_project_documents" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "category" "TrainingDocCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "fileId" UUID NOT NULL,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "deletedById" UUID,

    CONSTRAINT "training_project_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_external_refs" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "system" "TrainingExternalSystem" NOT NULL,
    "externalId" TEXT NOT NULL,
    "label" TEXT,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_external_refs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "training_project_assignment_links" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "letterId" UUID NOT NULL,
    "linkedById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "training_project_assignment_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "training_access_userId_key" ON "training_access"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "training_projects_code_key" ON "training_projects"("code");

-- CreateIndex
CREATE INDEX "training_projects_status_startDate_idx" ON "training_projects"("status", "startDate");

-- CreateIndex
CREATE INDEX "training_projects_programId_idx" ON "training_projects"("programId");

-- CreateIndex
CREATE INDEX "training_projects_startDate_idx" ON "training_projects"("startDate");

-- CreateIndex
CREATE UNIQUE INDEX "training_projects_seqYear_seqNo_key" ON "training_projects"("seqYear", "seqNo");

-- CreateIndex
CREATE INDEX "training_project_members_projectId_idx" ON "training_project_members"("projectId");

-- CreateIndex
CREATE INDEX "training_project_members_employeeId_endedAt_idx" ON "training_project_members"("employeeId", "endedAt");

-- CreateIndex
CREATE INDEX "training_tasks_projectId_status_idx" ON "training_tasks"("projectId", "status");

-- CreateIndex
CREATE INDEX "training_tasks_assigneeId_status_idx" ON "training_tasks"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "training_tasks_dueDate_idx" ON "training_tasks"("dueDate");

-- CreateIndex
CREATE INDEX "training_task_comments_taskId_createdAt_idx" ON "training_task_comments"("taskId", "createdAt");

-- CreateIndex
CREATE INDEX "training_checklist_template_items_templateId_phase_sortOrde_idx" ON "training_checklist_template_items"("templateId", "phase", "sortOrder");

-- CreateIndex
CREATE INDEX "training_project_checklist_items_projectId_phase_sortOrder_idx" ON "training_project_checklist_items"("projectId", "phase", "sortOrder");

-- CreateIndex
CREATE INDEX "training_project_checklist_items_assigneeId_isDone_idx" ON "training_project_checklist_items"("assigneeId", "isDone");

-- CreateIndex
CREATE UNIQUE INDEX "training_instructors_employeeId_key" ON "training_instructors"("employeeId");

-- CreateIndex
CREATE INDEX "training_instructors_name_idx" ON "training_instructors"("name");

-- CreateIndex
CREATE INDEX "training_project_instructors_instructorId_idx" ON "training_project_instructors"("instructorId");

-- CreateIndex
CREATE UNIQUE INDEX "training_project_instructors_projectId_instructorId_key" ON "training_project_instructors"("projectId", "instructorId");

-- CreateIndex
CREATE INDEX "training_schedules_projectId_startAt_idx" ON "training_schedules"("projectId", "startAt");

-- CreateIndex
CREATE INDEX "training_schedules_startAt_idx" ON "training_schedules"("startAt");

-- CreateIndex
CREATE INDEX "training_participants_projectId_status_idx" ON "training_participants"("projectId", "status");

-- CreateIndex
CREATE INDEX "training_participants_fullName_idx" ON "training_participants"("fullName");

-- CreateIndex
CREATE UNIQUE INDEX "training_project_documents_fileId_key" ON "training_project_documents"("fileId");

-- CreateIndex
CREATE INDEX "training_project_documents_projectId_deletedAt_idx" ON "training_project_documents"("projectId", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "training_external_refs_projectId_system_externalId_key" ON "training_external_refs"("projectId", "system", "externalId");

-- CreateIndex
CREATE INDEX "training_project_assignment_links_letterId_idx" ON "training_project_assignment_links"("letterId");

-- CreateIndex
CREATE UNIQUE INDEX "training_project_assignment_links_projectId_letterId_key" ON "training_project_assignment_links"("projectId", "letterId");

-- AddForeignKey
ALTER TABLE "training_access" ADD CONSTRAINT "training_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_projects" ADD CONSTRAINT "training_projects_programId_fkey" FOREIGN KEY ("programId") REFERENCES "training_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_project_members" ADD CONSTRAINT "training_project_members_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "training_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_project_members" ADD CONSTRAINT "training_project_members_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_tasks" ADD CONSTRAINT "training_tasks_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "training_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_tasks" ADD CONSTRAINT "training_tasks_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_task_comments" ADD CONSTRAINT "training_task_comments_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "training_tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_checklist_template_items" ADD CONSTRAINT "training_checklist_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "training_checklist_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_project_checklist_items" ADD CONSTRAINT "training_project_checklist_items_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "training_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_project_checklist_items" ADD CONSTRAINT "training_project_checklist_items_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_instructors" ADD CONSTRAINT "training_instructors_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_project_instructors" ADD CONSTRAINT "training_project_instructors_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "training_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_project_instructors" ADD CONSTRAINT "training_project_instructors_instructorId_fkey" FOREIGN KEY ("instructorId") REFERENCES "training_instructors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_schedules" ADD CONSTRAINT "training_schedules_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "training_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_schedules" ADD CONSTRAINT "training_schedules_inchargeId_fkey" FOREIGN KEY ("inchargeId") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_schedules" ADD CONSTRAINT "training_schedules_projectInstructorId_fkey" FOREIGN KEY ("projectInstructorId") REFERENCES "training_project_instructors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_participants" ADD CONSTRAINT "training_participants_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "training_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_project_documents" ADD CONSTRAINT "training_project_documents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "training_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_project_documents" ADD CONSTRAINT "training_project_documents_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "stored_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_external_refs" ADD CONSTRAINT "training_external_refs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "training_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_project_assignment_links" ADD CONSTRAINT "training_project_assignment_links_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "training_projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "training_project_assignment_links" ADD CONSTRAINT "training_project_assignment_links_letterId_fkey" FOREIGN KEY ("letterId") REFERENCES "assignment_letters"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ═════════════════════════════════════════════════════════════════════════════════════════
-- Penjagaan integritas Training & Operations — defense in depth di level database.
-- Aplikasi sudah menegakkan aturan yang sama di service layer; bagian ini memastikan skrip ad-hoc atau bug
-- tidak dapat menyimpan data yang tidak konsisten. Pesan diawali "HRIS-GUARD:" (ditampilkan apa adanya ke pengguna).
-- Seluruh perubahan di bawah ini hanya menyentuh tabel training_* yang baru dibuat.
-- ═════════════════════════════════════════════════════════════════════════════════════════

-- Keunikan tanpa membedakan huruf besar/kecil
CREATE UNIQUE INDEX "training_programs_name_ci" ON "training_programs" (lower("name"));
CREATE UNIQUE INDEX "training_checklist_templates_name_ci" ON "training_checklist_templates" (lower("name"));

-- Penugasan: satu penugasan AKTIF per (proyek, karyawan); satu PROJECT_MANAGER (PIC) aktif per proyek.
CREATE UNIQUE INDEX "training_project_members_one_active" ON "training_project_members" ("projectId", "employeeId") WHERE "endedAt" IS NULL;
CREATE UNIQUE INDEX "training_project_members_one_pic" ON "training_project_members" ("projectId") WHERE "role" = 'PROJECT_MANAGER' AND "endedAt" IS NULL;

-- ─────────────────────────── CHECK constraints ───────────────────────────

ALTER TABLE "training_programs"
  ADD CONSTRAINT "training_programs_name_not_blank" CHECK (length(btrim("name")) > 0);

ALTER TABLE "training_projects"
  ADD CONSTRAINT "training_projects_name_not_blank" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "training_projects_code_format" CHECK ("code" ~ '^TRN-[0-9]{4}-[0-9]{4,}$'),
  ADD CONSTRAINT "training_projects_seq" CHECK ("seqYear" BETWEEN 2000 AND 2999 AND "seqNo" >= 1),
  ADD CONSTRAINT "training_projects_dates" CHECK ("startDate" IS NULL OR "endDate" IS NULL OR "endDate" >= "startDate"),
  -- Proyek yang sudah berjalan/selesai wajib bertanggal.
  ADD CONSTRAINT "training_projects_dates_required" CHECK (
    "status" IN ('DRAFT', 'CANCELLED') OR ("startDate" IS NOT NULL AND "endDate" IS NOT NULL)
  ),
  -- Penutupan & pembatalan tercatat lengkap dan konsisten dengan status.
  ADD CONSTRAINT "training_projects_closed_info" CHECK (
    ("status" = 'COMPLETED') = ("closedAt" IS NOT NULL AND "closedById" IS NOT NULL)
  ),
  ADD CONSTRAINT "training_projects_cancel_info" CHECK (
    ("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL AND length(btrim(coalesce("cancelReason", ''))) > 0)
  );

ALTER TABLE "training_project_members"
  ADD CONSTRAINT "training_project_members_period" CHECK ("endedAt" IS NULL OR "endedAt" >= "startedAt");

ALTER TABLE "training_tasks"
  ADD CONSTRAINT "training_tasks_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "training_tasks_done_info" CHECK (
    ("status" = 'DONE') = ("completedAt" IS NOT NULL AND "completedById" IS NOT NULL)
  );

ALTER TABLE "training_task_comments"
  ADD CONSTRAINT "training_task_comments_body" CHECK (length(btrim("body")) > 0);

ALTER TABLE "training_checklist_templates"
  ADD CONSTRAINT "training_checklist_templates_name_not_blank" CHECK (length(btrim("name")) > 0);

ALTER TABLE "training_checklist_template_items"
  ADD CONSTRAINT "training_checklist_template_items_values" CHECK (length(btrim("title")) > 0 AND "sortOrder" >= 0);

ALTER TABLE "training_project_checklist_items"
  ADD CONSTRAINT "training_project_checklist_items_values" CHECK (length(btrim("title")) > 0 AND "sortOrder" >= 0),
  ADD CONSTRAINT "training_project_checklist_items_done" CHECK (
    "isDone" = ("doneAt" IS NOT NULL AND "doneById" IS NOT NULL)
  );

ALTER TABLE "training_instructors"
  ADD CONSTRAINT "training_instructors_name_not_blank" CHECK (length(btrim("name")) > 0);

ALTER TABLE "training_schedules"
  ADD CONSTRAINT "training_schedules_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "training_schedules_period" CHECK ("endAt" > "startAt");

ALTER TABLE "training_participants"
  ADD CONSTRAINT "training_participants_name_not_blank" CHECK (length(btrim("fullName")) > 0);

ALTER TABLE "training_project_documents"
  ADD CONSTRAINT "training_project_documents_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "training_project_documents_deleted_info" CHECK (("deletedAt" IS NULL) = ("deletedById" IS NULL));

ALTER TABLE "training_external_refs"
  ADD CONSTRAINT "training_external_refs_value" CHECK (length(btrim("externalId")) > 0);

-- ─────────────────────────── Trigger ───────────────────────────

-- Komentar tugas: append-only (memakai fungsi yang sudah ada pada migrasi integrity_guards).
CREATE TRIGGER training_task_comments_append_only BEFORE UPDATE OR DELETE ON "training_task_comments"
  FOR EACH ROW EXECUTE FUNCTION trg_forbid_update_delete();

-- Proyek: tidak boleh dihapus (riwayat), dan alur status hanya yang sah.
--   DRAFT → PREPARATION | CANCELLED ; PREPARATION → RUNNING | COMPLETED | CANCELLED ; RUNNING → COMPLETED | CANCELLED
--   COMPLETED → RUNNING (dibuka kembali oleh Manajer Program, beralasan) ; CANCELLED = final.
CREATE FUNCTION trg_training_projects_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Proyek pelatihan tidak boleh dihapus. Selesaikan atau batalkan proyek.' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."status" IS DISTINCT FROM OLD."status" AND NOT (
       (OLD."status" = 'DRAFT'       AND NEW."status" IN ('PREPARATION', 'CANCELLED'))
    OR (OLD."status" = 'PREPARATION' AND NEW."status" IN ('RUNNING', 'COMPLETED', 'CANCELLED'))
    OR (OLD."status" = 'RUNNING'     AND NEW."status" IN ('COMPLETED', 'CANCELLED'))
    OR (OLD."status" = 'COMPLETED'   AND NEW."status" = 'RUNNING')
  ) THEN
    RAISE EXCEPTION 'HRIS-GUARD: Perubahan status proyek tidak sah (% → %)', OLD."status", NEW."status" USING ERRCODE = 'check_violation';
  END IF;
  -- Kode proyek tidak pernah berubah.
  IF NEW."code" IS DISTINCT FROM OLD."code" OR NEW."seqYear" IS DISTINCT FROM OLD."seqYear" OR NEW."seqNo" IS DISTINCT FROM OLD."seqNo" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Kode proyek tidak boleh diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER training_projects_guard BEFORE UPDATE OR DELETE ON "training_projects"
  FOR EACH ROW EXECUTE FUNCTION trg_training_projects_guard();

-- Dokumen proyek: tidak boleh dihapus; satu-satunya perubahan sah adalah menyembunyikan (deletedAt/deletedById, sekali).
CREATE FUNCTION trg_training_documents_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Dokumen proyek tidak boleh dihapus permanen' USING ERRCODE = 'restrict_violation';
  END IF;
  IF (to_jsonb(NEW) - 'deletedAt' - 'deletedById') IS DISTINCT FROM (to_jsonb(OLD) - 'deletedAt' - 'deletedById')
     OR (OLD."deletedAt" IS NOT NULL AND NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt") THEN
    RAISE EXCEPTION 'HRIS-GUARD: Dokumen proyek tidak boleh diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER training_project_documents_guard BEFORE UPDATE OR DELETE ON "training_project_documents"
  FOR EACH ROW EXECUTE FUNCTION trg_training_documents_guard();
