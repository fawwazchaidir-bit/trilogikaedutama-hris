/**
 * Tata letak slip gaji PDF: jarak tagline & periode, satu halaman, kolom Catatan di atas tanda tangan, tanda tangan di kanan bawah.
 * Diukur dari KOORDINAT teks pada PDF yang dirender sungguhan (pdftotext -bbox), bukan dari gaya di kode.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { beforeAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { renderToBuffer } from "@react-pdf/renderer";
import type { PayslipSnapshot, PayslipLine } from "@/lib/payslip";

process.env.DATABASE_URL ||= "postgresql://x:x@localhost:5432/x";
process.env.DATA_ENCRYPTION_KEY ||= "dGVzdC1vbmx5LWtleS0zMi1ieXRlcy1sb25nLSEhISE=";

const line = (name: string, amount: number, formula: string | null = null): PayslipLine => ({ name, category: "OTHER_EARNING", amount, formula, note: null, manual: false });
const base: PayslipSnapshot = {
  version: 1, number: "SG-202610-R01-001",
  company: { name: "TRILOGIKA EDUTAMA", legalName: null, tagline: "Light & Insight", address: "Jl. Contoh No. 1, Sleman, DIY", phone: "0274-000000", email: "hr@trilogika.test", website: null, logoFileId: null },
  employee: { id: "e1", employeeNo: "TE-001", name: "Ayu Lestari", position: "Staf Operasional", division: "Operasional", employmentStatus: "PERMANENT", bankName: "Bank Uji", bankAccountMasked: "••••••0123" },
  period: { start: "2026-10-01", end: "2026-10-31", label: "Gaji Oktober 2026" }, attendanceBasis: { start: "2026-10-01", end: "2026-10-31" }, issueDate: "2026-11-01",
  earnings: [line("Gaji pokok", 8_000_000, "Nominal tetap per periode"), line("Tunjangan transport", 300_000, "Nominal tetap per periode"), line("Uang makan", 440_000, "22 hari hadir × Rp 20.000"), line("Lembur (disetujui)", 40_000, "2 j, Rp 20.000/jam (min. 60 mnt/hari, maks. 240 mnt/hari)")],
  deductions: [line("BPJS Kesehatan (1%)", 80_000, "1% × upah BPJS Rp 8.000.000"), line("BPJS JHT (2%)", 160_000, "2% × upah BPJS Rp 8.000.000"), line("BPJS JP (1%)", 80_000, "1% × upah BPJS Rp 8.000.000"), line("PPh 21 (TER A)", 126_000, "1,5% × bruto Rp 8.363.200"), line("Potongan keterlambatan", 40_000, "40 menit terlambat × Rp 1.000")],
  totalEarnings: 8_780_000, totalDeductions: 486_000, netPay: 8_294_000,
  attendance: { scheduledDays: 22, presentDays: 20, onTimeDays: 19, lateDays: 1, lateCount: 1, lateMinutes: 40, izinDays: 0.5, sakitDays: 1, cutiDays: 0.5, absentDays: 0, pendingDays: 0, incompleteCount: 0, workedMinutes: 9_600, offDays: 0, offDayAttendance: 0 } as never,
  employerContributions: [{ name: "BPJS Kesehatan (4%)", amount: 320_000 }, { name: "BPJS JHT (3,7%)", amount: 296_000 }, { name: "BPJS JP (2%)", amount: 160_000 }, { name: "BPJS JKK (0,24%)", amount: 19_200 }, { name: "BPJS JKM (0,3%)", amount: 24_000 }],
  overtimePaidMinutes: 120,
  signer: { name: "Fawwaz Chaidir, S.Psi.", title: "Chief Executive Officer", place: "Yogyakarta", signatureFileId: null },
  note: "Terima kasih atas kontribusi Anda bulan ini. Pertahankan ketepatan waktu — keterlambatan berulang akan ditinjau pada evaluasi triwulan.", footerNote: "Slip ini rahasia.", revisionNote: null,
};
const withLines = (e: number, d: number): PayslipSnapshot => ({
  ...base,
  earnings: [...base.earnings, ...Array.from({ length: e }, (_, i) => line(`Tunjangan khusus ${i + 1}`, 100_000, "Nominal tetap per periode"))],
  deductions: [...base.deductions, ...Array.from({ length: d }, (_, i) => line(`Potongan lain ${i + 1}`, 50_000, "Penyesuaian manual"))],
});

let PayslipDocument: typeof import("@/server/pdf/PayslipPdf").PayslipDocument;
let pickTier: typeof import("@/server/pdf/PayslipPdf").pickTier;
beforeAll(async () => { ({ PayslipDocument, pickTier } = await import("@/server/pdf/PayslipPdf")); });

const dir = mkdtempSync(join(tmpdir(), "slip-"));
let n = 0;
async function pdfOf(snapshot: PayslipSnapshot, extra: { signature?: { data: Buffer; mimeType: string } | null; forceTier?: number } = {}) {
  const buf = await renderToBuffer(createElement(PayslipDocument, { items: [{ snapshot, logo: null, signature: extra.signature ?? null, voided: false, printedAt: "01/11/2026 08:00", forceTier: extra.forceTier }] }) as never);
  const file = join(dir, `s${n++}.pdf`);
  writeFileSync(file, buf);
  return file;
}
const pages = (f: string) => Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [f], { encoding: "utf8" }))![1]);
const text = (f: string) => execFileSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" });
interface Box { x0: number; y0: number; x1: number; y1: number; page: number }
/** Kotak kata pertama yang cocok (koordinat pt dari kiri-atas halaman). */
function box(f: string, word: string, nth = 0): Box {
  const xml = execFileSync("pdftotext", ["-bbox", f, "-"], { encoding: "utf8" });
  const found: Box[] = [];
  let page = 0;
  for (const l of xml.split("\n")) {
    if (l.includes("<page ")) page++;
    const m = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*)<\/word>/.exec(l);
    if (m && m[5] === word) found.push({ x0: +m[1]!, y0: +m[2]!, x1: +m[3]!, y1: +m[4]!, page });
  }
  if (!found[nth]) throw new Error(`kata "${word}" tidak ditemukan`);
  return found[nth]!;
}

