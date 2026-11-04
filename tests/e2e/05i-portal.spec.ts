/**
 * Trilogika Internal Portal — rangka & beranda baru (sidebar maroon, bilah atas dengan pencarian Ctrl+K, menu pengguna, beranda per peran)
 * dan pemicu pekerja harian Training & Operations. Dijalankan sesudah 05f (memakai proyek & akses dari sana) dan sebelum 06-stage2 (2FA admin).
 */
import { expect, test, type Browser } from "@playwright/test";
import { USERS, login, logout } from "./helpers";

async function as(browser: Browser, who: keyof typeof USERS, vp = { width: 1360, height: 900 }) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  await login(page, USERS[who]);
  return { ctx, page };
}
const CRON = "e2e-cron-secret-uji-0123456789";

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
  await a.page.keyboard.press("Control+k");
  const box = a.page.getByRole("combobox", { name: "Cari" });
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
  await h.page.keyboard.press("Control+k");
  await h.page.getByRole("combobox", { name: "Cari" }).fill("Batch E2E");
  await expect(h.page.getByText(/Tidak ada hasil/)).toBeVisible();
  await expect(h.page.getByRole("option", { name: /Batch E2E/ })).toHaveCount(0);
  await h.ctx.close();
});

test("menu pengguna di pojok kanan atas: nama, peran, tautan akun, dan keluar", async ({ browser }) => {
  const { ctx, page } = await as(browser, "pimpinan");
  await page.getByRole("button", { name: "Menu pengguna" }).click();
  const menu = page.getByRole("menu", { name: "Menu pengguna" });
  await expect(menu).toContainText("Super Admin / Pimpinan");
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

test("pemicu pekerja harian: wajib CRON_SECRET; idempoten (pengingat tidak ganda)", async ({ request }) => {
  const url = "/api/internal/training-daily";
  expect((await request.post(url)).status()).toBe(401);
  expect((await request.post(url, { headers: { authorization: "Bearer salah-salah-salah-salah" } })).status()).toBe(401);
  const ok = await request.post(url, { headers: { authorization: `Bearer ${CRON}` } });
  expect(ok.status()).toBe(200);
  const first = (await ok.json()).data as { skipped: string | null; snapshots: number; reminders: number; escalations: number };
  expect(first.skipped).toBeNull();
  expect(first.snapshots).toBeGreaterThanOrEqual(0);
  const second = (await (await request.post(url, { headers: { authorization: `Bearer ${CRON}` } })).json()).data as typeof first;
  expect(second.reminders).toBe(0);
  expect(second.escalations).toBe(0);
  expect((await request.get(url)).status()).toBe(405);
});
