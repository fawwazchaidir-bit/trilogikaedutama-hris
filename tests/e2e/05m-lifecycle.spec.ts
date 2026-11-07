/**
 * Checklist masuk & berhenti di browser: HR memulai checklist, melihatnya di halaman Masuk & Berhenti, membuka detail karyawan, dan mencentang
 * satu butir (tercatat siapa & kapan). Karyawan biasa ditolak. Checklist dibatalkan di akhir agar spesifikasi lain tidak terpengaruh.
 */
import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import { E2E_PASSWORD, USERS, login, menuLink } from "./helpers";

test.describe.configure({ mode: "serial" });

let base = "";
let hr: APIRequestContext;
let citraId = "";
let checklistId = "";

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
  await hr.dispose();
});

test("HR memulai checklist masuk lewat API; kontrak API: 9 butir wajib, tidak ganda, karyawan biasa ditolak", async () => {
  const r = await hr.post(`/api/employees/${citraId}/checklists`, { data: { kind: "ONBOARDING", note: "Uji E2E" }, headers: { origin: base }, failOnStatusCode: false });
  expect(r.status(), await r.text()).toBe(201);
  const c = (await r.json()).data;
  checklistId = c.id;
  expect(c.items).toHaveLength(9);
  expect(c.items.every((i: { required: boolean; status: string }) => i.required && i.status === "TODO")).toBe(true);
  const dup = await hr.post(`/api/employees/${citraId}/checklists`, { data: { kind: "ONBOARDING" }, headers: { origin: base }, failOnStatusCode: false });
  expect(dup.status()).toBe(409);
  const budi = await session(USERS.budi);
  expect((await budi.get("/api/employee-checklists")).status()).toBe(403);
  expect((await budi.get(`/api/employees/${citraId}/checklists`)).status()).toBe(403);
  await budi.dispose();
});

test("di browser: halaman Masuk & Berhenti memuat prosesnya; detail karyawan memperlihatkan sinyal dan HR mencentang butir", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.hr);
  await menuLink(page, /Masuk & Berhenti/).click();
  await expect(page.getByRole("heading", { name: "Masuk & Berhenti" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Citra Dewi" });
  await expect(row.getByText("Karyawan masuk")).toBeVisible();
  await row.getByRole("link", { name: "Citra Dewi" }).click();

  await expect(page.getByText("Checklist masuk & berhenti")).toBeVisible();
  await expect(page.getByText("Kontak darurat dilengkapi")).toBeVisible();
  await expect(page.getByText(/Kontak darurat belum lengkap/)).toBeVisible(); // sinyal dari data sistem
  await page.getByRole("button", { name: "Tandai selesai: Orientasi dan pelatihan awal dicatat" }).click();
  await expect(page.getByText("Butir ditandai selesai.")).toBeVisible();
  await expect(page.getByText(/Selesai · \S/).first()).toBeVisible(); // siapa & kapan tercatat
  await ctx.close();

  const c = (await (await hr.get(`/api/employees/${citraId}/checklists`)).json()).data[0];
  expect(c.progress).toMatchObject({ done: 1, requiredLeft: 8 });
});
