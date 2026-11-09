-- Obrolan: penghitung revisi ruang (bel SSE untuk sunting/hapus) + retensi riwayat sunting (hanya boleh dihapus bila pesan induknya sudah dibersihkan retensi).

-- AlterTable
ALTER TABLE "chat_rooms" ADD COLUMN     "rev" BIGINT NOT NULL DEFAULT 0;


CREATE OR REPLACE FUNCTION chat_message_revisions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM "chat_messages" m WHERE m."id" = OLD."messageId" AND m."purgedAt" IS NOT NULL) THEN
    RETURN OLD; -- retensi: isi lama ikut dihapus setelah pesan induknya dibersihkan
  END IF;
  RAISE EXCEPTION 'HRIS-GUARD: Riwayat sunting pesan bersifat tambah-saja' USING ERRCODE = 'restrict_violation';
END $$ LANGUAGE plpgsql;
