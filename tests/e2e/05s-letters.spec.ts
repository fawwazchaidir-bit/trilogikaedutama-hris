/**
 * Persuratan di browser: Staf membuat surat dari templat dengan editor visual → memilih penandatangan → mengajukan →
 * Direktur membuka "Perlu tanda tangan", menyetujui → nomor master + PDF terkunci → halaman verifikasi PUBLIK (tanpa login) menampilkan metadata tanpa isi.
 * Bila LETTER_SHOTS diisi (folder), tangkapan layar tiap langkah disimpan di sana.
 */
import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { E2E_PASSWORD, USERS, login } from "./helpers";
import { demoLogo, demoSignature, demoStamp } from "../fixtures/documents/assets";

test.describe.configure({ mode: "serial" });
const SHOTS = process.env.LETTER_SHOTS;
const shot = async (page: Page, name: string, full = false) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: full }); };

let base = "";
let dir: APIRequestContext;
let letterId = "";
let number = "";
let token = "";

async function session(email: string): Promise<APIRequestContext> {
  const c = await pwRequest.newContext({ baseURL: base });
  const res = await c.post("/api/auth/login", { data: { email, password: E2E_PASSWORD }, headers: { origin: base } });
  expect(res.status(), `login ${email}`).toBe(200);
  return c;
}
const upload = async (c: APIRequestContext, url: string, img: { data: Buffer }) =>
  c.post(url, { headers: { origin: base }, multipart: { file: { name: "g.png", mimeType: "image/png", buffer: img.data } } });

test.beforeAll(async ({ baseURL }) => {
  base = new URL(baseURL!).origin;
  dir = await session(USERS.pimpinan);
  await dir.patch("/api/letters/settings", { data: { place: "Sleman", idLine: "Vocational Identity Number: 0000000000", footerText: "Trilogika Edutama Training Institute", escalationDays: 2 }, headers: { origin: base } });
  expect((await upload(dir, "/api/settings/logo", await demoLogo())).status()).toBe(201);
  expect((await upload(dir, "/api/letters/settings/stamp", await demoStamp())).status()).toBe(201);
  const me = (await (await dir.get("/api/me")).json()).data as { id?: string; userId?: string };
  const uid = me.userId ?? me.id;
  expect((await upload(dir, `/api/letters/signers/${uid}/signature`, await demoSignature())).status()).toBe(201);
});
test.afterAll(async () => { await dir.dispose(); });

test("Staf membuat surat permohonan narasumber dengan editor visual dan mengajukannya", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.ayu);
  await page.goto("/persuratan");
  await shot(page, "01-daftar-staf");
  await page.getByRole("button", { name: "Buat surat" }).click();
  await shot(page, "02-pilih-jenis");
  await page.getByRole("button", { name: /Permohonan narasumber/ }).click();
  await page.waitForURL(/\/persuratan\/[0-9a-f-]{36}$/);
  letterId = page.url().split("/").pop()!;
  await expect(page.getByRole("textbox", { name: "Isi surat" })).toBeVisible();
  // data surat
  await page.getByLabel("Penandatangan").selectOption({ index: 1 });
  await page.getByLabel("Perihal").fill("Surat Permohonan Narasumber");
  await page.getByLabel(/^Penerima/).fill("Bapak Contoh Narasumber\nPT Contoh Fiktif");
  // isi: ganti teks panduan templat
  const editor = page.getByRole("textbox", { name: "Isi surat" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Dalam rangka pelaksanaan pelatihan berbasis kompetensi, kami memohon kesediaan Bapak untuk menjadi narasumber pada kegiatan yang akan diselenggarakan bulan depan. Atas perhatian dan kerja samanya diucapkan terima kasih.");
  await page.getByRole("button", { name: "Rata kiri-kanan" }).click();
  await page.getByRole("button", { name: "Baris pertama menjorok" }).click();
  await shot(page, "03-editor-staf");
  await expect(page.getByText("Tersimpan otomatis")).toBeVisible({ timeout: 8000 });
  await page.getByRole("tab", { name: /Pratinjau PDF/ }).click();
  await expect(page.locator("iframe[title='Pratinjau PDF surat']")).toBeVisible();
  await page.waitForTimeout(1500);
  await shot(page, "04-pratinjau-draf");
  await page.getByRole("button", { name: "Ajukan ke penandatangan" }).click();
  await expect(page.getByText("Menunggu penandatangan").first()).toBeVisible();
  await shot(page, "05-diajukan");
  await ctx.close();
});

