/**
 * Obrolan internal di browser: dua karyawan saling berkirim japri dan menerima secara langsung (SSE) — termasuk lencana menu —, kanal publik,
 * japri tertutup bagi HR tetapi dapat diperiksa Direktur (tercatat), utas penugasan dari tombol "Diskusi" (hanya yang berhak), dan polling cadangan
 * saat aliran SSE diblokir.
 */
import { expect, request as pwRequest, test, type APIRequestContext, type Browser, type Page } from "@playwright/test";
import { E2E_PASSWORD, USERS, isoDatePlus, login, menuLink } from "./helpers";

test.describe.configure({ mode: "serial" });

let base = "";
let hr: APIRequestContext, citra: APIRequestContext, ayu: APIRequestContext;
let budiEmpId = "";
let dmRoomId = "";

async function session(email: string): Promise<APIRequestContext> {
  const c = await pwRequest.newContext({ baseURL: base });
  const res = await c.post("/api/auth/login", { data: { email, password: E2E_PASSWORD }, headers: { origin: base } });
  expect(res.status(), `login ${email}`).toBe(200);
  return c;
}
const post = (c: APIRequestContext, url: string, data: unknown) => c.post(url, { data, headers: { origin: base }, failOnStatusCode: false });
async function as(browser: Browser, email: string): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, email);
  return { page, close: () => ctx.close() };
}
const composer = (p: Page) => p.getByLabel("Tulis pesan");
/** Isi percakapan saja (daftar ruang di kiri juga memuat pratinjau pesan terakhir). */
const log = (p: Page) => p.getByRole("log", { name: "Pesan" });
const send = async (p: Page, text: string) => { await composer(p).fill(text); await composer(p).press("Enter"); };

test.beforeAll(async ({ baseURL }) => {
  base = new URL(baseURL!).origin;
  hr = await session(USERS.hr); citra = await session(USERS.citra); ayu = await session(USERS.ayu);
  const opts = (await (await hr.get("/api/employees/options")).json()).data as { id: string; fullName: string }[];
  budiEmpId = opts.find((o) => o.fullName.startsWith("Budi"))!.id;
});
test.afterAll(async () => { await hr.dispose(); await citra.dispose(); await ayu.dispose(); });

test("Budi memulai japri dengan Citra; Citra melihat lencana menyala secara langsung, membalas, dan Budi menerimanya", async ({ browser }) => {
  const b = await as(browser, USERS.budi);
  const c = await as(browser, USERS.citra);
  await menuLink(b.page, /Obrolan/).click();
  await expect(b.page.getByRole("heading", { name: "Obrolan" })).toBeVisible();
  await expect(b.page.getByText("Terhubung langsung")).toBeVisible();
  await expect(b.page.getByRole("button", { name: /Umum/ })).toBeVisible(); // kanal bawaan

  await b.page.getByRole("button", { name: "Japri baru" }).click();
  const dlg = b.page.getByRole("dialog");
  await dlg.getByLabel("Cari nama").fill("Citra");
  await dlg.getByRole("button", { name: /Citra Dewi/ }).click();
  await expect(b.page.getByRole("heading", { name: "Citra Dewi" })).toBeVisible();
  await expect(b.page.getByText(/Direktur dapat memeriksa percakapan/)).toBeVisible(); // transparansi privasi japri
  dmRoomId = new URL(b.page.url()).searchParams.get("room")!;
  expect(dmRoomId).toBeTruthy();
  await send(b.page, "Halo Citra, siap berangkat besok? <img src=x onerror=alert(1)>");
  await expect(log(b.page).getByText("Halo Citra, siap berangkat besok?")).toBeVisible();
  await expect(b.page.locator("img[src='x']")).toHaveCount(0); // HTML tidak dirender: tampil sebagai teks

  // Citra berada di halaman lain; lencana menu muncul tanpa muat ulang.
  await expect(menuLink(c.page, /Obrolan/).getByLabel("1 menunggu")).toBeVisible({ timeout: 15_000 });
  await menuLink(c.page, /Obrolan/).click();
  await c.page.getByRole("button", { name: /Budi Santoso/ }).click();
  await expect(log(c.page).getByText("Halo Citra, siap berangkat besok?")).toBeVisible();
  await expect(log(c.page).getByText("<img src=x onerror=alert(1)>", { exact: false })).toBeVisible();
  await expect(menuLink(c.page, /Obrolan/).getByLabel(/menunggu/)).toHaveCount(0, { timeout: 10_000 }); // sudah dibaca
  await send(c.page, "Siap! Berangkat jam 7.");
  await expect(log(b.page).getByText("Siap! Berangkat jam 7.")).toBeVisible({ timeout: 15_000 });
  await b.close(); await c.close();
});

