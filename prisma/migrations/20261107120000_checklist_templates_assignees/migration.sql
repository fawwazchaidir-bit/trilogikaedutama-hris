-- AlterTable
ALTER TABLE "employee_checklist_items" ADD COLUMN     "assigneeId" UUID,
ADD COLUMN     "dueDate" DATE;

-- CreateTable
CREATE TABLE "employee_checklist_template_items" (
    "id" UUID NOT NULL,
    "kind" "ChecklistKind" NOT NULL,
    "key" TEXT NOT NULL,
    "groupLabel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "hint" TEXT,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "defaultAssigneeId" UUID,
    "dueOffsetDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_checklist_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_checklist_reminder_log" (
    "id" UUID NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "itemId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_checklist_reminder_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_checklist_template_items_kind_key_key" ON "employee_checklist_template_items"("kind", "key");

-- CreateIndex
CREATE UNIQUE INDEX "employee_checklist_reminder_log_dedupeKey_key" ON "employee_checklist_reminder_log"("dedupeKey");

-- CreateIndex
CREATE INDEX "employee_checklist_items_assigneeId_status_idx" ON "employee_checklist_items"("assigneeId", "status");


-- ─────────────────────────── Aturan (aditif) ───────────────────────────
ALTER TABLE "employee_checklist_template_items" ADD CONSTRAINT "employee_checklist_template_items_values" CHECK (
  length(btrim("title")) > 0 AND ("dueOffsetDays" IS NULL OR "dueOffsetDays" BETWEEN 0 AND 365)
);
