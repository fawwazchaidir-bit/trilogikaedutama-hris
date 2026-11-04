/**
 * Training & Operations — perjalanan pengguna nyata di browser (build produksi + PostgreSQL uji).
 * Berjalan SEBELUM 06-stage2 (yang mewajibkan 2FA pada akun admin). Data dibuat lewat antarmuka, bukan dengan menyisipkan ke DB,
 * sehingga alur izin (Super Admin memberi level → Manajer membuat proyek → anggota bekerja) ikut diuji ujung ke ujung.
 */
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { USERS, isoDatePlus, login } from "./helpers";

const PROJECT = "Batch E2E Yogyakarta";
let projectUrl = "";

async function choose(select: Locator, text: string) {
  const opt = select.locator("option").filter({ hasText: text }).first();
  await select.selectOption({ label: ((await opt.textContent()) ?? "").trim() });
}
async function as(browser: Browser, who: keyof typeof USERS, vp = { width: 1360, height: 900 }) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  await login(page, USERS[who]);
  return { ctx, page };
}
const openProject = (page: Page, tab: string) => page.goto(`${projectUrl}?tab=${tab}`);

test.describe.configure({ mode: "serial" });

test("Super Admin memberi level modul: Ayu = Manajer Program, Budi = Admin Program (tercatat di audit)", async ({ browser }) => {
  const { ctx, page } = await as(browser, "pimpinan");
  await expect(page.getByRole("navigation", { name: "Menu utama" }).getByText("Training & Operations")).toBeVisible();
  await page.goto("/training/akses");
  await expect(page.getByRole("heading", { name: "Akses Training & Operations" })).toBeVisible();
  for (const [email, name, level, label] of [[USERS.ayu, "Ayu Lestari", "MANAGER", "Manajer Program"], [USERS.budi, "Budi Santoso", "ADMIN_PROGRAM", "Admin Program"]] as const) {
    const row = page.getByRole("row").filter({ hasText: email });
    await row.getByLabel(`Level modul ${name}`).selectOption(level);
    await row.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Level akses disimpan.").last()).toBeVisible();
    await expect(page.getByRole("row").filter({ hasText: email }).getByLabel(`Level modul ${name}`)).toHaveValue(level);
    expect(label).toBeTruthy();
  }
  // Perubahan level tercatat pada Audit Log (halaman khusus Super Admin).
  await page.goto("/audit-log");
  await expect(page.getByText(/Level akses Training & Operations Ayu Lestari/).first()).toBeVisible();
  await ctx.close();
});

