/**
 * Surat Tugas (dasar) + Bukti Penerimaan Uang Harian (per perjalanan, berdiri sendiri, di luar slip gaji).
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { prisma } from "@/server/db";
import { AppError } from "@/server/errors";
import { isoToDate } from "@/server/json";
import { normalizeSignature } from "@/server/photo/signature";
import { storeFile } from "@/server/services/files";
import { cancelAssignment, createAssignment, getAssignmentForPdf, getReceiptForPdf, issueReceipt, listAssignments, listMyAssignments, pendingAllowanceCount, voidReceipt } from "@/server/services/assignments";
import { listNotifications } from "@/server/services/notifications";
import { approveRun, calculateRun, createRun, getRun, issueRun, submitRun } from "@/server/services/payroll";
import { getRunPayslips } from "@/server/services/payslips";
import { confirmPayrollRules, setSignature, updateAttendancePolicy, updateCompany, updatePayrollRules } from "@/server/services/settings";
import { renderAssignmentPdf, renderPayslipsPdf, renderReceiptPdf } from "@/server/pdf/render";
import { addAttendance, addComponent, resetDb, seedFixtures, type Fixtures } from "../helpers/db";
import { pinNow } from "../helpers/pin-now";

pinNow(); // hari ini = 1 Nov 2026 (WIB)

let fx: Fixtures;
const fail = async (p: Promise<unknown>) => { try { await p; return null; } catch (e) { return e as AppError; } };
const dir = mkdtempSync(join(tmpdir(), "alw-"));
let k = 0;
const [A, B, C] = [0, 1, 2] as const;
const trip = (over: Record<string, unknown> = {}) => ({
  purpose: "Pendampingan pelatihan di klien", destination: "Bandung, Jawa Barat", startDate: "2026-11-02", endDate: "2026-11-06",
  assignees: [{ employeeId: fx.empIds[A], dailyRate: 300_000 }, { employeeId: fx.empIds[B], dailyRate: 250_000, days: 3 }], ...over,
});
const company = (over: Record<string, unknown> = {}) => ({
  name: "TRILOGIKA EDUTAMA (UJI)", legalName: null, tagline: "Light & Insight", address: "Alamat uji", phone: null, email: null, website: null,
  slipShowAttendance: true, slipFooterNote: null, slipNumberPrefix: "SG", slipSignerName: "Fawwaz Chaidir, S.Psi.", slipSignerTitle: "Chief Executive Officer", slipSignerPlace: "Yogyakarta", ...over,
});
const pdfInfo = (buf: Buffer) => {
  const f = join(dir, `d${k++}.pdf`); writeFileSync(f, buf);
  return {
    text: execFileSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" }),
    pages: Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [f], { encoding: "utf8" }))![1]),
    images: execFileSync("pdfimages", ["-list", f], { encoding: "utf8" }).split("\n").filter((l) => /^\s*\d+\s+\d+\s+image/.test(l)).length,
  };
};
/** Watermark berotasi dipecah per huruf oleh pdftotext → bandingkan jumlah huruf "DIBATALKAN" pada PDF (-raw) berstatus batal vs normal. */
const rawLetters = (buf: Buffer) => {
  const f = join(dir, `w${k++}.pdf`); writeFileSync(f, buf);
  const raw = execFileSync("pdftotext", ["-raw", f, "-"], { encoding: "utf8" }).replace(/\s+/g, "");
  return ["D", "I", "B", "A", "T", "L", "K", "N"].map((c) => raw.split(c).length - 1);
};
const hasWatermark = (voided: Buffer, normal: Buffer) => { const a = rawLetters(voided), b = rawLetters(normal); return a.some((n, i) => n > b[i]!); };
async function uploadSignature() {
  const png = await normalizeSignature(await sharp({ create: { width: 500, height: 200, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 0 } } })
    .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="200"><path d="M10 150 C80 10 140 190 220 80 S380 20 490 120" stroke="#1a2b6b" stroke-width="6" fill="none"/></svg>') }]).png().toBuffer());
  const file = await storeFile(fx.superAdmin, "SIGNATURE", { name: "tanda-tangan.png", bytes: png });
  await setSignature(fx.superAdmin, file.id);
}

