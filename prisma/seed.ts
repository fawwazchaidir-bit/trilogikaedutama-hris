/**
 * Seed PRODUKSI: pengaturan awal + jadwal default + SATU akun Super Admin.
 * Tidak ada data demo dan TIDAK ADA password default: gagal bila ADMIN_PASSWORD kosong/lemah.
 * Idempoten: aman dijalankan ulang (tidak menimpa data yang sudah ada).
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword, validatePasswordStrength } from "../src/server/auth/password";

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const name = (process.env.ADMIN_NAME ?? "Super Admin").trim();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!email) throw new Error("ADMIN_EMAIL wajib diisi untuk seed produksi.");
  const weak = validatePasswordStrength(password, { email, name });
  if (weak) throw new Error(`ADMIN_PASSWORD ditolak: ${weak}`);

  await prisma.companySettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1, name: "Trilogika Edutama", twoFactorRequiredForAdmins: true } });   // instalasi baru: 2FA wajib bagi Direktur & HR sejak awal

  // Contoh jam kerja 08.00–16.00 WIB (dapat diubah di menu Jadwal & Libur — perlu dikonfirmasi sesuai kebijakan perusahaan).
  if ((await prisma.workSchedule.count()) === 0) {
    await prisma.workSchedule.create({
      data: { name: "Reguler", description: "Contoh awal — sesuaikan dengan kebijakan perusahaan", workDays: [1, 2, 3, 4, 5], startTime: "08:00", endTime: "16:00", lateToleranceMinutes: 15, absentCutoffTime: "12:00", isDefault: true },
    });
    console.log("✔ Jadwal default 'Reguler' (Sen–Jum 08.00–16.00) dibuat — sesuaikan di menu Jadwal & Libur.");
  }

  if (await prisma.user.findUnique({ where: { email } })) {
    console.log(`• Akun ${email} sudah ada — dilewati.`);
  } else {
    const u = await prisma.user.create({ data: { email, name, role: "SUPER_ADMIN", passwordHash: await hashPassword(password), mustChangePassword: true } });
    await prisma.auditLog.create({ data: { actorEmail: "seed", action: "user.create", entityType: "User", entityId: u.id, summary: `Super Admin ${email} dibuat oleh seed produksi` } });
    console.log(`✔ Super Admin dibuat: ${email} (wajib ganti password saat login pertama).`);
  }
  console.log("\nLangkah berikut (lihat docs/PANDUAN-PENGGUNA.md): konfirmasi Pengaturan → tambah divisi & karyawan → isi hari libur → atur komponen gaji → konfirmasi aturan penggajian.");
}

main().catch((e) => { console.error(`Gagal: ${e instanceof Error ? e.message : e}`); process.exitCode = 1; }).finally(() => prisma.$disconnect());
