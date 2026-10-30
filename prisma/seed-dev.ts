/**
 * Seed DEMONSTRASI (`npm run db:seed:dev`): data fiktif + akun demo untuk menguji seluruh alur.
 * MENOLAK berjalan bila NODE_ENV=production atau database bukan lokal, atau bila database sudah berisi data.
 * Password akun demo: DEV_SEED_PASSWORD, atau acak dan dicetak SEKALI di terminal.
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { seedDemo } from "./seed-demo";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Seed demo DITOLAK: NODE_ENV=production.");
  const url = process.env.DATABASE_URL ?? "";
  const host = (() => { try { return new URL(url).hostname; } catch { return ""; } })();
  if (!["localhost", "127.0.0.1", "::1", "db", "postgres"].includes(host)) throw new Error(`Seed demo DITOLAK: database "${host || "?"}" bukan database lokal.`);
  if ((await prisma.employee.count()) > 0 || (await prisma.user.count()) > 0) throw new Error("Seed demo DITOLAK: database sudah berisi data. Gunakan database kosong (mis. `npx prisma migrate reset`).");

  const generated = !process.env.DEV_SEED_PASSWORD;
  const password = process.env.DEV_SEED_PASSWORD || `Demo-${randomBytes(9).toString("base64url")}`;
  const r = await seedDemo(prisma, { password });
  console.log(`\n✔ Data demo dibuat (${r.employees} karyawan, absensi ±3 bulan, 1 periode gaji terbit, 1 menunggu persetujuan).`);
  console.log("\nAKUN DEMONSTRASI — HANYA UNTUK PENGUJIAN (ditandai 'demo' di aplikasi):");
  for (const [k, email] of Object.entries(r.accounts)) console.log(`  ${k.padEnd(9)} ${email}`);
  console.log(generated ? `\n  Password (dicetak sekali): ${password}` : "\n  Password: nilai DEV_SEED_PASSWORD");
  console.log("\nNilai aturan penggajian & BPJS pada data demo hanyalah CONTOH — bukan tarif resmi.");
}

main().catch((e) => { console.error(`Gagal: ${e instanceof Error ? e.message : e}`); process.exitCode = 1; }).finally(() => prisma.$disconnect());
