/**
 * Persuratan di browser: Staf membuat surat dari templat dengan editor visual → memilih penandatangan → mengajukan →
 * Direktur membuka "Perlu tanda tangan", menyetujui → nomor master + PDF terkunci → halaman verifikasi PUBLIK (tanpa login) menampilkan metadata tanpa isi.
 * Bila LETTER_SHOTS diisi (folder), tangkapan layar tiap langkah disimpan di sana.
 */
import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { E2E_PASSWORD, USERS, login } from "./helpers";
import { PDFDocument } from "pdf-lib";
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

const pdfBuf = async (pages: number) => { const d = await PDFDocument.create(); for (let i = 0; i < pages; i++) d.addPage([595, 842]); return Buffer.from(await d.save()); };

test("lampiran: editor + PDF digabung + PDF terpisah; verifikasi publik mencantumkan hash lampiran terpisah", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await login(page, USERS.ayu);
  await page.goto("/persuratan");
  await page.getByRole("button", { name: "Buat surat" }).click();
  await page.getByRole("button", { name: /Penawaran B2B/ }).click();
  await page.waitForURL(/\/persuratan\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop()!;
  await page.getByLabel("Penandatangan").selectOption({ index: 1 });
  await page.getByLabel("Perihal").fill("Penawaran In-House Training");
  await page.getByLabel(/^Penerima/).fill("Bapak Contoh\nPT Contoh Boga");
  const ed = page.getByRole("textbox", { name: "Isi surat", exact: true });
  await ed.click(); await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.type("Terlampir penawaran program pelatihan kami.");
  // lampiran editor
  await page.getByLabel("Judul lampiran").fill("Rincian Investasi");
  await page.getByRole("button", { name: "Lampiran dari editor" }).click();
  await expect(page.getByRole("tab", { name: /Rincian Investasi/ })).toBeVisible();
  const att = page.getByRole("textbox", { name: /Isi lampiran Rincian Investasi/ });
  await att.click(); await page.keyboard.type("Paket Food Production: Rp 45.000.000");
  await expect(page.getByText("Lampiran tersimpan")).toBeVisible({ timeout: 8000 });
  // PDF digabung & terpisah
  await page.getByLabel("Judul lampiran").fill("Proposal Lengkap");
  await page.getByLabel("Unggah lampiran PDF").setInputFiles({ name: "proposal.pdf", mimeType: "application/pdf", buffer: await pdfBuf(2) });
  await expect(page.getByText("PDF digabung ke surat")).toBeVisible();
  await page.getByLabel("Mode lampiran PDF").selectOption("SEPARATE");
  await page.getByLabel("Judul lampiran").fill("Profil Lembaga");
  await page.getByLabel("Unggah lampiran PDF").setInputFiles({ name: "profil.pdf", mimeType: "application/pdf", buffer: await pdfBuf(1) });
  await expect(page.getByText("PDF terpisah")).toBeVisible();
  await shot(page, "14-lampiran");
  await page.getByRole("button", { name: "Ajukan ke penandatangan" }).click();
  await expect(page.getByText("Menunggu penandatangan").first()).toBeVisible();
  await ctx.close();
  const r = await dir.post(`/api/letters/${id}/approve`, { headers: { origin: base } });
  expect(r.status()).toBe(200);
  const d = (await r.json()).data as { number: string; verifyToken: string; attachments: { title: string }[] };
  expect(d.attachments).toHaveLength(3);
  const c2 = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const pub = await c2.newPage();
  await pub.goto(`/verifikasi/${d.verifyToken}`);
  await expect(pub.getByRole("heading", { name: "Lampiran (2)" })).toBeVisible();
  await expect(pub.getByText("berkas terpisah")).toBeVisible();
  await expect(pub.getByText("digabung ke PDF surat")).toBeVisible();
  await shot(pub, "15-verifikasi-lampiran");
  await c2.close();
});

test("arsip saja: Staf minta nomor, Direktur menyetujui, Staf unggah PDF pindaian; verifikasi menampilkan hash", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await login(page, USERS.ayu);
  await page.goto("/persuratan");
  await page.getByRole("button", { name: "Buat surat" }).click();
  await page.getByLabel(/Surat dibuat di luar portal/).check();
  await page.getByRole("button", { name: /Perjanjian \(MoU\/PKS\)/ }).click();
  await page.waitForURL(/\/persuratan\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop()!;
  await expect(page.getByText("Surat dibuat di luar portal (arsip saja)").first()).toBeVisible();
  await page.getByLabel("Penandatangan").selectOption({ index: 1 });
  await page.getByLabel("Perihal").fill("MoU dengan Mitra Contoh");
  await shot(page, "16-arsip-draf");
  await expect(page.getByText("Tersimpan otomatis")).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: "Ajukan ke penandatangan" }).click();
  await expect(page.getByText("Menunggu penandatangan").first()).toBeVisible();
  const r = await dir.post(`/api/letters/${id}/approve`, { headers: { origin: base } });
  expect(r.status()).toBe(200);
  const d = (await r.json()).data as { number: string; verifyToken: string };
  expect(d.number).toMatch(/\/TE-EKS\/012\//);
  await page.reload();
  await expect(page.getByText(d.number).first()).toBeVisible();
  await page.getByLabel("Unggah PDF pindaian").setInputFiles({ name: "scan.pdf", mimeType: "application/pdf", buffer: await pdfBuf(2) });
  await expect(page.getByText("PDF pindaian terpasang dan terkunci.")).toBeVisible();
  await shot(page, "17-arsip-terbit");
  const pub = await (await browser.newContext()).newPage();
  await pub.goto(`/verifikasi/${d.verifyToken}`);
  await expect(pub.getByText("dibuat dan ditandatangani di luar portal")).toBeVisible();
  await expect(pub.getByText("Sidik jari berkas (SHA-256)")).toBeVisible();
  await shot(pub, "18-verifikasi-arsip");
  await ctx.close();
});