test("Manajer: membuat program & template standar, lalu proyek dengan PIC + template, dan menyusun tim", async ({ browser }) => {
  const { ctx, page } = await as(browser, "ayu");
  await page.goto("/training/program");
  await page.getByRole("button", { name: "Program baru" }).click();
  await page.getByLabel("Nama program").fill("Sertifikasi E2E Food Production");
  await page.getByRole("dialog").getByRole("button", { name: "Simpan" }).click();
  await expect(page.getByText("Program disimpan.").last()).toBeVisible();
  await expect(page.getByRole("cell", { name: /Sertifikasi E2E Food Production/ })).toBeVisible();

  await page.goto("/training/checklist");
  await page.getByRole("button", { name: "Buat template standar" }).click();
  await expect(page.getByText("Template standar siap.").last()).toBeVisible();
  await expect(page.getByRole("heading", { name: /Standar Pelatihan Trilogika/ })).toBeVisible();

  await page.goto("/training/proyek/baru");
  await page.getByLabel("Nama proyek / kegiatan").fill(PROJECT);
  await choose(page.getByLabel("Program", { exact: true }), "Sertifikasi E2E Food Production");
  await choose(page.getByLabel("Template checklist"), "Standar Pelatihan Trilogika");
  await choose(page.getByLabel("Project Manager (PIC)"), "Ayu Lestari");
  await page.getByLabel("Tanggal mulai").fill(isoDatePlus(2));
  await page.getByLabel("Tanggal selesai").fill(isoDatePlus(4));
  await page.getByRole("button", { name: "Buat proyek" }).click();
  await page.waitForURL(/\/training\/proyek\/[0-9a-f-]{36}$/);
  projectUrl = new URL(page.url()).pathname;
  await expect(page.getByRole("heading", { name: PROJECT })).toBeVisible();
  await expect(page.getByText(/TRN-\d{4}-\d{4}/).first()).toBeVisible();

  // Tim: Budi staf pelaksana, Citra penanggung jawab peserta
  await openProject(page, "tim");
  for (const [name, role] of [["Budi Santoso", "Staf Pelaksana"], ["Citra Dewi", "Penanggung Jawab Peserta"]] as const) {
    await page.getByRole("button", { name: "Tambah anggota" }).click();
    const dlg = page.getByRole("dialog");
    await choose(dlg.getByLabel("Karyawan"), name);
    await choose(dlg.getByLabel("Peran di proyek"), role);
    await dlg.getByRole("button", { name: "Tambahkan" }).click();
    await expect(page.getByText("Anggota ditambahkan.").last()).toBeVisible();
    await expect(page.getByRole("cell", { name: new RegExp(name) })).toBeVisible();
  }

  // Alur status: Draf → Persiapan → Berjalan
  await openProject(page, "ringkasan");
  await page.getByRole("button", { name: "Mulai persiapan" }).click();
  await expect(page.getByRole("button", { name: "Mulai pelaksanaan" })).toBeVisible();
  await page.getByRole("button", { name: "Mulai pelaksanaan" }).click();
  await expect(page.getByText("Berjalan").first()).toBeVisible();

  // Tugas terlambat untuk Budi
  await openProject(page, "tugas");
  await page.getByRole("button", { name: "Tugas baru" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Judul tugas").fill("Konfirmasi asesor E2E");
  await choose(dlg.getByLabel("Penanggung jawab", { exact: true }), "Budi Santoso");
  await dlg.getByLabel("Tenggat").fill(isoDatePlus(-1));
  await dlg.getByRole("button", { name: "Simpan" }).click();
  await expect(page.getByText("Tugas dibuat.").last()).toBeVisible();
  const item = page.getByRole("listitem").filter({ hasText: "Konfirmasi asesor E2E" });
  await expect(item.getByText("Terlambat")).toBeVisible();
  await ctx.close();
});

test("Budi (level Admin Program + peran Staf): hanya mengerjakan tugasnya; tidak mendapat hak kelola proyek", async ({ browser }) => {
  const { ctx, page } = await as(browser, "budi");
  // Tugas saya → terlambat → selesai
  await page.goto("/training/tugas-saya");
  const item = page.getByRole("listitem").filter({ hasText: "Konfirmasi asesor E2E" });
  await expect(item.getByText("Terlambat")).toBeVisible();
  await item.getByRole("button", { name: "Ubah status" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Status baru").selectOption({ label: "Selesai" });
  await dlg.getByLabel("Catatan (opsional)").fill("Asesor sudah dikonfirmasi");
  await dlg.getByRole("button", { name: "Simpan" }).click();
  await expect(page.getByText("Status tugas diperbarui.").last()).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Konfirmasi asesor E2E" })).toHaveCount(0); // keluar dari filter "Terbuka"

  // Di dalam proyek: level Admin Program TIDAK memberi hak kelola atas proyek yang ia ikuti sebagai staf
  await openProject(page, "tim");
  await expect(page.getByRole("button", { name: "Tambah anggota" })).toHaveCount(0);
  await openProject(page, "tugas");
  await expect(page.getByRole("button", { name: "Tugas baru" })).toHaveCount(0);
  await openProject(page, "dokumen");
  await expect(page.getByRole("form", { name: "Unggah dokumen" })).toHaveCount(0);
  await openProject(page, "penutupan");
  await expect(page.getByText(/Penutupan proyek dilakukan oleh Manajer Program/)).toBeVisible();
  // …tetapi level Admin Program memang boleh membuat proyek baru
  await page.goto("/training/proyek");
  await expect(page.getByRole("link", { name: /Proyek baru/ })).toBeVisible();
  await ctx.close();
});

test("kontak peserta hanya terlihat oleh pengelola peserta (Citra); staf (Budi) melihat 'Disembunyikan'", async ({ browser }) => {
  const c = await as(browser, "citra");
  await openProject(c.page, "peserta");
  await c.page.getByRole("button", { name: "Tambah peserta" }).click();
  const dlg = c.page.getByRole("dialog");
  await dlg.getByLabel("Nama peserta").fill("Peserta E2E Satu");
  await dlg.getByLabel("Telepon").fill("081234567890");
  await dlg.getByRole("button", { name: "Simpan" }).click();
  await expect(c.page.getByText("Peserta disimpan.").last()).toBeVisible();
  await expect(c.page.getByRole("row").filter({ hasText: "Peserta E2E Satu" })).toContainText("081234567890");
  await c.ctx.close();

  const b = await as(browser, "budi");
  await openProject(b.page, "peserta");
  const row = b.page.getByRole("row").filter({ hasText: "Peserta E2E Satu" });
  await expect(row).toContainText("Disembunyikan");
  await expect(b.page.locator("body")).not.toContainText("081234567890");
  await b.ctx.close();
});

test("dokumen proyek: unggah PDF oleh PIC, unduh dengan Content-Disposition attachment; akun di luar proyek ditolak", async ({ browser }) => {
  const a = await as(browser, "ayu");
  await openProject(a.page, "dokumen");
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n");
  await a.page.locator("#doc-file").setInputFiles({ name: "proposal.pdf", mimeType: "application/pdf", buffer: pdf });
  await a.page.getByLabel("Judul").fill("Proposal E2E");
  await a.page.getByRole("button", { name: "Unggah", exact: true }).click();
  await expect(a.page.getByText("Dokumen diunggah.").last()).toBeVisible();
  const link = a.page.getByRole("link", { name: "Unduh Proposal E2E" });
  await expect(link).toBeVisible();
  const href = (await link.getAttribute("href"))!;
  const ok = await a.page.request.get(href);
  expect(ok.status()).toBe(200);
  expect(ok.headers()["content-type"]).toBe("application/pdf");
  expect(ok.headers()["content-disposition"]).toMatch(/^attachment/);
  expect(ok.headers()["cache-control"]).toContain("no-store");
  await a.ctx.close();

  // HR (admin HRIS) tidak punya akses proyek → berkas tidak dapat dibuka walau tahu URL-nya
  const hr = await as(browser, "hr");
  expect((await hr.page.request.get(href)).status()).toBe(403);
  await hr.ctx.close();
});

test("penutupan: checklist wajib menghalangi; ditutup dengan pengecualian beralasan; setelah itu proyek baca-saja", async ({ browser }) => {
  const { ctx, page } = await as(browser, "ayu");
  await openProject(page, "penutupan");
  await expect(page.getByText(/checklist wajib yang belum selesai/i).first()).toBeVisible();
  await page.getByLabel("Catatan hasil pelaksanaan").fill("Pelatihan berjalan lancar, 1 peserta.");
  const closeBtn = page.getByRole("button", { name: "Tutup proyek…" });
  await expect(closeBtn).toBeDisabled(); // butuh alasan pengecualian
  await page.getByLabel("Alasan pengecualian").fill("Klien membatalkan sesi penutup");
  await expect(closeBtn).toBeEnabled();
  await closeBtn.click();
  await page.getByRole("dialog").getByRole("button", { name: "Ya, tutup proyek" }).click();
  await expect(page.getByText("Proyek ditutup.").last()).toBeVisible();
  await expect(page.getByText(/Ditutup dengan pengecualian/)).toBeVisible();
  await expect(page.getByText("Klien membatalkan sesi penutup").first()).toBeVisible();
  await openProject(page, "tugas");
  await expect(page.getByText(/Proyek sudah ditutup/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Tugas baru" })).toHaveCount(0);
  await openProject(page, "riwayat");
  await expect(page.getByText(/ditutup DENGAN PENGECUALIAN/)).toBeVisible();
  await ctx.close();
});

test("admin HRIS (HR) tidak melihat menu Training & halamannya menjawab 404; Direktur (Super Admin) memiliki akses penuh", async ({ browser }) => {
  const hr = await as(browser, "hr");
  await expect(hr.page.getByRole("navigation", { name: "Menu utama" }).getByText("Training & Operations")).toHaveCount(0);
  for (const p of ["/training", "/training/proyek", projectUrl]) expect((await hr.page.goto(p))!.status()).toBe(404);
  expect((await hr.page.request.get("/api/training/projects")).status()).toBe(404);
  await hr.ctx.close();

  const boss = await as(browser, "pimpinan");
  await boss.page.goto("/training");
  await expect(boss.page.getByRole("heading", { name: "Dashboard Direktur" })).toBeVisible();
  await boss.page.goto("/training/proyek");
  await expect(boss.page.getByRole("link", { name: /Proyek baru/ })).toBeVisible(); // Direktur boleh membuat proyek
  await boss.page.goto(projectUrl);
  await expect(boss.page.getByRole("heading", { name: PROJECT })).toBeVisible();
  // Proyek sudah ditutup → baca-saja bagi siapa pun; yang diuji: Direktur melihat tombol kelola pada proyek lain yang masih terbuka
  await boss.page.goto("/training/proyek/baru");
  await boss.page.getByLabel("Nama proyek / kegiatan").fill("Proyek Direktur E2E");
  await choose(boss.page.getByLabel("Project Manager (PIC)"), "Ayu Lestari");
  await boss.page.getByRole("button", { name: "Buat proyek" }).click();
  await boss.page.waitForURL(/\/training\/proyek\/[0-9a-f-]{36}$/);
  await expect(boss.page.getByRole("button", { name: "Ubah data" })).toBeVisible();
  await expect(boss.page.getByRole("button", { name: "Batalkan proyek" })).toBeVisible();
  await boss.ctx.close();
});

test("ponsel: Tugas Saya, daftar proyek, dan kalender dapat dipakai tanpa overflow horizontal halaman; menu memuat grup Training", async ({ browser }) => {
  const { ctx, page } = await as(browser, "budi", { width: 390, height: 844 });
  for (const p of ["/training", "/training/tugas-saya", "/training/proyek", "/training/kalender"]) {
    await page.goto(p);
    await expect(page.getByRole("heading").first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `overflow horizontal di ${p}`).toBeLessThanOrEqual(1);
  }
  await page.getByRole("button", { name: "Buka menu" }).click();
  await expect(page.getByRole("dialog", { name: "Menu" }).getByText("Training & Operations")).toBeVisible();
  await page.getByRole("dialog", { name: "Menu" }).getByRole("button", { name: "Tutup", exact: true }).click(); // tombol X (bukan backdrop "Tutup menu")
  await expect(page.getByRole("dialog", { name: "Menu" })).toHaveCount(0);
  await ctx.close();
});
