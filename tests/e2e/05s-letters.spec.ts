/**
 * Persuratan di browser: Staf membuat surat dari templat dengan editor visual → memilih penandatangan → mengajukan →
 * Direktur membuka "Perlu tanda tangan", menyetujui → nomor master + PDF terkunci → halaman verifikasi PUBLIK (tanpa login) menampilkan metadata tanpa isi.
 * Bila LETTER_SHOTS diisi (folder), tangkapan layar tiap langkah disimpan di sana.
 */
import { expect, request as pwRequest, test, type APIRequestContext, type Page } from "@playwright/test";
import { E2E_PASSWORD, USERS, isoDatePlus, login } from "./helpers";
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

test("penjualan: PIC mengisi data penawaran, status Terkirim → Deal (bukti PO), register & dasbor Direktur terisi; staf tak melihat register", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const page = await ctx.newPage();
  await login(page, USERS.ayu);
  await page.goto("/persuratan");
  await page.getByRole("button", { name: "Buat surat" }).click();
  await page.getByRole("button", { name: /Penawaran B2B/ }).click();
  await page.waitForURL(/\/persuratan\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop()!;
  await page.getByLabel("Penandatangan").selectOption({ index: 1 });
  await page.getByLabel("Perihal").fill("Penawaran In-House Food Production");
  await page.getByLabel(/^Penerima/).fill("Bapak Klien\nPT Klien Boga");
  const ed = page.getByRole("textbox", { name: "Isi surat", exact: true });
  await ed.click(); await page.keyboard.press("ControlOrMeta+A"); await page.keyboard.type("Bersama ini kami sampaikan penawaran program pelatihan in-house.");
  await expect(page.getByText("Tersimpan otomatis")).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: "Ajukan ke penandatangan" }).click();
  await expect(page.getByText("Menunggu penandatangan").first()).toBeVisible();
  expect((await dir.post(`/api/letters/${id}/approve`, { headers: { origin: base } })).status()).toBe(200);
  await page.reload();
  const card = page.getByRole("heading", { name: "Penawaran & penjualan" });
  await expect(card).toBeVisible();
  await page.getByLabel("Klien / instansi").fill("PT Klien Boga");
  await page.getByLabel("Produk").selectOption("BNSP Tata Boga / Food Production");
  await page.getByLabel("Nilai potensi (Rp)").fill("45000000");
  await page.getByLabel("Jadwal follow-up").fill(isoDatePlus(-1));
  await page.getByRole("button", { name: "Simpan data" }).click();
  await expect(page.getByText("Data penjualan disimpan.")).toBeVisible();
  await page.getByRole("button", { name: "Ubah status" }).click();
  await page.getByLabel("Status baru").selectOption("SENT");
  await page.getByRole("button", { name: "Simpan status" }).click();
  await expect(page.getByText("Status: Terkirim.")).toBeVisible();
  await expect(page.getByText("Follow-up terlambat")).toBeVisible();
  await shot(page, "19-penjualan-terkirim");
  // Deal tanpa nilai/bukti ditolak
  await page.getByRole("button", { name: "Ubah status" }).click();
  await page.getByLabel("Status baru").selectOption("DEAL");
  await page.getByRole("button", { name: "Simpan status" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /nilai deal/i }).first()).toBeVisible();
  await page.getByLabel("Nilai deal (Rp)").fill("40000000");
  await page.getByLabel(/Catatan bukti/).fill("PO nomor 123 dari klien");
  await page.getByRole("button", { name: "Simpan status" }).click();
  await expect(page.getByText("Status: Deal.")).toBeVisible();
  await page.getByLabel("Unggah bukti Deal").setInputFiles({ name: "po.pdf", mimeType: "application/pdf", buffer: await pdfBuf(1) });
  await expect(page.getByText("Bukti Deal tersimpan.")).toBeVisible();
  await shot(page, "20-penjualan-deal");
  await ctx.close();
  // register & dasbor (Direktur)
  const c2 = await browser.newContext({ viewport: { width: 1640, height: 1000 } });
  const dpage = await c2.newPage();
  await login(dpage, USERS.pimpinan);
  await dpage.goto("/persuratan/register");
  await expect(dpage.getByRole("heading", { name: "Register Surat" })).toBeVisible();
  await expect(dpage.getByRole("row").filter({ hasText: "PT Klien Boga" }).getByText("Deal")).toBeVisible();
  await shot(dpage, "21-register");
  await dpage.goto("/persuratan/dasbor");
  await expect(dpage.getByText("Nilai deal").first()).toBeVisible();
  await shot(dpage, "22-dasbor", true);
  const csv = await dir.get("/api/letters/register/export");
  expect(csv.status()).toBe(200); expect(await csv.text()).toContain("PT Klien Boga");
  await c2.close();
  const other = await session(USERS.budi);
  expect((await other.get("/api/letters/register")).status()).toBe(403);
  await other.dispose();
});

