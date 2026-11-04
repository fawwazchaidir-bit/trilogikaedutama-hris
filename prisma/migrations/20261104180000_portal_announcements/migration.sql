-- Pesan banner beranda (broadcast Direktur). Murni penambahan; append-only.
-- CreateTable
CREATE TABLE "portal_announcements" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" DATE,
    "notifiedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_announcements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_announcements_createdAt_idx" ON "portal_announcements"("createdAt");


ALTER TABLE "portal_announcements"
  ADD CONSTRAINT "portal_announcements_values" CHECK (
    length(btrim("title")) BETWEEN 3 AND 120 AND ("body" IS NULL OR length("body") <= 500) AND "notifiedCount" >= 0
  );

-- Jejak pesan yang pernah dipasang di banner: tidak dapat diubah/dihapus (memakai fungsi yang sudah ada pada migrasi integrity_guards).
CREATE TRIGGER portal_announcements_append_only BEFORE UPDATE OR DELETE ON "portal_announcements"
  FOR EACH ROW EXECUTE FUNCTION trg_forbid_update_delete();
