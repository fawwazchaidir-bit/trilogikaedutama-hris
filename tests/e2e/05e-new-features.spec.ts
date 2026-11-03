/**
 * Lima permintaan pimpinan (diuji di peramban sungguhan terhadap build produksi):
 *  1. nama aplikasi "Trilogika Internal Portal"; 2. tampil/sembunyikan password di semua isian;
 *  3. Surat Tugas + Bukti Penerimaan Uang Harian (terpisah dari slip gaji); 4. Dokumen kontrak PDF + keputusan lanjut/tidak + pengingat;
 *  5. kebijakan cuti per karyawan.
 * Berjalan SEBELUM 06-stage2 (yang mengaktifkan 2FA pada akun HR & Super Admin dan sengaja diletakkan paling akhir) dan SETELAH 03b (penanda tangan
 * slip diatur Super Admin; dipakai oleh PDF surat tugas & bukti penerimaan).
 */
import "dotenv/config";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { USERS, alertWith, isoDatePlus, login, logout, workdayPlus } from "./helpers";

test.describe.configure({ mode: "serial" });

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
const dir = mkdtempSync(join(tmpdir(), "new-e2e-"));
let n = 0;
function pdfText(buf: Buffer): { text: string; pages: number } {
  const f = join(dir, `f${n++}.pdf`);
  writeFileSync(f, buf);
  return {
    text: execFileSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" }),
    pages: Number(/Pages:\s+(\d+)/.exec(execFileSync("pdfinfo", [f], { encoding: "utf8" }))![1]),
  };
}
const flat = (t: string) => t.replace(/\s+/g, "");
/** href dari tautan "PDF" pertama di dalam lingkup. */
async function pdfHref(scope: import("@playwright/test").Locator, name: string | RegExp): Promise<string> {
  const href = await scope.getByRole("link", { name }).first().getAttribute("href");
  expect(href).toBeTruthy();
  return href!;
}

// ───────────────────────── 1 & 2: nama aplikasi + tampil/sembunyikan password ─────────────────────────