test("kanal publik: pesan Citra terlihat oleh karyawan lain; HR tidak dapat membaca japri; Direktur dapat memeriksa (baca-saja) dan tercatat di Audit Log", async ({ browser }) => {
  const c = await as(browser, USERS.citra);
  await menuLink(c.page, /Obrolan/).click();
  await c.page.getByRole("button", { name: /Umum/ }).click();
  await expect(c.page.getByText(/Kanal ini dapat dibaca semua karyawan/)).toBeVisible();
  await send(c.page, "Pengumuman: rapat koordinasi Jumat pukul 10.");
  await expect(log(c.page).getByText("Pengumuman: rapat koordinasi Jumat pukul 10.")).toBeVisible();
  await c.close();

  const a = await as(browser, USERS.ayu);
  await menuLink(a.page, /Obrolan/).click();
  await a.page.getByRole("button", { name: /Umum/ }).click();
  await expect(log(a.page).getByText("Pengumuman: rapat koordinasi Jumat pukul 10.")).toBeVisible();
  await a.close();

  // HR: japri orang lain 404 (keberadaan tidak bocor); Direktur: daftar pemeriksaan + baca-saja.
  expect((await hr.get(`/api/chat/rooms/${dmRoomId}/messages`)).status()).toBe(404);
  expect((await ayu.get(`/api/chat/rooms/${dmRoomId}/messages`)).status()).toBe(404);
  expect((await hr.get("/api/chat/audit/rooms")).status()).toBe(403);
  const d = await as(browser, USERS.pimpinan);
  await d.page.goto("/obrolan/pemeriksaan");
  await expect(d.page.getByRole("heading", { name: "Pemeriksaan Japri" })).toBeVisible();
  await d.page.getByRole("link", { name: /Budi Santoso ↔ Citra Dewi|Citra Dewi ↔ Budi Santoso/ }).click();
  await expect(d.page.getByText(/Anda membuka japri karyawan sebagai Direktur/)).toBeVisible();
  await expect(log(d.page).getByText("Halo Citra, siap berangkat besok?")).toBeVisible();
  await expect(d.page.getByLabel("Tulis pesan")).toHaveCount(0); // baca-saja
  await d.page.goto("/audit-log");
  await expect(d.page.getByText(/Direktur membuka japri .* untuk pemeriksaan/).first()).toBeVisible();
  await d.close();
});

test("tombol Diskusi pada Surat Tugas membuka utas khusus penerima; karyawan lain ditolak (404)", async ({ browser }) => {
  const day = isoDatePlus(5);
  const r = await post(hr, "/api/assignments", { purpose: "Pendampingan uji (E2E obrolan)", destination: "Surakarta", startDate: day, endDate: day, assignees: [{ employeeId: budiEmpId, dailyRate: 300000 }] });
  expect(r.status(), await r.text()).toBe(201);
  const letter = (await r.json()).data as { id: string; number: string };

  const b = await as(browser, USERS.budi);
  await b.page.goto("/surat-tugas-saya");
  await b.page.getByRole("button", { name: /Diskusi \(obrolan penugasan\)/ }).first().click();
  await expect(b.page).toHaveURL(/\/obrolan\?room=/);
  await expect(b.page.getByRole("heading", { name: new RegExp(`Surat Tugas ${letter.number.replace(/\//g, "\\/")}`) })).toBeVisible();
  await send(b.page, "Penerima tugas: titik kumpul di kantor jam 06.30.");
  await expect(log(b.page).getByText("Penerima tugas: titik kumpul di kantor jam 06.30.")).toBeVisible();
  const threadId = new URL(b.page.url()).searchParams.get("room")!;
  await b.close();

  // Citra bukan penerima tugas: tidak dapat membuka utas, dan tidak dapat merujuk surat itu di pesannya.
  expect((await post(citra, "/api/chat/subjects", { type: "ASSIGNMENT_LETTER", id: letter.id })).status()).toBe(404);
  expect((await hr.get(`/api/chat/rooms/${threadId}/messages`)).status()).toBe(200); // HR (assignment:view_all) berhak membaca utas
  expect((await ayu.get(`/api/chat/rooms/${threadId}/messages`)).status()).toBe(404);
  expect((await citra.get(`/api/chat/rooms/${threadId}/messages`)).status()).toBe(404);
});

test("aliran SSE diblokir → polling cadangan tetap mengantar pesan (dan status berubah)", async ({ browser }) => {
  const c = await as(browser, USERS.citra);
  await c.page.route("**/api/chat/stream", (route) => route.abort());
  await c.page.goto("/obrolan");
  await expect(c.page.getByText(/Memuat ulang berkala/)).toBeVisible({ timeout: 15_000 });
  await c.page.getByRole("button", { name: /Budi Santoso/ }).click();
  const b = await as(browser, USERS.budi);
  await b.page.goto(`/obrolan?room=${dmRoomId}`);
  await send(b.page, "Pesan lewat jalur cadangan.");
  await expect(log(c.page).getByText("Pesan lewat jalur cadangan.")).toBeVisible({ timeout: 20_000 });
  await b.close(); await c.close();
});
