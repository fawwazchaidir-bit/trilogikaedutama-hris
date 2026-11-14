-- Kebijakan: 2FA WAJIB bagi Super Admin (Direktur) dan HR; Manajer/Staf/Magang tidak diwajibkan (fitur tetap tersedia bagi semua akun).
-- Menyalakan kebijakan pada instalasi yang sudah ada (baris pengaturan id = 1). Pada basis data kosong (uji/CI) tidak ada baris sehingga tidak berpengaruh.
-- Akun Direktur/HR yang belum ber-2FA diarahkan ke halaman Keamanan & Notifikasi pada permintaan berikutnya untuk mengaktifkannya; Super Admin dapat mematikan kebijakan di Pengaturan → Keamanan akun.
UPDATE "company_settings" SET "twoFactorRequiredForAdmins" = true WHERE "id" = 1;
