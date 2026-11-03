-- Penanda tangan slip gaji (nama, jabatan, kota, gambar tanda tangan) — diatur Super Admin; dibekukan pada snapshot slip saat terbit.


-- AlterEnum
ALTER TYPE "FileKind" ADD VALUE 'SIGNATURE';

-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "slipSignatureFileId" UUID,
ADD COLUMN     "slipSignerName" TEXT,
ADD COLUMN     "slipSignerPlace" TEXT,
ADD COLUMN     "slipSignerTitle" TEXT;

