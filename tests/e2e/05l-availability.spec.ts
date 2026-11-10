/**
 * Surat tugas di jadwal & ketersediaan tim (browser): HR menerbitkan surat tugas → "Dinas luar — tujuan" tampil pada jadwal karyawan (Profil) dan
 * pada Ketersediaan Tim; karyawan biasa tanpa level modul tidak melihat menu/halaman ketersediaan. Surat tugas dibatalkan di akhir.
 */
import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import { E2E_PASSWORD, USERS, issueAssignmentViaLetters, login, menuLink, workdayPlus } from "./helpers";

test.describe.configure({ mode: "serial" });

let base = "";
let hr: APIRequestContext, dir: APIRequestContext;
let letterId = "";
let ayuId = "";
const day = () => workdayPlus(3);

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
  ayuId = opts.find((o) => o.fullName.startsWith("Ayu"))!.id;
  dir = await session(USERS.pimpinan);
  const a = await issueAssignmentViaLetters(hr, dir, base, { purpose: "Pendampingan uji kompetensi (uji E2E)", destination: "Surakarta", startDate: day(), endDate: day(), assignees: [{ employeeId: ayuId, dailyRate: 300_000 }] });
  letterId = a.letterId;
});
test.afterAll(async () => {
  if (letterId) await dir.post(`/api/letters/${letterId}/cancel`, { data: { note: "Pemulihan setelah uji E2E" }, headers: { origin: base }, failOnStatusCode: false });
  await hr.dispose(); await dir.dispose();
});

test("HR melihat Ketersediaan Tim: penugasan tampil 'DL · Surakarta' dengan nomor surat pada tooltip; API menjawab data yang sama", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.hr);
  await menuLink(page, /Ketersediaan Tim/).click();
  await expect(page.getByRole("heading", { name: "Ketersediaan Tim" })).toBeVisible();
  await page.goto(`/ketersediaan?from=${day()}&days=3`);
  const chip = page.getByText("DL · Surakarta").first();
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("title", /Dinas luar — Surakarta \(\d{3}\/TE-INT\/002\//);
  await expect(page.getByText(/Penugasan bukan bukti hadir/)).toBeVisible();
  await ctx.close();
  const api = (await (await hr.get(`/api/availability?from=${day()}&days=1`)).json()).data;
  expect(api.canSeeNumbers).toBe(true);
  expect(api.rows.find((r: { employeeId: string }) => r.employeeId === ayuId).cells[0].duty.destination).toBe("Surakarta");
});

test("karyawan yang ditugaskan melihat 'Dinas luar — Surakarta' pada jadwalnya sendiri", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.ayu);
  await page.goto("/profil");
  await expect(page.getByText("Dinas luar — Surakarta").first()).toBeVisible();
  await ctx.close();
});

test("Admin Program lain (level modul) melihat penugasan Ayu tanpa nomor/maksud surat; anggota proyek tanpa level tidak punya menu/halaman/API", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.budi); // Admin Program (diberi level pada 05f-training)
  await menuLink(page, /Ketersediaan Tim/).click();
  await page.goto(`/ketersediaan?from=${day()}&days=3`);
  const chip = page.getByText("DL · Surakarta").first();
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute("title", "Dinas luar — Surakarta");
  await expect(page.getByText(/Nomor dan maksud surat hanya terlihat oleh HR/)).toBeVisible();
  await ctx.close();

  const c2 = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const p2 = await c2.newPage();
  await login(p2, USERS.citra); // hanya anggota proyek, tanpa level modul
  await expect(menuLink(p2, /Ketersediaan Tim/)).toHaveCount(0);
  expect((await p2.goto("/ketersediaan"))?.status()).toBe(404);
  const citra = await session(USERS.citra);
  expect((await citra.get("/api/availability")).status()).toBe(403);
  await citra.dispose();
  await c2.close();
});
