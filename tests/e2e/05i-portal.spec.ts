/**
 * Trilogika Internal Portal — rangka & beranda baru (sidebar maroon, bilah atas dengan pencarian Ctrl+K, menu pengguna, beranda per peran)
 * dan pemicu pekerja harian Training & Operations. Dijalankan sesudah 05f (memakai proyek & akses dari sana) dan sebelum 06-stage2 (2FA admin).
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { USERS, login, logout } from "./helpers";

async function as(browser: Browser, who: keyof typeof USERS, vp = { width: 1360, height: 900 }) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  await login(page, USERS[who]);
  return { ctx, page };
}
/** Ctrl+K dipasang saat hidrasi: ulangi sampai kotak pencarian terbuka (menekan sebelum hidrasi tidak berefek). */
async function openPalette(page: Page) {
  const box = page.getByRole("combobox", { name: "Cari" });
  await expect(async () => { await page.keyboard.press("Control+k"); await expect(box).toBeVisible({ timeout: 1_000 }); }).toPass({ timeout: 15_000 });
  return box;
}

test.describe.configure({ mode: "serial" });

test("beranda karyawan yang ikut proyek: sapaan, banner, menu utama, dan widget Training & Operations", async ({ browser }) => {
  const { ctx, page } = await as(browser, "citra");
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Selamat datang, Citra/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Sambutan" })).toContainText("Bersama Membangun Talenta Unggul untuk Indonesia");
  const menu = page.getByRole("region", { name: "Menu utama" });
  await expect(menu.getByRole("link", { name: /Absensi Saya/ })).toBeVisible();
  const training = page.getByRole("region", { name: "Training & Operations" });
  await expect(training.getByText("Ringkasan aktivitas")).toBeVisible();
  await expect(training.getByText("Kalender pelatihan")).toBeVisible();
  await expect(training.getByRole("img", { name: /Tugas selesai dan peserta ditambahkan/ })).toBeVisible();
  await ctx.close();
});

test("beranda admin HRIS tanpa akses modul: menu HR, tanpa widget Training", async ({ browser }) => {
  const { ctx, page } = await as(browser, "hr");
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: /Selamat datang/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Menu utama" }).getByRole("link", { name: /Karyawan/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Training & Operations" })).toHaveCount(0);
  await expect(page.getByText("Ringkasan aktivitas")).toHaveCount(0);
  await ctx.close();
});

test("pencarian cepat Ctrl+K: menu & proyek dalam lingkup akses; Enter membuka; Esc menutup; admin HRIS tidak melihat proyek", async ({ browser }) => {
  const a = await as(browser, "ayu");
  await a.page.goto("/dashboard");
  const box = await openPalette(a.page);
  await expect(box).toBeFocused();
  await box.fill("pemantauan");
  await expect(a.page.getByRole("option", { name: /Pemantauan Program/ })).toBeVisible();
  await a.page.keyboard.press("Enter");
  await a.page.waitForURL(/\/training\/pemantauan/, { timeout: 30_000 });

  await a.page.getByRole("button", { name: "Cari program, proyek, atau menu" }).click();
  await a.page.getByRole("combobox", { name: "Cari" }).fill("Batch E2E");
  await expect(a.page.getByRole("option", { name: /Batch E2E Yogyakarta/ })).toBeVisible();
  await a.page.keyboard.press("Escape");
  await expect(a.page.getByRole("dialog", { name: "Pencarian cepat" })).toHaveCount(0);
  await a.ctx.close();

  const h = await as(browser, "hr");
  await (await openPalette(h.page)).fill("Batch E2E");
  await expect(h.page.getByText(/Tidak ada hasil/)).toBeVisible();
  await expect(h.page.getByRole("option", { name: /Batch E2E/ })).toHaveCount(0);
  await h.ctx.close();
});

