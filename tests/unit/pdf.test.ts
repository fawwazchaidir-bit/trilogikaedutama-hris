import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { PayslipSnapshot } from "@/lib/payslip";

// render.tsx memanggil env() → isi variabel minimal sebelum modul dimuat.
process.env.DATABASE_URL ||= "postgresql://x:x@localhost:5432/x";
process.env.DATA_ENCRYPTION_KEY ||= "dGVzdC1vbmx5LWtleS0zMi1ieXRlcy1sb25nLSEhISE=";

const snap: PayslipSnapshot = {
  version: 1, number: "SG-202601-R01-001",
  company: { name: "TRILOGIKA EDUTAMA", legalName: null, tagline: "Light & Insight", address: "Jl. Contoh No. 1, Sleman", phone: "0274-000000", email: "hr@contoh.test", website: null, logoFileId: null },
  employee: { id: "e1", employeeNo: "TE-001", name: "Ayu Lestari", position: "Staf Operasional", division: "Operasional", employmentStatus: "PERMANENT", bankName: "Bank Uji", bankAccountMasked: "•••• •••• 0123" },
  period: { start: "2026-01-01", end: "2026-01-31", label: "Gaji Januari 2026" }, attendanceBasis: { start: "2026-01-01", end: "2026-01-31" }, issueDate: "2026-02-01",
  earnings: [
    { name: "Gaji pokok", category: "BASE_SALARY", amount: 5_000_000, formula: "Nominal tetap per periode", note: null, manual: false },
    { name: "Uang makan", category: "MEAL_ALLOWANCE", amount: 340_000, formula: "17 hari hadir × Rp 20.000", note: null, manual: false },
  ],
  deductions: [{ name: "Koreksi kasbon", category: "OTHER_DEDUCTION", amount: 100_000, formula: "Penyesuaian manual", note: "Sesuai surat pernyataan", manual: true }],
  totalEarnings: 5_340_000, totalDeductions: 100_000, netPay: 5_240_000,
  attendance: { scheduledDays: 21, presentDays: 17, onTimeDays: 16, lateDays: 1, lateCount: 1, lateMinutes: 20, izinDays: 1, sakitDays: 2, cutiDays: 0, absentDays: 1, pendingDays: 0, incompleteCount: 1, workedMinutes: 7655, offDayAttendance: 0, offDays: 10 },
  overtimePaidMinutes: 150,
  signer: { name: "Fawwaz Chaidir, S.Psi.", title: "Chief Executive Officer", place: "Yogyakarta", signatureFileId: null },
  note: "Terima kasih atas kontribusinya.", footerNote: "Slip ini rahasia.", revisionNote: null,
};

let render: typeof import("@/server/pdf/render").renderPayslipsPdf;
beforeAll(async () => { ({ renderPayslipsPdf: render } = await import("@/server/pdf/render")); });

const dir = mkdtempSync(join(tmpdir(), "pdf-"));
function text(pdf: Buffer, name: string, args: string[] = []) {
  const f = join(dir, name);
  writeFileSync(f, pdf);
  return execFileSync("pdftotext", [...args, f, "-"], { encoding: "utf8" });
}

describe("slip gaji PDF (dari snapshot)", () => {
  it("menghasilkan PDF valid berisi seluruh bagian slip", async () => {
    const pdf = await render([{ snapshot: snap, voided: false }]);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    const t = text(pdf, "a.pdf", ["-layout"]);
    for (const s of ["SLIP GAJI", "TRILOGIKA EDUTAMA", "Ayu Lestari", "TE-001", "Operasional", "PENDAPATAN", "POTONGAN", "Total Pendapatan", "Total Potongan",
      "Rp 5.000.000", "Rp 340.000", "17 hari hadir × Rp 20.000", "Rp 5.240.000", "GAJI BERSIH DITERIMA", "RINGKASAN KEHADIRAN", "CATATAN", "Terima kasih atas kontribusinya.", "1 Februari 2026", "0123", "Lembur dibayar", "2 j 30 m",
      "Yogyakarta, 1 Februari 2026", "Chief Executive Officer", "Fawwaz Chaidir, S.Psi."]) {
      expect(t, s).toContain(s);
    }
    expect(t).toContain("Terbilang: Lima Juta Dua Ratus Empat Puluh Ribu Rupiah");
    expect(t).not.toContain("DIBATALKAN");
  });

  it("slip dibatalkan memuat watermark DIBATALKAN; slip normal tidak", async () => {
    const voided = await render([{ snapshot: snap, voided: true }]);
    const normal = await render([{ snapshot: snap, voided: false }]);
    // Watermark berotasi: pdftotext memecahnya per huruf, jadi periksa lewat bbox/raw dan bandingkan dengan slip normal.
    const raw = text(voided, "v.pdf", ["-raw"]).replace(/\s+/g, "");
    const rawNormal = text(normal, "n.pdf", ["-raw"]).replace(/\s+/g, "");
    const letters = (s: string) => ["D", "I", "B", "A", "T", "L", "K", "N"].map((c) => s.split(c).length - 1);
    expect(letters(raw).some((n, i) => n > letters(rawNormal)[i]!)).toBe(true);
  });

  it("banyak slip → satu halaman per slip", async () => {
    const pdf = await render([{ snapshot: snap, voided: false }, { snapshot: { ...snap, number: "SG-2" }, voided: false }, { snapshot: { ...snap, number: "SG-3" }, voided: false }]);
    const f = join(dir, "m.pdf");
    writeFileSync(f, pdf);
    expect(Number(execFileSync("pdfinfo", [f], { encoding: "utf8" }).match(/Pages:\s+(\d+)/)?.[1])).toBe(3);
  });

  it("teks dengan karakter di luar WinAnsi tidak merusak PDF", async () => {
    const pdf = await render([{ snapshot: { ...snap, employee: { ...snap.employee, name: "Rina ✓ Wulandari 😀" }, note: "Catatan → penting ≥ 5" }, voided: false }]);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(text(pdf, "u.pdf")).toContain("Rina");
  });
});
