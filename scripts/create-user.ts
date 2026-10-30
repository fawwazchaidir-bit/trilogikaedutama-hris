/**
 * Membuat akun dari command line (mis. Super Admin tambahan atau pemulihan akses).
 *   NEW_USER_PASSWORD='…' npm run user:create -- --email a@b.id --name "Nama" --role SUPER_ADMIN
 * Password dibaca dari environment (bukan argumen, agar tidak tersimpan di riwayat shell/ps).
 * Peran EMPLOYEE harus ditautkan ke karyawan: tambahkan --employee-no TE-001.
 */
import "dotenv/config";
import { PrismaClient, type Role } from "@prisma/client";
import { hashPassword, validatePasswordStrength } from "../src/server/auth/password";

const prisma = new PrismaClient();
const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : undefined; };

async function main() {
  const email = arg("email")?.trim().toLowerCase();
  const name = arg("name")?.trim();
  const role = arg("role")?.toUpperCase() as Role | undefined;
  const employeeNo = arg("employee-no")?.trim();
  const password = process.env.NEW_USER_PASSWORD ?? "";
  if (!email || !name || !role || !["SUPER_ADMIN", "HR_ADMIN", "EMPLOYEE"].includes(role)) throw new Error("Gunakan: --email <email> --name <nama> --role SUPER_ADMIN|HR_ADMIN|EMPLOYEE [--employee-no <no. induk>] (password lewat env NEW_USER_PASSWORD)");
  const weak = validatePasswordStrength(password, { email, name });
  if (weak) throw new Error(`Password ditolak: ${weak}`);
  if (await prisma.user.findUnique({ where: { email } })) throw new Error("Email sudah terdaftar.");
  const emp = employeeNo ? await prisma.employee.findFirst({ where: { employeeNo: { equals: employeeNo, mode: "insensitive" } } }) : null;
  if (employeeNo && !emp) throw new Error(`Karyawan dengan no. induk ${employeeNo} tidak ditemukan.`);
  if (emp?.userId) throw new Error("Karyawan tersebut sudah memiliki akun.");
  if (role === "EMPLOYEE" && !emp) throw new Error("Peran EMPLOYEE wajib memakai --employee-no.");
  const u = await prisma.user.create({ data: { email, name, role, passwordHash: await hashPassword(password), mustChangePassword: true } });
  if (emp) await prisma.employee.update({ where: { id: emp.id }, data: { userId: u.id } });
  await prisma.auditLog.create({ data: { actorEmail: "cli", action: "user.create", entityType: "User", entityId: u.id, summary: `Akun ${email} (${role}) dibuat lewat CLI` } });
  console.log(`✔ Akun dibuat: ${email} (${role}). Wajib ganti password saat login pertama.`);
}
main().catch((e) => { console.error(`Gagal: ${e instanceof Error ? e.message : e}`); process.exitCode = 1; }).finally(() => prisma.$disconnect());
