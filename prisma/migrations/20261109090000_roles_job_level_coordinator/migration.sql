-- Penyelarasan peran dengan SOP Rev 0.5.
-- 1) Level modul "Manajer Program" diganti nama menjadi "Koordinator Program" (nilai enum MANAGER -> COORDINATOR). Data akses yang ada ikut berganti otomatis.
ALTER TYPE "TrainingLevel" RENAME VALUE 'MANAGER' TO 'COORDINATOR';

-- 2) Tingkat jabatan eksplisit (Staf / Supervisor / Manajer), aditif dengan bawaan STAFF.
CREATE TYPE "JobLevel" AS ENUM ('STAFF', 'SUPERVISOR', 'MANAGER');
ALTER TABLE "employees" ADD COLUMN "jobLevel" "JobLevel" NOT NULL DEFAULT 'STAFF';
ALTER TABLE "employee_org_history" ADD COLUMN "jobLevel" "JobLevel" NOT NULL DEFAULT 'STAFF';

-- 3) Karyawan berstatus Magang hanya boleh bertingkat Staf (aturan wewenang SOP: tanpa wewenang persetujuan).
ALTER TABLE "employees" ADD CONSTRAINT "employees_intern_staff_level" CHECK ("employmentStatus" <> 'INTERN' OR "jobLevel" = 'STAFF');
