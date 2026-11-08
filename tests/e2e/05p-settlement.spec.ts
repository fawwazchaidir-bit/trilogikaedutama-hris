/**
 * Penyelesaian akhir di browser: HR membuat (usulan sistem muncul), menambah baris manual pesangon, mengajukan; pimpinan menyetujui;
 * HR mencatat dibayar. Karyawan biasa tidak melihat menu dan ditolak di API. Penyelesaian yang dibayar terkunci (tidak dapat dibatalkan),
 * sehingga spesifikasi ini memakai Citra yang tidak dipakai spesifikasi berikutnya untuk proses berhenti.
 */
import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import { E2E_PASSWORD, USERS, login } from "./helpers";

test.describe.configure({ mode: "serial" });

let base = "";
let hr: APIRequestContext;
let citraId = "";
let settlementId = "";

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
test.afterAll(async () => { await hr.dispose(); });

test("HR membuat penyelesaian akhir, menambah pesangon manual, dan mengajukannya", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.hr);
  await page.getByRole("navigation", { name: "Menu utama" }).getByRole("link", { name: /^Penyelesaian Akhir$/ }).click();
  await expect(page.getByRole("heading", { name: "Penyelesaian Akhir", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Buat penyelesaian akhir" }).click();
  const dialog = page.getByRole("dialog");
  const who = dialog.getByLabel("Karyawan");
  await who.selectOption((await who.locator("option", { hasText: "Citra" }).first().getAttribute("value"))!);
  await dialog.getByRole("button", { name: "Buat & hitung usulan" }).click();

  await expect(page.getByRole("heading", { name: /Penyelesaian akhir · Citra Dewi/ })).toBeVisible();
  await expect(page.getByText(/tidak dihitung sistem/)).toBeVisible(); // pesangon/UPMK/UPH/THR/pajak tidak diusulkan
  await expect(page.getByText("Usulan sistem").first()).toBeVisible();
  settlementId = page.url().split("/").pop()!;

  await page.getByRole("button", { name: "Tambah baris manual" }).click();
  const line = page.getByRole("dialog");
  await line.getByLabel("Nama baris").fill("Uang pesangon (uji E2E)");
  await line.getByLabel("Nominal (Rp)").fill("1000000");
  await line.getByLabel("Dasar perhitungan").fill("Sesuai perjanjian kerja (data uji)");
  await line.getByRole("button", { name: "Simpan" }).click();
  await expect(page.getByText("Baris ditambahkan.")).toBeVisible();
  await expect(page.getByText("Uang pesangon (uji E2E)")).toBeVisible();

  await page.getByRole("button", { name: "Ajukan untuk persetujuan" }).click();
  await expect(page.getByText("Diajukan untuk persetujuan.")).toBeVisible();
  await expect(page.getByText("Menunggu persetujuan pimpinan.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tambah baris manual" })).toHaveCount(0); // terkunci setelah diajukan
  await ctx.close();

  const d = (await (await hr.get(`/api/final-settlements/${settlementId}`)).json()).data;
  expect(d.status).toBe("PENDING_APPROVAL");
  expect(d.lines.some((l: { name: string; source: string }) => l.name === "Uang pesangon (uji E2E)" && l.source === "MANUAL")).toBe(true);
  expect(d.employeeId).toBe(citraId);
});

test("pimpinan menyetujui, HR mencatat dibayar; setelah itu terkunci", async ({ browser }) => {
  const boss = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const bp = await boss.newPage();
  await login(bp, USERS.pimpinan);
  await bp.goto(`/penyelesaian-akhir/${settlementId}`);
  await bp.getByRole("button", { name: "Setujui" }).click();
  await bp.getByRole("dialog").getByLabel("Catatan persetujuan (opsional)").fill("Sesuai perjanjian (uji E2E)");
  await bp.getByRole("dialog").getByRole("button", { name: "Setujui" }).click();
  await expect(bp.getByText("Penyelesaian akhir disetujui.")).toBeVisible();
  await boss.close();

  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.hr);
  await page.goto(`/penyelesaian-akhir/${settlementId}`);
  await page.getByRole("button", { name: "Catat sudah dibayar" }).click();
  await page.getByRole("dialog").getByLabel("Referensi pembayaran (opsional)").fill("TRF-E2E-001");
  await page.getByRole("dialog").getByRole("button", { name: "Catat dibayar" }).click();
  await expect(page.getByText("Pembayaran dicatat.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Catat sudah dibayar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Batalkan" })).toHaveCount(0); // dibayar tidak dapat dibatalkan
  await ctx.close();

  const d = (await (await hr.get(`/api/final-settlements/${settlementId}`)).json()).data;
  expect(d).toMatchObject({ status: "PAID", payReference: "TRF-E2E-001", approvedBy: expect.any(String), paidBy: expect.any(String) });
  const again = await hr.post(`/api/final-settlements/${settlementId}/cancel`, { data: { reason: "Coba batalkan setelah dibayar" }, headers: { origin: base }, failOnStatusCode: false });
  expect(again.status()).toBe(409);
});

test("karyawan biasa tidak melihat menu Penyelesaian Akhir dan ditolak di API", async ({ browser }) => {
  const budi = await session(USERS.budi);
  expect((await budi.get("/api/final-settlements")).status()).toBe(403);
  expect((await budi.get(`/api/final-settlements/${settlementId}`)).status()).toBe(403);
  expect((await budi.post("/api/final-settlements", { data: { employeeId: citraId }, headers: { origin: base }, failOnStatusCode: false })).status()).toBe(403);
  await budi.dispose();
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.budi);
  await expect(page.getByRole("navigation", { name: "Menu utama" }).getByRole("link", { name: /Penyelesaian Akhir/ })).toHaveCount(0);
  await ctx.close();
});
