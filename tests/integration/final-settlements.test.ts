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
  addLine, approveSettlement, cancelSettlement, createSettlement, deleteLine, getSettlement, listSettlements, markSettlementPaid, recomputeSettlement,
  returnSettlement, settlementOfEmployee, submitSettlement, updateLine, updateSettlement,
} from "@/server/services/final-settlements";
import { assignAsset, createAsset } from "@/server/services/assets";
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

  it("mengubah baris sistem menjadikannya manual; hitung ulang mengganti baris sistem saja dan memunculkan lagi yang dihapus", async () => {
    await salary();
    const s0 = await mk();
    const sys = s0.lines.find((l) => l.name === "Gaji pokok (prorata)")!;
    const s1 = await updateLine(fx.hr, sys.id, { category: "PRORATED_SALARY", name: "Gaji pokok (prorata, disepakati)", amount: 3_000_000, formula: "Disepakati dengan karyawan" });
    expect(s1.lines.find((l) => l.id === sys.id)).toMatchObject({ source: "MANUAL", amount: 3_000_000 });
    const meal = s0.lines.find((l) => l.name === "Tunjangan makan (prorata)")!;
    await deleteLine(fx.hr, meal.id);
    await addLine(fx.hr, s0.id, { category: "OTHER_DEDUCTION", name: "Potongan koperasi", amount: 100_000 });
    const re = await recomputeSettlement(fx.hr, s0.id);
    // baris manual (termasuk gaji yang diubah) tetap; baris sistem yang dihapus kembali; tidak ada baris ganda untuk gaji pokok? — gaji pokok sistem muncul lagi karena baris lamanya sudah manual
    expect(re.lines.filter((l) => l.source === "MANUAL").map((l) => l.name).sort()).toEqual(["Gaji pokok (prorata, disepakati)", "Potongan koperasi"]);
    expect(re.lines.filter((l) => l.source === "SYSTEM").map((l) => l.name).sort()).toEqual(["Gaji pokok (prorata)", "Tunjangan makan (prorata)"]);
    expect(re.netPayable).toBe(3_000_000 + 2_727_273 + 200_000 - 100_000);
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
