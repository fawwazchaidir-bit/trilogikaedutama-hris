/**
 * Persuratan — dokumen yang SUDAH DIBATALKAN di browser: (11) halaman verifikasi publik tidak membocorkan alasan pembatalan; (12) unduhan Surat Tugas yang dibatalkan
 * adalah SALINAN STATUS bertanda DIBATALKAN (arsip asli tetap tersimpan & tercatat bila diambil), dengan peringatan yang jelas di layar.
 * Dijalankan setelah 05s (pengaturan Persuratan) dan sebelum 06-stage2 (2FA admin). Data disiapkan lewat API.
 */
import { createHash } from "node:crypto";
import { expect, request as pwRequest, test, type APIRequestContext } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { E2E_PASSWORD, USERS, issueAssignmentViaLetters, login, workdayPlus } from "./helpers";

test.describe.configure({ mode: "serial" });

const REASON = "Klien PT Rahasia Abadi membatalkan sepihak karena sengketa kontrak";
let base = "";
let hr: APIRequestContext, dir: APIRequestContext;
let assignmentId = "", letterId = "", number = "", token = "";
let liveSha = "";
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

async function session(email: string): Promise<APIRequestContext> {
  const c = await pwRequest.newContext({ baseURL: base });
  const res = await c.post("/api/auth/login", { data: { email, password: E2E_PASSWORD }, headers: { origin: base } });
  expect(res.status(), `login ${email}`).toBe(200);
  return c;
}

test.beforeAll(async ({ baseURL }) => {
  base = new URL(baseURL!).origin;
  hr = await session(USERS.hr);
  dir = await session(USERS.pimpinan);
  const opts = (await (await hr.get("/api/employees/options")).json()).data as { id: string; fullName: string }[];
  const citra = opts.find((o) => o.fullName.startsWith("Citra"))!.id;
  const a = await issueAssignmentViaLetters(hr, dir, base, { purpose: "Pendampingan uji pembatalan (uji E2E)", destination: "Magelang", startDate: workdayPlus(10), endDate: workdayPlus(10), assignees: [{ employeeId: citra, dailyRate: 300_000 }] });
  assignmentId = a.id; letterId = a.letterId; number = a.number;
  token = ((await (await hr.get(`/api/letters/${letterId}`)).json()).data as { verifyToken: string }).verifyToken;
});
test.afterAll(async () => { await hr.dispose(); await dir.dispose(); });

