/**
 * Template checklist, penanggung jawab per butir, dan "Checklist Saya" di browser.
 * HR menambah butir template (penanggung jawab bawaan = Budi) → checklist berhenti untuk Citra memuat butir itu terisi penanggung jawab →
 * Budi (karyawan biasa) melihatnya di /checklist-saya dan menandai selesai → HR melihat siapa yang menandai. Karyawan biasa tidak boleh membuka editor template.
 * Pemulihan di akhir: checklist dibatalkan dan butir template dinonaktifkan (butir tidak dihapus — memang begitu aturannya).
 */
import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import { E2E_PASSWORD, USERS, login } from "./helpers";

test.describe.configure({ mode: "serial" });

const TITLE = "Serahkan seragam kerja (uji E2E)";
let base = "";
let hr: APIRequestContext;
let citraId = "";
let checklistId = "";
let templateItemId = "";

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
  if (checklistId) await hr.post(`/api/employee-checklists/${checklistId}/cancel`, { data: { reason: "Pemulihan setelah uji E2E" }, headers: { origin: base }, failOnStatusCode: false });
  if (templateItemId) await hr.patch(`/api/employee-checklist-templates/${templateItemId}`, { data: { active: false }, headers: { origin: base }, failOnStatusCode: false });
  await hr.dispose();
});

test("HR menambah butir template berpenanggung jawab Budi lewat halaman Template Checklist", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.hr);
  await page.goto("/masuk-berhenti/template?kind=OFFBOARDING");
  await expect(page.getByRole("heading", { name: "Template Checklist" })).toBeVisible();
  await expect(page.getByText("Pengembalian aset diperiksa").first()).toBeVisible(); // butir bawaan terisi dari kode

  await page.getByRole("button", { name: "Tambah butir" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Judul butir").fill(TITLE);
  await dialog.getByLabel("Tenggat (hari sejak dimulai)").fill("5");
  await dialog.getByLabel("Penanggung jawab bawaan").selectOption({ label: "Budi Santoso" });
  await dialog.getByRole("button", { name: "Simpan" }).click();
  await expect(page.getByText("Butir template ditambahkan.")).toBeVisible();
  await expect(page.getByText(TITLE)).toBeVisible();
  await expect(page.getByText(/tenggat 5 hari sejak dimulai · penanggung jawab: Budi Santoso/)).toBeVisible();
  await ctx.close();

  const t = (await (await hr.get("/api/employee-checklist-templates?kind=OFFBOARDING")).json()).data.items as { id: string; title: string }[];
  templateItemId = t.find((i) => i.title === TITLE)!.id;
  expect(templateItemId).toBeTruthy();
});

test("checklist berhenti baru memuat butir itu dengan penanggung jawab & tenggat; karyawan biasa tidak boleh mengedit template", async () => {
  const r = await hr.post(`/api/employees/${citraId}/checklists`, { data: { kind: "OFFBOARDING", note: "Uji E2E template" }, headers: { origin: base }, failOnStatusCode: false });
  expect(r.status(), await r.text()).toBe(201);
  const c = (await r.json()).data;
  checklistId = c.id;
  const item = c.items.find((i: { title: string }) => i.title === TITLE);
  expect(item, "butir template baru harus tersalin ke checklist").toBeTruthy();
  expect(item.assigneeName).toBe("Budi Santoso");
  expect(item.dueDate).toBeTruthy();

  const budi = await session(USERS.budi);
  expect((await budi.get("/api/employee-checklist-templates")).status()).toBe(403);
  expect((await budi.post("/api/employee-checklist-templates", { data: { kind: "OFFBOARDING", title: "Tidak boleh" }, headers: { origin: base }, failOnStatusCode: false })).status()).toBe(403);
  await budi.dispose();
});

test("Budi melihat butir itu di Checklist Saya dan menandai selesai; HR melihat siapa yang menandai", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.budi);
  await page.getByRole("navigation", { name: "Menu utama" }).getByRole("link", { name: /Checklist Saya/ }).click();
  await expect(page.getByRole("heading", { name: "Checklist Saya" })).toBeVisible();
  await expect(page.getByText(TITLE)).toBeVisible();
  await expect(page.getByText(/Citra Dewi/).first()).toBeVisible();
  await page.getByRole("button", { name: `Tandai selesai: ${TITLE} (Citra Dewi)` }).click();
  await expect(page.getByText("Butir ditandai selesai.")).toBeVisible();
  await expect(page.getByText("Tidak ada butir yang menunggu Anda")).toBeVisible();
  await ctx.close();

  const list = (await (await hr.get(`/api/employees/${citraId}/checklists`)).json()).data as { id: string; items: { title: string; status: string; doneBy: string | null }[] }[];
  const done = list.find((x) => x.id === checklistId)!.items.find((i) => i.title === TITLE)!;
  expect(done.status).toBe("DONE");
  expect(done.doneBy).toBe("Budi Santoso");
});
