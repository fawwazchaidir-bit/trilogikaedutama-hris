import { expect, test } from "@playwright/test";
import { USERS, alertWith, login } from "./helpers";

test.describe.configure({ mode: "serial" });

const OFFICE = { latitude: -7.7956, longitude: 110.3695 };

async function setLocation(page: import("@playwright/test").Page, enabled: boolean) {
  await page.goto("/pengaturan");
  const form = page.getByRole("form", { name: "Form kebijakan" });
  const box = form.getByLabel("Aktifkan absensi berbasis lokasi");
  if ((await box.isChecked()) !== enabled) await box.setChecked(enabled);
  if (enabled) {
    await form.getByLabel("Nama lokasi").fill("Kantor Uji");
    await form.getByLabel("Lintang (latitude)").fill(String(OFFICE.latitude));
    await form.getByLabel("Bujur (longitude)").fill(String(OFFICE.longitude));
    await form.getByLabel("Radius diizinkan (meter)").fill("100");
  }
  await form.getByRole("button", { name: "Simpan & konfirmasi" }).click();
  await expect(page.getByText("Kebijakan disimpan dan dikonfirmasi.")).toBeVisible();
}

test("Super Admin mengaktifkan absensi berbasis lokasi (titik + radius)", async ({ page }) => {
  await login(page, USERS.pimpinan);
  await setLocation(page, true);
});

test("karyawan di dalam radius → check-in berhasil dan jarak tercatat", async ({ browser }) => {
  const ctx = await browser.newContext({ geolocation: { ...OFFICE, accuracy: 15 }, permissions: ["geolocation"] });
  const page = await ctx.newPage();
  await login(page, USERS.citra);
  await expect(page.getByText(/Absensi berbasis lokasi aktif \(Kantor Uji\)/)).toBeVisible();
  await page.getByRole("button", { name: "Check-in" }).click();
  await expect(page.getByText(/Check-in tercatat pukul/)).toBeVisible();
  await ctx.close();
});

test("karyawan di luar radius → ditolak dengan jarak yang jelas", async ({ browser }) => {
  const ctx = await browser.newContext({ geolocation: { latitude: OFFICE.latitude + 0.02, longitude: OFFICE.longitude, accuracy: 10 }, permissions: ["geolocation"] });
  const page = await ctx.newPage();
  await login(page, USERS.budi);
  await page.getByRole("button", { name: "Check-in" }).click();
  await expect(alertWith(page, /di luar radius absensi Kantor Uji: \d+ m dari titik lokasi \(maksimal 100 m\)/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Check-in" })).toBeEnabled(); // belum tercatat
  await ctx.close();
});

test("akurasi GPS buruk ditolak; izin lokasi ditolak → pesan jelas", async ({ browser }) => {
  const poor = await browser.newContext({ geolocation: { ...OFFICE, accuracy: 900 }, permissions: ["geolocation"] });
  const p1 = await poor.newPage();
  await login(p1, USERS.budi);
  await p1.getByRole("button", { name: "Check-in" }).click();
  await expect(alertWith(p1, /Akurasi lokasi perangkat terlalu rendah/)).toBeVisible();
  await poor.close();

  const denied = await browser.newContext(); // tanpa izin geolocation
  const p2 = await denied.newPage();
  await login(p2, USERS.budi);
  await p2.getByRole("button", { name: "Check-in" }).click();
  await expect(alertWith(p2, /Izin lokasi ditolak/)).toBeVisible();
  await denied.close();
});

test("API menolak check-in tanpa koordinat saat fitur aktif; Super Admin menonaktifkan kembali", async ({ page }) => {
  await login(page, USERS.budi);
  const res = await page.request.post("/api/attendance/check-in", { data: {}, headers: { origin: new URL(page.url()).origin } });
  expect(res.status()).toBe(422);
  expect((await res.json()).error.message).toMatch(/mewajibkan lokasi/);
  await page.context().clearCookies();
  await login(page, USERS.pimpinan);
  await setLocation(page, false);
});