test("sebelum dibatalkan: unduhan Surat Tugas = PDF resmi tanpa tanda; halaman publik 'sah'", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.citra);
  await page.goto("/surat-tugas-saya");
  await expect(page.getByText(number)).toBeVisible();
  await expect(page.getByRole("link", { name: "Surat Tugas (PDF)" }).first()).toBeVisible();
  const pdf = await page.request.get(`/api/assignments/${assignmentId}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["x-document-status"]).toBeUndefined();
  expect(pdf.headers()["content-disposition"]).not.toContain("DIBATALKAN");
  const liveBody = await pdf.body();
  liveSha = sha(liveBody);
  expect((await PDFDocument.load(liveBody)).getSubject() ?? "").not.toContain("DIBATALKAN");
  const pub = await ctx.newPage();
  await pub.goto(`/verifikasi/${token}`);
  await expect(pub.getByRole("heading", { name: "Dokumen sah dan terdaftar" })).toBeVisible();
  await ctx.close();
});

test("Direktur membatalkan lewat Persuratan: dialog memuat pengingat pemberitahuan penerima; PDF tidak lagi keluar sebagai asli tanpa tanda", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.pimpinan);
  await page.goto(`/persuratan/${letterId}`);
  await page.getByRole("button", { name: "Batalkan", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByText(/PDF yang sudah terlanjur dikirim tidak berubah/)).toBeVisible();
  await expect(dlg.getByText(/beritahukan pembatalan kepada penerima sesuai prosedur Trilogika/)).toBeVisible();
  await dlg.getByRole("textbox").fill(REASON);
  await dlg.getByRole("button", { name: "Kirim" }).click();
  await expect(page.getByTestId("cancelled-notice")).toBeVisible();
  await expect(page.getByTestId("cancelled-notice")).toContainText("salinan status bertanda DIBATALKAN");
  await expect(page.getByTestId("cancelled-notice")).toContainText("tidak ikut berubah");
  await expect(page.getByTestId("cancelled-notice")).toContainText(REASON);               // pengguna berwenang melihat alasannya
  await expect(page.getByRole("link", { name: "unduh arsip asli" })).toBeVisible();
  await ctx.close();
});

test("penerima: unduhan Surat Tugas yang dibatalkan = salinan status bertanda DIBATALKAN, dengan peringatan di layar", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.citra);
  await page.goto("/surat-tugas-saya");
  await expect(page.getByTestId("my-assignment-cancelled-notice").first()).toContainText("salinan status bertanda DIBATALKAN");
  await expect(page.getByTestId("my-assignment-cancelled-notice").first()).toContainText("Hentikan penggunaan salinan PDF");
  await expect(page.getByRole("link", { name: "Salinan status (DIBATALKAN)" }).first()).toBeVisible();
  const pdf = await page.request.get(`/api/assignments/${assignmentId}/pdf`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["x-document-status"]).toBe("CANCELLED");
  expect(pdf.headers()["content-disposition"]).toMatch(/_DIBATALKAN\.pdf/);
  const body = await pdf.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  expect(sha(body)).not.toBe(liveSha);                                                   // salinan bertanda ≠ berkas asli
  expect((await PDFDocument.load(body)).getSubject()).toContain("DIBATALKAN");           // keterangan status juga tertanam di metadata berkas
  await ctx.close();
});

test("HR: daftar Surat Tugas menampilkan peringatan pembatalan & tombol salinan status", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.hr);
  await page.goto("/surat-tugas");
  const notice = page.getByTestId("assignment-cancelled-notice").filter({ hasText: REASON });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("salinan status bertanda DIBATALKAN");
  await expect(notice).toContainText("beritahukan pembatalan kepada penerima sesuai prosedur");
  await expect(page.getByRole("link", { name: "Salinan status (DIBATALKAN)" }).first()).toBeVisible();
  await ctx.close();
});

test("Persuratan: pratinjau = salinan status; arsip asli hanya bila diminta (?asli=1) dan berbeda dari salinan", async () => {
  const stamped = await hr.get(`/api/letters/${letterId}/pdf`);
  expect(stamped.status()).toBe(200);
  expect(stamped.headers()["x-document-status"]).toBe("CANCELLED");
  const orig = await hr.get(`/api/letters/${letterId}/pdf?asli=1`);
  expect(orig.status()).toBe(200);
  expect(orig.headers()["x-document-status"]).toBe("CANCELLED-ORIGINAL");
  expect(sha(await orig.body())).toBe(liveSha);                                          // arsip asli persis berkas yang pernah diterbitkan
  expect(sha(await stamped.body())).not.toBe(liveSha);
});

test("halaman verifikasi PUBLIK untuk surat yang dibatalkan: status Dibatalkan tanpa alasan pembatalan", async ({ browser }) => {
  const ctx = await browser.newContext();                                                // tanpa login
  const page = await ctx.newPage();
  await page.goto(`/verifikasi/${token}`);
  await expect(page.getByRole("heading", { name: "Dokumen telah DIBATALKAN" })).toBeVisible();
  await expect(page.getByText(/alasan pembatalan hanya diberikan kepada pihak berwenang/)).toBeVisible();
  const text = (await page.locator("body").innerText());
  expect(text).not.toContain(REASON);
  expect(text).not.toContain("Rahasia Abadi");
  expect(text).not.toContain("sengketa");
  await ctx.close();
});
