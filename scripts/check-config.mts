/**
 * Pemeriksaan KESIAPAN konfigurasi sebelum deployment (Persuratan: surat tugas & uang harian). Hanya membaca.
 *   npm run check:config                 # kode keluar 1 bila ada masalah yang MENGHALANGI
 *   npm run check:config -- --strict     # peringatan juga dianggap gagal (disarankan di jalur deployment)
 *   npm run check:config -- --no-render  # lewati uji render PDF (lebih cepat)
 * Membaca DATABASE_URL & environment lain dari .env / environment proses, sama seperti aplikasi.
 * Berjalan sebagai ESM (.mts) dengan kondisi `react-server`: modul server memakai "server-only", dan mesin PDF (@react-pdf) hanya dapat dimuat lewat ESM.
 */
import "dotenv/config";
import { prisma } from "../src/server/db";
import { checkLettersReadiness } from "../src/server/services/letters/readiness";
import { exitCodeFor, formatReport } from "../src/lib/letters-readiness";

async function main() {
  const strict = process.argv.includes("--strict");
  const report = await checkLettersReadiness({ renderTest: !process.argv.includes("--no-render") });
  console.log(formatReport(report));
  if (!report.canCreateAssignments) console.log("\nSurat tugas BARU belum dapat dibuat pada konfigurasi ini.");
  process.exitCode = exitCodeFor(report, strict);
}
main().catch((e) => { console.error("check:config gagal dijalankan:", e instanceof Error ? e.message : e); process.exitCode = 2; }).finally(() => prisma.$disconnect());
