-- Garis di bawah kop surat dapat diadakan atau ditiadakan (Pengaturan Persuratan). Aditif: baris lama tetap memakai garis (perilaku sebelumnya).
ALTER TABLE "letter_settings" ADD COLUMN "kopRule" BOOLEAN NOT NULL DEFAULT true;