describe("revisi tata letak slip", () => {
  it("tagline turun dari nama lembaga (kotak teks tidak lagi bertumpuk) dan periode tidak mepet dengan judul SLIP GAJI (jarak ≥ 8 pt)", async () => {
    const f = await pdfOf(base);
    const company = box(f, "TRILOGIKA"), tagline = box(f, "Light"), title = box(f, "SLIP"), period = box(f, "Periode");
    // Sebelum revisi (margin 1 pt) kotak teks tagline bertumpuk dengan nama (jarak ≈ −0,8 pt); sesudah ≈ +2,7 pt.
    expect(tagline.y0 - company.y1, "jarak nama lembaga → tagline").toBeGreaterThanOrEqual(2);
    expect(period.y0 - title.y1, "jarak judul → periode").toBeGreaterThanOrEqual(8);
    expect(tagline.y1 - tagline.y0).toBeLessThan(company.y1 - company.y0); // tagline lebih kecil dari nama
  });

  it("satu halaman untuk slip realistis (dengan BPJS perusahaan, ringkasan kehadiran, catatan, tanda tangan) dan untuk 17 baris komponen", async () => {
    for (const [label, s] of [["tipikal", base], ["tanpa beban perusahaan", { ...base, employerContributions: undefined }], ["13 baris", withLines(2, 2)], ["17 baris", withLines(4, 4)]] as const) {
      const f = await pdfOf(s);
      expect(pages(f), label).toBe(1);
      for (const t of ["Total Pendapatan", "Total Potongan", "GAJI BERSIH DITERIMA", "RINGKASAN KEHADIRAN", "CATATAN", "Fawwaz Chaidir, S.Psi."]) expect(text(f), `${label}: ${t}`).toContain(t);
    }
  });

  it("makin banyak baris → makin padat (tingkat naik), isi tidak ada yang terpotong; slip ekstrem boleh >1 halaman tetapi lengkap", async () => {
    expect(pickTier(base)).toBeLessThanOrEqual(pickTier(withLines(2, 2)));
    expect(pickTier(withLines(2, 2))).toBeLessThanOrEqual(pickTier(withLines(8, 8)));
    const extreme = withLines(14, 14);
    const f = await pdfOf(extreme);
    const t = text(f);
    for (const name of ["Tunjangan khusus 14", "Potongan lain 14", "Fawwaz Chaidir, S.Psi.", "CATATAN"]) expect(t).toContain(name);
  });

  it("kolom CATATAN selalu ada, di BAWAH ringkasan kehadiran dan di ATAS tanda tangan; tanda tangan di KANAN bawah", async () => {
    const f = await pdfOf(base);
    const attendance = box(f, "RINGKASAN"), catatan = box(f, "CATATAN"), noteText = box(f, "Terima"), place = box(f, "Yogyakarta,"), name = box(f, "Fawwaz");
    expect(catatan.y0).toBeGreaterThan(attendance.y1);
    expect(noteText.y0).toBeGreaterThan(catatan.y0);
    expect(place.y0, "tempat/tanggal di bawah catatan").toBeGreaterThan(noteText.y1);
    expect(name.y0, "nama penanda tangan di bawah tempat/tanggal").toBeGreaterThan(place.y1);
    expect(name.x0, "nama di separuh KANAN halaman").toBeGreaterThan(595 / 2);
    expect(name.page).toBe(1);
  });

  it("catatan kosong tetap menampilkan kolom (tanda '-'); catatan 400 karakter muat dalam satu halaman", async () => {
    const empty = await pdfOf({ ...base, note: null });
    expect(text(empty)).toMatch(/CATATAN\s*\n?\s*-/);
    const long = "Motivasi dan peringatan untuk karyawan. ".repeat(10).trim().slice(0, 400);
    const f = await pdfOf({ ...base, note: long });
    expect(pages(f)).toBe(1);
    expect(text(f).replace(/\s+/g, " ")).toContain("Motivasi dan peringatan untuk karyawan.");
  });

  it("tanpa penanda tangan (slip lama): tidak ada blok tanda tangan, tetap satu halaman, kolom Catatan tetap ada", async () => {
    const old: PayslipSnapshot = { ...base, signer: undefined, overtimePaidMinutes: undefined };
    const f = await pdfOf(old);
    const t = text(f);
    expect(pages(f)).toBe(1);
    expect(t).not.toContain("Fawwaz");
    expect(t).not.toContain("Lembur dibayar"); // slip lama tanpa data lembur tidak menampilkan sel itu
    expect(t).toContain("CATATAN");
  });

  it("lembur masuk ringkasan kehadiran: 2 j dibayar; 0 menit tampil '-'; tanpa data tidak tampil", async () => {
    expect(text(await pdfOf(base))).toMatch(/Lembur dibayar[\s\S]*2\s?j/);
    expect(text(await pdfOf({ ...base, overtimePaidMinutes: 0 }))).toMatch(/Lembur dibayar/);
    expect(text(await pdfOf({ ...base, overtimePaidMinutes: null }))).not.toContain("Lembur dibayar");
  });

  it("gambar tanda tangan tertanam di PDF (dan tidak ada gambar bila tidak disediakan)", async () => {
    const png = await sharp({ create: { width: 300, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120"><path d="M10 90 C50 5 80 130 120 50 S190 10 290 70" stroke="#1a2b6b" stroke-width="5" fill="none"/></svg>') }]).png().toBuffer();
    const withSig = await pdfOf(base, { signature: { data: png, mimeType: "image/png" } });
    const without = await pdfOf(base);
    const images = (f: string) => execFileSync("pdfimages", ["-list", f], { encoding: "utf8" }).split("\n").filter((l) => /^\s*\d+\s+\d+\s+image/.test(l)).length;
    expect(images(withSig) - images(without)).toBe(1);
    expect(pages(withSig)).toBe(1);
    // gambar berada di antara tempat/tanggal dan nama (di area tanda tangan)
    const place = box(withSig, "Yogyakarta,"), name = box(withSig, "Fawwaz");
    expect(name.y0 - place.y1).toBeGreaterThan(20);
  });
});
