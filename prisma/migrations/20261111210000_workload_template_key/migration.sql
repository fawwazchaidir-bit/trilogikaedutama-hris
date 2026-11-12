-- Tugas jam kerja (indikator Beban Tim): identitas asal template yang TETAP + penanda "sudah disesuaikan" terpisah dari asal.
-- Memperbaiki hitung ganda: baris template yang diedit/diselesaikan dulu berubah menjadi MANUAL sehingga hitung ulang membuat baris template yang sama lagi.
-- Aditif. Baris LAMA tidak diubah di sini: asalnya ditentukan saat dihitung ulang bila pasti, atau ditinjau pengguna bila meragukan (tanpa menebak).

-- AlterTable
ALTER TABLE "training_workload_tasks" ADD COLUMN     "templateKey" TEXT,
ADD COLUMN     "adjusted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "adjustedAt" TIMESTAMP(3),
ADD COLUMN     "originReviewedAt" TIMESTAMP(3);

-- CreateIndex (NULL tidak dianggap sama: baris manual / lama boleh banyak; satu baris asal template per proyek + ID)
CREATE UNIQUE INDEX "training_workload_tasks_projectId_templateKey_key" ON "training_workload_tasks"("projectId", "templateKey");
