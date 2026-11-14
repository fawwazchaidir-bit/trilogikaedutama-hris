-- Kaki halaman (footer) persuratan: tiga zona teks + gaya. ADITIF; baris pengaturan yang ada memperoleh bawaan yang meniru tampilan lama
-- (teks lembaga di kiri = kolom "footerText" yang sudah ada; "Hal. X dari Y" di kanan; miring, abu-abu, 8,5 pt, Liberation Serif).
ALTER TABLE "letter_settings"
  ADD COLUMN "footerEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "footerCenter" TEXT,
  ADD COLUMN "footerRight" TEXT DEFAULT 'Hal. {halaman} dari {total}',
  ADD COLUMN "footerFont" TEXT NOT NULL DEFAULT 'LIBERATION_SERIF',
  ADD COLUMN "footerSize" DOUBLE PRECISION NOT NULL DEFAULT 8.5,
  ADD COLUMN "footerBold" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "footerItalic" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "footerUnderline" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "footerColor" TEXT NOT NULL DEFAULT '#444444',
  ADD COLUMN "footerRule" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "footerFirstPage" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "footerAttachments" BOOLEAN NOT NULL DEFAULT true;

-- Pagar basis data (pertahanan berlapis; validasi utama ada di layanan): ukuran, warna, dan pilihan font.
ALTER TABLE "letter_settings"
  ADD CONSTRAINT "letter_settings_footer_size_chk" CHECK ("footerSize" >= 6 AND "footerSize" <= 14),
  ADD CONSTRAINT "letter_settings_footer_color_chk" CHECK ("footerColor" ~ '^#[0-9a-fA-F]{6}$'),
  ADD CONSTRAINT "letter_settings_footer_font_chk" CHECK ("footerFont" IN ('LIBERATION_SERIF', 'LIBERATION_SANS', 'CALADEA', 'CARLITO'));