test("galeri tahap 4: Surat Tugas lewat Persuratan, Uang Harian, dan Surat Tugas Saya", async ({ browser }) => {
  test.skip(!SHOTS, "hanya untuk tangkapan layar (LETTER_SHOTS)");
  const hrApi = await session(USERS.hr);
  const opts = (await (await hrApi.get("/api/employees/options")).json()).data as { id: string; fullName: string }[];
  const ayuId = opts.find((o) => o.fullName.startsWith("Ayu"))!.id;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await login(page, USERS.hr);
  await page.goto("/persuratan");
  await shot(page, "23-persuratan-hr");
  await page.goto("/persuratan/surat-tugas");
  await shot(page, "24-surat-tugas-uang-harian-kosong");
  await page.getByRole("button", { name: "Buat Surat Tugas" }).click();
  await page.waitForURL(/\/persuratan\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop()!;
  await page.getByRole("button", { name: "Isi data penugasan" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Maksud / tujuan penugasan").fill("Pendampingan pelatihan In-House Food Production");
  await dlg.getByLabel("Lokasi tujuan").fill("Bandung, Jawa Barat");
  await dlg.getByLabel("Tanggal mulai").fill(isoDatePlus(1));
  await dlg.getByLabel("Tanggal selesai").fill(isoDatePlus(3));
  await dlg.getByLabel("Karyawan 1").selectOption({ label: "Ayu Lestari (DEMO-001)" });
  await dlg.getByLabel("Uang harian / hari").fill("300000");
  await shot(page, "25-data-penugasan");
  await dlg.getByRole("button", { name: "Simpan" }).click();
  await expect(page.getByRole("textbox", { name: "Isi surat" })).toContainText("Ayu Lestari");
  await page.getByLabel("Penandatangan").selectOption({ index: 1 });
  await expect(page.getByText("Tersimpan otomatis")).toBeVisible({ timeout: 8000 });
  await shot(page, "26-editor-surat-tugas");
  await page.getByRole("tab", { name: /Pratinjau PDF/ }).click();
  await page.waitForTimeout(1500);
  await shot(page, "27-pratinjau-surat-tugas");
  await page.getByRole("button", { name: "Ajukan ke penandatangan" }).click();
  await expect(page.getByText("Menunggu penandatangan").first()).toBeVisible();
  expect((await dir.post(`/api/letters/${id}/approve`, { headers: { origin: base } })).status()).toBe(200);
  await page.goto("/persuratan/surat-tugas");
  await shot(page, "28-surat-tugas-terbit-uang-harian");
  await page.getByRole("button", { name: /Terbitkan bukti penerimaan/ }).first().click();
  await shot(page, "29-terbitkan-bukti-penerimaan");
  await ctx.close();
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const ayu = await c2.newPage();
  await login(ayu, USERS.ayu);
  await ayu.goto("/surat-tugas-saya");
  await shot(ayu, "30-surat-tugas-saya-staf");
  await c2.close();
  await hrApi.dispose();
  void ayuId;
});

test("galeri tampilan STAF: daftar surat, pilih jenis, dikembalikan, terbit, penjualan, Surat Tugas Saya, notifikasi, batas akses", async ({ browser }) => {
  test.skip(!SHOTS, "hanya untuk tangkapan layar (LETTER_SHOTS)");
  const ayu = await session(USERS.ayu);
  const H = { origin: base };
  const types = (await (await ayu.get("/api/letters/types")).json()).data as { id: string; series: string; code: number; kind: string }[];
  const tid = (series: string, code: number) => types.find((t) => t.series === series && t.code === code)!.id;
  expect(types.some((t) => t.kind === "TUGAS")).toBe(false); // Surat Tugas tidak ditawarkan kepada staf
  const signerId = ((await (await ayu.get(`/api/letters/signers?typeId=${tid("EKS", 2)}`)).json()).data as { userId: string }[])[0]!.userId;
  const mk = async (typeCode: [string, number], subject: string, body: string) => {
    const c = await (await ayu.post("/api/letters", { data: { typeId: tid(typeCode[0], typeCode[1]) }, headers: H })).json();
    const id = c.data.id as string;
    const r = await ayu.patch(`/api/letters/${id}`, { data: { subject, recipientLines: ["Bapak Contoh", "PT Contoh Fiktif"], signerId, body: { type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "justify", firstLine: true }, content: [{ type: "text", text: body }] }] } }, headers: H });
    expect(r.status()).toBe(200);
    return id;
  };
  await mk(["EKS", 3], "Permohonan narasumber pelatihan (masih draf)", "Isi surat yang masih disusun.");
  const waiting = await mk(["EKS", 7], "Pemberitahuan perubahan jadwal pelatihan", "Mohon maaf atas perubahan jadwal.");
  expect((await ayu.post(`/api/letters/${waiting}/submit`, { headers: H })).status()).toBe(200);
  const returned = await mk(["EKS", 5], "Permohonan izin penggunaan ruang praktik", "Kami mohon izin penggunaan ruang praktik.");
  expect((await ayu.post(`/api/letters/${returned}/submit`, { headers: H })).status()).toBe(200);
  expect((await dir.post(`/api/letters/${returned}/return`, { data: { note: "Tolong tambahkan tanggal dan jam penggunaan ruang." }, headers: H })).status()).toBe(200);
  const offer = await mk(["EKS", 2], "Penawaran In-House Training Food Production", "Bersama ini kami sampaikan penawaran program pelatihan.");
  expect((await ayu.post(`/api/letters/${offer}/submit`, { headers: H })).status()).toBe(200);
  expect((await dir.post(`/api/letters/${offer}/approve`, { headers: H })).status()).toBe(200);
  await ayu.patch(`/api/letters/${offer}/commercial`, { data: { clientName: "PT Contoh Boga", product: "BNSP Tata Boga / Food Production", potentialValue: 45000000, picId: null, followUpAt: isoDatePlus(5) }, headers: H });

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await login(page, USERS.ayu);
  await page.goto("/persuratan");
  await shot(page, "31-staf-daftar-surat-saya");
  await page.getByRole("button", { name: "Buat surat" }).click();
  await shot(page, "32-staf-pilih-jenis");
  await page.keyboard.press("Escape");
  await page.goto(`/persuratan/${returned}`);
  await expect(page.getByText(/Dikembalikan:/)).toBeVisible();
  await shot(page, "33-staf-surat-dikembalikan");
  await page.goto(`/persuratan/${offer}`);
  await expect(page.getByRole("heading", { name: "Penawaran & penjualan" })).toBeVisible();
  await shot(page, "34-staf-surat-terbit-penjualan");
  await page.goto("/notifikasi");
  await shot(page, "35-staf-notifikasi");
  for (const url of ["/persuratan/register", "/persuratan/dasbor", "/persuratan/pengaturan", "/persuratan/surat-tugas"]) expect((await page.goto(url))?.status(), url).toBe(404);
  await ctx.close();
  await ayu.dispose();
});