test.describe("nama aplikasi & tampil/sembunyikan password", () => {
  test("halaman masuk memakai nama baru dan password dapat ditampilkan/disembunyikan", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText("Trilogika Internal Portal")).toBeVisible();
    await expect(page.getByText("Mini HRIS")).toHaveCount(0);
    const pw = page.getByLabel("Password");
    await pw.fill("rahasia-uji-123");
    await expect(pw).toHaveAttribute("type", "password");
    await page.getByRole("button", { name: "Tampilkan sandi" }).click();
    await expect(pw).toHaveAttribute("type", "text");
    await expect(pw).toHaveValue("rahasia-uji-123");
    await page.getByRole("button", { name: "Sembunyikan sandi" }).click();
    await expect(pw).toHaveAttribute("type", "password");
    // Tombol mata tidak mengirim formulir (tetap di halaman masuk, tanpa galat)
    await expect(page).toHaveURL(/\/login/);
    await expect(alertWith(page)).toHaveCount(0);
  });

  test("halaman atur ulang password (tautan token sah) memiliki tombol mata pada kedua isian", async ({ page }) => {
    // Token sungguhan dibuat langsung di database uji (hanya hash-nya yang tersimpan, seperti alur lupa password); tidak dipakai/disubmit.
    const token = `tok-e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
    try {
      const u = await prisma.user.findUniqueOrThrow({ where: { email: USERS.citra } });
      await prisma.passwordResetToken.create({ data: { userId: u.id, tokenHash: createHash("sha256").update(token).digest("hex"), expiresAt: new Date(Date.now() + 30 * 60_000) } });
    } finally { await prisma.$disconnect(); }
    await page.goto(`/reset-password?token=${token}`);
    const buttons = page.getByRole("button", { name: "Tampilkan sandi" });
    await expect(buttons).toHaveCount(2);
    await page.getByLabel(/^Password baru/).fill("Sandi-Baru-2026!!");
    await buttons.first().click();
    await expect(page.getByLabel(/^Password baru/)).toHaveAttribute("type", "text");
    await expect(page.getByLabel(/^Ulangi password baru/)).toHaveAttribute("type", "password");
  });

  test("setelah masuk: sidebar memakai nama baru; ganti password & akun pengguna memiliki tombol mata", async ({ page }) => {
    await login(page, USERS.hr);
    await expect(page.getByRole("complementary").getByText("Trilogika Internal Portal")).toBeVisible();
    await page.goto("/change-password");
    await expect(page.getByRole("button", { name: "Tampilkan sandi" })).toHaveCount(3);
    await page.getByLabel("Password saat ini").fill("abc");
    await page.getByRole("button", { name: "Tampilkan sandi" }).first().click();
    await expect(page.getByLabel("Password saat ini")).toHaveAttribute("type", "text");
    await page.goto("/pengguna");
    await page.getByRole("button", { name: /Tambah akun/ }).click();
    const dlg = page.getByRole("dialog");
    const temp = dlg.getByLabel("Password sementara");
    await temp.fill("Sementara-12345!");
    await expect(temp).toHaveAttribute("type", "password"); // tidak lagi terbaca polos di layar
    await dlg.getByRole("button", { name: "Tampilkan sandi" }).click();
    await expect(temp).toHaveAttribute("type", "text");
  });
});

// ───────────────────────── 3: Surat Tugas + Bukti Penerimaan Uang Harian ─────────────────────────

test.describe("Surat Tugas & Bukti Penerimaan Uang Harian", () => {
  let letterNo = "";
  let receiptPdf = "";

  test("Karyawan tidak melihat menu/halaman admin; HR menerbitkan surat tugas untuk Ayu", async ({ page }) => {
    await login(page, USERS.ayu);
    await expect(page.getByRole("link", { name: "Surat Tugas Saya" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Surat Tugas( \d+ menunggu)?$/ })).toHaveCount(0); // menu admin; "Surat Tugas Saya" tetap ada
    expect((await page.goto("/surat-tugas"))?.status()).toBe(404);
    await page.goto("/dashboard"); // halaman 404 tidak memuat rangka aplikasi (tombol Keluar)
    await logout(page);

    await login(page, USERS.hr);
    await page.getByRole("link", { name: /^Surat Tugas( \d+ menunggu)?$/ }).click();
    await page.getByRole("button", { name: /Terbitkan Surat Tugas/ }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Maksud / tujuan penugasan").fill("Pendampingan pelatihan Training of Trainers");
    await dlg.getByLabel("Lokasi tujuan").fill("Bandung, Jawa Barat");
    await dlg.getByLabel("Tanggal selesai").fill(isoDatePlus(2));
    await dlg.getByLabel("Karyawan 1").selectOption({ label: "Ayu Lestari (DEMO-001)" });
    await dlg.getByLabel("Uang harian / hari").fill("300000");
    await expect(dlg.getByText("Rp 900.000")).toBeVisible(); // 3 hari × Rp 300.000
    await dlg.getByRole("button", { name: "Terbitkan", exact: true }).click();
    await expect(page.getByText(/Surat Tugas \d{3}\/ST\/[IVX]+\/\d{4} diterbitkan/)).toBeVisible();
    const card = page.locator("section", { hasText: "Pendampingan pelatihan Training of Trainers" }).first();
    letterNo = (await card.locator("span.font-mono").first().innerText()).trim();
    expect(letterNo).toMatch(/^\d{3}\/ST\/[IVX]+\/\d{4}$/);
    await expect(card.getByText("Rp 900.000").first()).toBeVisible();
    await expect(card.getByText("Belum diterbitkan").first()).toHaveCount(0);

    // PDF Surat Tugas
    const res = await page.request.get(await pdfHref(card, /Surat Tugas \(PDF\)/));
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    const pdf = pdfText(await res.body());
    expect(pdf.pages).toBe(1);
    for (const t of ["Ayu Lestari", "Bandung, Jawa Barat", "Rp 900.000", "bukan bagian dari slip gaji"]) expect(pdf.text, t).toContain(t);
    expect(flat(pdf.text)).toContain("SURATTUGAS");
  });

  test("HR menerbitkan Bukti Penerimaan Uang Harian; PDF memuat blok tanda tangan yang sama dengan slip; HR tidak dapat membatalkannya", async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto("/surat-tugas");
    const card = page.locator("section", { hasText: letterNo });
    await card.getByRole("button", { name: /Terbitkan bukti penerimaan/ }).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg).toContainText("tidak masuk slip gaji");
    await dlg.getByLabel("Cara pembayaran").selectOption("TRANSFER");
    await dlg.getByRole("button", { name: "Terbitkan", exact: true }).click();
    await expect(page.getByText(/Bukti Penerimaan \d{3}\/BPUH\/[IVX]+\/\d{4} diterbitkan/)).toBeVisible();
    const row = card.locator("tbody tr", { hasText: "Ayu Lestari" });
    await expect(row.getByText(/\d{3}\/BPUH\//)).toBeVisible();
    await expect(row.getByRole("button", { name: "Batalkan" })).toHaveCount(0); // hanya Super Admin
    await expect(row.getByRole("button", { name: /Terbitkan bukti penerimaan/ })).toHaveCount(0);
    receiptPdf = await pdfHref(row, "PDF");

    const res = await page.request.get(receiptPdf);
    expect(res.status()).toBe(200);
    const pdf = pdfText(await res.body());
    expect(pdf.pages).toBe(1);
    expect(flat(pdf.text)).toContain("BUKTIPENERIMAANUANGHARIAN");
    for (const t of ["Ayu Lestari", "3 hari x Rp 300.000 = Rp 900.000", "Sembilan Ratus Ribu Rupiah", `Surat Tugas No. ${letterNo}`, "Transfer bank", "Penerima,", "Yogyakarta,", "Chief Executive Officer", "Fawwaz Chaidir, S.Psi."]) {
      expect(pdf.text, t).toContain(t);
    }
    // Tidak dapat diterbitkan dua kali
    const again = await page.request.post("/api/allowance-receipts", { data: { assigneeId: "00000000-0000-4000-8000-000000000000", method: "CASH" }, headers: { origin: new URL(page.url()).origin } });
    expect(again.status()).toBe(404);
  });

  test("Karyawan melihat surat tugas & bukti miliknya, dapat mengunduh PDF; karyawan lain tidak dapat mengakses bukti itu; slip gaji tidak berubah", async ({ page, browser }) => {
    await login(page, USERS.ayu);
    await page.getByRole("link", { name: "Surat Tugas Saya" }).click();
    const card = page.locator("section", { hasText: letterNo });
    await expect(card).toContainText("Uang harian Anda: 3 hari × Rp 300.000 = Rp 900.000");
    await expect(card.getByText(/Diterima .* Transfer bank/)).toBeVisible();
    const ok = await page.request.get(receiptPdf);
    expect(ok.status()).toBe(200);
    expect((await page.request.get(await pdfHref(card, /Surat Tugas \(PDF\)/))).status()).toBe(200);
    // Notifikasi
    const notif = JSON.stringify((await (await page.request.get("/api/notifications")).json()));
    expect(notif).toContain("Surat Tugas baru");
    expect(notif).toContain("Bukti Penerimaan Uang Harian tersedia");

    const other = await browser.newContext({ locale: "id-ID", timezoneId: "Asia/Jakarta" });
    const bp = await other.newPage();
    await login(bp, USERS.budi);
    expect((await bp.request.get(receiptPdf)).status()).toBe(404);
    await bp.goto("/surat-tugas-saya");
    await expect(bp.getByText(letterNo)).toHaveCount(0);
    await other.close();
  });

  test("Super Admin dapat membatalkan bukti (beralasan); surat tugas tidak bisa dibatalkan selama bukti aktif; bukti batal tidak terlihat karyawan", async ({ page }) => {
    await login(page, USERS.pimpinan);
    await page.goto("/surat-tugas");
    const card = page.locator("section", { hasText: letterNo });
    await card.getByRole("button", { name: "Batalkan", exact: true }).first().click(); // batalkan surat tugas → ditolak karena bukti aktif
    let dlg = page.getByRole("dialog");
    await dlg.getByLabel("Alasan pembatalan (wajib)").fill("Klien membatalkan jadwal");
    await dlg.getByRole("button", { name: "Batalkan", exact: true }).click();
    await expect(alertWith(dlg, /Bukti Penerimaan Uang Harian yang aktif/).first()).toBeVisible();
    await dlg.getByRole("button", { name: "Batal", exact: true }).click();

    const row = card.locator("tbody tr", { hasText: "Ayu Lestari" });
    await row.getByRole("button", { name: "Batalkan" }).click();
    dlg = page.getByRole("dialog");
    await dlg.getByLabel("Alasan pembatalan (wajib)").fill("Salah cara pembayaran");
    await dlg.getByRole("button", { name: "Batalkan", exact: true }).click();
    await expect(page.getByText("Bukti penerimaan dibatalkan.")).toBeVisible();
    await expect(row.getByRole("button", { name: /Terbitkan bukti penerimaan/ })).toBeVisible(); // dapat diterbitkan ulang
    expect((await page.request.get(receiptPdf)).status()).toBe(200); // pengelola tetap dapat membuka (berwatermark)
    await logout(page);

    await login(page, USERS.ayu);
    expect((await page.request.get(receiptPdf)).status()).toBe(404);
  });
});

// ───────────────────────── 4: Dokumen kontrak + keputusan + pengingat ─────────────────────────

test.describe("Dokumen: kontrak kerja PDF, penampil, keputusan lanjut/tidak, pengingat", () => {
  const TITLE = "PKWT II — Koordinator Pelatihan (uji E2E)";

  test("HR mengunggah kontrak PDF Budi (berakhir dalam 60 hari); berkas bukan PDF ditolak; PDF dapat dilihat langsung di aplikasi", async ({ page }) => {
    await login(page, USERS.hr);
    await page.getByRole("link", { name: /^Dokumen( \d+ menunggu)?$/ }).click();
    await expect(page).toHaveURL(/\/dokumen$/);
    await page.getByRole("button", { name: /Unggah dokumen/ }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel(/^Karyawan/).selectOption({ label: "Budi Santoso (DEMO-002)" });
    await dlg.getByLabel("Judul dokumen").fill(TITLE);
    await dlg.getByLabel("Nomor dokumen (opsional)").fill("KTR/007/2026");
    await dlg.getByLabel("Tanggal mulai kontrak").fill(isoDatePlus(-305));
    await dlg.getByLabel("Tanggal berakhir").fill(isoDatePlus(60));

    // Berkas yang bukan PDF ditolak server (magic bytes), walau berekstensi .pdf
    await dlg.locator("#doc-file").setInputFiles({ name: "palsu.pdf", mimeType: "application/pdf", buffer: Buffer.from("ini bukan pdf sungguhan") });
    await dlg.getByRole("button", { name: "Simpan" }).click();
    await expect(alertWith(dlg, /Jenis file tidak diizinkan/).first()).toBeVisible();

    await dlg.locator("#doc-file").setInputFiles({ name: "kontrak-budi.pdf", mimeType: "application/pdf", buffer: PDF });
    await dlg.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Dokumen tersimpan.")).toBeVisible();

    const row = page.locator("tbody tr", { hasText: TITLE });
    await expect(row).toContainText("Budi Santoso");
    await expect(row).toContainText("Segera berakhir");
    await expect(row).toContainText("Perlu keputusan pimpinan");
    await expect(row).toContainText("kontrak-budi.pdf");

    // Penampil PDF dalam aplikasi
    await row.getByRole("button", { name: /Lihat PDF/ }).click();
    const viewer = page.getByRole("dialog");
    const frame = viewer.locator("iframe");
    await expect(frame).toBeVisible();
    const src = (await frame.getAttribute("src"))!;
    expect(src).toMatch(/^\/api\/documents\/[0-9a-f-]{36}\/file#view=FitH$/);
    const res = await page.request.get(src.split("#")[0]!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect(res.headers()["content-disposition"]).toMatch(/^inline;/);
    expect(res.headers()["x-content-type-options"]).toBe("nosniff");
    expect(res.headers()["content-security-policy"] ?? "").not.toMatch(/sandbox/); // CSP sandbox membuat penampil PDF peramban gagal
    expect(res.headers()["x-frame-options"]).toBe("SAMEORIGIN"); // hanya halaman aplikasi ini yang dapat menyematkan
    expect((await res.body()).subarray(0, 5).toString()).toBe("%PDF-");
    await expect(viewer.getByRole("link", { name: /Buka di tab baru/ })).toHaveAttribute("target", "_blank");
    const dl = await page.request.get(`${src.split("#")[0]}?download=1`);
    expect(dl.headers()["content-disposition"]).toMatch(/^attachment;/);
    await viewer.getByRole("button", { name: "Tutup" }).last().click();
  });

  test("pimpinan menerima pengingat kontrak berakhir, lencana menu, dan memutuskan LANJUT; HR diberi tahu; karyawan tidak", async ({ page, browser }) => {
    await login(page, USERS.pimpinan);
    const notifs = JSON.stringify(await (await page.request.get("/api/notifications")).json());
    expect(notifs).toContain("Kontrak Budi Santoso berakhir");
    expect(notifs).toContain("lanjut atau tidak");
    await expect(page.getByRole("navigation", { name: "Menu utama" }).getByRole("link", { name: /^Dokumen( \d+ menunggu)?$/ })).toContainText("1"); // lencana perlu keputusan

    await page.goto("/dokumen?view=perlu-keputusan");
    const row = page.locator("tbody tr", { hasText: TITLE });
    await row.getByRole("button", { name: "Putuskan lanjut/tidak" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Catatan (opsional)").fill("Kinerja baik");
    await dlg.getByRole("button", { name: "Simpan keputusan" }).click();
    await expect(page.getByText("Keputusan dicatat: kontrak dilanjutkan.")).toBeVisible();
    await page.goto("/dokumen");
    await expect(page.locator("tbody tr", { hasText: TITLE })).toContainText("Dilanjutkan");
    await expect(page.locator("tbody tr", { hasText: TITLE })).toContainText("PDF baru belum diunggah");

    // HR diberi tahu & tidak dapat memutuskan; karyawan tidak diberi tahu
    const hr = await browser.newContext({ locale: "id-ID", timezoneId: "Asia/Jakarta" });
    const hp = await hr.newPage();
    await login(hp, USERS.hr);
    expect(JSON.stringify(await (await hp.request.get("/api/notifications")).json())).toContain("akan dilanjutkan");
    await hp.goto("/dokumen");
    await expect(hp.locator("tbody tr", { hasText: TITLE }).getByRole("button", { name: /Putuskan|Ubah keputusan/ })).toHaveCount(0);
    await hr.close();
    const emp = await browser.newContext({ locale: "id-ID", timezoneId: "Asia/Jakarta" });
    const ep = await emp.newPage();
    await login(ep, USERS.budi);
    expect(JSON.stringify(await (await ep.request.get("/api/notifications")).json())).not.toContain("akan dilanjutkan");
    await emp.close();
  });

  test("HR mengunggah kontrak perpanjangan → kontrak lama 'Sudah diperpanjang', lencana hilang", async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto("/dokumen?view=perlu-perpanjangan");
    const row = page.locator("tbody tr", { hasText: TITLE });
    await row.getByRole("button", { name: /Unggah perpanjangan/ }).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByLabel("Judul dokumen")).toHaveValue(`Perpanjangan: ${TITLE}`);
    await dlg.getByLabel("Tanggal berakhir").fill(isoDatePlus(60 + 365));
    await dlg.locator("#doc-file").setInputFiles({ name: "kontrak-budi-2.pdf", mimeType: "application/pdf", buffer: PDF });
    await dlg.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Dokumen tersimpan.")).toBeVisible();
    await page.goto("/dokumen?view=semua");
    await expect(page.locator("tbody tr", { hasText: TITLE }).filter({ hasNotText: `Perpanjangan: ${TITLE}` })).toContainText("Sudah diperpanjang");
    await page.goto("/dokumen?view=perlu-perpanjangan");
    await expect(page.getByText("Tidak ada dokumen")).toBeVisible();
  });

  test("karyawan melihat dokumennya sendiri di 'Dokumen Saya' dan dapat membuka PDF; karyawan lain & anonim tidak", async ({ page, browser }) => {
    await login(page, USERS.budi);
    await page.getByRole("link", { name: "Dokumen Saya" }).click();
    await expect(page.getByText(TITLE).first()).toBeVisible();
    await page.getByRole("button", { name: /Lihat PDF/ }).first().click();
    const src = (await page.getByRole("dialog").locator("iframe").getAttribute("src"))!.split("#")[0]!;
    expect((await page.request.get(src)).status()).toBe(200);
    expect((await page.goto("/dokumen"))?.status()).toBe(404); // menu admin tidak ada untuk karyawan

    const ayu = await browser.newContext({ locale: "id-ID", timezoneId: "Asia/Jakarta" });
    const ap = await ayu.newPage();
    await login(ap, USERS.ayu);
    expect((await ap.request.get(src)).status()).toBe(404);
    await ap.goto("/dokumen-saya");
    await expect(ap.getByText(TITLE)).toHaveCount(0);
    await ayu.close();
    const anon = await browser.newContext();
    expect((await anon.request.get(src)).status()).toBe(401);
    await anon.close();
  });
});

// ───────────────────────── 5: kebijakan cuti per karyawan ─────────────────────────

test.describe("kebijakan cuti per karyawan", () => {
  test("karyawan yang masa kerjanya belum cukup ditandai 'belum berhak'; karyawan >1 tahun berhak", async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto("/karyawan?q=Joko");
    await page.getByRole("link", { name: "Joko Susilo" }).first().click();
    const card = page.locator("section", { hasText: "Kebijakan cuti karyawan" });
    await expect(card).toContainText("Belum berhak cuti tahunan");
    await expect(card).toContainText("Bawaan");
    await page.goto("/karyawan?q=Ayu");
    await page.getByRole("link", { name: "Ayu Lestari" }).first().click();
    await expect(page.locator("section", { hasText: "Kebijakan cuti karyawan" })).toContainText("Sudah berhak cuti tahunan");
  });

  test("HR mengkhususkan kebijakan Citra (berhak mulai tahun depan) → Citra tidak dapat mengajukan cuti; izin tetap boleh; HR mengembalikan ke bawaan", async ({ page, browser }) => {
    await login(page, USERS.hr);
    await page.goto("/karyawan?q=Citra");
    await page.getByRole("link", { name: "Citra Dewi" }).first().click();
    const card = page.locator("section", { hasText: "Kebijakan cuti karyawan" });
    await card.getByRole("button", { name: "Ubah kebijakan" }).click();
    let dlg = page.getByRole("dialog");
    await dlg.getByLabel("Tanggal mulai berhak cuti khusus").check();
    await dlg.getByLabel("Berhak cuti sejak").fill(isoDatePlus(400));
    await dlg.getByRole("button", { name: "Simpan" }).click();
    await expect(alertWith(dlg, /Alasan kebijakan khusus wajib diisi/).first()).toBeVisible();
    await dlg.getByLabel("Alasan kebijakan khusus (wajib)").fill("Evaluasi kinerja — hak cuti ditunda (uji E2E)");
    await dlg.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Kebijakan cuti karyawan diperbarui.")).toBeVisible();
    await expect(card).toContainText("Belum berhak cuti tahunan");
    await expect(card).toContainText("Khusus");

    const emp = await browser.newContext({ locale: "id-ID", timezoneId: "Asia/Jakarta" });
    const cp = await emp.newPage();
    await login(cp, USERS.citra);
    await cp.goto("/pengajuan-saya");
    await expect(cp.getByText("belum berhak cuti tahunan").first()).toBeVisible();
    await cp.getByLabel("Jenis pengajuan").selectOption("CUTI");
    await cp.getByLabel("Tanggal mulai").fill(workdayPlus(1));
    await cp.getByLabel("Tanggal selesai").fill(workdayPlus(1));
    await cp.getByLabel("Alasan").fill("Liburan keluarga");
    await cp.getByRole("button", { name: /Kirim pengajuan/ }).click();
    await expect(alertWith(cp, /belum berhak cuti tahunan/).first()).toBeVisible();
    await emp.close();

    // Kembali ke bawaan lembaga
    await card.getByRole("button", { name: "Ubah kebijakan" }).click();
    dlg = page.getByRole("dialog");
    await dlg.getByLabel("Tanggal mulai berhak cuti khusus").uncheck();
    await dlg.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Kebijakan cuti karyawan diperbarui.")).toBeVisible();
    await expect(card).toContainText("Sudah berhak cuti tahunan");
  });

  test("pengaturan bawaan memuat 'Masa kerja minimum sebelum berhak cuti'", async ({ page }) => {
    await login(page, USERS.pimpinan);
    await page.goto("/pengaturan");
    const form = page.getByRole("form", { name: "Form kebijakan" });
    await expect(form.getByLabel(/Masa kerja minimum sebelum berhak cuti/)).toHaveValue("12");
    await expect(form.getByLabel(/Kuota cuti tahunan bawaan/)).toHaveValue("12");
  });
});

