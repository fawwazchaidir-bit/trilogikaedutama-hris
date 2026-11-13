/**
 * Penyelesaian akhir (final settlement): usulan sistem (gaji prorata, uang cuti bila pembagi diisi, uang harian belum dibayar), baris manual,
 * alur Draf → Menunggu → Disetujui → Dibayar, larangan menyetujui milik sendiri, penguncian (service + trigger database), dan peringatan.
 * Tanggal tetap (Oktober 2026: 22 hari kerja Sen–Jum; s.d. Rabu 14 Okt = 10 hari) agar tidak bergantung hari berjalannya tes.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import { addComponent, makeUser, resetDb } from "../helpers/db";
import { makeLetter, seedTraining, type TrainingFixtures } from "../helpers/training";
import {
  addLine, approveSettlement, auditAllowanceOverlaps, auditSettlementDuplicates, cancelSettlement, createSettlement, deleteLine, getSettlement, listSettlements, markSettlementPaid, recomputeSettlement,
  returnSettlement, settlementOfEmployee, submitSettlement, updateLine, updateSettlement,
} from "@/server/services/final-settlements";
import { assignAsset, createAsset } from "@/server/services/assets";
import { cancelAssignment, issueReceipt, listAssignments, pendingAllowanceCount } from "@/server/services/assignments";
import { readFileSync } from "node:fs";
import { listEmployeeChecklists, startChecklist } from "@/server/services/employee-checklists";

let fx: TrainingFixtures;
const LAST = "2026-10-14";
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const emp = () => fx.empIds[0];
const salary = async (employeeId = emp()) => {
  await addComponent(employeeId, fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 6_000_000 });
  await addComponent(employeeId, fx.hr.userId, { category: "MEAL_ALLOWANCE", name: "Tunjangan makan", amount: 440_000 });
};
const mk = (over: Record<string, unknown> = {}) => createSettlement(fx.hr, { employeeId: emp(), lastWorkDate: LAST, ...over });
const names = (s: { lines: { name: string; amount: number }[] }) => s.lines.map((l) => [l.name, l.amount]);

beforeEach(async () => {
  await resetDb();
  fx = await seedTraining();
});

describe("usulan sistem", () => {
  it("gaji prorata per komponen tetap menurut hari kerja terjadwal, dengan rumus tertulis dan total yang konsisten", async () => {
    await salary();
    await addComponent(emp(), fx.hr.userId, { category: "TRANSPORT_ALLOWANCE", name: "Transport harian", amount: 25_000, calc: "PER_PRESENT_DAY" });
    const s = await mk();
    expect(s).toMatchObject({ status: "DRAFT", lastWorkDate: LAST, basis: "WORKING_DAYS", employeeName: "Ayu Lestari" });
    expect(names(s)).toEqual([["Gaji pokok (prorata)", 2_727_273], ["Tunjangan makan (prorata)", 200_000]]); // 6.000.000 × 10/22 ; 440.000 × 10/22
    expect(s.lines[0]).toMatchObject({ kind: "EARNING", category: "PRORATED_SALARY", source: "SYSTEM" });
    expect(s.lines[0]!.formula).toContain("10/22");
    expect(s).toMatchObject({ totalEarnings: 2_927_273, totalDeductions: 0, netPayable: 2_927_273 });
    expect(s.warnings.join(" ")).toMatch(/Transport harian[^]*per hari hadir/); // tidak dihitung otomatis → peringatan
    expect(await prisma.auditLog.count({ where: { action: "settlement.create", entityId: s.id } })).toBe(1);
  });

  it("dasar hari kalender memakai 14/31; tanggal terakhir bekerja divalidasi; satu penyelesaian berlaku per karyawan", async () => {
    await salary();
    const s = await mk({ basis: "CALENDAR_DAYS" });
    expect(s.lines[0]!.amount).toBe(2_709_677); // 6.000.000 × 14/31 = 2.709.677,4
    expect(s.lines[0]!.formula).toContain("14/31");
    expect((await fail(mk()))?.code).toBe("CONFLICT");
    await cancelSettlement(fx.hr, s.id, { reason: "Salah tanggal terakhir bekerja" });
    expect((await fail(mk({ lastWorkDate: "2024-12-31" })))?.fieldErrors?.lastWorkDate).toBeTruthy(); // sebelum tanggal mulai bekerja (2025-01-01)
    expect((await fail(mk({ lastWorkDate: "2099-01-01" })))?.fieldErrors?.lastWorkDate).toBeTruthy();
    expect((await mk()).status).toBe("DRAFT"); // yang dibatalkan tidak menghalangi yang baru
  });

  it("uang cuti hanya diusulkan bila HR mengisi pembagi; tanpa pembagi → peringatan, bukan angka", async () => {
    await salary();
    await prisma.leaveBalanceEntry.create({ data: { employeeId: emp(), year: 2026, kind: "GRANT", days: 5, createdById: fx.hr.userId } });
    const none = await mk();
    expect(none.lines.some((l) => l.category === "LEAVE_PAYOUT")).toBe(false);
    expect(none.warnings.join(" ")).toMatch(/Sisa cuti 2026: 5 hari belum dihitung/);
    const withDiv = await updateSettlement(fx.hr, none.id, { leaveDivisor: 25 });
    const leave = withDiv.lines.find((l) => l.category === "LEAVE_PAYOUT")!;
    expect(leave).toMatchObject({ amount: 1_200_000, source: "SYSTEM" }); // 6.000.000 × 5 ÷ 25
    expect(leave.formula).toContain("÷ 25");
    expect((await fail(updateSettlement(fx.hr, none.id, { leaveDivisor: 0 })))?.code).toBe("VALIDATION");
  });

  it("uang harian dinas yang belum diterbitkan bukti penerimaannya diusulkan sebagai pendapatan", async () => {
    await salary();
    const letter = await makeLetter(fx.hr.userId);
    await prisma.assignmentAssignee.create({ data: { letterId: letter.id, employeeId: emp(), days: 5, dailyRate: 150_000n, total: 750_000n } });
    const s = await mk();
    const a = s.lines.find((l) => l.category === "UNPAID_ALLOWANCE")!;
    expect(a).toMatchObject({ amount: 750_000, kind: "EARNING", source: "SYSTEM", name: "Uang harian: Bandung" });
    expect(a.formula).toContain("001/ST/XI/2026");
  });

  it("peringatan: periode gaji yang sudah memuat karyawan, kasbon aktif, aset belum kembali; pesangon/pajak tidak pernah diusulkan", async () => {
    await salary();
    await addComponent(emp(), fx.hr.userId, { category: "LOAN", name: "Kasbon Mei", amount: 300_000 });
    const run = await prisma.payrollRun.create({ data: { label: "Gaji Oktober 2026", periodStart: isoToDate("2026-10-01"), periodEnd: isoToDate("2026-10-31"), attendanceStart: isoToDate("2026-10-01"), attendanceEnd: isoToDate("2026-10-31"), createdById: fx.hr.userId } });
    await prisma.payrollItem.create({ data: { runId: run.id, employeeId: emp(), employeeNo: "TE-001", employeeName: "Ayu Lestari", position: "Staf", employmentStatus: "PERMANENT", attendanceSummary: {}, sourceHash: "x" } });
    const a = await createAsset(fx.hr, { name: "Laptop Kantor", category: "LAPTOP" });
    await assignAsset(fx.hr, a.id, { employeeId: emp() });
    const s = await mk();
    const w = s.warnings.join(" | ");
    expect(w).toMatch(/Gaji Oktober 2026[^|]*terhitung ganda/);
    expect(w).toMatch(/Kasbon Mei/);
    expect(w).toMatch(/Aset belum dikembalikan: Laptop Kantor/);
    expect(s.lines.some((l) => ["SEVERANCE", "SERVICE_AWARD", "ENTITLEMENT", "THR", "TAX", "BPJS"].includes(l.category))).toBe(false);
  });

  it("hanya payroll:prepare yang membuat; payroll:view yang melihat; karyawan biasa tidak berhak apa pun", async () => {
    await salary();
    expect((await fail(createSettlement(fx.emp2, { employeeId: emp(), lastWorkDate: LAST })))?.code).toBe("FORBIDDEN");
    const s = await mk();
    expect((await fail(getSettlement(fx.emp2, s.id)))?.code).toBe("FORBIDDEN");
    expect((await fail(listSettlements(fx.emp2)))?.code).toBe("FORBIDDEN");
    expect((await getSettlement(fx.superAdmin, s.id)).id).toBe(s.id);
    expect((await listSettlements(fx.hr)).map((r) => r.id)).toEqual([s.id]);
    expect(await settlementOfEmployee(fx.hr, emp())).toMatchObject({ id: s.id, status: "DRAFT" });
    expect((await fail(getSettlement(fx.hr, "00000000-0000-4000-8000-000000000000")))?.code).toBe("NOT_FOUND");
  });
});

describe("baris manual & hitung ulang", () => {
  it("pesangon/pajak/kasbon diisi manual; jenis mengikuti kategori; total ikut berubah; validasi nominal & nama", async () => {
    await salary();
    const s0 = await mk();
    const s1 = await addLine(fx.hr, s0.id, { category: "SEVERANCE", name: "Uang pesangon (sesuai perjanjian kerja)", amount: 5_000_000, formula: "1 × gaji pokok sesuai PKB pasal 12" });
    const sev = s1.lines.find((l) => l.category === "SEVERANCE")!;
    expect(sev).toMatchObject({ kind: "EARNING", source: "MANUAL", amount: 5_000_000 });
    const s2 = await addLine(fx.hr, s0.id, { category: "TAX", name: "PPh 21 (hasil hitung konsultan pajak)", amount: 400_000 });
    expect(s2.lines.find((l) => l.category === "TAX")).toMatchObject({ kind: "DEDUCTION" });
    expect(s2).toMatchObject({ totalEarnings: 2_927_273 + 5_000_000, totalDeductions: 400_000, netPayable: 2_927_273 + 5_000_000 - 400_000 });
    expect((await fail(addLine(fx.hr, s0.id, { category: "TAX", name: "PP", amount: 100 })))?.fieldErrors?.name).toBeTruthy();
    expect((await fail(addLine(fx.hr, s0.id, { category: "TAX", name: "PPh 21 lagi", amount: 0 })))?.fieldErrors?.amount).toBeTruthy();
    expect((await fail(addLine(fx.hr, s0.id, { category: "BONUS", name: "Bonus aneh", amount: 100 })))?.fieldErrors?.category).toBeTruthy();
    expect((await fail(addLine(fx.emp1, s0.id, { category: "OTHER_EARNING", name: "Tidak boleh", amount: 100 })))?.code).toBe("FORBIDDEN");
    expect(await prisma.auditLog.count({ where: { action: "settlement.line.add", entityId: s0.id } })).toBe(2);
  });

  it("mengubah baris sistem menjadikannya manual (membawa kunci sumber); hitung ulang tidak membuat usulan yang sama lagi", async () => {
    await salary();
    const s0 = await mk();
    const sys = s0.lines.find((l) => l.name === "Gaji pokok (prorata)")!;
    expect(sys.sourceKey).toMatch(/^PRORATA:[0-9a-f-]{36}$/);
    const s1 = await updateLine(fx.hr, sys.id, { category: "PRORATED_SALARY", name: "Gaji pokok (prorata, disepakati)", amount: 3_000_000, formula: "Disepakati dengan karyawan" });
    expect(s1.lines.find((l) => l.id === sys.id)).toMatchObject({ source: "MANUAL", amount: 3_000_000, sourceKey: sys.sourceKey });
    await addLine(fx.hr, s0.id, { category: "OTHER_DEDUCTION", name: "Potongan koperasi", amount: 100_000 });
    const re = await recomputeSettlement(fx.hr, s0.id);
    expect(re.lines.filter((l) => l.source === "MANUAL").map((l) => l.name).sort()).toEqual(["Gaji pokok (prorata, disepakati)", "Potongan koperasi"]);
    expect(re.lines.filter((l) => l.source === "SYSTEM").map((l) => l.name)).toEqual(["Tunjangan makan (prorata)"]); // gaji pokok sistem TIDAK muncul lagi
    expect(re.lines.filter((l) => l.name.startsWith("Gaji pokok"))).toHaveLength(1);
    expect(re).toMatchObject({ totalEarnings: 3_200_000, totalDeductions: 100_000, netPayable: 3_100_000 });
  });
});

describe("satu sumber hanya dihitung satu kali", () => {
  const gaji = (s: { lines: { name: string; amount: number; source: string; sourceKey: string | null }[] }) => s.lines.filter((l) => l.name.startsWith("Gaji pokok"));
  const editGaji = async (id: string, amount = 3_000_000) => {
    const sys = (await getSettlement(fx.hr, id)).lines.find((l) => l.name === "Gaji pokok (prorata)")!;
    return updateLine(fx.hr, sys.id, { category: "PRORATED_SALARY", name: "Gaji pokok (prorata, koreksi)", amount, formula: "Dikoreksi HR" });
  };

  it("kasus laporan: gaji prorata diubah ke Rp3.000.000 lalu dihitung ulang → hanya SATU baris gaji (Rp3.000.000), bukan dua (Rp5.727.273)", async () => {
    await salary();
    const s0 = await mk();
    await editGaji(s0.id);
    const re = await recomputeSettlement(fx.hr, s0.id);
    expect(gaji(re).map((l) => [l.name, l.amount, l.source])).toEqual([["Gaji pokok (prorata, koreksi)", 3_000_000, "MANUAL"]]);
    expect(re).toMatchObject({ totalEarnings: 3_200_000, netPayable: 3_200_000 });
    // peringatan memberi tahu penyetuju bahwa usulan sistem berbeda & tidak dihitung
    expect(re.warnings.join(" | ")).toMatch(/Usulan sistem "Gaji pokok \(prorata\)" Rp ?2\.727\.273 digantikan baris manual "Gaji pokok \(prorata, koreksi\)" Rp ?3\.000\.000/);
    // dihitung ulang berkali-kali tetap stabil
    for (let i = 0; i < 3; i++) { const again = await recomputeSettlement(fx.hr, s0.id); expect(again.netPayable).toBe(3_200_000); expect(again.lines).toHaveLength(2); }
  });

  it("memperbarui penyelesaian (catatan saja, atau tanggal/dasar/pembagi) juga tidak menggandakan sumber yang sudah dikoreksi", async () => {
    await salary();
    const s0 = await mk();
    await editGaji(s0.id);
    const n = await updateSettlement(fx.hr, s0.id, { note: "Catatan baru" });
    expect(gaji(n)).toHaveLength(1);
    expect(n.netPayable).toBe(3_200_000);
    const d = await updateSettlement(fx.hr, s0.id, { lastWorkDate: "2026-10-16", basis: "CALENDAR_DAYS" });
    expect(gaji(d)).toHaveLength(1);
    expect(gaji(d)[0]).toMatchObject({ source: "MANUAL", amount: 3_000_000 }); // koreksi HR dipertahankan, tidak diam-diam diganti
    expect(d.lines.find((l) => l.name === "Tunjangan makan (prorata)")!.amount).toBe(Math.round((440_000 * 16) / 31)); // yang belum dikoreksi ikut dihitung ulang
    expect(d.warnings.join(" | ")).toMatch(/digantikan baris manual/);
  });

  it("usulan yang DIHAPUS HR dikecualikan permanen: tidak muncul lagi saat hitung ulang maupun saat data penyelesaian diperbarui", async () => {
    await salary();
    const s0 = await mk();
    const meal = s0.lines.find((l) => l.name === "Tunjangan makan (prorata)")!;
    const s1 = await deleteLine(fx.hr, meal.id);
    expect(s1.lines.some((l) => l.name === "Tunjangan makan (prorata)")).toBe(false);
    expect(s1.excluded).toMatchObject([{ sourceKey: meal.sourceKey, name: "Tunjangan makan (prorata)", categoryLabel: "Gaji prorata", amount: 200_000, excludedBy: "HR Uji" }]);
    const re = await recomputeSettlement(fx.hr, s0.id);
    expect(re.lines.map((l) => l.name)).toEqual(["Gaji pokok (prorata)"]);
    const up = await updateSettlement(fx.hr, s0.id, { lastWorkDate: "2026-10-15" });
    expect(up.lines.map((l) => l.name)).toEqual(["Gaji pokok (prorata)"]);
    expect(up.excluded).toHaveLength(1);
    expect(await prisma.finalSettlementExclusion.count({ where: { settlementId: s0.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "settlement.line.delete", entityId: s0.id, summary: { contains: "dikecualikan permanen" } } })).toBe(1);
    // HR tetap bisa menambahkannya kembali secara sadar sebagai baris manual
    const back = await addLine(fx.hr, s0.id, { category: "PRORATED_SALARY", name: "Tunjangan makan (prorata, ditambah lagi)", amount: 200_000, formula: "Ditambahkan HR" });
    expect(back.lines).toHaveLength(2);
    expect((await recomputeSettlement(fx.hr, s0.id)).lines).toHaveLength(2);
  });

  it("menghapus baris pengganti (manual hasil koreksi) juga mengecualikan sumbernya — tidak ada usulan sistem yang bangkit lagi", async () => {
    await salary();
    const s0 = await mk();
    const edited = (await editGaji(s0.id)).lines.find((l) => l.name === "Gaji pokok (prorata, koreksi)")!;
    const s1 = await deleteLine(fx.hr, edited.id);
    expect(s1.excluded.map((x) => x.name)).toEqual(["Gaji pokok (prorata, koreksi)"]);
    const re = await recomputeSettlement(fx.hr, s0.id);
    expect(gaji(re)).toHaveLength(0);
    expect(re.netPayable).toBe(200_000);
  });

  it("menghapus baris manual murni (tanpa sumber) tidak membuat pengecualian", async () => {
    await salary();
    const s0 = await mk();
    const sev = (await addLine(fx.hr, s0.id, { category: "SEVERANCE", name: "Uang pesangon", amount: 1_000_000 })).lines.find((l) => l.category === "SEVERANCE")!;
    expect(sev.sourceKey).toBeNull();
    const s1 = await deleteLine(fx.hr, sev.id);
    expect(s1.excluded).toEqual([]);
    expect(await prisma.finalSettlementExclusion.count({ where: { settlementId: s0.id } })).toBe(0);
  });

  it("uang cuti sisa: dikoreksi → tidak ganda saat hitung ulang; dihapus → dikecualikan", async () => {
    await salary();
    await prisma.leaveBalanceEntry.create({ data: { employeeId: emp(), year: 2026, kind: "GRANT", days: 5, createdById: fx.hr.userId } });
    const s0 = await mk({ leaveDivisor: 25 });
    const cuti = s0.lines.find((l) => l.category === "LEAVE_PAYOUT")!;
    expect(cuti).toMatchObject({ sourceKey: "LEAVE_PAYOUT", amount: 1_200_000 });
    await updateLine(fx.hr, cuti.id, { category: "LEAVE_PAYOUT", name: "Uang cuti sisa (disepakati)", amount: 1_000_000, formula: "Disepakati" });
    const re = await recomputeSettlement(fx.hr, s0.id);
    expect(re.lines.filter((l) => l.category === "LEAVE_PAYOUT").map((l) => [l.name, l.amount])).toEqual([["Uang cuti sisa (disepakati)", 1_000_000]]);
    const del = await deleteLine(fx.hr, re.lines.find((l) => l.category === "LEAVE_PAYOUT")!.id);
    expect(del.excluded.map((x) => x.sourceKey)).toEqual(["LEAVE_PAYOUT"]);
    expect((await updateSettlement(fx.hr, s0.id, { leaveDivisor: 20 })).lines.some((l) => l.category === "LEAVE_PAYOUT")).toBe(false);
  });

  it("uang harian dinas: satu baris per penerima tugas; dikoreksi tidak ganda; dihapus dikecualikan, sedangkan tugas BARU tetap diusulkan", async () => {
    await salary();
    const l1 = await makeLetter(fx.hr.userId);
    const a1 = await prisma.assignmentAssignee.create({ data: { letterId: l1.id, employeeId: emp(), days: 5, dailyRate: 150_000n, total: 750_000n } });
    const s0 = await mk();
    const allow = s0.lines.find((l) => l.category === "UNPAID_ALLOWANCE")!;
    expect(allow.sourceKey).toBe(`ALLOWANCE:${a1.id}`);
    await updateLine(fx.hr, allow.id, { category: "UNPAID_ALLOWANCE", name: "Uang harian: Bandung (disepakati)", amount: 600_000, formula: "Hanya 4 hari" });
    const re = await recomputeSettlement(fx.hr, s0.id);
    expect(re.lines.filter((l) => l.category === "UNPAID_ALLOWANCE").map((l) => l.amount)).toEqual([600_000]);
    await deleteLine(fx.hr, re.lines.find((l) => l.category === "UNPAID_ALLOWANCE")!.id);
    const l2 = await makeLetter(fx.hr.userId, 2);
    const a2 = await prisma.assignmentAssignee.create({ data: { letterId: l2.id, employeeId: emp(), days: 2, dailyRate: 150_000n, total: 300_000n } });
    const after = await recomputeSettlement(fx.hr, s0.id);
    expect(after.lines.filter((l) => l.category === "UNPAID_ALLOWANCE").map((l) => [l.sourceKey, l.amount])).toEqual([[`ALLOWANCE:${a2.id}`, 300_000]]);
  });

  it("jumlah yang diajukan & disetujui benar (tidak membengkak) setelah koreksi + hitung ulang + ubah data", async () => {
    await salary();
    const s0 = await mk();
    await editGaji(s0.id);
    await addLine(fx.hr, s0.id, { category: "OTHER_DEDUCTION", name: "Potongan koperasi", amount: 100_000 });
    await recomputeSettlement(fx.hr, s0.id);
    await updateSettlement(fx.hr, s0.id, { note: "Dihitung ulang" });
    await submitSettlement(fx.hr, s0.id);
    const ok = await approveSettlement(fx.superAdmin, s0.id, {});
    expect(ok).toMatchObject({ status: "APPROVED", totalEarnings: 3_200_000, totalDeductions: 100_000, netPayable: 3_100_000 });
    expect(gaji(ok)).toHaveLength(1);
    const stored = await prisma.finalSettlement.findUniqueOrThrow({ where: { id: s0.id } });
    expect(stored.netPayable).toBe(3_100_000n);
  });

  it("penjaga database: satu kunci sumber = paling banyak satu baris; baris tanpa kunci boleh banyak; pengecualian tambah-saja & hanya saat Draf", async () => {
    await salary();
    const s0 = await mk();
    const sys = s0.lines[0]!;
    const base = { settlementId: s0.id, kind: "EARNING" as const, category: "PRORATED_SALARY" as const, name: "Salinan", amount: 1n, sortOrder: 50 };
    await expect(prisma.finalSettlementLine.create({ data: { ...base, sourceKey: sys.sourceKey } })).rejects.toMatchObject({ code: "P2002" });
    await prisma.finalSettlementLine.create({ data: { ...base, source: "MANUAL", sortOrder: 51 } });
    await prisma.finalSettlementLine.create({ data: { ...base, source: "MANUAL", sortOrder: 52 } }); // tanpa kunci: tidak dibatasi
    // pengecualian: tidak bisa diubah/dihapus
    const withEx = await deleteLine(fx.hr, s0.lines[1]!.id);
    const ex = await prisma.finalSettlementExclusion.findFirstOrThrow({ where: { settlementId: s0.id } });
    expect(withEx.excluded).toHaveLength(1);
    await expect(prisma.finalSettlementExclusion.update({ where: { id: ex.id }, data: { name: "ubah" } })).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.finalSettlementExclusion.delete({ where: { id: ex.id } })).rejects.toThrow(/HRIS-GUARD/);
    // setelah diajukan, pengecualian baru tidak bisa disisipkan
    await prisma.finalSettlementLine.deleteMany({ where: { settlementId: s0.id, sourceKey: null } });
    await submitSettlement(fx.hr, s0.id);
    await expect(prisma.finalSettlementExclusion.create({ data: { settlementId: s0.id, sourceKey: "PRORATA:x", name: "x", category: "PRORATED_SALARY", amount: 1n, createdById: fx.hr.userId } })).rejects.toThrow(/HRIS-GUARD/);
  });
});

describe("data lama (sebelum ada identitas sumber)", () => {
  /** Meniru keadaan lama: kunci sumber hilang, baris sistem diubah jadi manual lalu usulan sistem dibuat lagi (pola laporan). */
  async function legacyDuplicate() {
    await salary();
    const s0 = await mk();
    await prisma.finalSettlementLine.updateMany({ where: { settlementId: s0.id }, data: { sourceKey: null } });
    const sys = s0.lines.find((l) => l.name === "Gaji pokok (prorata)")!;
    await updateLine(fx.hr, sys.id, { category: "PRORATED_SALARY", name: "Gaji pokok (prorata, koreksi)", amount: 3_000_000 });
    return { s0, sys };
  }

  it("baris manual tanpa tautan di samping baris sistem sekategori diberi peringatan 'kemungkinan hitungan ganda'", async () => {
    const { s0 } = await legacyDuplicate();
    const re = await recomputeSettlement(fx.hr, s0.id); // data lama tidak punya kunci → pola ganda lama masih bisa terbentuk
    expect(re.lines.filter((l) => l.name.startsWith("Gaji pokok"))).toHaveLength(2);
    expect(re.warnings.join(" | ")).toMatch(/Kemungkinan hitungan ganda pada kategori "Gaji prorata"/);
    expect((await getSettlement(fx.hr, s0.id)).warnings.join(" | ")).toMatch(/Kemungkinan hitungan ganda/);
    // usulan baru yang tercipta sudah berkunci → dari sini tidak bertambah ganda lagi
    expect(re.lines.find((l) => l.source === "SYSTEM" && l.name === "Gaji pokok (prorata)")!.sourceKey).toMatch(/^PRORATA:/);
    expect((await recomputeSettlement(fx.hr, s0.id)).lines).toHaveLength(re.lines.length);
  });

  it("audit baca-saja untuk pimpinan: mendaftar penyelesaian yang terduga ganda (termasuk yang sudah disetujui), tidak mengubah data, mengabaikan yang batal", async () => {
    const { s0 } = await legacyDuplicate();
    await recomputeSettlement(fx.hr, s0.id);
    const before = await prisma.finalSettlementLine.findMany({ where: { settlementId: s0.id }, orderBy: { sortOrder: "asc" } });
    await submitSettlement(fx.hr, s0.id);
    await approveSettlement(fx.superAdmin, s0.id, {});
    const rows = await auditSettlementDuplicates(fx.superAdmin);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ settlementId: s0.id, status: "APPROVED", employeeName: "Ayu Lestari" });
    expect(rows[0]!.categories).toMatchObject([{ category: "PRORATED_SALARY", categoryLabel: "Gaji prorata" }]);
    expect(rows[0]!.categories[0]!.lines.map((l) => l.name).sort()).toEqual(["Gaji pokok (prorata)", "Gaji pokok (prorata, koreksi)", "Tunjangan makan (prorata)"]);
    expect(rows[0]!.categories[0]!.total).toBe(3_000_000 + 2_727_273 + 200_000);
    expect(await prisma.finalSettlementLine.findMany({ where: { settlementId: s0.id }, orderBy: { sortOrder: "asc" } })).toEqual(before); // tidak ada yang diubah
    expect((await fail(auditSettlementDuplicates(fx.hr)))?.code).toBe("FORBIDDEN"); // HR tidak punya payroll:approve
    expect((await fail(auditSettlementDuplicates(fx.emp1)))?.code).toBe("FORBIDDEN");
  });

  it("penyelesaian bersih (berkunci, tanpa pola ganda) tidak masuk audit", async () => {
    await salary();
    const s0 = await mk();
    await updateLine(fx.hr, s0.lines[0]!.id, { category: "PRORATED_SALARY", name: "Gaji pokok (prorata, koreksi)", amount: 3_000_000 });
    await recomputeSettlement(fx.hr, s0.id);
    expect(await auditSettlementDuplicates(fx.superAdmin)).toEqual([]);
  });
});