test("galeri tampilan MANAJER (Citra bertingkat Manajer): antrean tanda tangan, tinjauan, setujui, penjualan, register & dasbor terbatas, tanda tangan saya", async ({ browser }) => {
  test.skip(!SHOTS, "hanya untuk tangkapan layar (LETTER_SHOTS)");
  const H = { origin: base };
  const hrApi = await session(USERS.hr), budi = await session(USERS.budi), citra = await session(USERS.citra);
  const opts = (await (await hrApi.get("/api/employees/options")).json()).data as { id: string; fullName: string }[];
  const citraEmp = opts.find((o) => o.fullName.startsWith("Citra"))!.id;
  const org = (level: string) => hrApi.post(`/api/employees/${citraEmp}/org`, { data: { jobLevel: level, effectiveFrom: isoDatePlus(0), note: "Uji galeri Persuratan" }, headers: H });
  try {
    expect((await org("MANAGER")).status()).toBe(200);
    const types = (await (await budi.get("/api/letters/types")).json()).data as { id: string; series: string; code: number }[];
    const tid = (c: number) => types.find((t) => t.series === "EKS" && t.code === c)!.id;
    const meId = ((await (await citra.get("/api/me")).json()).data as { userId?: string; id?: string });
    const citraUid = (meId.userId ?? meId.id)!;
    expect((await upload(citra, "/api/letters/signers/me/signature", await demoSignature())).status()).toBe(201);
    const mk = async (code: number, subject: string, body: string) => {
      const id = (await (await budi.post("/api/letters", { data: { typeId: tid(code) }, headers: H })).json()).data.id as string;
      const r = await budi.patch(`/api/letters/${id}`, { data: { subject, recipientLines: ["Bapak Contoh", "PT Contoh Fiktif"], signerId: citraUid, body: { type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "justify", firstLine: true }, content: [{ type: "text", text: body }] }] } }, headers: H });
      expect(r.status(), await r.text()).toBe(200);
      expect((await budi.post(`/api/letters/${id}/submit`, { headers: H })).status()).toBe(200);
      return id;
    };
    const offer = await mk(2, "Penawaran In-House Training Food Production", "Bersama ini kami sampaikan penawaran program pelatihan in-house.");
    const speaker = await mk(3, "Permohonan narasumber pelatihan ToT", "Kami memohon kesediaan Bapak sebagai narasumber.");
    await mk(5, "Permohonan izin penggunaan laboratorium", "Kami mohon izin penggunaan laboratorium praktik.");

    const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const page = await ctx.newPage();
    await login(page, USERS.citra);
    await page.goto("/persuratan?scope=review");
    await expect(page.getByRole("link", { name: /Penawaran B2B/ })).toBeVisible();
    await shot(page, "36-manajer-antrean-tanda-tangan");
    await page.goto(`/persuratan/${offer}`);
    await page.getByRole("tab", { name: /Pratinjau PDF/ }).click();
    await page.waitForTimeout(1500);
    await shot(page, "37-manajer-tinjau-surat");
    await page.getByRole("button", { name: "Setujui & terbitkan" }).click();
    await expect(page.getByText(/^Surat terbit dengan nomor/)).toBeVisible();
    await page.waitForTimeout(1500);
    await shot(page, "38-manajer-surat-terbit");
    await page.goto(`/persuratan/${speaker}`);
    await page.getByRole("button", { name: "Kembalikan" }).click();
    await page.getByLabel("Catatan / alasan").fill("Mohon cantumkan tanggal dan jam kegiatan.");
    await shot(page, "39-manajer-kembalikan-surat");
    await page.getByRole("button", { name: "Kirim" }).click();
    await expect(page.getByText("Surat dikembalikan ke pembuat.")).toBeVisible();
    // penjualan: Manajer dapat memantau & mengubah status penawaran corong
    await page.goto(`/persuratan/${offer}`);
    await expect(page.getByRole("heading", { name: "Penawaran & penjualan" })).toBeVisible();
    await shot(page, "40-manajer-kartu-penjualan");
    await page.goto("/persuratan/register");
    await expect(page.getByRole("heading", { name: "Register Surat" })).toBeVisible();
    await shot(page, "41-manajer-register");
    await page.goto("/persuratan/dasbor");
    await shot(page, "42-manajer-dasbor", true);
    await page.goto("/persuratan");
    await page.getByRole("button", { name: /Tanda tangan saya/ }).click();
    await shot(page, "43-manajer-tanda-tangan-saya");
    await page.keyboard.press("Escape");
    for (const url of ["/persuratan/pengaturan", "/persuratan/surat-tugas"]) expect((await page.goto(url))?.status(), url).toBe(404);
    await ctx.close();
  } finally {
    await org("STAFF");
    await hrApi.dispose(); await budi.dispose(); await citra.dispose();
  }
});
