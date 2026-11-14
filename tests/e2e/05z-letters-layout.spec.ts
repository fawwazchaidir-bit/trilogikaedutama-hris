/**
 * Persuratan: kop (kontak + garis), tabel yang ditempel dari Word lewat editor sungguhan, dan paritas susunan baris editor ↔ PDF.
 * Dijalankan setelah 05s (surat & pengaturan dasar) dan sebelum 06-stage2 (2FA admin).
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { USERS, login } from "./helpers";
import { pageStreams } from "../helpers/pdf-streams";
import { pdfWords } from "../helpers/pdf-words";

test.describe.configure({ mode: "serial" });

async function as(browser: Browser, who: keyof typeof USERS) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await login(page, USERS[who]);
  return { ctx, page };
}
const origin = (page: Page) => new URL(page.url()).origin;
async function api<T = unknown>(page: Page, method: "get" | "post" | "patch" | "put", url: string, data?: unknown): Promise<T> {
  const res = await page.request[method](url, { ...(data === undefined ? {} : { data }), headers: { origin: origin(page) } });
  expect(res.ok(), `${method.toUpperCase()} ${url} → ${res.status()} ${await res.text()}`).toBe(true);
  return ((await res.json()) as { data: T }).data;
}
const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
test.afterAll(async () => { await prisma.$disconnect(); });

async function newLetter(page: Page, typeName: RegExp): Promise<string> {
  await page.goto("/persuratan");
  await page.getByRole("button", { name: "Buat surat" }).click();
  await page.getByRole("button", { name: typeName }).click();
  await page.waitForURL(/\/persuratan\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("textbox", { name: "Isi surat" })).toBeVisible();
  return page.url().split("/").pop()!;
}
const pdfOf = async (page: Page, id: string): Promise<Buffer> => {
  const res = await page.request.get(`/api/letters/${id}/pdf`);
  expect(res.status(), await res.text().catch(() => "")).toBe(200);
  return Buffer.from(await res.body());
};

test("Pengaturan kop surat: kontak lembaga tampil, garis dapat ditiadakan/diadakan, pratinjau PDF, tersimpan", async ({ browser }) => {
  await prisma.companySettings.update({ where: { id: 1 }, data: { email: "info@trilogika.example", phone: "(0274) 555-0100", website: "www.trilogika.example", address: "Grha Trilogika, Sleman" } });
  const { ctx, page } = await as(browser, "pimpinan");
  await page.goto("/persuratan/pengaturan");
  await expect(page.getByRole("heading", { name: "Kop surat" })).toBeVisible();
  const contact = page.getByTestId("kop-contact-line");
  await expect(contact).toContainText("Email: info@trilogika.example");
  await expect(contact).toContainText("Telp: (0274) 555-0100");
  await expect(contact).toContainText("Website: www.trilogika.example");

  // garis: bawaan ada → matikan → pratinjau cepat berubah, tombol simpan aktif
  const rule = page.getByLabel("Tampilkan garis di bawah kop");
  await expect(rule).toBeChecked();
  await expect(page.getByRole("button", { name: "Simpan kop" })).toBeDisabled();            // belum ada perubahan
  const live = page.getByTestId("kop-live-preview").locator("div").first();
  await expect(live).toHaveCSS("border-bottom-width", "2px");
  await rule.uncheck();
  await expect(live).toHaveCSS("border-bottom-width", "0px");
  await page.getByRole("button", { name: "Pratinjau PDF" }).first().click();                // kartu Kop surat tampil sebelum kartu Kaki halaman
  await expect(page.locator("iframe[title='Pratinjau PDF kop surat']")).toBeVisible();
  await page.getByRole("button", { name: "Simpan kop" }).click();
  await expect(page.getByText("Pengaturan kop disimpan.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Tampilkan garis di bawah kop")).not.toBeChecked();
  expect((await api<{ kopRule: boolean }>(page, "get", "/api/letters/settings")).kopRule).toBe(false);

  // PDF pratinjau: tanpa garis (tersimpan) vs dengan garis (diminta), dan kontak tercetak di bawah alamat
  const strokes = async (body: unknown) => {
    const r = await page.request.post("/api/letters/settings/footer-preview", { data: body, headers: { origin: origin(page) } });
    expect(r.status()).toBe(200);
    const buf = Buffer.from(await r.body());
    return { buf, n: ((await pageStreams(buf))[0]!.match(/0 0 0 SCN/g) ?? []).length };
  };
  const saved = await strokes({});                                  // memakai nilai tersimpan: tanpa garis
  const forced = await strokes({ kopRule: true });                  // pratinjau belum tersimpan: dengan garis
  expect(forced.n).toBeGreaterThan(saved.n);
  const text = pdfWords(saved.buf).words.map((w) => w.text).join(" ");
  expect(text).toContain("info@trilogika.example");
  expect(text).toContain("www.trilogika.example");

  // kontak dikosongkan di Pengaturan lembaga → baris kontak hilang, ada petunjuk untuk melengkapi
  await prisma.companySettings.update({ where: { id: 1 }, data: { email: null, phone: null, website: null } });
  await page.reload();
  await expect(page.getByTestId("kop-contact-line")).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: "belum diisi" })).toBeVisible();

  // pulihkan
  await api(page, "patch", "/api/letters/settings", { kopRule: true });
  await prisma.companySettings.update({ where: { id: 1 }, data: { email: "info@trilogika.example", phone: "(0274) 555-0100", website: "www.trilogika.example" } });
  await ctx.close();
});

test("Staf menempel tabel dari Word (sel gabungan colspan/rowspan) di editor: tersimpan, dan di PDF sel gabungan sampai tepi kanan", async ({ browser }) => {
  const { ctx, page } = await as(browser, "ayu");
  const id = await newLetter(page, /Penawaran B2B/);
  const cell = (attrs: string, inner: string) => `<td ${attrs} valign=top style='width:70.5pt;border:solid windowtext 1.0pt;padding:0cm 5.4pt 0cm 5.4pt'><p class=MsoNormal ${inner.startsWith("R") ? "align=right style='text-align:right'" : ""}><span lang=EN-US style='font-family:"Times New Roman",serif;mso-ansi-language:EN-US'>${inner}<o:p></o:p></span></p></td>`;
  const word = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset=utf-8><style>p.MsoNormal{margin:0cm;font-size:12.0pt}</style></head><body lang=EN-US><!--StartFragment-->
<table class=MsoTableGrid border=1 cellspacing=0 cellpadding=0 style='border-collapse:collapse;border:none;mso-border-alt:solid windowtext .5pt'>
<tr>${cell("width=94", "A")}${cell("width=94", "B")}${cell("width=94", "C")}${cell("width=94", "RK1")}</tr>
<tr>${cell("colspan=2 width=188", "Sel A dan B")}${cell("colspan=2 width=188", "RK2")}</tr>
<tr>${cell("rowspan=2 width=94", "Gabung")}${cell("width=94", "B3")}${cell("width=94", "C3")}${cell("width=94", "RK3")}</tr>
<tr>${cell("width=94", "B4")}${cell("width=94", "C4")}${cell("width=94", "RK4")}</tr>
</table><!--EndFragment--></body></html>`;
  const ed = page.getByRole("textbox", { name: "Isi surat" });
  await ed.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.evaluate((html) => {
    const el = document.querySelector('[role="textbox"][aria-label="Isi surat"]') as HTMLElement;      // bukan <section aria-label="Isi surat"> pembungkusnya
    el.focus();
    const dt = new DataTransfer();
    dt.setData("text/html", html);
    dt.setData("text/plain", "A\tB\tC\tRK1");
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, word);
  // tabel muncul di editor dengan sel gabungan
  const table = page.locator(".letter-paper .ProseMirror table");
  await expect(table).toHaveCount(1);
  await expect(table.locator("td[colspan='2'], th[colspan='2']")).toHaveCount(2);
  await expect(table.locator("td[rowspan='2'], th[rowspan='2']")).toHaveCount(1);
  await expect(page.getByText("Tersimpan otomatis")).toBeVisible({ timeout: 10_000 });

  // tersimpan sebagai dokumen yang sah (colspan/rowspan terbaca) dan PDF berhasil dibuat
  const d = await api<{ body: { content: { type: string; content?: { content?: { attrs?: Record<string, unknown> }[] }[] }[] } }>(page, "get", `/api/letters/${id}`);
  const t = d.body.content.find((n) => n.type === "table")!;
  expect(t, "tabel tersimpan").toBeTruthy();
  const cells = t.content!.flatMap((r) => r.content ?? []);
  expect(cells.filter((c) => c.attrs?.colspan === 2)).toHaveLength(2);
  expect(cells.filter((c) => c.attrs?.rowspan === 2)).toHaveLength(1);
  const { words } = pdfWords(await pdfOf(page, id));
  const right = (tk: string) => words.filter((w) => w.text === tk).map((w) => w.x1);
  expect(right("RK1")).toHaveLength(1);
  // sel gabungan RK2 berakhir di tepi kanan yang sama dengan sel kolom terakhir pada baris lain
  expect(Math.abs(right("RK2")[0]! - right("RK1")[0]!)).toBeLessThan(0.8);
  expect(Math.abs(right("RK3")[0]! - right("RK1")[0]!)).toBeLessThan(0.8);
  expect(Math.abs(right("RK4")[0]! - right("RK1")[0]!)).toBeLessThan(0.8);
  // kolom sejajar walau ada sel rowspan
  const left = (tk: string) => words.filter((w) => w.text === tk).sort((a, b) => a.y0 - b.y0)[0]!.x0;      // kemunculan paling atas = sel judul kolom
  expect(Math.abs(left("B3") - left("B4"))).toBeLessThan(0.8);
  expect(Math.abs(left("B3") - left("B"))).toBeLessThan(0.8);
  expect(Math.abs(left("C3") - left("C"))).toBeLessThan(0.8);
  await ctx.close();
});

/** Jumlah baris (pecahan baris) sebuah paragraf di editor, dihitung dari kotak teks yang sebenarnya dirender browser. */
async function editorLines(page: Page, marker: string): Promise<number> {
  await page.evaluate(() => document.fonts.ready);
  return page.evaluate((m) => {
    const p = Array.from(document.querySelectorAll(".letter-paper .ProseMirror p")).find((x) => x.textContent?.includes(m));
    if (!p) return -1;
    const r = document.createRange();
    r.selectNodeContents(p);
    const tops: number[] = [];
    for (const rect of Array.from(r.getClientRects())) if (!tops.some((t) => Math.abs(t - rect.top) < 4)) tops.push(rect.top);
    return tops.length;
  }, marker);
}
const pdfLines = (words: ReturnType<typeof pdfWords>["words"], re: RegExp): number => {
  const rows: { page: number; y: number }[] = [];
  for (const w of words.filter((x) => re.test(x.text))) if (!rows.some((r) => r.page === w.page && Math.abs(r.y - w.y0) < 2)) rows.push({ page: w.page, y: w.y0 });
  return rows.length;
};
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", attrs: { textAlign: "left" }, content: [{ type: "text", text }] }] });
const manyWords = (n: number) => Array.from({ length: n }, (_, i) => `kata${String(i + 1).padStart(3, "0")}`).join(" ");

