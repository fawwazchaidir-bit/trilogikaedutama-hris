/**
 * Notifikasi push desktop di browser: service worker tersaji, kartu pengaturan (hanya desktop), daftar perangkat, penolakan alamat yang bukan push service.
 * Pengiriman sungguhan ke Google/Mozilla/Apple tidak diuji di sini (tidak ada akses jaringan keluar); enkripsi diuji terhadap vektor RFC 8291 pada tes unit.
 */
import { expect, test, type Browser } from "@playwright/test";
import { generateVapidKeys } from "../../src/lib/webpush";
import { USERS, login } from "./helpers";

async function as(browser: Browser, who: keyof typeof USERS, opts: Parameters<Browser["newContext"]>[0] = { viewport: { width: 1360, height: 900 } }) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await login(page, USERS[who]);
  return { ctx, page };
}
const origin = (url: string) => new URL(url).origin;

test.describe.configure({ mode: "serial" });

test("service worker tersaji dari akar situs dengan jenis & cache yang benar", async ({ request }) => {
  const r = await request.get("/sw.js");
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toMatch(/javascript/);
  expect(r.headers()["cache-control"] ?? "").not.toMatch(/immutable|max-age=[1-9]/);
  const text = await r.text();
  expect(text).toContain("notificationclick");
  expect(text).toContain("showNotification");
});

test("API push: wajib masuk; alamat yang bukan push service ditolak 422 dan tidak disimpan", async ({ browser, request }) => {
  expect((await request.get("/api/push/status")).status()).toBe(401);
  const { ctx, page } = await as(browser, "citra");
  const o = origin(page.url());
  const k = generateVapidKeys();
  for (const endpoint of ["https://evil.example/push/abc", "http://fcm.googleapis.com/fcm/send/abc", "https://169.254.169.254/latest/meta-data"]) {
    const r = await page.request.post("/api/push/subscribe", { data: { endpoint, keys: { p256dh: k.publicKey, auth: "AAAAAAAAAAAAAAAAAAAAAA" } }, headers: { origin: o } });
    expect(r.status(), endpoint).toBe(422);
  }
  const status = await (await page.request.get("/api/push/status")).json();
  expect(status.data).toMatchObject({ available: true, devices: [] });
  expect(typeof status.data.publicKey).toBe("string");
  await ctx.close();
});

test("kartu Notifikasi desktop: tombol aktifkan; perangkat terdaftar tampil dan dapat dimatikan", async ({ browser }) => {
  const { ctx, page } = await as(browser, "citra");
  await page.goto("/akun");
  await expect(page.getByText("Notifikasi desktop", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aktifkan di browser ini" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Kirim notifikasi uji" })).toBeDisabled(); // belum ada perangkat

  // Daftarkan satu perangkat lewat API (peramban uji tidak dapat berlangganan ke push service sungguhan).
  const k = generateVapidKeys();
  const r = await page.request.post("/api/push/subscribe", { data: { endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${Date.now()}-${"z".repeat(24)}`, keys: { p256dh: k.publicKey, auth: "AAAAAAAAAAAAAAAAAAAAAA" } }, headers: { origin: origin(page.url()) } });
  expect(r.status()).toBe(201);
  await page.reload();
  await expect(page.getByText("Perangkat yang aktif (1/10)")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Matikan Chrome/ })).toBeVisible();
  await page.getByRole("button", { name: /^Matikan Chrome/ }).click();
  await expect(page.getByText("Perangkat dimatikan.").last()).toBeVisible();
  await expect(page.getByText(/Perangkat yang aktif/)).toHaveCount(0);
  await ctx.close();
});

test("ponsel: fitur ini khusus desktop — pengguna ponsel diberi penjelasan, bukan tombol aktifkan", async ({ browser }) => {
  const { ctx, page } = await as(browser, "citra", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36" });
  await page.goto("/akun");
  await expect(page.getByText(/hanya tersedia di komputer/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Aktifkan di browser ini" })).toHaveCount(0);
  await ctx.close();
});
