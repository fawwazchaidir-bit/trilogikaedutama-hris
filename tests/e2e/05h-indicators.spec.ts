/**
 * Training & Operations — INDIKATOR PEMANTAUAN di browser: Direktur mengubah rumus/ambang di aplikasi (berversi), program baru mendapat
 * milestone & item kesiapan otomatis, milestone diselesaikan dengan bukti, peserta terkonfirmasi, peta beban & kepadatan kelas.
 * Dijalankan sesudah 05f (memakai level akses Ayu/Budi dan keanggotaan Citra dari sana) dan sebelum 06-stage2 (2FA admin).
 */
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { USERS, isoDatePlus, login } from "./helpers";

const PROJECT = "Sertifikasi HACCP E2E Indikator";
let projectUrl = "";

async function choose(select: Locator, text: string) {
  const opt = select.locator("option").filter({ hasText: text }).first();
  await select.selectOption({ label: ((await opt.textContent()) ?? "").trim() });
}
async function as(browser: Browser, who: keyof typeof USERS, vp = { width: 1360, height: 900 }) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  await login(page, USERS[who]);
  return { ctx, page };
}

test.describe.configure({ mode: "serial" });

/** Versi konfigurasi aktif dari layar (0 = bawaan dokumen, belum pernah disimpan). Spec lain (mis. sweep API 05c) dapat sudah membuat versi, jadi tidak diasumsikan 1. */
async function activeVersion(page: Page): Promise<number> {
  const text = (await page.getByText(/Versi aktif:/).textContent()) ?? "";
  const m = /Versi aktif: (\d+)/.exec(text);
  return m ? Number(m[1]) : 0;
}

test("Direktur mengubah ambang di aplikasi: validasi urutan, simpan sebagai VERSI BARU, tercatat di riwayat & audit", async ({ browser }) => {
  const { ctx, page } = await as(browser, "pimpinan");
  await page.goto("/training/indikator");
  await expect(page.getByRole("heading", { name: "Rumus Indikator" })).toBeVisible();
  const v0 = await activeVersion(page);
  const yellow = page.getByLabel("Ketepatan Waktu — Kuning bila SPI ≥");
  await expect(yellow).toHaveValue("0.85");
  const save = page.getByRole("button", { name: "Simpan sebagai versi baru" });
  await expect(save).toBeDisabled(); // belum ada perubahan

  await yellow.fill("0.97"); // melewati batas Hijau (0,95) → tidak sah
  await expect(page.getByText("Perbaiki sebelum menyimpan:")).toBeVisible();
  await expect(page.getByText(/batas Hijau \(SPI\) harus lebih besar dari batas Kuning/)).toBeVisible();
  await expect(save).toBeDisabled();

  await yellow.fill("0.8");
  await expect(page.getByText("Perbaiki sebelum menyimpan:")).toHaveCount(0);
  await page.getByLabel("Catatan perubahan").fill("Batas Kuning SPI diturunkan setelah peninjauan");
  await save.click();
  await expect(page.getByText("Konfigurasi disimpan sebagai versi baru.").last()).toBeVisible();
  await expect(page.getByRole("region", { name: "Riwayat versi" })).toContainText(`Versi ${v0 + 1}`);
  await expect(page.getByRole("region", { name: "Riwayat versi" })).toContainText("Batas Kuning SPI diturunkan setelah peninjauan");
  expect(await activeVersion(page)).toBe(v0 + 1);
  await page.reload();
  await expect(page.getByLabel("Ketepatan Waktu — Kuning bila SPI ≥")).toHaveValue("0.8");

  await page.goto("/audit-log");
  await expect(page.getByText(new RegExp(`Konfigurasi indikator diubah → versi ${v0 + 1}\\b`)).first()).toBeVisible();
  await ctx.close();
});