beforeEach(async () => {
  await resetDb();
  fx = await seedFixtures();
  await updateCompany(fx.superAdmin, company());
});

describe("Surat Tugas", () => {
  it("HR menerbitkan surat tugas: nomor per tahun, nominal hari × tarif, audit, hanya karyawan ditunjuk yang diberi tahu", async () => {
    const l = await createAssignment(fx.hr, trip());
    expect(l).toMatchObject({ number: "001/ST/XI/2026", status: "ISSUED", tripDays: 5, totalAllowance: 5 * 300_000 + 3 * 250_000, issuedBy: "HR Uji" });
    expect(l.assignees.map((a) => [a.employeeName, a.days, a.dailyRate, a.total, a.receipt])).toEqual([
      ["Ayu Lestari", 5, 300_000, 1_500_000, null], ["Budi Santoso", 3, 250_000, 750_000, null],
    ]);
    expect((await createAssignment(fx.superAdmin, trip({ assignees: [{ employeeId: fx.empIds[C], dailyRate: 100_000 }] }))).number).toBe("002/ST/XI/2026");
    expect((await createAssignment(fx.hr, trip({ issueDate: "2027-01-05", startDate: "2027-01-06", endDate: "2027-01-06", assignees: [{ employeeId: fx.empIds[A], dailyRate: 100_000 }] }))).number).toBe("001/ST/I/2027"); // nomor urut mulai lagi tiap tahun
    expect(await prisma.auditLog.count({ where: { action: "assignment.create" } })).toBe(3);
    expect((await listNotifications(fx.emp1, 20)).items.some((n) => n.type === "assignment.issued" && n.href === "/surat-tugas-saya")).toBe(true);
    expect((await listNotifications(fx.emp3, 20)).items.filter((n) => n.type === "assignment.issued")).toHaveLength(1); // hanya surat ke-2
    expect(await pendingAllowanceCount()).toBe(3);
  });

  it("validasi: tujuan wajib, tanggal terbalik, hari melebihi lama penugasan, karyawan ganda/nonaktif, tarif negatif, daftar kosong", async () => {
    expect((await fail(createAssignment(fx.hr, trip({ purpose: "" }))))?.fieldErrors?.purpose).toBeTruthy();
    expect((await fail(createAssignment(fx.hr, trip({ endDate: "2026-11-01" }))))?.fieldErrors?.endDate).toBeTruthy();
    expect((await fail(createAssignment(fx.hr, trip({ assignees: [{ employeeId: fx.empIds[A], dailyRate: 100_000, days: 9 }] }))))?.fieldErrors?.["assignees.0.days"]).toMatch(/lama penugasan/);
    expect((await fail(createAssignment(fx.hr, trip({ assignees: [{ employeeId: fx.empIds[A], dailyRate: 1 }, { employeeId: fx.empIds[A], dailyRate: 1 }] }))))?.fieldErrors?.["assignees.1.employeeId"]).toBeTruthy();
    expect((await fail(createAssignment(fx.hr, trip({ assignees: [{ employeeId: fx.empIds[A], dailyRate: -5 }] }))))?.code).toBe("VALIDATION");
    expect((await fail(createAssignment(fx.hr, trip({ assignees: [] }))))?.code).toBe("VALIDATION");
    await prisma.employee.update({ where: { id: fx.empIds[B] }, data: { isActive: false } });
    expect((await fail(createAssignment(fx.hr, trip())))?.message).toMatch(/nonaktif/);
    expect(await prisma.assignmentLetter.count()).toBe(0);
  });

  it("hak akses: karyawan tidak dapat menerbitkan; HR tidak dapat menugaskan dirinya sendiri (Super Admin boleh)", async () => {
    expect((await fail(createAssignment(fx.emp1, trip())))?.code).toBe("FORBIDDEN");
    const hrEmp = { ...fx.hr, employeeId: fx.empIds[C] };
    expect((await fail(createAssignment(hrEmp, trip({ assignees: [{ employeeId: fx.empIds[C], dailyRate: 100_000 }] }))))?.message).toMatch(/diri Anda sendiri/);
    const sa = { ...fx.superAdmin, employeeId: fx.empIds[C] };
    expect((await createAssignment(sa, trip({ assignees: [{ employeeId: fx.empIds[C], dailyRate: 100_000 }] }))).assignees[0]!.employeeName).toBe("Citra Dewi");
    expect((await fail(listAssignments(fx.emp1)))?.code).toBe("FORBIDDEN");
  });

  it("karyawan hanya melihat surat yang menugaskannya (dan uang harian miliknya); surat orang lain 'tidak ditemukan'", async () => {
    const l = await createAssignment(fx.hr, trip());
    const mine = await listMyAssignments(fx.emp1);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ number: l.number, mine: { days: 5, dailyRate: 300_000, total: 1_500_000 }, receipt: null, colleagues: ["Budi Santoso"] });
    expect(await listMyAssignments(fx.emp3)).toHaveLength(0);
    expect((await getAssignmentForPdf(fx.emp2, l.id)).number).toBe(l.number);
    expect((await fail(getAssignmentForPdf(fx.emp3, l.id)))?.code).toBe("NOT_FOUND");
    expect((await getAssignmentForPdf(fx.hr, l.id)).snapshot.assignees).toHaveLength(2);
  });

  it("PDF Surat Tugas memuat nomor, penugasan, penerima, uang harian, dan blok tanda tangan; satu halaman; dibatalkan berwatermark", async () => {
    await uploadSignature();
    const l = await createAssignment(fx.hr, trip({ details: "Mendampingi sesi pelatihan hari 1–5." }));
    const a = await getAssignmentForPdf(fx.hr, l.id);
    const noSig = pdfInfo(await renderAssignmentPdf({ ...a.snapshot, signer: { ...a.snapshot.signer!, signatureFileId: null } }, false));
    const info = pdfInfo(await renderAssignmentPdf(a.snapshot, false));
    expect(info.pages).toBe(1);
    expect(info.images).toBe(noSig.images + 1); // gambar tanda tangan ikut tercetak
    expect(info.text.replace(/\s+/g, "")).toContain("SURATTUGAS"); // judul berjarak huruf → bandingkan tanpa spasi
    for (const t of ["001/ST/XI/2026", "Ayu Lestari", "Budi Santoso", "Bandung, Jawa Barat", "2 – 6 November 2026", "(5 hari)", "Mendampingi sesi", "Rp 1.500.000", "Rp 750.000", "Rp 2.250.000", "Fawwaz Chaidir, S.Psi.", "Chief Executive Officer", "Yogyakarta, 1 November 2026", "bukan bagian dari slip gaji"]) expect(info.text).toContain(t);
    expect(hasWatermark(await renderAssignmentPdf(a.snapshot, true), await renderAssignmentPdf(a.snapshot, false))).toBe(true);
  });

  it("pembatalan wajib beralasan; surat dibatalkan menjadi riwayat; isi surat terbit dikunci di database", async () => {
    const l = await createAssignment(fx.hr, trip());
    expect((await fail(cancelAssignment(fx.hr, l.id, { reason: "" })))?.code).toBe("VALIDATION");
    await expect(prisma.$executeRawUnsafe(`UPDATE assignment_letters SET destination = 'Jakarta' WHERE id = '${l.id}'`)).rejects.toThrow(/tidak dapat diubah/);
    await expect(prisma.$executeRawUnsafe(`UPDATE assignment_assignees SET "dailyRate" = 1, total = days WHERE "letterId" = '${l.id}'`)).rejects.toThrow(/tidak dapat diubah/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM assignment_letters WHERE id = '${l.id}'`)).rejects.toThrow(/tidak boleh dihapus/);
    await expect(prisma.$executeRawUnsafe(`UPDATE assignment_assignees SET total = total + 1 WHERE "letterId" = '${l.id}'`)).rejects.toThrow();
    const c = await cancelAssignment(fx.hr, l.id, { reason: "Jadwal klien berubah" });
    expect(c).toMatchObject({ status: "CANCELLED", cancelReason: "Jadwal klien berubah" });
    expect((await fail(cancelAssignment(fx.hr, l.id, { reason: "Sekali lagi" })))?.code).toBe("CONFLICT");
    expect((await listNotifications(fx.emp1, 20)).items.some((n) => n.type === "assignment.cancelled")).toBe(true);
    expect((await listMyAssignments(fx.emp1))[0]!.status).toBe("CANCELLED");
    expect(await pendingAllowanceCount()).toBe(0);
  });
});

describe("Bukti Penerimaan Uang Harian", () => {
  it("diterbitkan per penerima per perjalanan: nomor, nominal dari surat tugas, snapshot penanda tangan, audit, karyawan diberi tahu", async () => {
    const l = await createAssignment(fx.hr, trip());
    const r = await issueReceipt(fx.hr, { assigneeId: l.assignees[0]!.id, method: "CASH", note: "Diserahkan tunai di kantor" });
    expect(r).toMatchObject({ number: "001/BPUH/XI/2026", status: "ACTIVE", letterNumber: "001/ST/XI/2026", employeeName: "Ayu Lestari", days: 5, dailyRate: 300_000, total: 1_500_000, paidDate: "2026-11-01", method: "CASH" });
    const row = await prisma.dailyAllowanceReceipt.findUniqueOrThrow({ where: { id: r.id } });
    expect(row.snapshot).toMatchObject({ number: r.number, total: 1_500_000, signer: { name: "Fawwaz Chaidir, S.Psi.", title: "Chief Executive Officer", place: "Yogyakarta" }, letter: { number: "001/ST/XI/2026", destination: "Bandung, Jawa Barat" } });
    expect(await prisma.auditLog.count({ where: { action: "allowance.issue", entityId: r.id } })).toBe(1);
    expect((await listNotifications(fx.emp1, 20)).items.some((n) => n.type === "allowance.issued")).toBe(true);
    // Penerima kedua → nomor berikutnya; daftar menampilkan bukti aktif pada penerimanya
    const r2 = await issueReceipt(fx.superAdmin, { assigneeId: l.assignees[1]!.id, method: "TRANSFER" });
    expect(r2.number).toBe("002/BPUH/XI/2026");
    const listed = (await listAssignments(fx.hr)).items[0]!;
    expect(listed.assignees.map((a) => a.receipt?.number)).toEqual(["001/BPUH/XI/2026", "002/BPUH/XI/2026"]);
    expect(await pendingAllowanceCount()).toBe(0);
  });

  it("aturan penerbitan: satu bukti aktif per penerima (juga saat serentak); tanggal tidak boleh sebelum surat / di masa depan; HR tidak untuk diri sendiri; karyawan ditolak", async () => {
    const l = await createAssignment(fx.hr, trip());
    const id = l.assignees[0]!.id;
    expect((await fail(issueReceipt(fx.hr, { assigneeId: id, method: "CASH", paidDate: "2026-10-31" })))?.fieldErrors?.paidDate).toBeTruthy();
    expect((await fail(issueReceipt(fx.hr, { assigneeId: id, method: "CASH", paidDate: "2026-11-05" })))?.fieldErrors?.paidDate).toBeTruthy();
    expect((await fail(issueReceipt(fx.hr, { assigneeId: id })))?.code).toBe("VALIDATION"); // cara bayar wajib
    expect((await fail(issueReceipt(fx.emp1, { assigneeId: id, method: "CASH" })))?.code).toBe("FORBIDDEN");
    const hrAsAyu = { ...fx.hr, employeeId: fx.empIds[A] };
    expect((await fail(issueReceipt(hrAsAyu, { assigneeId: id, method: "CASH" })))?.message).toMatch(/diri Anda sendiri/);
    const races = await Promise.allSettled(Array.from({ length: 4 }, () => issueReceipt(fx.hr, { assigneeId: id, method: "CASH" })));
    expect(races.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.dailyAllowanceReceipt.count({ where: { assigneeId: id, status: "ACTIVE" } })).toBe(1);
    expect((await fail(issueReceipt(fx.hr, { assigneeId: id, method: "CASH" })))?.code).toBe("CONFLICT");
  });

  it("batal & terbit ulang: hanya Super Admin yang membatalkan bukti; surat tugas tak bisa dibatalkan selama ada bukti aktif; bukti dikunci database", async () => {
    const l = await createAssignment(fx.hr, trip());
    const id = l.assignees[0]!.id;
    const r = await issueReceipt(fx.hr, { assigneeId: id, method: "CASH" });
    expect((await fail(cancelAssignment(fx.hr, l.id, { reason: "Dibatalkan klien" })))?.message).toMatch(/Bukti Penerimaan Uang Harian yang aktif/);
    expect((await fail(voidReceipt(fx.hr, r.id, { reason: "Salah nominal" })))?.code).toBe("FORBIDDEN");
    await expect(prisma.$executeRawUnsafe(`UPDATE daily_allowance_receipts SET total = 1, "dailyRate" = 1, days = 1 WHERE id = '${r.id}'`)).rejects.toThrow(/tidak dapat diubah/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM daily_allowance_receipts WHERE id = '${r.id}'`)).rejects.toThrow(/tidak boleh dihapus/);
    expect((await fail(voidReceipt(fx.superAdmin, r.id, { reason: "" })))?.code).toBe("VALIDATION");
    await voidReceipt(fx.superAdmin, r.id, { reason: "Salah cara pembayaran" });
    expect((await fail(voidReceipt(fx.superAdmin, r.id, { reason: "Dua kali" })))?.code).toBe("CONFLICT");
    expect((await getReceiptForPdf(fx.hr, r.id)).status).toBe("VOIDED"); // pengelola masih bisa melihat (berwatermark)
    expect((await fail(getReceiptForPdf(fx.emp1, r.id)))?.code).toBe("NOT_FOUND"); // karyawan tidak melihat bukti yang dibatalkan
    const again = await issueReceipt(fx.hr, { assigneeId: id, method: "TRANSFER" });
    expect(again.number).toBe("002/BPUH/XI/2026");
    await voidReceipt(fx.superAdmin, again.id, { reason: "Dibatalkan juga" });
    await cancelAssignment(fx.hr, l.id, { reason: "Dibatalkan klien" });
    expect((await fail(issueReceipt(fx.hr, { assigneeId: l.assignees[1]!.id, method: "CASH" })))?.message).toMatch(/sudah dibatalkan/);
  });

  it("karyawan hanya membuka bukti miliknya yang aktif", async () => {
    const l = await createAssignment(fx.hr, trip());
    const r = await issueReceipt(fx.hr, { assigneeId: l.assignees[0]!.id, method: "CASH" });
    expect((await getReceiptForPdf(fx.emp1, r.id)).snapshot.employee.name).toBe("Ayu Lestari");
    expect((await fail(getReceiptForPdf(fx.emp2, r.id)))?.code).toBe("NOT_FOUND");
    expect((await listMyAssignments(fx.emp1))[0]!.receipt?.number).toBe(r.number);
  });

  it("PDF: judul, rujukan surat tugas, perhitungan, terbilang, kotak penerima + blok tanda tangan resmi yang SAMA dengan slip gaji; satu halaman", async () => {
    await uploadSignature();
    const l = await createAssignment(fx.hr, trip());
    const r = await issueReceipt(fx.hr, { assigneeId: l.assignees[0]!.id, method: "TRANSFER" });
    const rec = await getReceiptForPdf(fx.hr, r.id);
    const info = pdfInfo(await renderReceiptPdf(rec.snapshot, false));
    const noSig = pdfInfo(await renderReceiptPdf({ ...rec.snapshot, signer: { ...rec.snapshot.signer!, signatureFileId: null } }, false));
    expect(info.pages).toBe(1);
    expect(info.images).toBe(noSig.images + 1);
    expect(info.text.replace(/\s+/g, "")).toContain("BUKTIPENERIMAANUANGHARIAN");
    for (const t of ["001/BPUH/XI/2026", "Rp 1.500.000", "Satu Juta Lima Ratus Ribu Rupiah", "Ayu Lestari", "Surat Tugas No. 001/ST/XI/2026", "5 hari x Rp 300.000 = Rp 1.500.000", "Transfer bank", "1 November 2026", "Penerima,", "Fawwaz Chaidir, S.Psi.", "Chief Executive Officer", "Yogyakarta, 1 November 2026", "bukan bagian dari slip gaji"]) expect(info.text).toContain(t);
    expect(info.text).not.toContain("Meterai"); // 1,5 juta < Rp 5 juta
    // Sumber blok tanda tangan sama persis dengan slip gaji: pengaturan penanda tangan yang sama
    const big = await createAssignment(fx.hr, trip({ assignees: [{ employeeId: fx.empIds[C], dailyRate: 1_200_000 }] }));
    const r2 = await issueReceipt(fx.hr, { assigneeId: big.assignees[0]!.id, method: "CASH" });
    const t2 = pdfInfo(await renderReceiptPdf((await getReceiptForPdf(fx.hr, r2.id)).snapshot, false)).text;
    expect(t2).toContain("Rp 6.000.000");
    expect(t2).toContain("Meterai");
    expect(hasWatermark(await renderReceiptPdf(rec.snapshot, true), await renderReceiptPdf(rec.snapshot, false))).toBe(true);
  });

  it("tanpa penanda tangan terkonfigurasi: PDF tetap valid dengan ruang tanda tangan kosong", async () => {
    await prisma.companySettings.update({ where: { id: 1 }, data: { slipSignerName: null, slipSignerTitle: null, slipSignerPlace: null } });
    const l = await createAssignment(fx.hr, trip());
    const r = await issueReceipt(fx.hr, { assigneeId: l.assignees[0]!.id, method: "CASH" });
    const t = pdfInfo(await renderReceiptPdf((await getReceiptForPdf(fx.hr, r.id)).snapshot, false));
    expect(t.pages).toBe(1);
    expect(t.text).toContain("( ............................ )");
    expect(pdfInfo(await renderAssignmentPdf((await getAssignmentForPdf(fx.hr, l.id)).snapshot, false)).pages).toBe(1);
  });
});