test("Direktur melihat surat di 'Perlu tanda tangan' dan menyetujui → nomor master & PDF terkunci", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.pimpinan);
  await page.goto("/persuratan?scope=review");
  await expect(page.getByRole("link", { name: /Permohonan narasumber/ })).toBeVisible();
  await shot(page, "06-antrean-direktur");
  await page.goto(`/persuratan/${letterId}`);
  await page.getByRole("tab", { name: /Pratinjau PDF/ }).click();
  await page.waitForTimeout(1500);
  await shot(page, "07-tinjauan-direktur");
  await page.getByRole("button", { name: "Setujui & terbitkan" }).click();
  await expect(page.getByText(/^Surat terbit dengan nomor/)).toBeVisible();
  const d = (await (await dir.get(`/api/letters/${letterId}`)).json()).data as { number: string; status: string; verifyToken: string };
  expect(d.status).toBe("ISSUED");
  expect(d.number).toMatch(/^\d{3}\/TE-EKS\/003\/(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII)\/\d{4}$/);
  number = d.number; token = d.verifyToken;
  await page.waitForTimeout(1500);
  await shot(page, "08-terbit");
  await page.getByRole("tab", { name: "Riwayat" }).click();
  await expect(page.getByText("Disetujui & diterbitkan")).toBeVisible();
  await ctx.close();
});

test("halaman verifikasi PUBLIK (tanpa login) menampilkan metadata tanpa isi surat; token palsu tidak dikenal", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`/verifikasi/${token}`);
  await expect(page.getByRole("heading", { name: "Dokumen sah dan terdaftar" })).toBeVisible();
  await expect(page.getByText(number)).toBeVisible();
  await expect(page.getByText("kerja samanya diucapkan")).toHaveCount(0);
  await shot(page, "09-verifikasi-publik");
  await page.goto(`/verifikasi/${"0".repeat(32)}`);
  await expect(page.getByRole("heading", { name: "Dokumen tidak ditemukan" })).toBeVisible();
  await ctx.close();
});

test("penjagaan akses: staf lain mendapat 404; pengaturan hanya Direktur", async ({ browser }) => {
  const other = await session(USERS.budi);
  expect((await other.get(`/api/letters/${letterId}`)).status()).toBe(404);
  expect((await other.get("/api/letters/settings")).status()).toBe(403);
  await other.dispose();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.pimpinan);
  await page.goto("/persuratan/pengaturan");
  await expect(page.getByRole("heading", { name: "Pengaturan Persuratan" })).toBeVisible();
  await shot(page, "10-pengaturan");
  await ctx.close();
});

test("galeri editor: templat narasumber (blok rincian), SK (diktum), dan tabel", async ({ browser }) => {
  test.skip(!SHOTS, "hanya untuk tangkapan layar (LETTER_SHOTS)");
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await login(page, USERS.ayu);
  const make = async (name: RegExp) => {
    await page.goto("/persuratan");
    await page.getByRole("button", { name: "Buat surat" }).click();
    await page.getByRole("button", { name }).click();
    await page.waitForURL(/\/persuratan\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("textbox", { name: "Isi surat" })).toBeVisible();
  };
  await make(/Permohonan narasumber/);
  await page.getByLabel("Penandatangan").selectOption({ index: 1 });
  await shot(page, "11-templat-narasumber");
  await make(/Surat keputusan\/SK/);
  await shot(page, "12-templat-sk");
  await make(/Penawaran B2B/);
  const ed = page.getByRole("textbox", { name: "Isi surat" });
  await ed.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.getByRole("button", { name: "Sisipkan tabel" }).click();
  await page.waitForTimeout(300);
  await page.keyboard.type("No");
  await page.keyboard.press("Tab"); await page.keyboard.type("Uraian");
  await page.keyboard.press("Tab"); await page.keyboard.type("Investasi");
  await page.keyboard.press("Tab"); await page.keyboard.type("1");
  await page.keyboard.press("Tab"); await page.keyboard.type("Pelatihan Juru Masak SPPG");
  await page.keyboard.press("Tab"); await page.keyboard.type("Rp 25.000.000");
  await shot(page, "13-tabel-di-editor");
  await ctx.close();
});