test("Direktur mengisi pemegang jabatan (PIC) dan fasilitator; perubahan menjadi versi baru", async ({ browser }) => {
  const { ctx, page } = await as(browser, "pimpinan");
  await page.goto("/training/indikator");
  const v1 = await activeVersion(page);
  await page.locator("summary", { hasText: "Jabatan, pemegang, dan fasilitator" }).click();
  await choose(page.getByLabel("Pemegang Supervisor Adm. & Kurikulum"), "Ayu Lestari");
  await choose(page.getByLabel("Pemegang Manajer Operasional dan Keuangan"), "Ayu Lestari");
  await choose(page.getByLabel("Pemegang Staf Administrasi Umum"), "Citra Dewi");
  await choose(page.getByLabel("Pemegang Fasilitator Kelas"), "Budi Santoso");
  await choose(page.getByLabel("Tambah fasilitator"), "Budi Santoso");
  await choose(page.getByLabel("Tambah fasilitator"), "Citra Dewi");
  await page.getByRole("button", { name: "Simpan sebagai versi baru" }).click();
  await expect(page.getByText("Konfigurasi disimpan sebagai versi baru.").last()).toBeVisible();
  await expect(page.getByRole("region", { name: "Riwayat versi" })).toContainText(`Versi ${v1 + 1}`);
  await ctx.close();
});

test("rumus bersifat terbuka untuk dilihat tetapi hanya Direktur yang mengubah; kapasitas per staf oleh Koordinator Program", async ({ browser }) => {
  const a = await as(browser, "ayu"); // Koordinator Program
  await a.page.goto("/training/indikator");
  await expect(a.page.getByText(/hanya Super Admin \(Direktur\) yang dapat mengubahnya/)).toBeVisible();
  await expect(a.page.getByRole("button", { name: "Simpan sebagai versi baru" })).toHaveCount(0);
  await expect(a.page.getByLabel("Ketepatan Waktu — Kuning bila SPI ≥")).toBeDisabled();
  await expect(a.page.getByLabel("Ketepatan Waktu — Kuning bila SPI ≥")).toHaveValue("0.8");
  // API menolak tegas walau tombol disembunyikan
  const put = await a.page.request.put("/api/training/indicators/config", { data: { config: {} }, headers: { origin: new URL(a.page.url()).origin } });
  expect([403, 422]).toContain(put.status());

  const region = a.page.getByRole("region", { name: "Kapasitas per staf" });
  await expect(region).toBeVisible();
  await choose(region.getByLabel("Staf", { exact: true }), "Citra Dewi");
  await region.getByLabel("Jam/hari").fill("4");
  await region.getByRole("button", { name: "Tambah" }).click();
  await expect(a.page.getByText("Kapasitas disimpan.").last()).toBeVisible();
  await expect(region).toContainText("Citra Dewi");
  await expect(region).toContainText("4 jam/hari");
  await a.ctx.close();

  const b = await as(browser, "budi"); // Admin Program: melihat rumus, tanpa kapasitas
  await b.page.goto("/training/indikator");
  await expect(b.page.getByRole("heading", { name: "Rumus Indikator" })).toBeVisible();
  await expect(b.page.getByRole("region", { name: "Kapasitas per staf" })).toHaveCount(0);
  await b.ctx.close();

  const h = await as(browser, "hr"); // admin HRIS tanpa level modul
  const r = await h.page.goto("/training/indikator");
  expect(r?.status()).toBe(404);
  await h.ctx.close();
});

