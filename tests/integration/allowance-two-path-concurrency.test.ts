/**
 * Uang harian lewat DUA JALUR bersamaan (Bukti Penerimaan × penyelesaian akhir × pembatalan surat tugas): satu aturan penguncian — kunci advisory per SURAT TUGAS
 * (`assign:<letterId>`, src/server/services/allowance-lock.ts) — dipakai semua jalur, dan trigger database mengambil kunci yang sama sebagai jaring pengaman.
 *
 * Sebelumnya penjaga hanya MEMBACA (pemeriksaan service + trigger) sehingga tidak melihat transaksi lawan yang belum commit: bila satu jalur ditahan di tengah
 * transaksinya, jalur lain lolos dan hasilnya satu baris penyelesaian Dibayar + satu bukti aktif (atau baris Dibayar pada surat yang dibatalkan).
 *
 * Koneksi yang benar-benar serentak; jendela balapan dilebarkan dengan trigger uji `pg_sleep` yang dipasang & DILEPAS di dalam tes (afterEach).
 * Setiap skenario dijalankan dalam DUA lapisan:
 *   · "aplikasi saja": keempat trigger penjaga dimatikan — kunci di layanan harus cukup;
 *   · "lengkap": dengan trigger database.
 * Invarian (apa pun urutan menangnya): (I1) tidak ada bukti aktif DAN baris penyelesaian berlaku untuk uang harian yang sama; (I2) tidak ada baris pada penyelesaian
 * Disetujui/Dibayar untuk surat tugas yang Dibatalkan; (I3) tidak ada deadlock.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma, transaction } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import { addComponent, resetDb } from "../helpers/db";
import { makeLetter, seedTraining, type TrainingFixtures } from "../helpers/training";
import { addLine, approveSettlement, createSettlement, markSettlementPaid, recomputeSettlement, submitSettlement } from "@/server/services/final-settlements";
import { cancelAssignment, issueReceipt } from "@/server/services/assignments";
import { allowanceLockKey } from "@/server/services/allowance-lock";

let fx: TrainingFixtures;
const LAST = "2026-10-14";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const errOf = async (p: Promise<unknown>): Promise<string> => { try { await p; return "OK"; } catch (e) { return `${e instanceof AppError ? e.code : "ERR"}: ${(e as Error).message}`; } };
const emp = (i = 0) => fx.empIds[i]!;

const GUARDS = [
  ["daily_allowance_receipts", "daily_allowance_receipts_settlement_guard"],
  ["final_settlement_lines", "final_settlement_lines_allowance_guard"],
  ["final_settlements", "final_settlements_allowance_guard"],
  ["assignment_letters", "assignment_letters_cancel_allowance_guard"],
] as const;
const setGuards = async (on: boolean) => { for (const [t, n] of GUARDS) await prisma.$executeRawUnsafe(`ALTER TABLE ${t} ${on ? "ENABLE" : "DISABLE"} TRIGGER ${n}`); };

const SLEEPERS = [["a_hold", "daily_allowance_receipts"], ["zz_hold", "daily_allowance_receipts"], ["zz_after_hold", "daily_allowance_receipts"], ["zz_letter_hold", "assignment_letters"],
  ["zz_status_hold", "final_settlements"], ["zz_line_hold", "final_settlement_lines"]] as const;
async function installSleeper(name: (typeof SLEEPERS)[number][0], when: "BEFORE" | "AFTER", event: "INSERT" | "UPDATE", table: string, seconds: number, cond?: string) {
  await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION trg_${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(${seconds}); RETURN COALESCE(NEW, OLD); END $$`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} ${when} ${event} ON ${table} FOR EACH ROW ${cond ? `WHEN (${cond}) ` : ""}EXECUTE FUNCTION trg_${name}()`);
}
const dropSleepers = async () => { for (const [n, t] of SLEEPERS) { await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${n} ON ${t}`); await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS trg_${n}()`); } };

/** Tahan kunci surat dalam satu transaksi terbuka (meniru jalur lain yang sedang memegang kunci). */
async function holdLetter(letterId: string) {
  let release!: () => void; const gate = new Promise<void>((r) => (release = r));
  let held!: () => void; const heldP = new Promise<void>((r) => (held = r));
  const done = transaction(async (tx) => { await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${allowanceLockKey(letterId)}))`; held(); await gate; });
  await heldP;
  return { release: async () => { release(); await done; } };
}

async function mkAssignee(seq = 1, who = 0) {
  const l = await makeLetter(fx.hr.userId, seq);
  const a = await prisma.assignmentAssignee.create({ data: { letterId: l.id, employeeId: emp(who), days: 5, dailyRate: 150_000n, total: 750_000n } });
  return { l, a };
}
const salary = (who = 0) => addComponent(emp(who), fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 6_000_000 });

async function snap(assigneeId: string, letterId: string) {
  const receipts = await prisma.dailyAllowanceReceipt.count({ where: { assigneeId, status: "ACTIVE" } });
  const lines = await prisma.finalSettlementLine.findMany({ where: { assigneeId, settlement: { status: { not: "CANCELLED" } } }, select: { settlement: { select: { status: true } } } });
  const letter = await prisma.assignmentLetter.findUniqueOrThrow({ where: { id: letterId }, select: { status: true } });
  return { receipts, lineStatuses: lines.map((x) => x.settlement.status), letter: letter.status };
}
/** I1 + I2 untuk satu uang harian. */
async function expectInvariants(assigneeId: string, letterId: string) {
  const s = await snap(assigneeId, letterId);
  expect(s.receipts > 0 && s.lineStatuses.length > 0, `I1 bukti aktif + baris penyelesaian berlaku: ${JSON.stringify(s)}`).toBe(false);
  expect(s.letter === "CANCELLED" && s.lineStatuses.some((x) => x === "APPROVED" || x === "PAID"), `I2 surat dibatalkan + baris Disetujui/Dibayar: ${JSON.stringify(s)}`).toBe(false);
  return s;
}
const noDeadlock = (...rs: string[]) => { for (const r of rs) expect(r, "I3").not.toMatch(/deadlock|40P01/i); };
/** Alur penyelesaian akhir penuh; mengembalikan hasil tiap langkah. */
async function settlementFlow(who = 0) {
  const log: Record<string, string> = {}; let id = "";
  log.create = await errOf((async () => { id = (await createSettlement(fx.hr, { employeeId: emp(who), lastWorkDate: LAST })).id; })());
  if (id) {
    log.submit = await errOf(submitSettlement(fx.hr, id));
    log.approve = await errOf(approveSettlement(fx.superAdmin, id, {}));
    log.paid = await errOf(markSettlementPaid(fx.hr, id, {}));
  }
  return { id, log };
}

beforeEach(async () => { await resetDb(); fx = await seedTraining(); await setGuards(true); });
afterEach(async () => { await dropSleepers(); await setGuards(true); });

describe.each([["aplikasi saja (trigger penjaga dimatikan)", false], ["lengkap (aplikasi + trigger database)", true]] as const)("dua jalur serentak — lapisan %s", (_name, withTriggers) => {
  beforeEach(async () => { if (!withTriggers) await setGuards(false); });

  it("S1 bukti ditahan SESUDAH baris masuk (sebelum commit) × penyelesaian akhir sampai Dibayar → tidak ada uang harian ganda; bukti menang, penyelesaian tanpa baris itu", async () => {
    await salary(); const { a, l } = await mkAssignee();
    await installSleeper("zz_after_hold", "AFTER", "INSERT", "daily_allowance_receipts", 4);
    const A = errOf(issueReceipt(fx.hr, { assigneeId: a.id, method: "CASH" }));
    await sleep(1000);
    const B = await settlementFlow();
    const rA = await A; noDeadlock(rA, ...Object.values(B.log));
    expect(rA).toBe("OK");
    const s = await expectInvariants(a.id, l.id);
    expect(s).toMatchObject({ receipts: 1, lineStatuses: [] });                         // penyelesaian MENUNGGU kunci lalu melihat bukti → uang harian tidak ikut
    expect(B.log).toMatchObject({ create: "OK", submit: "OK", approve: "OK", paid: "OK" });
  }, 120_000);

  it("S2 bukti ditahan SESUDAH penjaga database lolos, sebelum baris masuk × penyelesaian akhir", async () => {
    await salary(); const { a, l } = await mkAssignee();
    await installSleeper("zz_hold", "BEFORE", "INSERT", "daily_allowance_receipts", 4);
    const A = errOf(issueReceipt(fx.hr, { assigneeId: a.id, method: "CASH" }));
    await sleep(1000);
    const B = await settlementFlow();
    const rA = await A; noDeadlock(rA, ...Object.values(B.log));
    expect(rA).toBe("OK");
    expect(await expectInvariants(a.id, l.id)).toMatchObject({ receipts: 1, lineStatuses: [] });
  }, 120_000);

  it("S3 bukti ditahan SEBELUM penjaga database (setelah pemeriksaan service) × penyelesaian akhir", async () => {
    await salary(); const { a, l } = await mkAssignee();
    await installSleeper("a_hold", "BEFORE", "INSERT", "daily_allowance_receipts", 4);
    const A = errOf(issueReceipt(fx.hr, { assigneeId: a.id, method: "CASH" }));
    await sleep(1000);
    const B = await settlementFlow();
    const rA = await A; noDeadlock(rA, ...Object.values(B.log));
    expect(rA).toBe("OK");
    expect(await expectInvariants(a.id, l.id)).toMatchObject({ receipts: 1, lineStatuses: [] });
  }, 120_000);

  it("S6 arah SEBALIKNYA: hitung ulang penyelesaian ditahan sesudah baris uang harian masuk × terbitkan bukti → bukti MENUNGGU lalu ditolak (sudah termasuk penyelesaian)", async () => {
    await salary();
    const s = await createSettlement(fx.hr, { employeeId: emp(), lastWorkDate: LAST });     // belum ada uang harian
    const { a, l } = await mkAssignee();                                                    // surat tugas terbit SESUDAH penyelesaian dibuat
    await installSleeper("zz_line_hold", "AFTER", "INSERT", "final_settlement_lines", 4, `NEW."assigneeId" IS NOT NULL`);
    const B = errOf(recomputeSettlement(fx.hr, s.id));
    await sleep(1200);
    const rA = await errOf(issueReceipt(fx.hr, { assigneeId: a.id, method: "CASH" }));
    const rB = await B; noDeadlock(rA, rB);
    expect(rB).toBe("OK");
    expect(rA).toMatch(/^CONFLICT: .*sudah termasuk penyelesaian akhir/);
    expect(await expectInvariants(a.id, l.id)).toMatchObject({ receipts: 0, lineStatuses: ["DRAFT"] });
  }, 120_000);

  it("S5 pembatalan surat tugas ditahan sebelum commit × penyelesaian akhir sampai Dibayar → tidak ada baris Dibayar untuk surat yang dibatalkan", async () => {
    await salary(); const { a, l } = await mkAssignee();
    await installSleeper("zz_letter_hold", "AFTER", "UPDATE", "assignment_letters", 4, `OLD."status" IS DISTINCT FROM NEW."status"`);
    const A = errOf(cancelAssignment(fx.hr, l.id, { reason: "Perjalanan dibatalkan klien" }));
    await sleep(1000);
    const B = await settlementFlow();
    const rA = await A; noDeadlock(rA, ...Object.values(B.log));
    expect(rA).toBe("OK");
    expect(await expectInvariants(a.id, l.id)).toMatchObject({ letter: "CANCELLED", lineStatuses: [] });   // usulan dihitung SESUDAH pembatalan → uang harian tidak ikut
  }, 120_000);

  it("S7 penyelesaian PENDING: setujui ditahan sebelum commit × batalkan surat tugas → pembatalan MENUNGGU lalu ditolak (sudah Disetujui)", async () => {
    await salary(); const { a, l } = await mkAssignee();
    const s = await createSettlement(fx.hr, { employeeId: emp(), lastWorkDate: LAST });
    await submitSettlement(fx.hr, s.id);
    await installSleeper("zz_status_hold", "AFTER", "UPDATE", "final_settlements", 4, `OLD."status" IS DISTINCT FROM NEW."status"`);
    const B = errOf(approveSettlement(fx.superAdmin, s.id, {}));
    await sleep(1000);
    const rA = await errOf(cancelAssignment(fx.hr, l.id, { reason: "Dibatalkan setelah disetujui" }));
    const rB = await B; noDeadlock(rA, rB);
    expect(rB).toBe("OK");
    expect(rA).toMatch(/^CONFLICT: /);
    expect(await expectInvariants(a.id, l.id)).toMatchObject({ letter: "ISSUED", lineStatuses: ["APPROVED"] });
  }, 120_000);

  it("S8 penyelesaian PENDING: pembatalan surat tugas ditahan sebelum commit × setujui → persetujuan MENUNGGU lalu ditolak (surat dibatalkan)", async () => {
    await salary(); const { a, l } = await mkAssignee();
    const s = await createSettlement(fx.hr, { employeeId: emp(), lastWorkDate: LAST });
    await submitSettlement(fx.hr, s.id);
    await installSleeper("zz_letter_hold", "AFTER", "UPDATE", "assignment_letters", 4, `OLD."status" IS DISTINCT FROM NEW."status"`);
    const A = errOf(cancelAssignment(fx.hr, l.id, { reason: "Perjalanan dibatalkan klien" }));
    await sleep(1000);
    const rB = await errOf(approveSettlement(fx.superAdmin, s.id, {}));
    const rA = await A; noDeadlock(rA, rB);
    expect(rA).toBe("OK");
    expect(rB).toMatch(/^CONFLICT: .*dibatalkan/);
    expect(await expectInvariants(a.id, l.id)).toMatchObject({ letter: "CANCELLED", lineStatuses: ["PENDING_APPROVAL"] });
  }, 120_000);
});

describe("tanpa deadlock", () => {
  it("dua penyelesaian untuk karyawan berbeda pada DUA surat tugas yang sama, dihitung ulang berkali-kali bersamaan dengan penerbitan bukti & pembatalan → tak ada deadlock", async () => {
    await salary(0); await salary(1);
    const letters = [await makeLetter(fx.hr.userId, 1), await makeLetter(fx.hr.userId, 2)];
    for (const l of letters) for (const who of [0, 1]) await prisma.assignmentAssignee.create({ data: { letterId: l.id, employeeId: emp(who), days: 2, dailyRate: 100_000n, total: 200_000n } });
    const third = await prisma.assignmentAssignee.create({ data: { letterId: letters[0]!.id, employeeId: emp(2), days: 2, dailyRate: 100_000n, total: 200_000n } });
    const s0 = await createSettlement(fx.hr, { employeeId: emp(0), lastWorkDate: LAST });
    const s1 = await createSettlement(fx.hr, { employeeId: emp(1), lastWorkDate: LAST });
    const results: string[] = [];
    for (let i = 0; i < 6; i++) {
      results.push(...(await Promise.all([
        errOf(recomputeSettlement(fx.hr, s0.id)), errOf(recomputeSettlement(fx.hr, s1.id)),
        i === 0 ? errOf(issueReceipt(fx.hr, { assigneeId: third.id, method: "CASH" })) : errOf(recomputeSettlement(fx.hr, s0.id)),
      ])));
    }
    noDeadlock(...results);
    expect(results.filter((r) => r === "OK").length).toBeGreaterThanOrEqual(12);
  }, 180_000);
});

describe("trigger database mengambil kunci surat yang SAMA (jaring pengaman untuk jalur di luar layanan)", () => {
  /** Jalankan `op` saat kunci surat dipegang: harus MENUNGGU (belum selesai setelah 900 ms) dan selesai sesudah kunci dilepas. */
  async function blocksWhileLocked(letterId: string, op: () => Promise<unknown>) {
    const hold = await holdLetter(letterId);
    let settled = false;
    const run = op().then(() => "OK", (e: Error) => `ERR: ${e.message}`).finally(() => { settled = true; });
    await sleep(900);
    const waitedWhileHeld = !settled;
    await hold.release();
    const outcome = await run;
    return { waitedWhileHeld, outcome };
  }
  const receiptData = (a: { id: string; letterId: string; employeeId: string }) => ({
    seqYear: 2026, seqNo: 7, number: "007/BPUH/XI/2026", letterId: a.letterId, assigneeId: a.id, employeeId: a.employeeId, days: 5, dailyRate: 150_000n, total: 750_000n,
    paidDate: isoToDate("2026-11-03"), method: "CASH" as const, snapshot: {}, issuedById: fx.hr.userId,
  });

  it("INSERT bukti langsung ke tabel menunggu kunci surat", async () => {
    await salary(); const { a } = await mkAssignee();
    const r = await blocksWhileLocked(a.letterId, () => prisma.dailyAllowanceReceipt.create({ data: receiptData(a) }));
    expect(r).toEqual({ waitedWhileHeld: true, outcome: "OK" });
  });

  it("INSERT baris penyelesaian (uang harian) langsung ke tabel menunggu kunci surat", async () => {
    await salary(); const { a } = await mkAssignee();
    const s = await createSettlement(fx.hr, { employeeId: emp(), lastWorkDate: LAST });
    await prisma.finalSettlementLine.deleteMany({ where: { settlementId: s.id, assigneeId: a.id } });
    const r = await blocksWhileLocked(a.letterId, () => prisma.finalSettlementLine.create({
      data: { settlementId: s.id, kind: "EARNING", category: "UNPAID_ALLOWANCE", name: "Uang harian uji", amount: 750_000n, source: "MANUAL", assigneeId: a.id, sortOrder: 99 },
    }));
    expect(r).toEqual({ waitedWhileHeld: true, outcome: "OK" });
  });

  it("perubahan STATUS penyelesaian (ajukan) langsung ke tabel menunggu kunci surat", async () => {
    await salary(); const { a } = await mkAssignee();
    const s = await createSettlement(fx.hr, { employeeId: emp(), lastWorkDate: LAST });
    const r = await blocksWhileLocked(a.letterId, () => prisma.finalSettlement.update({ where: { id: s.id }, data: { status: "PENDING_APPROVAL", submittedAt: new Date(), submittedById: fx.hr.userId } }));
    expect(r).toEqual({ waitedWhileHeld: true, outcome: "OK" });
  });

  it("PEMBATALAN surat tugas langsung ke tabel menunggu kunci surat", async () => {
    const { l } = await mkAssignee();
    const r = await blocksWhileLocked(l.id, () => prisma.assignmentLetter.update({ where: { id: l.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: fx.hr.userId, cancelReason: "Uji kunci" } }));
    expect(r).toEqual({ waitedWhileHeld: true, outcome: "OK" });
  });

  it("penjaga status penyelesaian: ajukan DITOLAK bila uang harian kini punya bukti aktif / surat dibatalkan (data lama atau jalur di luar layanan)", async () => {
    await salary(); const { a, l } = await mkAssignee();
    const s = await createSettlement(fx.hr, { employeeId: emp(), lastWorkDate: LAST });
    // (1) bukti aktif disisipkan LANGSUNG dengan penjaga bukti dimatikan (meniru data lama/balapan yang lolos)
    await prisma.$executeRawUnsafe(`ALTER TABLE daily_allowance_receipts DISABLE TRIGGER daily_allowance_receipts_settlement_guard`);
    try { await prisma.dailyAllowanceReceipt.create({ data: receiptData(a) }); } finally { await prisma.$executeRawUnsafe(`ALTER TABLE daily_allowance_receipts ENABLE TRIGGER daily_allowance_receipts_settlement_guard`); }
    const submit = () => prisma.finalSettlement.update({ where: { id: s.id }, data: { status: "PENDING_APPROVAL", submittedAt: new Date(), submittedById: fx.hr.userId } });
    await expect(submit()).rejects.toThrow(/HRIS-GUARD: Ada uang harian pada penyelesaian akhir ini yang sudah memiliki Bukti Penerimaan aktif/);
    // (2) bukti dibatalkan, tetapi surat tugasnya dibatalkan langsung → ajukan ditolak karena surat dibatalkan
    await prisma.dailyAllowanceReceipt.updateMany({ where: { assigneeId: a.id }, data: { status: "VOIDED", voidedAt: new Date(), voidedById: fx.superAdmin.userId, voidReason: "uji" } });
    await prisma.assignmentLetter.update({ where: { id: l.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: fx.hr.userId, cancelReason: "Uji" } });
    await expect(submit()).rejects.toThrow(/HRIS-GUARD: Ada uang harian pada penyelesaian akhir ini yang surat tugasnya sudah dibatalkan/);
  });

  it("penjaga pembatalan surat tugas: DITOLAK bila uang harian sudah termasuk penyelesaian Disetujui/Dibayar atau masih ada bukti aktif (langsung ke tabel)", async () => {
    await salary(); const { a, l } = await mkAssignee(1);
    const s = await createSettlement(fx.hr, { employeeId: emp(), lastWorkDate: LAST });
    await submitSettlement(fx.hr, s.id);
    await approveSettlement(fx.superAdmin, s.id, {});
    const cancel = () => prisma.assignmentLetter.update({ where: { id: l.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: fx.hr.userId, cancelReason: "Uji" } });
    await expect(cancel()).rejects.toThrow(/HRIS-GUARD: Uang harian pada surat tugas ini sudah termasuk penyelesaian akhir yang disetujui\/dibayar/);
    // bukti aktif pada surat lain
    await resetDb(); fx = await seedTraining();
    const b = await mkAssignee(2);
    await prisma.dailyAllowanceReceipt.create({ data: receiptData(b.a) });
    await expect(prisma.assignmentLetter.update({ where: { id: b.l.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelledById: fx.hr.userId, cancelReason: "Uji" } }))
      .rejects.toThrow(/HRIS-GUARD: Masih ada Bukti Penerimaan Uang Harian yang aktif/);
    void a; void addLine;
  });
});
