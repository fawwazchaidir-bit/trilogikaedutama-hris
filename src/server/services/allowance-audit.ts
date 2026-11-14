/**
 * AUDIT uang harian BACA-SAJA untuk data nyata (dipakai skrip operasional `npm run audit:allowance` dan tes). Dijalankan setelah migrasi pengaman uang harian diterapkan.
 *
 * Tidak mengubah apa pun: seluruh pemeriksaan berjalan dalam satu transaksi `READ ONLY` (basis data sendiri yang menolak tulis). Sengaja TANPA `server-only` dan tanpa aktor:
 * skrip dijalankan operator di server, bukan lewat sesi pengguna. (Rute `GET /api/final-settlements/audit-allowance` untuk pimpinan tetap ada dan memakai aturan yang sama
 * untuk dua temuan pertama.)
 *
 * Temuan:
 *  - ACTIVE_RECEIPT   : baris penyelesaian akhir (belum dibatalkan) yang tertaut ke penerima tugas yang JUGA punya Bukti Penerimaan aktif → uang harian tercatat DUA kali.
 *  - LETTER_CANCELLED : baris tertaut ke surat tugas yang sudah dibatalkan, padahal penyelesaiannya masih berlaku.
 *  - UNLINKED_MATCH   : baris uang harian LAMA yang tidak dapat ditautkan otomatis oleh migrasi (rumus tanpa nomor surat, baris manual, kecocokan ganda), DAN karyawan itu punya Bukti
 *                       Penerimaan aktif dengan nominal yang sama → patut diduga dibayar dua kali; periksa manual.
 *  - UNLINKED         : baris uang harian lama lain yang tidak tertaut (tidak ada bukti aktif senilai itu): periksa manual apakah uang harian itu sudah dibayar lewat jalur lain.
 */

export const ALLOWANCE_MIGRATIONS = ["20261110170000_settlement_allowance_link", "20261113120000_allowance_two_path_locks"] as const;
export const ALLOWANCE_TRIGGERS = ["daily_allowance_receipts_settlement_guard", "final_settlement_lines_allowance_guard", "final_settlements_allowance_guard", "assignment_letters_cancel_allowance_guard"] as const;

export type AllowanceFindingKind = "ACTIVE_RECEIPT" | "LETTER_CANCELLED" | "UNLINKED_MATCH" | "UNLINKED";
/** Temuan yang HARUS ditindaklanjuti (sudah/hampir pasti bermasalah) — berbeda dari UNLINKED yang hanya "perlu diperiksa". */
export const BLOCKING_KINDS: readonly AllowanceFindingKind[] = ["ACTIVE_RECEIPT", "LETTER_CANCELLED", "UNLINKED_MATCH"];

export interface AllowanceFinding {
  kind: AllowanceFindingKind;
  settlementId: string; settlementStatus: string; employeeNo: string; employeeName: string;
  lineId: string; lineName: string; amount: number; source: string; formula: string | null;
  letterNumber: string | null; receiptNumber: string | null; receiptTotal: number | null;
  /** Jumlah penerima tugas karyawan ini yang nominalnya sama (calon tautan, untuk pemeriksaan manual). */
  candidateAssignees: number;
  action: string;
}
export interface AllowanceAuditReport {
  generatedAt: string;
  migrations: { name: string; applied: boolean }[];
  triggers: { name: string; present: boolean }[];
  counts: { settlementLines: number; linkedLines: number; unlinkedLines: number; activeReceipts: number };
  findings: AllowanceFinding[];
  /** 0 = bersih; 2 = ada temuan yang harus ditindaklanjuti; 3 = migrasi/penjaga belum lengkap; hanya UNLINKED = 4 (periksa manual). */
  exitCode: 0 | 2 | 3 | 4;
}

/** Subset PrismaClient yang dibutuhkan (dapat diganti klien lain pada tes). */
interface Db { $transaction: <T>(fn: (tx: Tx) => Promise<T>) => Promise<T> }
interface Tx { $executeRawUnsafe: (sql: string) => Promise<unknown>; $queryRawUnsafe: <T>(sql: string, ...values: unknown[]) => Promise<T> }

const ACTIONS: Record<AllowanceFindingKind, string> = {
  ACTIVE_RECEIPT: "Uang harian ini tercatat dua kali. Batalkan Bukti Penerimaan (Super Admin) ATAU kembalikan/batalkan penyelesaian akhirnya sebelum dibayar; jangan membayar keduanya.",
  LETTER_CANCELLED: "Surat tugasnya sudah dibatalkan tetapi barisnya masih ada. Hapus baris itu dari penyelesaian (bila masih Draf) atau kembalikan/batalkan penyelesaiannya.",
  UNLINKED_MATCH: "Baris lama yang tidak tertaut, dan karyawan ini punya Bukti Penerimaan aktif senilai itu. Pastikan satu uang harian tidak dibayar dua kali (lihat nomor bukti); bila ya, koreksi lewat pembatalan.",
  UNLINKED: "Baris lama yang tidak dapat dikenali otomatis. Periksa manual: apakah uang harian ini sudah dibayar lewat jalur lain, dan surat tugas mana asalnya.",
};

