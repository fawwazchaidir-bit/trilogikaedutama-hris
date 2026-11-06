/**
 * Atasan langsung & alur tinjauan di browser: HR menetapkan atasan → karyawan mengajukan → atasan melihat "Persetujuan Tim" dan menyetujui →
 * HR tetap melihat datanya. Yang bukan atasan tidak melihat menu/halaman itu. Atasan dikembalikan seperti semula di akhir agar spesifikasi lain tidak terpengaruh.
 */
import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import { E2E_PASSWORD, USERS, isoDatePlus, login, menuLink, workdayPlus } from "./helpers";

test.describe.configure({ mode: "serial" });

let base = "";
let hr: APIRequestContext, citra: APIRequestContext;
const ids = { ayu: "", citra: "" };

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
  const opts = (await (await hr.get("/api/employees/options")).json()).data as { id: string; fullName: string }[];
  ids.ayu = opts.find((o) => o.fullName.startsWith("Ayu"))!.id;
  ids.citra = opts.find((o) => o.fullName.startsWith("Citra"))!.id;
});
test.afterAll(async () => {
  await post(hr, `/api/employees/${ids.citra}/org`, { supervisorId: null, effectiveFrom: isoDatePlus(0), note: "Pemulihan setelah uji E2E" });
  await hr.dispose(); await citra.dispose();
});

test("HR menetapkan atasan lewat API; riwayat dan profil memuatnya; validasi menolak rantai melingkar", async () => {
  const r = await post(hr, `/api/employees/${ids.citra}/org`, { supervisorId: ids.ayu, effectiveFrom: isoDatePlus(0), note: "Uji E2E" });
  expect(r.status()).toBe(200);
  const got = (await (await hr.get(`/api/employees/${ids.citra}/org`)).json()).data;
  expect(got.profile.supervisor.id).toBe(ids.ayu);
  expect(got.history[0].changes).toEqual(["SUPERVISOR"]);
  expect(got.history.some((h: { changes: string[] }) => h.changes.includes("BASELINE"))).toBe(true);
  // Ayu menjadi bawahan Citra? membentuk rantai melingkar → 422
  const bad = await post(hr, `/api/employees/${ids.ayu}/org`, { supervisorId: ids.citra, effectiveFrom: isoDatePlus(0) });
  expect(bad.status()).toBe(422);
  expect((await bad.json()).error.fieldErrors.supervisorId).toBeTruthy();
});

test("karyawan mengajukan → atasan melihat Persetujuan Tim dan menyetujui di browser → status & kapasitas tercatat", async ({ browser }) => {
  const day = workdayPlus(75);
  const sub = await post(citra, "/api/leaves", { type: "IZIN", startDate: day, endDate: day, dayPart: "FULL", reason: "Urusan keluarga (uji E2E)" });
  expect(sub.status(), await sub.text()).toBe(201);
  const leaveId = (await sub.json()).data.id as string;

  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.ayu);
  await menuLink(page, /Persetujuan Tim/).click();
  await expect(page.getByRole("heading", { name: "Persetujuan Tim" })).toBeVisible();
  await expect(page.getByText(/Anda meninjau sebagai atasan langsung/)).toBeVisible();
  await page.getByRole("button", { name: /Setujui pengajuan Citra Dewi/ }).click();
  await page.getByRole("button", { name: "Setujui", exact: true }).click();
  await expect(page.getByText("Pengajuan disetujui.")).toBeVisible();
  await expect(page.getByRole("button", { name: /Setujui pengajuan Citra Dewi/ })).toHaveCount(0);
  await ctx.close();

  const mine = (await (await citra.get("/api/leaves/mine")).json()).data as { id: string; status: string; reviewedAs: string }[];
  expect(mine.find((l) => l.id === leaveId)).toMatchObject({ status: "APPROVED", reviewedAs: "SUPERVISOR" });
});

test("yang bukan atasan tidak melihat menu maupun halaman Persetujuan Tim; HR melihat kartu Organisasi pada detail karyawan", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.budi);
  await expect(menuLink(page, /Persetujuan Tim/)).toHaveCount(0);
  const res = await page.goto("/persetujuan-tim");
  expect(res?.status()).toBe(404);
  await ctx.close();

  const hrCtx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const hrPage = await hrCtx.newPage();
  await login(hrPage, USERS.hr);
  await hrPage.goto(`/karyawan/${ids.citra}`);
  await expect(hrPage.getByText("Organisasi & atasan langsung")).toBeVisible();
  await expect(hrPage.getByText("Ayu Lestari").first()).toBeVisible();
  await expect(hrPage.getByText("Riwayat perubahan")).toBeVisible();
  await hrCtx.close();
});