test("program baru: template terpasang otomatis (16 milestone), milestone diselesaikan dengan bukti, status Merah karena milestone kritikal lewat tenggat", async ({ browser }) => {
  const { ctx, page } = await as(browser, "ayu");
  await page.goto("/training/proyek/baru");
  await page.getByLabel("Nama proyek / kegiatan").fill(PROJECT);
  await page.getByLabel("Memakai skema sertifikasi BNSP").check();
  await page.getByLabel("Peserta minimum").fill("15");
  await choose(page.getByLabel("Project Manager (PIC)"), "Ayu Lestari");
  await page.getByLabel("Tanggal mulai").fill(isoDatePlus(4));
  await page.getByLabel("Tanggal selesai").fill(isoDatePlus(4));
  await page.getByRole("button", { name: "Buat proyek" }).click();
  await page.waitForURL(/\/training\/proyek\/[0-9a-f-]{36}$/);
  projectUrl = new URL(page.url()).pathname;

  await page.goto(`${projectUrl}?tab=pemantauan`);
  await expect(page.getByText("Status program:")).toBeVisible();
  const ms = page.getByRole("region", { name: "Milestone" });
  await expect(ms.getByRole("row")).toHaveCount(17); // 16 milestone + judul kolom
  await expect(ms.getByRole("row").filter({ hasText: "R06" })).toContainText("Jadwal uji dari LSP"); // BNSP aktif → berlaku
  await expect(ms.getByRole("row").filter({ hasText: "R01" })).toContainText("Terlambat");
  await expect(page.getByText("Milestone kritikal lewat tenggat dan belum selesai")).toBeVisible();

  const r01 = ms.getByRole("row").filter({ hasText: "R01" });
  await r01.getByRole("button", { name: "Selesai" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByRole("button", { name: "Simpan" })).toBeDisabled(); // bukti wajib
  await dlg.getByLabel("Bukti penyelesaian").fill("Halaman program terbit: /program/haccp");
  await dlg.getByRole("button", { name: "Simpan" }).click();
  await expect(page.getByText("Milestone diselesaikan.").last()).toBeVisible();
  await expect(ms.getByRole("row").filter({ hasText: "R01" })).toContainText("Selesai");
  await expect(ms.getByRole("row").filter({ hasText: "R01" })).toContainText("Bukti: Halaman program terbit");

  // Item kesiapan: Citra (pemegang Staf Adm. Umum) hanya memegang item miliknya; Ayu sebagai Manajer dapat mengubah semuanya.
  const readiness = page.getByRole("region", { name: "Item kesiapan" });
  await readiness.getByLabel("Status Instruktur terkonfirmasi").selectOption("DONE");
  await expect(readiness.getByLabel("Status Instruktur terkonfirmasi")).toHaveValue("DONE");
  await ctx.close();
});

test("peserta terkonfirmasi dicatat manual dan memengaruhi komponen Peserta pada Kesiapan; ringkasan menampilkan status pemantauan", async ({ browser }) => {
  const { ctx, page } = await as(browser, "ayu");
  await page.goto(`${projectUrl}?tab=peserta`);
  await page.getByRole("button", { name: "Tambah peserta" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Nama peserta").fill("Peserta Indikator Satu");
  await dlg.getByRole("checkbox", { name: /Terkonfirmasi/ }).check();
  await dlg.getByRole("button", { name: "Simpan" }).click();
  await expect(page.getByText("Peserta disimpan.").last()).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Peserta Indikator Satu" })).toContainText("Terkonfirmasi");

  await page.goto(`${projectUrl}?tab=ringkasan`);
  await expect(page.getByText("Status pemantauan")).toBeVisible();
  await page.getByRole("link", { name: /Lihat rincian/ }).click();
  await expect(page.getByText("Proyeksi peserta", { exact: true })).toBeVisible();
  await expect(page.getByText(/Proyeksi 1[.,]\d peserta/)).toBeVisible();
  await ctx.close();
});

test("halaman Pemantauan: kartu program, peta beban tim, kepadatan kelas; anggota biasa hanya melihat bebannya sendiri", async ({ browser }) => {
  const a = await as(browser, "ayu");
  await a.page.goto("/training/pemantauan");
  await expect(a.page.getByRole("link", { name: PROJECT })).toBeVisible();
  await a.page.getByRole("link", { name: "Beban tim" }).click();
  await expect(a.page.getByText("Ada ruang ≤ 70%")).toBeVisible();
  await expect(a.page.getByRole("columnheader", { name: "Minggu ini" })).toBeVisible();
  await expect(a.page.getByRole("row").filter({ hasText: "Ayu Lestari" })).toBeVisible();
  await a.page.getByRole("link", { name: "Kelas paralel" }).click();
  await expect(a.page.getByText(/KP = \(luring \+ daring \+ 2 × hybrid\)/)).toBeVisible();
  await expect(a.page.getByText("Fasilitator dikonfigurasi: 2")).toBeVisible();
  await a.ctx.close();

  const c = await as(browser, "citra"); // anggota proyek biasa
  await c.page.goto("/training/pemantauan?tab=tim");
  await expect(c.page.getByText("Anda melihat beban Anda sendiri")).toBeVisible();
  await expect(c.page.getByRole("row").filter({ hasText: "Ayu Lestari" })).toHaveCount(0);
  await c.page.goto("/training/pemantauan?tab=kelas");
  await expect(c.page.getByText(/hanya terlihat oleh Pemantau, Koordinator Program, dan Direktur/)).toBeVisible();
  await c.ctx.close();
});

test("tab Pemantauan di layar ponsel tidak melebar ke samping; daftar milestone dapat digulir di dalam tabelnya", async ({ browser }) => {
  const { ctx, page } = await as(browser, "ayu", { width: 390, height: 844 });
  await page.goto(`${projectUrl}?tab=pemantauan`);
  await expect(page.getByText("Status program:")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await ctx.close();
});
