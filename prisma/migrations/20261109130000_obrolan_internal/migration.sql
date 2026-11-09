-- Obrolan internal (live chat): japri, kanal publik, utas penugasan. Rancangan: docs/OBROLAN.md. Aditif: enum & tabel baru + dua kolom nullable pada notification_deliveries.
-- Tabel anggota hanya untuk belum-dibaca & preferensi; izin dihitung di service (japri = dua anggota, kanal = akun aktif, utas = gerbang modul asal).

-- CreateEnum
CREATE TYPE "ChatRoomKind" AS ENUM ('DIRECT', 'CHANNEL', 'SUBJECT');

-- CreateEnum
CREATE TYPE "ChatSubjectType" AS ENUM ('ASSIGNMENT_LETTER', 'TRAINING_PROJECT', 'TRAINING_TASK');

-- CreateEnum
CREATE TYPE "ChatNotifyMode" AS ENUM ('ALL', 'MENTIONS', 'NONE');

-- CreateEnum
CREATE TYPE "ChatMessageKind" AS ENUM ('TEXT', 'SYSTEM');

-- AlterTable
ALTER TABLE "notification_deliveries" ADD COLUMN     "href" TEXT,
ADD COLUMN     "tag" TEXT;

-- CreateTable
CREATE TABLE "chat_rooms" (
    "id" UUID NOT NULL,
    "kind" "ChatRoomKind" NOT NULL,
    "name" TEXT,
    "slug" TEXT,
    "directKey" TEXT,
    "subjectType" "ChatSubjectType",
    "subjectId" UUID,
    "archivedAt" TIMESTAMP(3),
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "lastSeq" BIGINT NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_members" (
    "roomId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadSeq" BIGINT NOT NULL DEFAULT 0,
    "lastActiveAt" TIMESTAMP(3),
    "lastPushAt" TIMESTAMP(3),
    "notifyMode" "ChatNotifyMode" NOT NULL DEFAULT 'ALL',
    "mutedUntil" TIMESTAMP(3),

    CONSTRAINT "chat_members_pkey" PRIMARY KEY ("roomId","userId")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "seq" BIGINT NOT NULL,
    "senderId" UUID NOT NULL,
    "kind" "ChatMessageKind" NOT NULL DEFAULT 'TEXT',
    "body" TEXT,
    "clientMsgId" UUID NOT NULL,
    "replyToId" UUID,
    "refs" JSONB,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "deletedById" UUID,
    "deleteReason" TEXT,
    "purgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_mentions" (
    "messageId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "seq" BIGINT NOT NULL,

    CONSTRAINT "chat_mentions_pkey" PRIMARY KEY ("messageId","userId")
);

-- CreateTable
CREATE TABLE "chat_message_revisions" (
    "id" UUID NOT NULL,
    "messageId" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "editedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_rooms_slug_key" ON "chat_rooms"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "chat_rooms_directKey_key" ON "chat_rooms"("directKey");

-- CreateIndex
CREATE INDEX "chat_rooms_kind_idx" ON "chat_rooms"("kind");

-- CreateIndex
CREATE UNIQUE INDEX "chat_rooms_subjectType_subjectId_key" ON "chat_rooms"("subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "chat_members_userId_idx" ON "chat_members"("userId");

-- CreateIndex
CREATE INDEX "chat_messages_roomId_seq_idx" ON "chat_messages"("roomId", "seq" DESC);

-- CreateIndex
CREATE INDEX "chat_messages_createdAt_idx" ON "chat_messages"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_roomId_seq_key" ON "chat_messages"("roomId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_roomId_senderId_clientMsgId_key" ON "chat_messages"("roomId", "senderId", "clientMsgId");

-- CreateIndex
CREATE INDEX "chat_mentions_userId_roomId_seq_idx" ON "chat_mentions"("userId", "roomId", "seq");

-- CreateIndex
CREATE INDEX "chat_message_revisions_messageId_idx" ON "chat_message_revisions"("messageId");

-- AddForeignKey
ALTER TABLE "chat_members" ADD CONSTRAINT "chat_members_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "chat_rooms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ─────────────── Penjaga integritas (gaya HRIS-GUARD) ───────────────

-- Bentuk ruang: japri ⇔ directKey; kanal ⇔ slug+nama; utas ⇔ subjectType+subjectId. Tidak boleh bercampur.
ALTER TABLE "chat_rooms" ADD CONSTRAINT "chat_rooms_shape" CHECK (
  ("kind" = 'DIRECT'  AND "directKey" IS NOT NULL AND "slug" IS NULL AND "subjectType" IS NULL AND "subjectId" IS NULL)
  OR ("kind" = 'CHANNEL' AND "slug" IS NOT NULL AND "name" IS NOT NULL AND "directKey" IS NULL AND "subjectType" IS NULL AND "subjectId" IS NULL)
  OR ("kind" = 'SUBJECT' AND "subjectType" IS NOT NULL AND "subjectId" IS NOT NULL AND "directKey" IS NULL AND "slug" IS NULL)
);
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_body_len" CHECK ("body" IS NULL OR char_length("body") <= 4000);
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_seq_pos" CHECK ("seq" > 0);

-- Pesan tidak pernah di-DELETE; kolom identitas terkunci; isi hanya berubah lewat sunting (editedAt berubah) atau retensi (isi NULL + purgedAt).
CREATE OR REPLACE FUNCTION chat_messages_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'HRIS-GUARD: Pesan obrolan tidak boleh dihapus' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."roomId" IS DISTINCT FROM OLD."roomId" OR NEW."seq" IS DISTINCT FROM OLD."seq" OR NEW."senderId" IS DISTINCT FROM OLD."senderId"
     OR NEW."clientMsgId" IS DISTINCT FROM OLD."clientMsgId" OR NEW."kind" IS DISTINCT FROM OLD."kind" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR NEW."replyToId" IS DISTINCT FROM OLD."replyToId" OR NEW."refs" IS DISTINCT FROM OLD."refs" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Identitas pesan obrolan tidak boleh diubah' USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW."body" IS DISTINCT FROM OLD."body" AND NOT (NEW."editedAt" IS DISTINCT FROM OLD."editedAt" OR (NEW."body" IS NULL AND NEW."purgedAt" IS NOT NULL)) THEN
    RAISE EXCEPTION 'HRIS-GUARD: Isi pesan hanya dapat berubah lewat sunting atau retensi' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."purgedAt" IS NOT NULL AND (NEW."body" IS NOT NULL OR NEW."purgedAt" IS DISTINCT FROM OLD."purgedAt") THEN
    RAISE EXCEPTION 'HRIS-GUARD: Pesan yang sudah dibersihkan retensi tidak dapat dipulihkan' USING ERRCODE = 'restrict_violation';
  END IF;
  IF OLD."deletedAt" IS NOT NULL AND NEW."deletedAt" IS DISTINCT FROM OLD."deletedAt" THEN
    RAISE EXCEPTION 'HRIS-GUARD: Pesan yang sudah dihapus tidak dapat dikembalikan' USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "chat_messages_guard" BEFORE UPDATE OR DELETE ON "chat_messages" FOR EACH ROW EXECUTE FUNCTION chat_messages_guard();

-- Revisi sunting: tambah-saja.
CREATE OR REPLACE FUNCTION chat_message_revisions_guard() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'HRIS-GUARD: Riwayat sunting pesan bersifat tambah-saja' USING ERRCODE = 'restrict_violation';
END $$ LANGUAGE plpgsql;
CREATE TRIGGER "chat_message_revisions_append_only" BEFORE UPDATE OR DELETE ON "chat_message_revisions" FOR EACH ROW EXECUTE FUNCTION chat_message_revisions_guard();
