/**
 * Audit uang harian BACA-SAJA — jalankan sesudah migrasi pengaman uang harian diterapkan pada basis data yang berisi transaksi nyata.
 *
 *   DATABASE_URL=postgresql://… npm run audit:allowance            # laporan terbaca
 *   DATABASE_URL=postgresql://… npm run audit:allowance -- --json  # keluaran JSON
 *
 * Tidak mengubah data (seluruhnya dalam satu transaksi READ ONLY). Kode keluar:
 *   0 bersih · 2 ada temuan yang HARUS ditindaklanjuti · 3 migrasi/penjaga belum lengkap (jalankan `npm run db:migrate` dulu) · 4 hanya baris lama yang perlu diperiksa manual · 1 galat.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { runAllowanceAudit, type AllowanceFinding } from "../src/server/services/allowance-audit";

const rupiah = (n: number) => `Rp ${n.toLocaleString("id-ID")}`;
const LABEL: Record<AllowanceFinding["kind"], string> = {
  ACTIVE_RECEIPT: "TERCATAT DUA KALI (penyelesaian akhir + Bukti Penerimaan aktif)",
  UNLINKED_MATCH: "BARIS LAMA TAK TERTAUT, ada bukti aktif senilai itu (patut diduga ganda)",
  LETTER_CANCELLED: "SURAT TUGAS DIBATALKAN, baris masih berlaku",
  UNLINKED: "BARIS LAMA TAK TERTAUT (periksa manual)",
};

async function main() {
  const json = process.argv.includes("--json");
  const prisma = new PrismaClient();
  try {
    const r = await runAllowanceAudit(prisma as never);
    if (json) { console.log(JSON.stringify(r, null, 2)); process.exitCode = r.exitCode; return; }
    console.log(`Audit uang harian (baca-saja) — ${r.generatedAt}\n`);
    console.log("Migrasi pengaman:");
    for (const m of r.migrations) console.log(`  [${m.applied ? "OK" : "BELUM"}] ${m.name}`);
    console.log("Penjaga basis data (trigger):");
    for (const t of r.triggers) console.log(`  [${t.present ? "OK" : "HILANG"}] ${t.name}`);
    if (r.exitCode === 3) console.log("\n⚠ Migrasi/penjaga belum lengkap. Jalankan `npm run db:migrate` (prisma migrate deploy) lalu ulangi audit ini.");
    console.log(`\nBaris uang harian pada penyelesaian akhir yang berlaku: ${r.counts.settlementLines} (tertaut ${r.counts.linkedLines}, tak tertaut ${r.counts.unlinkedLines}); Bukti Penerimaan aktif: ${r.counts.activeReceipts}`);
    if (r.findings.length === 0) console.log("\n✔ Tidak ada temuan.");
    for (const f of r.findings) {
      console.log(`\n— ${LABEL[f.kind]}`);
      console.log(`  Karyawan   : ${f.employeeName} (${f.employeeNo})`);
      console.log(`  Penyelesaian: ${f.settlementId} [${f.settlementStatus}]`);
      console.log(`  Baris      : "${f.lineName}" ${rupiah(f.amount)} (${f.source === "SYSTEM" ? "usulan sistem" : "manual"})${f.formula ? ` — ${f.formula}` : ""}`);
      if (f.letterNumber) console.log(`  Surat tugas: ${f.letterNumber}`);
      if (f.receiptNumber) console.log(`  Bukti aktif: ${f.receiptNumber}${f.receiptTotal !== null ? ` (${rupiah(f.receiptTotal)})` : ""}`);
      if (f.kind.startsWith("UNLINKED")) console.log(`  Calon tautan: ${f.candidateAssignees} penerima tugas karyawan ini bernominal sama`);
      console.log(`  Tindak lanjut: ${f.action}`);
    }
    const code = r.exitCode;
    console.log(`\nKode keluar ${code}: ${code === 0 ? "bersih" : code === 2 ? "ADA temuan yang harus ditindaklanjuti" : code === 3 ? "migrasi/penjaga belum lengkap" : "hanya baris lama yang perlu diperiksa manual"}.`);
    process.exitCode = code;
  } finally { await prisma.$disconnect(); }
}
main().catch((e) => { console.error("Audit gagal:", e instanceof Error ? e.message : e); process.exit(1); });