describe("uang harian: penyelesaian akhir vs Bukti Penerimaan (tidak dibayar dua kali)", () => {
  const TRG = "daily_allowance_receipts_settlement_guard";
  const mkAssignee = async (seq = 1) => {
    const l = await makeLetter(fx.hr.userId, seq);
    return prisma.assignmentAssignee.create({ data: { letterId: l.id, employeeId: emp(), days: 5, dailyRate: 150_000n, total: 750_000n } });
  };
  const allow = <L extends { category: string }>(s: { lines: L[] }) => s.lines.filter((l) => l.category === "UNPAID_ALLOWANCE");
  /** Bukti disisipkan LANGSUNG ke database dengan penjaga dimatikan — meniru data lama/balapan yang lolos dari pemeriksaan service. */
  async function rawReceipt(a: { id: string; letterId: string; employeeId: string }, seqNo = 90) {
    await prisma.$executeRawUnsafe(`ALTER TABLE daily_allowance_receipts DISABLE TRIGGER ${TRG}`);
    try {
      return await prisma.dailyAllowanceReceipt.create({ data: { seqYear: 2026, seqNo, number: `${seqNo}/BPUH/XI/2026`, letterId: a.letterId, assigneeId: a.id, employeeId: a.employeeId, days: 5, dailyRate: 150_000n, total: 750_000n, paidDate: isoToDate("2026-11-03"), method: "CASH", snapshot: {}, issuedById: fx.hr.userId } });
    } finally { await prisma.$executeRawUnsafe(`ALTER TABLE daily_allowance_receipts ENABLE TRIGGER ${TRG}`); }
  }

  it("baris uang harian tertaut ke penerima tugas (assigneeId + kunci ALLOWANCE)", async () => {
    await salary();
    const a = await mkAssignee();
    const s = await mk();
    expect(allow(s)).toMatchObject([{ assigneeId: a.id, sourceKey: `ALLOWANCE:${a.id}`, amount: 750_000 }]);
    // baris lain tidak bertaut
    expect(s.lines.filter((l) => l.category !== "UNPAID_ALLOWANCE").every((l) => l.assigneeId === null)).toBe(true);
  });

  it("Bukti Penerimaan terpisah DITOLAK selama penyelesaian berlaku — Draf, Menunggu, Disetujui, Dibayar — dan tidak ada bukti yang tercipta", async () => {
    await salary();
    const a = await mkAssignee();
    const s = await mk();
    const tryIssue = async () => fail(issueReceipt(fx.hr, { assigneeId: a.id, method: "CASH" }));
    let e = await tryIssue();
    expect(e?.code).toBe("CONFLICT");
    expect(e?.message).toMatch(/sudah termasuk penyelesaian akhir \(draf\)[^]*tidak dibayar dua kali/);
    expect(e?.extra).toMatchObject({ settlementId: s.id });
    await submitSettlement(fx.hr, s.id);
    expect((await tryIssue())?.message).toMatch(/\(menunggu persetujuan\)/);
    await approveSettlement(fx.superAdmin, s.id, {});
    expect((await tryIssue())?.message).toMatch(/\(disetujui\)/);
    await markSettlementPaid(fx.hr, s.id, {});
    e = await tryIssue();
    expect(e?.message).toMatch(/\(dibayar\)/);
    expect(await prisma.dailyAllowanceReceipt.count()).toBe(0);
  });

  it("jalur sah tetap ada: setelah baris dihapus (Draf) atau penyelesaian dibatalkan, bukti boleh diterbitkan", async () => {
    await salary();
    const a1 = await mkAssignee(1);
    const s = await mk();
    // (1) hapus barisnya dari Draf → bukti boleh, dan usulan tidak bangkit lagi (bukti aktif + dikecualikan)
    await deleteLine(fx.hr, allow(s)[0]!.id);
    expect((await issueReceipt(fx.hr, { assigneeId: a1.id, method: "TRANSFER" })).total).toBe(750_000);
    expect(allow(await recomputeSettlement(fx.hr, s.id))).toHaveLength(0);
    // (2) penyelesaian dibatalkan → uang harian lain yang sebelumnya tercakup kembali boleh dibuatkan bukti
    const a2 = await mkAssignee(2);
    const re = await recomputeSettlement(fx.hr, s.id);
    expect(allow(re).map((l) => l.assigneeId)).toEqual([a2.id]);
    expect((await fail(issueReceipt(fx.hr, { assigneeId: a2.id, method: "CASH" })))?.code).toBe("CONFLICT");
    await cancelSettlement(fx.hr, s.id, { reason: "Salah tanggal terakhir bekerja" });
    expect((await issueReceipt(fx.hr, { assigneeId: a2.id, method: "CASH" })).total).toBe(750_000);
  });

  it("Surat Tugas menandai penerima yang uangnya masuk penyelesaian akhir; lencana & filter 'menunggu bukti' tidak menghitungnya; kembali dihitung setelah dibatalkan", async () => {
    await salary();
    const a = await mkAssignee();
    const items = async (pending = false) => (await listAssignments(fx.hr, pending ? { pending: "1" } : {})).items;
    expect(await pendingAllowanceCount()).toBe(1);
    const s = await mk();
    expect((await items())[0]!.assignees[0]!.settlement).toEqual({ id: s.id, status: "DRAFT", paidOn: null });
    expect(await pendingAllowanceCount()).toBe(0);
    expect(await items(true)).toHaveLength(0);
    await submitSettlement(fx.hr, s.id); await approveSettlement(fx.superAdmin, s.id, {}); await markSettlementPaid(fx.hr, s.id, { paidOn: "2026-11-09" });
    expect((await items())[0]!.assignees[0]!.settlement).toMatchObject({ status: "PAID", paidOn: "2026-11-09" });
    expect(await pendingAllowanceCount()).toBe(0); // dibayar lewat penyelesaian akhir → bukan lagi "menunggu bukti"
    expect(a.id).toBeTruthy();
  });

  it("penyelesaian yang dibatalkan melepas penanda: penerima kembali 'menunggu bukti'", async () => {
    await salary();
    await mkAssignee();
    const s = await mk();
    expect(await pendingAllowanceCount()).toBe(0);
    await cancelSettlement(fx.hr, s.id, { reason: "Dibuat ulang nanti" });
    expect(await pendingAllowanceCount()).toBe(1);
    expect((await listAssignments(fx.hr)).items[0]!.assignees[0]!.settlement).toBeNull();
  });

  it("penjaga database: bukti aktif ditolak untuk uang yang sudah di penyelesaian berlaku; baris ditolak untuk uang yang sudah punya bukti aktif", async () => {
    await salary();
    const a = await mkAssignee(1);
    const s = await mk();
    const data = { seqYear: 2026, seqNo: 7, number: "007/BPUH/XI/2026", letterId: a.letterId, assigneeId: a.id, employeeId: a.employeeId, days: 5, dailyRate: 150_000n, total: 750_000n, paidDate: isoToDate("2026-11-03"), method: "CASH" as const, snapshot: {}, issuedById: fx.hr.userId };
    await expect(prisma.dailyAllowanceReceipt.create({ data })).rejects.toThrow(/HRIS-GUARD[^]*sudah termasuk penyelesaian akhir/);
    // bukti VOIDED tidak dihalangi (arsip), tetapi bukti aktif untuk penerima lain sah
    const b = await mkAssignee(2);
    await prisma.dailyAllowanceReceipt.create({ data: { ...data, seqNo: 8, number: "008/BPUH/XI/2026", letterId: b.letterId, assigneeId: b.id } });
    await expect(prisma.finalSettlementLine.create({ data: { settlementId: s.id, kind: "EARNING", category: "UNPAID_ALLOWANCE", name: "Uang harian: tidak boleh", amount: 750_000n, source: "MANUAL", assigneeId: b.id, sortOrder: 99 } })).rejects.toThrow(/HRIS-GUARD[^]*Bukti Penerimaan aktif/);
  });

  it("cek ulang saat DIAJUKAN: bukti yang lolos ke database ditolak jelas, peringatan muncul di layar, dan jalan keluarnya hapus baris", async () => {
    await salary();
    const a = await mkAssignee();
    const s = await mk();
    await rawReceipt(a);
    expect((await getSettlement(fx.hr, s.id)).warnings.join(" | ")).toMatch(/Uang harian bermasalah: "Uang harian: Bandung" sudah punya Bukti Penerimaan 90\/BPUH/);
    const e = await fail(submitSettlement(fx.hr, s.id));
    expect(e?.code).toBe("CONFLICT");
    expect(e?.message).toMatch(/Uang harian tidak boleh dibayar lewat penyelesaian akhir[^]*sudah punya Bukti Penerimaan 90\/BPUH[^]*tidak dibayar dua kali/);
    expect((await prisma.finalSettlement.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("DRAFT");
    await deleteLine(fx.hr, allow(s)[0]!.id);
    expect((await submitSettlement(fx.hr, s.id)).status).toBe("PENDING_APPROVAL");
  });

  it("cek ulang saat DISETUJUI: status tidak berubah bila bukti muncul setelah diajukan; jalan keluar: kembalikan, hapus baris, ajukan lagi", async () => {
    await salary();
    const a = await mkAssignee();
    const s = await mk();
    await submitSettlement(fx.hr, s.id);
    await rawReceipt(a);
    const e1 = await fail(approveSettlement(fx.superAdmin, s.id, {}));
    expect(e1?.code).toBe("CONFLICT");
    expect(e1?.message).toMatch(/Bukti Penerimaan 90\/BPUH/);
    expect((await prisma.finalSettlement.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("PENDING_APPROVAL");
    // dikembalikan ke Draf → baris dihapus → disetujui
    await returnSettlement(fx.superAdmin, s.id, { note: "Uang harian sudah dibayar lewat bukti" });
    await deleteLine(fx.hr, allow(await getSettlement(fx.hr, s.id))[0]!.id);
    await submitSettlement(fx.hr, s.id);
    expect((await approveSettlement(fx.superAdmin, s.id, {})).status).toBe("APPROVED");
  });

  it("cek ulang saat DICATAT DIBAYAR menolak bila bukti muncul setelah disetujui", async () => {
    await salary();
    const a = await mkAssignee();
    const s = await mk();
    await submitSettlement(fx.hr, s.id);
    await approveSettlement(fx.superAdmin, s.id, {});
    await rawReceipt(a);
    const e = await fail(markSettlementPaid(fx.hr, s.id, {}));
    expect(e?.code).toBe("CONFLICT");
    expect(e?.message).toMatch(/Bukti Penerimaan 90\/BPUH/);
    expect((await prisma.finalSettlement.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("APPROVED");
  });

  it("surat tugas yang dibatalkan: baris uang harian ditolak saat diajukan; hitung ulang membuangnya; pembatalan surat DITOLAK bila penyelesaian sudah disetujui/dibayar", async () => {
    await salary();
    const a = await mkAssignee();
    const s = await mk();
    await cancelAssignment(fx.hr, a.letterId, { reason: "Perjalanan dibatalkan klien" }); // masih Draf → boleh
    expect((await fail(submitSettlement(fx.hr, s.id)))?.message).toMatch(/surat tugas 001\/ST\/XI\/2026 sudah dibatalkan/);
    expect(allow(await recomputeSettlement(fx.hr, s.id))).toHaveLength(0);
    // pembanding: pembatalan surat DITOLAK bila uangnya sudah di penyelesaian yang disetujui
    const b = await mkAssignee(2);
    const s2 = (await recomputeSettlement(fx.hr, s.id));
    expect(allow(s2).map((l) => l.assigneeId)).toEqual([b.id]);
    await submitSettlement(fx.hr, s.id); await approveSettlement(fx.superAdmin, s.id, {});
    const e = await fail(cancelAssignment(fx.hr, b.letterId, { reason: "Dibatalkan setelah disetujui" }));
    expect(e?.code).toBe("CONFLICT");
    expect(e?.message).toMatch(/sudah termasuk penyelesaian akhir yang disetujui/);
    expect((await prisma.assignmentLetter.findUniqueOrThrow({ where: { id: b.letterId } })).status).toBe("ISSUED");
    // dibatalkan oleh pimpinan → pembatalan surat tugas boleh
    await cancelSettlement(fx.superAdmin, s.id, { reason: "Dikoreksi" });
    expect((await cancelAssignment(fx.hr, b.letterId, { reason: "Dibatalkan setelah koreksi" })).status).toBe("CANCELLED");
  });

  it("sinyal checklist berhenti tidak lagi menghitung uang harian yang sudah masuk penyelesaian akhir sebagai 'belum diterbitkan bukti'", async () => {
    await salary();
    await mkAssignee();
    const c = await startChecklist(fx.hr, emp(), { kind: "OFFBOARDING" });
    const sig = async () => (await listEmployeeChecklists(fx.hr, emp())).find((x) => x.id === c.id)!.items.find((i) => i.key === "obligations")!;
    expect((await sig()).signal?.text).toMatch(/1 uang harian belum diterbitkan bukti penerimaannya/);
    await mk();
    expect((await sig()).signal?.text).not.toMatch(/uang harian belum diterbitkan/);
  });

  it("audit baca-saja untuk pimpinan: mendaftar uang harian yang tercatat dua kali; kosong bila bersih; penyelesaian batal diabaikan; HR ditolak", async () => {
    await salary();
    const a = await mkAssignee();
    const s = await mk();
    expect(await auditAllowanceOverlaps(fx.superAdmin)).toEqual([]);
    await rawReceipt(a);
    const rows = await auditAllowanceOverlaps(fx.superAdmin);
    expect(rows).toEqual([expect.objectContaining({ settlementId: s.id, settlementStatus: "DRAFT", employeeName: "Ayu Lestari", lineAmount: 750_000, receiptTotal: 750_000, letterNumber: "001/ST/XI/2026", receiptNumber: "90/BPUH/XI/2026", problem: "ACTIVE_RECEIPT" })]);
    expect((await fail(auditAllowanceOverlaps(fx.hr)))?.code).toBe("FORBIDDEN");
    await cancelSettlement(fx.hr, s.id, { reason: "Dibuat ulang" });
    expect(await auditAllowanceOverlaps(fx.superAdmin)).toEqual([]);
  });

  it("audit juga mendaftar baris uang harian pada penyelesaian yang berlaku untuk surat tugas yang sudah DIBATALKAN (LETTER_CANCELLED); hilang bila penyelesaian dibatalkan", async () => {
    await salary();
    const a = await mkAssignee();
    const s = await mk();                                                       // penyelesaian Draf memuat uang harian
    await cancelAssignment(fx.hr, a.letterId, { reason: "Perjalanan dibatalkan klien" });   // masih Draf → pembatalan surat diizinkan; barisnya tertinggal
    const rows = await auditAllowanceOverlaps(fx.superAdmin);
    expect(rows).toEqual([expect.objectContaining({ settlementId: s.id, problem: "LETTER_CANCELLED", lineAmount: 750_000, letterNumber: "001/ST/XI/2026", receiptNumber: null, receiptTotal: null })]);
    // dan penyelesaian itu tidak dapat diajukan selama barisnya masih ada (pesan layanan menyebut surat dibatalkan)
    expect((await fail(submitSettlement(fx.hr, s.id)))?.message).toMatch(/dibatalkan/);
    await cancelSettlement(fx.hr, s.id, { reason: "Dibuat ulang" });
    expect(await auditAllowanceOverlaps(fx.superAdmin)).toEqual([]);
  });
});

describe("migrasi: menautkan baris uang harian lama", () => {
  const sql = readFileSync("prisma/migrations/20261110170000_settlement_allowance_link/migration.sql", "utf8");
  const backfill = sql.slice(sql.indexOf("-- BACKFILL:START"), sql.indexOf("-- BACKFILL:END"))
    .split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").split(";").map((x) => x.trim()).filter(Boolean);
  const runBackfill = async () => { for (const st of backfill) await prisma.$executeRawUnsafe(st); };

  it("baris SISTEM lama tanpa kunci ditautkan bila kecocokannya tunggal; yang meragukan/manual dibiarkan; penjaga 'hanya Draf' menyala kembali; nominal tidak berubah", async () => {
    await salary();
    const l1 = await makeLetter(fx.hr.userId, 1);
    const l2 = await makeLetter(fx.hr.userId, 2);
    const l3 = await makeLetter(fx.hr.userId, 3);
    const mkA = (letterId: string, total: bigint) => prisma.assignmentAssignee.create({ data: { letterId, employeeId: emp(), days: 5, dailyRate: total / 5n, total } });
    const a1 = await mkA(l1.id, 750_000n), a2 = await mkA(l2.id, 500_000n), a3 = await mkA(l3.id, 300_000n);
    const s = await mk();
    // tiru data LAMA: kunci & tautan hilang; baris 3 diubah HR (MANUAL) sehingga tidak bisa dicocokkan; baris 2 rumusnya tidak memuat nomor surat
    await prisma.finalSettlementLine.updateMany({ where: { settlementId: s.id }, data: { sourceKey: null, assigneeId: null } });
    const lines = await prisma.finalSettlementLine.findMany({ where: { settlementId: s.id, category: "UNPAID_ALLOWANCE" } });
    const of = (total: bigint) => lines.find((l) => l.amount === total)!;
    await prisma.finalSettlementLine.update({ where: { id: of(500_000n).id }, data: { formula: "ditulis ulang HR tanpa nomor" } });
    await prisma.finalSettlementLine.update({ where: { id: of(300_000n).id }, data: { source: "MANUAL", name: "Uang harian (diubah HR)" } });
    await submitSettlement(fx.hr, s.id); await approveSettlement(fx.superAdmin, s.id, {}); // SEKARANG terkunci (non-Draf)
    const before = await prisma.finalSettlementLine.findMany({ where: { settlementId: s.id }, orderBy: { sortOrder: "asc" } });

    await runBackfill();

    const after = await prisma.finalSettlementLine.findMany({ where: { settlementId: s.id }, orderBy: { sortOrder: "asc" } });
    const get = (total: bigint) => after.find((l) => l.category === "UNPAID_ALLOWANCE" && l.amount === total)!;
    expect(get(750_000n)).toMatchObject({ assigneeId: a1.id, sourceKey: `ALLOWANCE:${a1.id}` }); // tertaut
    expect(get(500_000n)).toMatchObject({ assigneeId: null, sourceKey: null });                   // rumus tak memuat nomor surat → dibiarkan
    expect(get(300_000n)).toMatchObject({ assigneeId: null, sourceKey: null });                   // baris MANUAL → dibiarkan
    expect(a2.id).not.toBe(a3.id);
    // hanya kolom penanda yang berubah
    expect(after.map((l) => [l.id, l.amount, l.name, l.formula, l.source])).toEqual(before.map((l) => [l.id, l.amount, l.name, l.formula, l.source]));
    // penjaga "hanya Draf" menyala lagi
    await expect(prisma.finalSettlementLine.update({ where: { id: get(750_000n).id }, data: { name: "ubah" } })).rejects.toThrow(/HRIS-GUARD/);
    // sesudah tertaut, bukti terpisah untuk penerima itu ditolak
    expect((await fail(issueReceipt(fx.hr, { assigneeId: a1.id, method: "CASH" })))?.code).toBe("CONFLICT");
    // idempoten
    await runBackfill();
    expect((await prisma.finalSettlementLine.findMany({ where: { settlementId: s.id, assigneeId: { not: null } } })).length).toBe(1);
  });
});

describe("alur persetujuan & penguncian", () => {
  it("Draf → diajukan → disetujui → dibayar; baris terkunci setelah diajukan; pimpinan diberi tahu; semua tercatat", async () => {
    await salary();
    const s = await mk();
    await submitSettlement(fx.hr, s.id);
    expect((await prisma.notification.findMany({ where: { type: "settlement.submitted" } })).map((n) => n.userId)).toEqual([fx.superAdmin.userId]);
    expect((await fail(addLine(fx.hr, s.id, { category: "OTHER_EARNING", name: "Tambahan telat", amount: 1000 })))?.code).toBe("CONFLICT");
    expect((await fail(updateSettlement(fx.hr, s.id, { note: "ubah" })))?.code).toBe("CONFLICT");
    // trigger database menolak walau service dilewati
    await expect(prisma.finalSettlementLine.create({ data: { settlementId: s.id, kind: "EARNING", category: "OTHER_EARNING", name: "Menyelinap", amount: 1n, sortOrder: 99 } })).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.finalSettlementLine.deleteMany({ where: { settlementId: s.id } })).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.finalSettlement.update({ where: { id: s.id }, data: { totalEarnings: 9_999_999n, netPayable: 9_999_999n } })).rejects.toThrow(/HRIS-GUARD/);

    expect((await fail(approveSettlement(fx.hr, s.id)))?.code).toBe("FORBIDDEN"); // HR tidak punya payroll:approve
    const ok = await approveSettlement(fx.superAdmin, s.id, { note: "Sesuai perjanjian" });
    expect(ok).toMatchObject({ status: "APPROVED", approvedBy: "Pimpinan Uji", approvalNote: "Sesuai perjanjian" });
    expect((await fail(markSettlementPaid(fx.hr, s.id, { paidOn: "2099-01-01" })))?.fieldErrors?.paidOn).toBeTruthy();
    const paid = await markSettlementPaid(fx.hr, s.id, { reference: "TRF-2026-1107-01" });
    expect(paid).toMatchObject({ status: "PAID", payReference: "TRF-2026-1107-01", paidBy: "HR Uji" });
    expect((await fail(cancelSettlement(fx.superAdmin, s.id, { reason: "Terlanjur dibayar" })))?.code).toBe("CONFLICT");
    await expect(prisma.finalSettlement.update({ where: { id: s.id }, data: { note: "ubah" } })).rejects.toThrow(/HRIS-GUARD/);
    expect((await prisma.auditLog.findMany({ where: { entityId: s.id }, orderBy: { id: "asc" } })).map((a) => a.action)).toEqual(["settlement.create", "settlement.submit", "settlement.approve", "settlement.paid"]);
  });

  it("tidak boleh menyetujui milik sendiri; dikembalikan wajib catatan lalu bisa diubah & diajukan lagi", async () => {
    await salary();
    const s = await mk();
    await submitSettlement(fx.hr, s.id);
    // Pimpinan yang sekaligus karyawan ybs (mis. direktur yang berhenti) tidak bisa menyetujui penyelesaian miliknya.
    const self = await makeUser("direktur@uji.test", "Direktur Uji", "SUPER_ADMIN", emp());
    expect((await fail(approveSettlement(self, s.id)))?.code).toBe("FORBIDDEN");
    expect((await fail(returnSettlement(fx.superAdmin, s.id, { note: "" })))?.fieldErrors?.note).toBeTruthy();
    const back = await returnSettlement(fx.superAdmin, s.id, { note: "Mohon periksa dasar pesangon" });
    expect(back).toMatchObject({ status: "DRAFT", returnedNote: "Mohon periksa dasar pesangon" });
    expect((await prisma.notification.findMany({ where: { type: "settlement.returned" } })).map((n) => n.userId)).toEqual([fx.hr.userId]);
    await addLine(fx.hr, s.id, { category: "SEVERANCE", name: "Uang pesangon", amount: 1_000_000 });
    expect((await submitSettlement(fx.hr, s.id)).status).toBe("PENDING_APPROVAL");
    expect((await fail(returnSettlement(fx.hr, s.id, { note: "HR tidak boleh" })))?.code).toBe("FORBIDDEN");
  });

  it("tidak bisa diajukan tanpa baris atau dengan bersih negatif; pembatalan: Draf/Menunggu oleh HR, Disetujui hanya pimpinan", async () => {
    const empty = await mk(); // tanpa komponen gaji → tanpa usulan
    expect(empty.lines).toHaveLength(0);
    expect((await fail(submitSettlement(fx.hr, empty.id)))?.code).toBe("VALIDATION");
    await addLine(fx.hr, empty.id, { category: "OTHER_EARNING", name: "Insentif akhir", amount: 100_000 });
    await addLine(fx.hr, empty.id, { category: "LOAN", name: "Pelunasan kasbon", amount: 250_000 });
    const neg = await fail(submitSettlement(fx.hr, empty.id));
    expect(neg?.code).toBe("VALIDATION");
    expect(neg?.message).toMatch(/melebihi total pendapatan/);
    await expect(prisma.finalSettlement.update({ where: { id: empty.id }, data: { status: "PENDING_APPROVAL", submittedAt: new Date(), submittedById: fx.hr.userId, totalEarnings: 100_000n, totalDeductions: 250_000n, netPayable: -150_000n } })).rejects.toThrow(); // CHECK database

    const lines = (await getSettlement(fx.hr, empty.id)).lines;
    await updateLine(fx.hr, lines.find((l) => l.category === "LOAN")!.id, { category: "LOAN", name: "Pelunasan kasbon", amount: 50_000 });
    await submitSettlement(fx.hr, empty.id);
    expect((await cancelSettlement(fx.hr, empty.id, { reason: "Diajukan keliru" })).status).toBe("CANCELLED"); // Menunggu → Batal oleh penyusun
    expect((await fail(cancelSettlement(fx.hr, empty.id, { reason: "Sudah dibatalkan" })))?.code).toBe("CONFLICT");
    expect((await fail(cancelSettlement(fx.hr, empty.id, { reason: "x" })))?.fieldErrors?.reason).toBeTruthy();

    const second = await mk();
    await addLine(fx.hr, second.id, { category: "OTHER_EARNING", name: "Insentif akhir", amount: 100_000 });
    await submitSettlement(fx.hr, second.id);
    await approveSettlement(fx.superAdmin, second.id);
    expect((await fail(cancelSettlement(fx.hr, second.id, { reason: "Salah hitung" })))?.code).toBe("FORBIDDEN");
    expect((await cancelSettlement(fx.superAdmin, second.id, { reason: "Salah hitung" })).status).toBe("CANCELLED");
  });
});

describe("id yang bukan UUID", () => {
  it("dijawab tidak ditemukan (404), bukan galat database", async () => {
    for (const bad of ["ngawur", "123", "00000000-0000-0000-0000-00000000000Z"]) {
      expect((await fail(getSettlement(fx.hr, bad)))?.code).toBe("NOT_FOUND");
      expect((await fail(submitSettlement(fx.hr, bad)))?.code).toBe("NOT_FOUND");
      expect((await fail(approveSettlement(fx.superAdmin, bad)))?.code).toBe("NOT_FOUND");
      expect((await fail(markSettlementPaid(fx.hr, bad)))?.code).toBe("NOT_FOUND");
      expect((await fail(recomputeSettlement(fx.hr, bad)))?.code).toBe("NOT_FOUND");
      expect((await fail(deleteLine(fx.hr, bad)))?.code).toBe("NOT_FOUND");
    }
  });
});

describe("penjaga database", () => {
  it("tidak dihapus, karyawan tidak berganti, loncat status ditolak, satu yang berlaku per karyawan", async () => {
    await salary();
    const s = await mk();
    await expect(prisma.finalSettlement.delete({ where: { id: s.id } })).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.finalSettlement.update({ where: { id: s.id }, data: { employeeId: fx.empIds[1] } })).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.finalSettlement.update({ where: { id: s.id }, data: { status: "PAID", approvedAt: new Date(), approvedById: fx.hr.userId, paidAt: new Date(), paidById: fx.hr.userId, paidOn: new Date() } })).rejects.toThrow(/HRIS-GUARD/);
    await expect(prisma.finalSettlement.create({ data: { employeeId: emp(), lastWorkDate: isoToDate(LAST), preparedById: fx.hr.userId } })).rejects.toThrow(); // indeks unik parsial
    await expect(prisma.finalSettlementLine.create({ data: { settlementId: s.id, kind: "EARNING", category: "TAX", name: "Kategori salah jenis", amount: 1n, sortOrder: 50 } })).rejects.toThrow(); // CHECK: pajak adalah potongan
    await expect(prisma.finalSettlementLine.create({ data: { settlementId: s.id, kind: "EARNING", category: "OTHER_EARNING", name: "Nol", amount: 0n, sortOrder: 51 } })).rejects.toThrow(); // CHECK: nominal > 0
  });
});

describe("sinyal pada checklist karyawan berhenti", () => {
  it("butir hak & kewajiban menampilkan status penyelesaian akhir dan tidak mencentang sendiri", async () => {
    await salary();
    const c = await startChecklist(fx.hr, emp(), { kind: "OFFBOARDING" });
    const sig = async () => (await listEmployeeChecklists(fx.hr, emp())).find((x) => x.id === c.id)!.items.find((i) => i.key === "obligations")!;
    expect((await sig()).signal?.text).toMatch(/penyelesaian akhir belum dibuat/);
    const s = await mk();
    expect(await sig()).toMatchObject({ status: "TODO", signal: { state: "WARN" } });
    expect((await sig()).signal?.text).toMatch(/penyelesaian akhir draf \(belum dibayar\)/);
    await submitSettlement(fx.hr, s.id);
    await approveSettlement(fx.superAdmin, s.id);
    await markSettlementPaid(fx.hr, s.id);
    const done = await sig();
    expect(done.signal).toMatchObject({ state: "OK" });
    expect(done.signal?.text).toMatch(/sudah dibayar/);
    expect(done.status).toBe("TODO");
  });
});
