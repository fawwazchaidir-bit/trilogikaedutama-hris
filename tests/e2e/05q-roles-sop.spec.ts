/**
 * Penyelarasan peran dengan SOP Rev 0.5 di browser: HR mengubah TINGKAT JABATAN Citra menjadi Manajer lewat kartu Organisasi →
 * Direktur melihat "Pemantau (otomatis: tingkat Manajer)" di Akses Training → Citra melihat SEMUA proyek tetapi tidak dapat membuat/mengubah →
 * mengubah status Citra menjadi Magang diblok selama ia masih bertingkat Manajer. Pemulihan di akhir: tingkat dikembalikan ke Staf.
 */
import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import { E2E_PASSWORD, USERS, isoDatePlus, login } from "./helpers";

test.describe.configure({ mode: "serial" });

let base = "";
let hr: APIRequestContext, citra: APIRequestContext, pimpinan: APIRequestContext;
let citraId = "";

async function session(email: string): Promise<APIRequestContext> {
  const c = await pwRequest.newContext({ baseURL: base });
  const res = await c.post("/api/auth/login", { data: { email, password: E2E_PASSWORD }, headers: { origin: base } });
  expect(res.status(), `login ${email}`).toBe(200);
  return c;
}
const post = (c: APIRequestContext, url: string, data: unknown) => c.post(url, { data, headers: { origin: base }, failOnStatusCode: false });

test.beforeAll(async ({ baseURL }) => {
  base = new URL(baseURL!).origin;
  hr = await session(USERS.hr);
  citra = await session(USERS.citra);
  pimpinan = await session(USERS.pimpinan);
  const opts = (await (await hr.get("/api/employees/options")).json()).data as { id: string; fullName: string }[];
  citraId = opts.find((o) => o.fullName.startsWith("Citra"))!.id;
});
test.afterAll(async () => {
  await post(hr, `/api/employees/${citraId}/org`, { jobLevel: "STAFF", effectiveFrom: isoDatePlus(0), note: "Pemulihan setelah uji E2E" });
  await hr.dispose(); await citra.dispose(); await pimpinan.dispose();
});

test("HR mengubah tingkat jabatan Citra menjadi Manajer lewat kartu Organisasi; riwayat mencatat 'Tingkat'", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.hr);
  await page.goto(`/karyawan/${citraId}`);
  await expect(page.getByRole("heading", { name: "Organisasi & atasan langsung" })).toBeVisible();
  await page.getByRole("button", { name: "Ubah jabatan / atasan" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Tingkat jabatan").selectOption("MANAGER");
  await dialog.getByLabel("Catatan").fill("Uji E2E tingkat jabatan");
  await dialog.getByRole("button", { name: "Simpan" }).click();
  await expect(page.getByText("Struktur organisasi diperbarui dan dicatat di riwayat.")).toBeVisible();
  await expect(page.getByText("Tingkat jabatan", { exact: true })).toBeVisible();
  await expect(page.getByText("Catatan: Uji E2E tingkat jabatan")).toBeVisible();
  await ctx.close();

  const got = (await (await hr.get(`/api/employees/${citraId}/org`)).json()).data;
  expect(got.profile.jobLevel).toBe("MANAGER");
  expect(got.history[0]).toMatchObject({ changes: ["JOB_LEVEL"], jobLevel: "MANAGER" });
});

test("Direktur melihat Citra sebagai Pemantau otomatis di Akses Training; Citra melihat semua proyek tetapi tidak dapat membuat proyek", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1640, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.pimpinan);
  await page.goto("/training/akses");
  const row = page.getByRole("row").filter({ hasText: USERS.citra });
  await expect(row.getByText("Pemantau (otomatis: tingkat Manajer)")).toBeVisible();
  await ctx.close();

  const all = (await (await pimpinan.get("/api/training/projects")).json()).data.total as number;
  const mine = (await (await citra.get("/api/training/projects")).json()).data.total as number;
  expect(mine).toBe(all); // Pemantau melihat seluruh proyek
  const create = await post(citra, "/api/training/projects", { name: "Tidak boleh dibuat Pemantau (uji E2E)" });
  expect(create.status()).toBe(403);
});

test("mengubah status Citra menjadi Magang diblok selama ia masih bertingkat Manajer (tidak dicabut otomatis)", async () => {
  const r = await post(hr, `/api/employees/${citraId}/org`, { employmentStatus: "INTERN", effectiveFrom: isoDatePlus(0) });
  expect(r.status()).toBe(422);
  expect(JSON.stringify(await r.json())).toContain("tingkat jabatan Manajer");
  const got = (await (await hr.get(`/api/employees/${citraId}/org`)).json()).data;
  expect(got.profile.employmentStatus).not.toBe("INTERN");
  expect(got.profile.jobLevel).toBe("MANAGER");
});
