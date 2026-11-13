import "server-only";
import type { Tx } from "../db";

/**
 * SATU aturan penguncian untuk uang harian: kunci advisory per SURAT TUGAS (`assign:<letterId>`).
 *
 * Uang harian bisa tercatat lewat dua jalur — Bukti Penerimaan (`issueReceipt`) dan penyelesaian akhir — dan surat tugasnya bisa dibatalkan. Penjaga yang hanya
 * MEMBACA (pemeriksaan service dan trigger database) tidak melihat transaksi lawan yang belum commit (READ COMMITTED), sehingga dua jalur yang berjalan
 * bersamaan sama-sama lolos. Semua jalur di bawah ini mengambil kunci yang SAMA (dan trigger database mengambilnya lagi sebagai jaring pengaman):
 *   · terbitkan Bukti Penerimaan, batalkan surat tugas (`assignments.ts`),
 *   · buat / ubah / hitung ulang penyelesaian akhir, ajukan, setujui, catat dibayar (`final-settlements.ts`).
 * Sesudah kunci diperoleh, pemeriksaan DIBACA ULANG (pernyataan baru → melihat commit transaksi yang tadi memegang kunci).
 *
 * Aturan pakai (bebas deadlock): beberapa surat selalu dikunci TERURUT menurut ID (urutan yang sama dengan trigger database: `ORDER BY` uuid = urutan teks heksadesimal),
 * dan di jalur penyelesaian akhir kunci surat diambil SESUDAH kunci baris penyelesaian. Jalur bukti/pembatalan hanya memegang satu kunci surat.
 */
export const allowanceLockKey = (letterId: string): string => `assign:${letterId}`;

export async function lockAllowanceLetters(tx: Tx, letterIds: readonly string[]): Promise<void> {
  for (const id of [...new Set(letterIds)].sort()) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${allowanceLockKey(id)}))`;
}

/** Semua surat tugas yang menugaskan karyawan ini (kandidat uang harian pada penyelesaian akhirnya). */
export async function lettersOfEmployee(tx: Tx, employeeId: string): Promise<string[]> {
  const rows = await tx.assignmentAssignee.findMany({ where: { employeeId }, select: { letterId: true }, distinct: ["letterId"] });
  return rows.map((r) => r.letterId);
}

/** Surat tugas dari baris uang harian yang SUDAH ada pada penyelesaian akhir ini. */
export async function lettersOfSettlement(tx: Tx, settlementId: string): Promise<string[]> {
  const rows = await tx.finalSettlementLine.findMany({ where: { settlementId, assigneeId: { not: null } }, select: { assignee: { select: { letterId: true } } } });
  return rows.flatMap((r) => (r.assignee ? [r.assignee.letterId] : []));
}

/** Surat tugas dari sekumpulan penerima (baris usulan uang harian yang baru dihitung) — untuk memastikan semuanya sudah terkunci. */
export async function lettersOfAssignees(tx: Tx, assigneeIds: readonly string[]): Promise<string[]> {
  if (assigneeIds.length === 0) return [];
  const rows = await tx.assignmentAssignee.findMany({ where: { id: { in: [...assigneeIds] } }, select: { letterId: true }, distinct: ["letterId"] });
  return rows.map((r) => r.letterId);
}