describe("terpisah dari penggajian & slip gaji", () => {
  it("menerbitkan uang harian tidak mengubah gaji, komponen, maupun isi slip; PDF slip tidak memuatnya", async () => {
    await updateAttendancePolicy(fx.superAdmin, { lateMinutesAfterTolerance: false, locationEnabled: false, locationName: null, locationLat: null, locationLng: null, locationRadiusMeters: 100, locationMaxAccuracyMeters: 150, requestBackdateDays: 365, annualLeaveQuota: 12, allowNegativeLeaveBalance: false });
    await updatePayrollRules(fx.superAdmin, { lateMode: "NONE", lateAmount: 0, absenceMode: "NONE", absenceAmount: 0, absenceDivisor: null, izinDeductsPay: true, sakitDeductsPay: false, cutiDeductsPay: false, overtimeMode: "MANUAL", overtimeRatePerHour: 0, overtimeMinMinutes: 60, overtimeMaxMinutesPerDay: 240 });
    await confirmPayrollRules(fx.superAdmin);
    await addComponent(fx.empIds[A], fx.hr.userId, { category: "BASE_SALARY", name: "Gaji pokok", amount: 5_000_000 });
    await prisma.employee.update({ where: { id: fx.empIds[A] }, data: { joinDate: isoToDate("2026-01-01") } });
    await addAttendance(fx.empIds[A], "2026-10-05", "08:00", "16:00");
    const period = { label: "Gaji Oktober 2026", periodStart: "2026-10-01", periodEnd: "2026-10-31" };

    const first = await createRun(fx.hr, period);
    const net0 = (await getRun(fx.hr, first.id)).items[0]!.netPay;
    const comps0 = await prisma.salaryComponent.count();

    const l = await createAssignment(fx.hr, trip({ startDate: "2026-10-12", endDate: "2026-10-16", assignees: [{ employeeId: fx.empIds[A], dailyRate: 400_000 }] }));
    await issueReceipt(fx.hr, { assigneeId: l.assignees[0]!.id, method: "CASH" });
    await calculateRun(fx.hr, first.id);
    expect((await getRun(fx.hr, first.id)).items[0]!.netPay).toBe(net0);
    expect(await prisma.salaryComponent.count()).toBe(comps0);
    expect(await prisma.payrollItemLine.count({ where: { name: { contains: "harian", mode: "insensitive" } } })).toBe(0);

    await submitRun(fx.hr, first.id); await approveRun(fx.superAdmin, first.id); await issueRun(fx.hr, first.id);
    const slip = (await getRunPayslips(fx.hr, first.id))[0]!;
    expect(slip.snapshot.netPay).toBe(net0);
    const text = pdfInfo(await renderPayslipsPdf([{ snapshot: slip.snapshot, voided: false }])).text;
    expect(text).not.toMatch(/uang harian|BPUH|surat tugas/i);
  });
});
