/**
 * Modul aset di browser: HR mendaftarkan aset, menyerahkannya ke Citra, melihatnya di detail karyawan, mencatat pengembalian dari sana.
 * Karyawan biasa tidak melihat menu Aset dan ditolak di API. Pemulihan: aset dinonaktifkan di akhir (tidak bisa dihapus — memang begitu aturannya).
 */
import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import { E2E_PASSWORD, USERS, login } from "./helpers";

test.describe.configure({ mode: "serial" });

const NAME = "Laptop Uji E2E";
let base = "";
let hr: APIRequestContext;
let citraId = "";
let assetId = "";

async function session(email: string): Promise<APIRequestContext> {
  const c = await pwRequest.newContext({ baseURL: base });
  const res = await c.post("/api/auth/login", { data: { email, password: E2E_PASSWORD }, headers: { origin: base } });
  expect(res.status(), `login ${email}`).toBe(200);
  return c;
}

test.beforeAll(async ({ baseURL }) => {
  base = new URL(baseURL!).origin;
  hr = await session(USERS.hr);
  const opts = (await (await hr.get("/api/employees/options")).json()).data as { id: string; fullName: string }[];
  citraId = opts.find((o) => o.fullName.startsWith("Citra"))!.id;
});
test.afterAll(async () => {
  if (assetId) {
    await hr.post(`/api/assets/${assetId}/return`, { data: { condition: "GOOD" }, headers: { origin: base }, failOnStatusCode: false });
    await hr.post(`/api/assets/${assetId}/retire`, { data: { reason: "Pemulihan setelah uji E2E" }, headers: { origin: base }, failOnStatusCode: false });
  }
  await hr.dispose();
});

test("HR mendaftarkan aset, menyerahkannya ke Citra, dan melihatnya di detail karyawan", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.hr);
  await page.getByRole("navigation", { name: "Menu utama" }).getByRole("link", { name: /^Aset$/ }).click();
  await expect(page.getByRole("heading", { name: "Aset", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Daftarkan aset" }).click();
  let dialog = page.getByRole("dialog");
  await dialog.getByLabel("Nama aset").fill(NAME);
  await dialog.getByLabel("Nomor seri (opsional)").fill("SN-E2E-1");
  await dialog.getByRole("button", { name: "Simpan" }).click();
  await expect(page.getByText("Aset didaftarkan.")).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: NAME });
  await expect(row.getByText("Tersedia")).toBeVisible();
  await expect(row.getByText(/AST-\d{4}/)).toBeVisible();

  await row.getByRole("button", { name: `Serahkan: ${NAME}` }).click();
  dialog = page.getByRole("dialog");
  const who = dialog.getByLabel("Diserahkan kepada");
  await who.selectOption((await who.locator("option", { hasText: "Citra" }).first().getAttribute("value"))!);
  await dialog.getByRole("button", { name: "Serahkan" }).click();
  await expect(page.getByText("Aset diserahkan.")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: NAME }).getByText("Dipinjam")).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: NAME }).getByRole("link", { name: /Citra/ })).toBeVisible();

  const list = (await (await hr.get("/api/assets?q=E2E")).json()).data as { id: string; name: string }[];
  assetId = list.find((a) => a.name === NAME)!.id;

  // detail karyawan: terlihat, lalu dikembalikan dari kartu itu (mis. saat proses berhenti)
  await page.goto(`/karyawan/${citraId}`);
  await expect(page.getByText("Aset yang dipegang (1)")).toBeVisible();
  await page.getByRole("button", { name: `Catat pengembalian: ${NAME}` }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel("Kondisi saat dikembalikan").selectOption("DAMAGED");
  await dialog.getByRole("button", { name: "Simpan pengembalian" }).click();
  await expect(dialog.getByText("Jelaskan kerusakan atau kehilangannya").first()).toBeVisible(); // rusak wajib berketerangan
  await dialog.getByLabel(/Keterangan kerusakan/).fill("Engsel longgar");
  await dialog.getByRole("button", { name: "Simpan pengembalian" }).click();
  await expect(page.getByText("Pengembalian dicatat.")).toBeVisible();
  await expect(page.getByText("Aset yang dipegang (0)")).toBeVisible();
  await ctx.close();

  const d = (await (await hr.get(`/api/assets/${assetId}`)).json()).data;
  expect(d.asset).toMatchObject({ status: "AVAILABLE", lastCondition: "DAMAGED" });
  expect(d.history).toHaveLength(1);
});

test("karyawan biasa tidak melihat menu Aset dan ditolak di API", async ({ browser }) => {
  const budi = await session(USERS.budi);
  expect((await budi.get("/api/assets")).status()).toBe(403);
  expect((await budi.post("/api/assets", { data: { name: "Tidak boleh", category: "OTHER" }, headers: { origin: base }, failOnStatusCode: false })).status()).toBe(403);
  expect((await budi.get(`/api/employees/${citraId}/assets`)).status()).toBe(403);
  await budi.dispose();

  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.budi);
  await expect(page.getByRole("navigation", { name: "Menu utama" }).getByRole("link", { name: /^Aset$/ })).toHaveCount(0);
  await ctx.close();
});