test("menu pengguna di pojok kanan atas: nama, peran, tautan akun, dan keluar", async ({ browser }) => {
  const { ctx, page } = await as(browser, "pimpinan");
  await page.getByRole("button", { name: "Menu pengguna" }).click();
  const menu = page.getByRole("menu", { name: "Menu pengguna" });
  await expect(menu).toContainText("Direktur (Super Admin)");
  await expect(menu.getByRole("menuitem", { name: "Keamanan & Notifikasi" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Ganti password" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await logout(page);
  await expect(page).toHaveURL(/\/login/);
  await ctx.close();
});

test("dashboard Direktur: kartu ringkasan, rujukan ke Pemantauan, dan tanpa teks 'rumus belum disepakati'", async ({ browser }) => {
  const { ctx, page } = await as(browser, "pimpinan");
  await page.goto("/training");
  await expect(page.getByRole("heading", { name: "Dashboard Direktur" })).toBeVisible();
  await expect(page.getByText("Program perlu perhatian")).toBeVisible();
  await expect(page.getByRole("region", { name: "Pemantauan program" }).getByRole("link", { name: /Buka pemantauan/ })).toBeVisible();
  await expect(page.getByText(/belum disepakati/)).toHaveCount(0);
  await ctx.close();
});

test("ponsel: beranda & dashboard training tanpa overflow horizontal; ikon cari membuka pencarian", async ({ browser }) => {
  const { ctx, page } = await as(browser, "ayu", { width: 390, height: 844 });
  for (const path of ["/dashboard", "/training"]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), path).toBeLessThanOrEqual(1);
  }
  await page.getByRole("button", { name: "Cari", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Pencarian cepat" })).toBeVisible();
  await ctx.close();
});

test("banner beranda: Direktur menulis pesan broadcast (+ notifikasi) → tampil bagi karyawan; hanya Direktur yang dapat mengubah; kembali ke bawaan", async ({ browser }) => {
  const boss = await as(browser, "pimpinan");
  await boss.page.goto("/dashboard");
  await expect(boss.page.getByRole("region", { name: "Sambutan" })).toContainText("Bersama Membangun Talenta Unggul untuk Indonesia");
  await boss.page.getByRole("button", { name: "Ubah pesan banner" }).click();
  const dlg = boss.page.getByRole("dialog", { name: "Pesan banner beranda" });
  await dlg.getByLabel("Judul pesan").fill("Libur bersama E2E");
  await dlg.getByLabel("Isi pesan (opsional)").fill("Kantor tutup satu hari.\nLayanan kembali normal esok hari.");
  await dlg.getByRole("checkbox", { name: /Kirim juga sebagai notifikasi/ }).check();
  await dlg.getByRole("button", { name: "Simpan & kirim notifikasi" }).click();
  await expect(boss.page.getByText("Pesan banner diperbarui.").last()).toBeVisible();
  const banner = boss.page.getByRole("region", { name: "Sambutan" });
  await expect(banner).toContainText("Libur bersama E2E");
  await expect(banner).toContainText("Layanan kembali normal esok hari.");
  await expect(banner).toContainText("Pesan dari Rudi Hartono");
  await boss.ctx.close();

  const emp = await as(browser, "citra");
  await emp.page.goto("/dashboard");
  await expect(emp.page.getByRole("region", { name: "Sambutan" })).toContainText("Libur bersama E2E");
  await expect(emp.page.getByRole("button", { name: "Ubah pesan banner" })).toHaveCount(0);
  const put = await emp.page.request.put("/api/portal/announcement", { data: { title: "Pesan palsu karyawan" }, headers: { origin: new URL(emp.page.url()).origin } });
  expect(put.status()).toBe(403);
  await emp.page.goto("/notifikasi");
  await expect(emp.page.getByText("Pesan dari Direktur: Libur bersama E2E")).toBeVisible();
  await emp.ctx.close();

  const hr = await as(browser, "hr");
  await hr.page.goto("/dashboard");
  await expect(hr.page.getByRole("region", { name: "Sambutan" })).toContainText("Libur bersama E2E");
  await expect(hr.page.getByRole("button", { name: "Ubah pesan banner" })).toHaveCount(0);
  await hr.ctx.close();

  const back = await as(browser, "pimpinan");
  await back.page.goto("/dashboard");
  await back.page.getByRole("button", { name: "Ubah pesan banner" }).click();
  await back.page.getByRole("dialog", { name: "Pesan banner beranda" }).getByRole("button", { name: "Kembalikan ke bawaan" }).click();
  await expect(back.page.getByText("Banner dikembalikan ke teks bawaan.").last()).toBeVisible();
  await expect(back.page.getByRole("region", { name: "Sambutan" })).toContainText("Bersama Membangun Talenta Unggul untuk Indonesia");
  await back.ctx.close();
});
