import { expect, test, type Browser, type Page } from "@playwright/test";
import { USERS, alertWith, login } from "./helpers";

// Berjalan setelah 05-location dan SEBELUM 06-stage2 (yang menyisakan 2FA aktif pada akun admin).
test.describe.configure({ mode: "serial" });

const SURABAYA = { latitude: -7.2575, longitude: 112.7521, accuracy: 15 }; // jauh dari kantor: dinas luar
const panelOf = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: "Absensi hari ini" }) });
const origin = (page: Page) => new URL(page.url()).origin;

async function employeeContext(browser: Browser, geo = SURABAYA) {
  const ctx = await browser.newContext({ geolocation: geo, permissions: ["geolocation", "camera"] });
  return { ctx, page: await ctx.newPage() };
}

async function takePhoto(page: Page) {
  const panel = panelOf(page);
  await panel.getByRole("button", { name: "Buka kamera" }).click();
  await expect(panel.getByLabel("Pratinjau kamera")).toBeVisible();
  await panel.getByRole("button", { name: "Ambil foto" }).click();
  await expect(panel.getByTestId("photo-preview")).toBeVisible();
}

test("Super Admin mewajibkan foto absensi; opsi jaringan kantor (Wi-Fi/IP) sudah tidak ada", async ({ page }) => {
  await login(page, USERS.pimpinan);
  await page.goto("/pengaturan");
  const form = page.getByRole("form", { name: "Form kebijakan" });
  // Tidak ada lagi isian/pilihan jaringan kantor (kata itu hanya muncul pada keterangan foto: "tidak bergantung pada Wi-Fi/jaringan kantor").
  await expect(form.getByLabel(/jaringan kantor/i)).toHaveCount(0);
  await expect(form.getByRole("checkbox", { name: /jaringan/i })).toHaveCount(0);
  await expect(form.getByRole("textbox", { name: /jaringan/i })).toHaveCount(0);
  const mode = form.locator('select:has(option[value="OPTIONAL"])');
  await mode.selectOption("REQUIRED");
  await expect(form.getByLabel("Foto wajib disertai lokasi (izin GPS)")).toBeChecked();
  await form.getByRole("button", { name: "Simpan & konfirmasi" }).click();
  await expect(page.getByText("Kebijakan disimpan dan dikonfirmasi.")).toBeVisible();
});

test("API: tanpa foto atau dengan foto rusak ditolak (422) dan absensi TIDAK tercatat", async ({ browser }) => {
  const { ctx, page } = await employeeContext(browser);
  await login(page, USERS.budi);
  const headers = { origin: origin(page) };
  const noPhoto = await page.request.post("/api/attendance/check-in", { data: { location: { lat: -7.2575, lng: 112.7521, accuracy: 15 } }, headers });
  expect(noPhoto.status()).toBe(422);
  expect((await noPhoto.json()).error.message).toMatch(/Foto absensi wajib/);

  const garbage = await page.request.post("/api/attendance/check-in", {
    headers,
    multipart: { payload: JSON.stringify({ location: { lat: -7.2575, lng: 112.7521, accuracy: 15 } }), photo: { name: "absensi.jpg", mimeType: "image/jpeg", buffer: Buffer.from("ini bukan gambar") } },
  });
  expect(garbage.status()).toBe(422);

  const svg = await page.request.post("/api/attendance/check-in", {
    headers,
    multipart: { payload: JSON.stringify({ location: { lat: -7.2575, lng: 112.7521, accuracy: 15 } }), photo: { name: "x.svg", mimeType: "image/svg+xml", buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="500"/>') } },
  });
  expect(svg.status()).toBe(422);
  const state = (await (await page.request.get("/api/attendance/today")).json()).data;
  expect(state.checkInAt).toBeNull();
  await ctx.close();
});

test("dinas luar: karyawan di luar kota memotret lewat kamera → check-in tercatat; tanpa foto tombol menolak dengan pesan jelas", async ({ browser }) => {
  const { ctx, page } = await employeeContext(browser);
  await login(page, USERS.budi);
  const panel = panelOf(page);
  await expect(panel.getByText("Foto absensi", { exact: false }).first()).toBeVisible();
  await expect(panel.getByText("(wajib)")).toBeVisible();

  await panel.getByRole("button", { name: "Check-in" }).click(); // belum memotret
  await expect(alertWith(page, /Ambil foto absensi dulu/)).toBeVisible();

  await takePhoto(page);
  await panel.getByRole("button", { name: "Check-in" }).click();
  await expect(page.getByText(/Check-in tercatat pukul \d{2}\.\d{2} WIB/)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Check-in" })).toBeDisabled();
  await ctx.close();
});

test("HR melihat foto absensi di rincian rekap; berkas JPEG nyata (bercap), hanya HR/pemilik yang boleh membukanya", async ({ browser }) => {
  const hrCtx = await browser.newContext();
  const hr = await hrCtx.newPage();
  await login(hr, USERS.hr);
  const found = (await (await hr.request.get("/api/employees?q=Budi")).json()).data.items as { id: string; fullName: string }[];
  const employeeId = found.find((e) => /^Budi/.test(e.fullName))!.id;
  await hr.goto(`/rekap/${employeeId}?view=bulanan`);
  const link = hr.getByRole("link", { name: "Masuk" }).first();
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href"))!;
  expect(href).toMatch(/^\/api\/files\/[0-9a-f-]{36}$/);
  await expect(hr.getByRole("link", { name: /Lokasi foto masuk/ }).first()).toHaveAttribute("href", /openstreetmap\.org\/\?mlat=-7\.2575/);

  const img = await hr.request.get(href);
  expect(img.status()).toBe(200);
  expect(img.headers()["content-type"]).toBe("image/jpeg");
  const bytes = await img.body();
  expect(bytes.length).toBeGreaterThan(5_000);
  expect([...bytes.subarray(0, 3)]).toEqual([0xff, 0xd8, 0xff]);

  // Karyawan lain tidak boleh membuka foto Budi.
  const { ctx, page } = await employeeContext(browser);
  await login(page, USERS.ayu);
  expect((await page.request.get(href)).status()).toBe(403);
  await ctx.close();

  // Pemilik boleh membuka fotonya sendiri.
  const own = await browser.newContext();
  const budi = await own.newPage();
  await login(budi, USERS.budi);
  expect((await budi.request.get(href)).status()).toBe(200);
  await own.close();
  await hrCtx.close();
});

test("check-out dinas luar dengan foto kedua (Citra, sudah check-in tadi); lalu Super Admin mengembalikan foto ke MATI", async ({ browser }) => {
  const { ctx, page } = await employeeContext(browser, { latitude: -6.9175, longitude: 107.6191, accuracy: 20 }); // Bandung
  await login(page, USERS.citra);
  const panel = panelOf(page);
  await takePhoto(page);
  await panel.getByRole("button", { name: "Check-out" }).click();
  await expect(page.getByText(/Check-out tercatat pukul/)).toBeVisible();
  await ctx.close();

  const sa = await browser.newContext();
  const p = await sa.newPage();
  await login(p, USERS.pimpinan);
  await p.goto("/pengaturan");
  const form = p.getByRole("form", { name: "Form kebijakan" });
  await form.locator('select:has(option[value="OPTIONAL"])').selectOption("OFF");
  await form.getByRole("button", { name: "Simpan & konfirmasi" }).click();
  await expect(p.getByText("Kebijakan disimpan dan dikonfirmasi.")).toBeVisible();
  await sa.close();
});
