-- Uang harian lewat DUA JALUR yang berjalan bersamaan (Bukti Penerimaan × penyelesaian akhir × pembatalan surat tugas).
--
-- Penjaga sebelumnya (migrasi 20261110170000) hanya MEMBACA: pada READ COMMITTED ia tidak melihat baris transaksi lawan yang belum commit, sehingga dua jalur
-- yang tumpang-tindih sama-sama lolos. Perbaikannya satu aturan penguncian: kunci advisory per SURAT TUGAS, yaitu hashtext('assign:' || <id surat>) — KUNCI YANG SAMA
-- dengan yang diambil layanan aplikasi (src/server/services/allowance-lock.ts). Aplikasi mengambilnya lebih dulu; trigger di bawah mengambilnya lagi (kunci advisory
-- bersifat re-entrant dalam satu sesi) sebagai JARING PENGAMAN, sehingga invarian tetap terjaga walau ada jalur baru atau SQL langsung.
--
-- Aturan bebas deadlock: beberapa surat selalu dikunci TERURUT menurut ID (ORDER BY uuid = urutan yang sama dengan pengurutan aplikasi); kunci surat diambil SESUDAH kunci baris
-- penyelesaian. Migrasi ini aditif: hanya mengganti isi dua fungsi trigger yang ada dan menambah dua trigger baru; tidak mengubah tabel/kolom/data.

-- Penjaga 1 (bukti): kunci surat dulu, baru periksa "uang harian ini sudah masuk penyelesaian akhir yang masih berlaku".
CREATE OR REPLACE FUNCTION trg_daily_allowance_receipts_settlement_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."status" = 'ACTIVE' THEN
    PERFORM pg_advisory_xact_lock(hashtext('assign:' || NEW."letterId"::text));
    IF EXISTS (
      SELECT 1 FROM "final_settlement_lines" l JOIN "final_settlements" s ON s."id" = l."settlementId"
      WHERE l."assigneeId" = NEW."assigneeId" AND s."status" <> 'CANCELLED'
    ) THEN
      RAISE EXCEPTION 'HRIS-GUARD: Uang harian ini sudah termasuk penyelesaian akhir yang masih berlaku; bukti penerimaan terpisah tidak dapat diterbitkan agar tidak dibayar dua kali' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Penjaga 2 (baris penyelesaian): kunci surat milik penerima itu dulu, baru periksa "sudah punya Bukti Penerimaan aktif".
CREATE OR REPLACE FUNCTION trg_final_settlement_lines_allowance_guard() RETURNS trigger AS $$
DECLARE
  v_letter uuid;
BEGIN
  IF NEW."assigneeId" IS NOT NULL THEN
    SELECT a."letterId" INTO v_letter FROM "assignment_assignees" a WHERE a."id" = NEW."assigneeId";
    IF v_letter IS NOT NULL THEN
      PERFORM pg_advisory_xact_lock(hashtext('assign:' || v_letter::text));
    END IF;
    IF EXISTS (SELECT 1 FROM "daily_allowance_receipts" r WHERE r."assigneeId" = NEW."assigneeId" AND r."status" = 'ACTIVE') THEN
      RAISE EXCEPTION 'HRIS-GUARD: Uang harian ini sudah memiliki Bukti Penerimaan aktif; tidak dapat dimasukkan ke penyelesaian akhir' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Penjaga 3 (BARU, status penyelesaian): saat diajukan / disetujui / dicatat dibayar, kunci semua surat tugas pada baris uang harian (terurut), lalu periksa ulang:
-- tidak ada baris yang kini sudah punya Bukti Penerimaan aktif dan tidak ada yang surat tugasnya sudah dibatalkan. Nama trigger mendahului final_settlements_guard (urutan abjad).
CREATE FUNCTION trg_final_settlements_allowance_guard() RETURNS trigger AS $$
DECLARE
  r record;
BEGIN
  IF NEW."status" IN ('PENDING_APPROVAL', 'APPROVED', 'PAID') AND NEW."status" <> OLD."status" THEN
    FOR r IN
      SELECT DISTINCT a."letterId" AS letter_id
      FROM "final_settlement_lines" l JOIN "assignment_assignees" a ON a."id" = l."assigneeId"
      WHERE l."settlementId" = NEW."id"
      ORDER BY 1
    LOOP
      PERFORM pg_advisory_xact_lock(hashtext('assign:' || r.letter_id::text));
    END LOOP;
    IF EXISTS (
      SELECT 1 FROM "final_settlement_lines" l
      JOIN "daily_allowance_receipts" rc ON rc."assigneeId" = l."assigneeId" AND rc."status" = 'ACTIVE'
      WHERE l."settlementId" = NEW."id"
    ) THEN
      RAISE EXCEPTION 'HRIS-GUARD: Ada uang harian pada penyelesaian akhir ini yang sudah memiliki Bukti Penerimaan aktif; hapus barisnya dari penyelesaian atau batalkan buktinya agar tidak dibayar dua kali' USING ERRCODE = 'restrict_violation';
    END IF;
    IF EXISTS (
      SELECT 1 FROM "final_settlement_lines" l
      JOIN "assignment_assignees" a ON a."id" = l."assigneeId"
      JOIN "assignment_letters" t ON t."id" = a."letterId"
      WHERE l."settlementId" = NEW."id" AND t."status" <> 'ISSUED'
    ) THEN
      RAISE EXCEPTION 'HRIS-GUARD: Ada uang harian pada penyelesaian akhir ini yang surat tugasnya sudah dibatalkan; hapus barisnya dari penyelesaian' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER final_settlements_allowance_guard BEFORE UPDATE OF "status" ON "final_settlements"
  FOR EACH ROW EXECUTE FUNCTION trg_final_settlements_allowance_guard();

-- Penjaga 4 (BARU, pembatalan surat tugas): kunci surat itu, lalu periksa — tidak boleh dibatalkan bila uang harian pada surat ini sudah termasuk penyelesaian akhir yang
-- disetujui/dibayar, atau masih punya Bukti Penerimaan aktif. Nama trigger mendahului assignment_letters_guard (urutan abjad).
CREATE FUNCTION trg_assignment_letters_cancel_allowance_guard() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'ISSUED' AND NEW."status" = 'CANCELLED' THEN
    PERFORM pg_advisory_xact_lock(hashtext('assign:' || NEW."id"::text));
    IF EXISTS (
      SELECT 1 FROM "final_settlement_lines" l
      JOIN "assignment_assignees" a ON a."id" = l."assigneeId"
      JOIN "final_settlements" s ON s."id" = l."settlementId"
      WHERE a."letterId" = NEW."id" AND s."status" IN ('APPROVED', 'PAID')
    ) THEN
      RAISE EXCEPTION 'HRIS-GUARD: Uang harian pada surat tugas ini sudah termasuk penyelesaian akhir yang disetujui/dibayar; batalkan atau koreksi penyelesaian akhirnya terlebih dahulu' USING ERRCODE = 'restrict_violation';
    END IF;
    IF EXISTS (SELECT 1 FROM "daily_allowance_receipts" rc WHERE rc."letterId" = NEW."id" AND rc."status" = 'ACTIVE') THEN
      RAISE EXCEPTION 'HRIS-GUARD: Masih ada Bukti Penerimaan Uang Harian yang aktif pada surat tugas ini; batalkan buktinya terlebih dahulu' USING ERRCODE = 'restrict_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER assignment_letters_cancel_allowance_guard BEFORE UPDATE OF "status" ON "assignment_letters"
  FOR EACH ROW EXECUTE FUNCTION trg_assignment_letters_cancel_allowance_guard();
