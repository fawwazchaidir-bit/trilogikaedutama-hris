-- Pemisahan pelaksana / pengirim hasil / pemeriksa pada tugas wajib periksa (Training & Operations).
ALTER TABLE "training_tasks" ADD COLUMN     "assigneeAtSubmitId" UUID,
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedById" UUID,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedById" UUID;

-- Data lama: tugas yang SEDANG menunggu pemeriksaan — pengirim & waktu diambil dari catatan audit perpindahan status terakhir ke "Menunggu pemeriksaan";
-- pelaksana = penanggung jawab saat ini (perkiraan terbaik). Tugas yang sudah selesai tidak diubah.
UPDATE "training_tasks" t SET "submittedById" = a."actorId", "submittedAt" = a."createdAt", "assigneeAtSubmitId" = t."assigneeId"
FROM (
  SELECT DISTINCT ON (l."after"->>'taskId') l."after"->>'taskId' AS task_id, l."actorId", l."createdAt"
  FROM "audit_logs" l
  WHERE l."action" = 'training.task.status' AND l."after"->>'status' = 'IN_REVIEW' AND l."actorId" IS NOT NULL
  ORDER BY l."after"->>'taskId', l."id" DESC
) a
WHERE t."id"::text = a.task_id AND t."status" = 'IN_REVIEW' AND t."submittedById" IS NULL;

-- Penjaga di database: tugas wajib periksa hanya selesai dari "Menunggu pemeriksaan", dan pemeriksa (completedById) BUKAN pengirim hasil,
-- BUKAN pelaksana saat dikirim, dan BUKAN penanggung jawab saat ini. Melengkapi pemeriksaan service agar tidak ada jalur lain yang melewatinya.
CREATE FUNCTION trg_training_tasks_review_guard() RETURNS trigger AS $$
DECLARE reviewer_emp uuid;
BEGIN
  IF NEW."status" = 'DONE' AND OLD."status" <> 'DONE' AND NEW."requiresReview" THEN
    IF OLD."status" <> 'IN_REVIEW' THEN
      RAISE EXCEPTION 'HRIS-GUARD: Tugas wajib periksa hanya dapat diselesaikan dari status Menunggu pemeriksaan' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."completedById" IS NULL THEN
      RAISE EXCEPTION 'HRIS-GUARD: Pemeriksa tugas wajib tercatat' USING ERRCODE = 'restrict_violation';
    END IF;
    IF NEW."submittedById" IS NOT NULL AND NEW."completedById" = NEW."submittedById" THEN
      RAISE EXCEPTION 'HRIS-GUARD: Pemeriksa tidak boleh orang yang mengirim hasil ke pemeriksaan' USING ERRCODE = 'restrict_violation';
    END IF;
    SELECT e."id" INTO reviewer_emp FROM "employees" e WHERE e."userId" = NEW."completedById";
    IF reviewer_emp IS NOT NULL AND (reviewer_emp = NEW."assigneeAtSubmitId" OR reviewer_emp = NEW."assigneeId") THEN
      RAISE EXCEPTION 'HRIS-GUARD: Pemeriksa tidak boleh pelaksana tugas itu sendiri' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER training_tasks_review_guard BEFORE UPDATE ON "training_tasks"
  FOR EACH ROW EXECUTE FUNCTION trg_training_tasks_review_guard();