for (const [label, typeName, kind] of [["surat biasa (11 pt, spasi 1,3)", /Permohonan narasumber/, "default"], ["Surat Edaran (Cambria 12 pt, spasi 1,5)", /Surat edaran/, "edaran"]] as const) {
  test(`paritas editor ↔ PDF — ${label}: gaya, lebar, dan jumlah baris paragraf panjang (selisih ≤ 12%) mengikuti PDF`, async ({ browser }) => {
    const { ctx, page } = await as(browser, "ayu");
    const id = await newLetter(page, typeName);
    await api(page, "patch", `/api/letters/${id}`, { body: doc(manyWords(520)), ...(kind === "edaran" ? { subject: "Uji paritas editor dan PDF" } : { subject: "Uji paritas", recipientLines: ["Bapak Uji", "PT Contoh"] }) });
    await page.reload();
    await expect(page.getByRole("textbox", { name: "Isi surat" })).toBeVisible();
    const paper = page.locator("article.letter-paper");
    await expect(paper).toHaveAttribute("data-layout", kind);
    // gaya editor = gaya PDF per jenis
    await expect(paper).toHaveCSS("font-size", kind === "edaran" ? "16px" : "14.6667px");   // 12 pt / 11 pt
    await expect(paper).toHaveCSS("line-height", kind === "edaran" ? "24px" : "19.0667px");  // 1,5 × 12 pt / 1,3 × 11 pt
    const family = await paper.evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toContain(kind === "edaran" ? "Caladea" : "Liberation Serif");
    // lebar isi editor = 17 cm (area isi PDF) pada UKURAN ASLI; kertas diskalakan (zoom) mengikuti kolom, bukan dibungkus ulang
    const w = await page.locator(".letter-paper .ProseMirror").evaluate((el) => parseFloat(getComputedStyle(el).width));
    expect(Math.abs(w - (17 / 2.54) * 96)).toBeLessThan(1.5);
    const zoom = Number(await paper.getAttribute("data-zoom"));
    expect(zoom).toBeGreaterThan(0.5);
    expect(zoom).toBeLessThanOrEqual(1);

    const inEditor = await editorLines(page, "kata001");
    const inPdf = pdfLines(pdfWords(await pdfOf(page, id)).words, /^kata\d{3}$/);
    expect(inEditor, "baris di editor").toBeGreaterThan(30);
    expect(inPdf, "baris di PDF").toBeGreaterThan(30);
    // Kesamaan baris yang PERSIS tidak mungkin: react-pdf memampatkan spasi hingga 50% (shrinkWhitespaceFactor di pustakanya) sehingga PDF memuat ±1 kata lebih banyak per baris
    // daripada peramban, yang tidak pernah memampatkan spasi. Yang dijamin: font/ukuran/spasi/lebar sama (di atas), selisih jumlah baris kecil (≤ 12%), dan editor tidak pernah
    // menampilkan LEBIH SEDIKIT baris daripada PDF (staf tidak dibuat mengira isi lebih pendek daripada hasil sesungguhnya).
    expect(Math.abs(inEditor - inPdf) / inPdf, `editor ${inEditor} baris vs PDF ${inPdf} baris`).toBeLessThanOrEqual(0.12);
    expect(inEditor, "editor tidak boleh lebih pendek dari PDF").toBeGreaterThanOrEqual(inPdf - 1);
    await ctx.close();
  });
}
