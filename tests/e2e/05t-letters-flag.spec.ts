/**
 * Bendera Persuratan di browser (surat tugas): MENYALA (server utama) vs MATI (server kedua pada port lain, build yang sama, LETTERS_MODULE_ENABLED=false).
 * Memastikan HR tidak bertemu tombol yang gagal diam-diam: saat mati ada penjelasan + jalan ke Surat Tugas & Uang Harian; Direktur melihat hasil kesiapan di Pengaturan.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { expect, test } from "@playwright/test";
import { USERS, login } from "./helpers";

test.describe.configure({ mode: "serial" });
const OFF_PORT = Number(process.env.E2E_OFF_PORT ?? 3102);
const OFF = `http://127.0.0.1:${OFF_PORT}`;
let server: ChildProcess | null = null;

test.beforeAll(async () => {
  const env: NodeJS.ProcessEnv = {
    ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL ?? "", APP_URL: OFF, NODE_ENV: "production", APP_TIMEZONE: "Asia/Jakarta", TRUST_PROXY: "false",
    LETTERS_MODULE_ENABLED: "false", LETTERS_WORKER: "false", TRAINING_MODULE_ENABLED: "true", TRAINING_WORKER: "false", CHAT_MODULE_ENABLED: "true", CHAT_WORKER: "false", CHECKLIST_REMINDER_WORKER: "false",
  };
  server = spawn("npx", ["next", "start", "-H", "127.0.0.1", "-p", String(OFF_PORT)], { cwd: process.cwd(), env, stdio: "ignore" });
  for (let i = 0; i < 90; i++) {
    try { if ((await fetch(`${OFF}/login`)).ok) return; } catch { /* belum siap */ }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("Server dengan Persuratan mati tidak siap pada " + OFF);
});
test.afterAll(() => { server?.kill("SIGTERM"); });

test("bendera MENYALA: HR melihat menu Persuratan dan tombol 'Buat Surat Tugas'; Direktur melihat kesiapan 'Menyala' di Pengaturan", async ({ page }) => {
  await login(page, USERS.hr);
  await expect(page.getByRole("link", { name: /^Persuratan\b/ }).first()).toBeVisible();     // tautan menu bisa memuat lencana angka ("Persuratan 1")
  await page.goto("/persuratan/surat-tugas");
  await expect(page.getByRole("button", { name: "Buat Surat Tugas" })).toBeVisible();
  await expect(page.getByText("Surat tugas baru belum dapat dibuat")).toHaveCount(0);
  await page.context().clearCookies();
  await login(page, USERS.pimpinan);
  await page.goto("/pengaturan");
  const card = page.getByTestId("letters-readiness");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Menyala (LETTERS_MODULE_ENABLED=true)");
});

test.describe("bendera MATI (server kedua)", () => {
  test.use({ baseURL: OFF });

  test("HR: menu Persuratan hilang tetapi Surat Tugas & Uang Harian tetap terjangkau; halaman menjelaskan, tanpa tombol yang gagal; /persuratan 404", async ({ page }) => {
    await login(page, USERS.hr);
    await expect(page.getByRole("link", { name: /^Persuratan\b/ })).toHaveCount(0);
    await page.getByRole("link", { name: /Surat Tugas & Uang Harian/ }).first().click();
    await page.waitForURL("**/persuratan/surat-tugas");
    await expect(page.getByText("Surat tugas baru belum dapat dibuat")).toBeVisible();
    await expect(page.getByText("LETTERS_MODULE_ENABLED=false")).toBeVisible();
    await expect(page.getByRole("button", { name: "Buat Surat Tugas" })).toHaveCount(0);
    await expect(page.getByText("Surat Tugas & Uang Harian").first()).toBeVisible();     // daftar & uang harian tetap tersedia
    const res = await page.goto("/persuratan");
    expect(res?.status()).toBe(404);
  });

  test("Direktur: kartu 'Kesiapan Persuratan' di Pengaturan menunjukkan modul MATI dengan cara memperbaikinya; staf tetap punya Surat Tugas Saya", async ({ page }) => {
    await login(page, USERS.pimpinan);
    await page.goto("/pengaturan");
    const card = page.getByTestId("letters-readiness");
    await expect(card).toContainText("MATI (LETTERS_MODULE_ENABLED=false)");
    await expect(card).toContainText("Surat tugas BARU tidak dapat dibuat");
    await expect(card).toContainText("Setel LETTERS_MODULE_ENABLED=true");
    await page.context().clearCookies();
    await login(page, USERS.ayu);
    const res = await page.goto("/surat-tugas-saya");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("link", { name: /Surat Tugas Saya/ }).first()).toBeVisible();
  });
});
