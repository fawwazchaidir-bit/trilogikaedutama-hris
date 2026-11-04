-- Urutan monoton pesan banner (pesan terbaru = seq terbesar). Murni penambahan.
-- AlterTable
ALTER TABLE "portal_announcements" ADD COLUMN     "seq" BIGSERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "portal_announcements_seq_key" ON "portal_announcements"("seq");

