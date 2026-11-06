-- Penggajian: hash komponen gaji saat dihitung, agar perubahan komponen sesudahnya terdeteksi ("data berubah").
-- Aditif: kolom nullable tanpa default; item lama (NULL) tidak dinilai sehingga tidak ada periode lama yang mendadak ditandai berubah.
ALTER TABLE "payroll_items" ADD COLUMN "componentsHash" TEXT;