export async function runAllowanceAudit(db: Db, now: Date = new Date()): Promise<AllowanceAuditReport> {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");   // tulis ditolak oleh basis data sendiri

    const mig = await tx.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM "_prisma_migrations" WHERE migration_name = ANY($1::text[]) AND finished_at IS NOT NULL AND rolled_back_at IS NULL`, [...ALLOWANCE_MIGRATIONS]);
    const trg = await tx.$queryRawUnsafe<{ tgname: string }[]>(`SELECT tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname = ANY($1::text[])`, [...ALLOWANCE_TRIGGERS]);
    const applied = new Set(mig.map((m) => m.migration_name));
    const present = new Set(trg.map((t) => t.tgname));
    const migrations = ALLOWANCE_MIGRATIONS.map((name) => ({ name, applied: applied.has(name) }));
    const triggers = ALLOWANCE_TRIGGERS.map((name) => ({ name, present: present.has(name) }));

    // Kolom "assigneeId" baru ada setelah migrasi pertama: tanpa itu pemeriksaan data tidak dapat dilakukan (hanya laporan migrasi).
    const hasColumn = (await tx.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM information_schema.columns WHERE table_name = 'final_settlement_lines' AND column_name = 'assigneeId'`))[0]!.n > 0n;
    if (!hasColumn) {
      return { generatedAt: now.toISOString(), migrations, triggers, counts: { settlementLines: 0, linkedLines: 0, unlinkedLines: 0, activeReceipts: 0 }, findings: [], exitCode: 3 } as AllowanceAuditReport;
    }

    const base = `
      SELECT l."id" AS "lineId", l."name" AS "lineName", l."amount"::text AS amount, l."source"::text AS source, l."formula", l."assigneeId",
             s."id" AS "settlementId", s."status"::text AS "settlementStatus", s."employeeId",
             e."employeeNo", e."fullName" AS "employeeName"
      FROM "final_settlement_lines" l
      JOIN "final_settlements" s ON s."id" = l."settlementId" AND s."status"::text <> 'CANCELLED'
      JOIN "employees" e ON e."id" = s."employeeId"
      WHERE l."category"::text = 'UNPAID_ALLOWANCE'`;
    type Row = { lineId: string; lineName: string; amount: string; source: string; formula: string | null; assigneeId: string | null; settlementId: string; settlementStatus: string; employeeId: string; employeeNo: string; employeeName: string };
    const lines = await tx.$queryRawUnsafe<Row[]>(`${base} ORDER BY s."createdAt" DESC, l."sortOrder" ASC`);

    const receipts = await tx.$queryRawUnsafe<{ id: string; number: string; total: string; assigneeId: string; employeeId: string }[]>(
      `SELECT r."id", r."number", r."total"::text AS total, r."assigneeId", r."employeeId" FROM "daily_allowance_receipts" r WHERE r."status"::text = 'ACTIVE'`);
    const assignees = await tx.$queryRawUnsafe<{ id: string; employeeId: string; total: string; letterNumber: string | null; letterStatus: string }[]>(
      `SELECT a."id", a."employeeId", a."total"::text AS total, t."number" AS "letterNumber", t."status"::text AS "letterStatus" FROM "assignment_assignees" a JOIN "assignment_letters" t ON t."id" = a."letterId"`);
    const assigneeById = new Map(assignees.map((a) => [a.id, a]));
    const receiptByAssignee = new Map(receipts.map((r) => [r.assigneeId, r]));

    const findings: AllowanceFinding[] = [];
    const push = (kind: AllowanceFindingKind, l: Row, extra: Partial<AllowanceFinding> = {}) => findings.push({
      kind, settlementId: l.settlementId, settlementStatus: l.settlementStatus, employeeNo: l.employeeNo, employeeName: l.employeeName, lineId: l.lineId, lineName: l.lineName,
      amount: Number(l.amount), source: l.source, formula: l.formula, letterNumber: null, receiptNumber: null, receiptTotal: null,
      candidateAssignees: assignees.filter((a) => a.employeeId === l.employeeId && a.total === l.amount).length, action: ACTIONS[kind], ...extra,
    });
    for (const l of lines) {
      if (l.assigneeId) {
        const a = assigneeById.get(l.assigneeId);
        const rc = receiptByAssignee.get(l.assigneeId);
        if (rc) push("ACTIVE_RECEIPT", l, { letterNumber: a?.letterNumber ?? null, receiptNumber: rc.number, receiptTotal: Number(rc.total) });
        if (a && a.letterStatus !== "ISSUED") push("LETTER_CANCELLED", l, { letterNumber: a.letterNumber });
      } else {
        const same = receipts.find((r) => r.employeeId === l.employeeId && r.total === l.amount);
        if (same) push("UNLINKED_MATCH", l, { receiptNumber: same.number, receiptTotal: Number(same.total) });
        else push("UNLINKED", l);
      }
    }
    const order: Record<AllowanceFindingKind, number> = { ACTIVE_RECEIPT: 0, UNLINKED_MATCH: 1, LETTER_CANCELLED: 2, UNLINKED: 3 };
    findings.sort((a, b) => order[a.kind] - order[b.kind]);

    const blocking = findings.some((f) => BLOCKING_KINDS.includes(f.kind));
    const incomplete = migrations.some((m) => !m.applied) || triggers.some((t) => !t.present);
    const exitCode: AllowanceAuditReport["exitCode"] = incomplete ? 3 : blocking ? 2 : findings.length ? 4 : 0;
    const linked = lines.filter((l) => l.assigneeId).length;
    return { generatedAt: now.toISOString(), migrations, triggers, counts: { settlementLines: lines.length, linkedLines: linked, unlinkedLines: lines.length - linked, activeReceipts: receipts.length }, findings, exitCode };
  });
}
