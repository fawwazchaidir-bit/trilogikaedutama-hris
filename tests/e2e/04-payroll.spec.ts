import { expect, test } from "@playwright/test";
import { USERS, alertWith, confirmDialog, demoPayrollMonths, login } from "./helpers";

test.describe.configure({ mode: "serial" });

const RUN = demoPayrollMonths().pendingRun;
let runUrl = "";

test.describe("Penggajian — alur persetujuan sampai slip", () => {
  test("HR: tidak dapat menyetujui; Super Admin menyetujui", async ({ page }) => {
    await login(page, USERS.hr);
    await page.getByRole("link", { name: "Penggajian", exact: true }).click();
    await expect(page.getByText("Perlu disesuaikan dengan kebijakan perusahaan dan ketentuan yang berlaku.").first()).toBeVisible();
    await page.getByRole("link", { name: RUN }).click();
    await page.waitForURL(/\/penggajian\/[0-9a-f-]{36}$/);
    runUrl = page.url();
    await expect(page.getByText("Menunggu persetujuan").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Setujui" })).toHaveCount(0);
    expect((await page.request.post(`${runUrl.replace(/\/penggajian\//, "/api/payroll/")}/approve`, { data: {}, headers: { origin: new URL(page.url()).origin } })).status()).toBe(403);

    // rincian dapat diperiksa: komponen, rumus, dan sumber absensi
    await page.getByRole("link", { name: "Ayu Lestari" }).click();
    await expect(page.getByRole("heading", { name: "Ayu Lestari" })).toBeVisible();
    await expect(page.getByText("Gaji pokok").first()).toBeVisible();
    await expect(page.getByText(/hari hadir × Rp 15\.000/)).toBeVisible();
    await expect(page.getByText("Sumber data absensi")).toBeVisible();
    await expect(page.getByText("= pendapatan − potongan")).toBeVisible();
    await expect(page.getByRole("button", { name: "Tambahkan" })).toHaveCount(0); // terkunci di luar Draf
  });

  test("Super Admin menyetujui", async ({ page }) => {
    await login(page, USERS.pimpinan);
    await page.goto(runUrl);
    await page.getByRole("button", { name: "Setujui" }).click();
    await page.getByRole("dialog").getByLabel(/Catatan persetujuan/).fill("Sesuai rekap");
    await confirmDialog(page, "Setujui");
    await expect(page.getByText("Penggajian disetujui.")).toBeVisible();
    await expect(page.getByText("Disetujui", { exact: true }).first()).toBeVisible();
    await expect(page.getByText(/oleh Rudi Hartono/).first()).toBeVisible();
  });

  test("HR menerbitkan slip → karyawan melihat & mengunduh; unduh massal PDF/ZIP", async ({ page, browser }) => {
    await login(page, USERS.hr);
    await page.goto(runUrl);
    await page.getByRole("button", { name: "Terbitkan slip" }).click();
    await confirmDialog(page, "Terbitkan");
    await expect(page.getByText("Slip gaji diterbitkan.")).toBeVisible();
    await expect(page.getByText("Diterbitkan", { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /^SG-\d{6}-R02-001$/ })).toBeVisible();

    const all = page.getByRole("link", { name: /Semua slip \(1 PDF\)/ });
    const pdf = await page.request.get((await all.getAttribute("href"))!);
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
    const zip = await page.request.get((await page.getByRole("link", { name: /ZIP per karyawan/ }).getAttribute("href"))!);
    expect(zip.headers()["content-type"]).toBe("application/zip");
    expect((await zip.body()).subarray(0, 2).toString()).toBe("PK");

    const ctx = await browser.newContext();
    const bp = await ctx.newPage();
    await login(bp, USERS.budi);
    await bp.getByRole("link", { name: "Slip Gaji Saya" }).click();
    await expect(bp.locator("tbody tr")).toHaveCount(2);
    await expect(bp.locator("tbody tr").first()).toContainText(RUN);
    // Karyawan tidak dapat memakai unduh massal
    expect((await bp.request.get((await all.getAttribute("href"))!)).status()).toBe(403);
    await ctx.close();
  });

  test("slip terbit terkunci: tidak ada tombol ubah; API menolak penyesuaian & hitung ulang", async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto(runUrl);
    await expect(page.getByRole("button", { name: "Hitung ulang" })).toHaveCount(0);
    const itemHref = await page.getByRole("link", { name: "Ayu Lestari" }).getAttribute("href");
    const itemId = itemHref!.split("/").pop();
    const origin = new URL(page.url()).origin;
    const adj = await page.request.post(`/api/payroll/items/${itemId}/adjustments`, { data: { kind: "EARNING", name: "Curang", amount: 1_000_000, reason: "Mencoba mengubah slip terbit" }, headers: { origin } });
    expect(adj.status()).toBe(409);
    const recalc = await page.request.post(`${runUrl.replace(/\/penggajian\//, "/api/payroll/")}/calculate`, { data: {}, headers: { origin } });
    expect(recalc.status()).toBe(409);
    // HR juga tidak dapat membatalkan periode terbit
    const cancel = await page.request.post(`${runUrl.replace(/\/penggajian\//, "/api/payroll/")}/cancel`, { data: { reason: "Coba batalkan sendiri" }, headers: { origin } });
    expect(cancel.status()).toBe(403);
  });

  test("Super Admin membatalkan penerbitan (alasan wajib) → slip hilang dari karyawan → HR membuat revisi", async ({ page, browser }) => {
    await login(page, USERS.pimpinan);
    await page.goto(runUrl);
    await page.getByRole("button", { name: "Batalkan penerbitan" }).click();
    await confirmDialog(page, "Batalkan");
    await expect(alertWith(page.getByRole("dialog")).first()).toBeVisible();
    await page.getByRole("dialog").getByLabel(/Alasan pembatalan/).fill("Tunjangan transport salah hitung");
    await confirmDialog(page, "Batalkan");
    await expect(page.getByText("Dibatalkan.")).toBeVisible();
    await expect(page.getByText(/Alasan: Tunjangan transport salah hitung/)).toBeVisible();

    const ctx = await browser.newContext();
    const bp = await ctx.newPage();
    await login(bp, USERS.budi);
    await bp.goto("/slip-saya");
    await expect(bp.locator("tbody tr")).toHaveCount(1);
    await expect(bp.locator("tbody tr").first()).toContainText(demoPayrollMonths().issuedRun);
    await ctx.close();

    const hr = await browser.newContext();
    const hp = await hr.newPage();
    await login(hp, USERS.hr);
    await hp.goto(runUrl);
    await hp.getByRole("button", { name: "Buat revisi" }).click();
    await confirmDialog(hp, "Buat revisi");
    await expect(hp.getByText("Revisi dibuat.")).toBeVisible();
    await expect(hp.getByRole("heading", { name: /\(Revisi\)/ })).toBeVisible();
    await expect(hp.getByText("Revisi dari periode")).toBeVisible();
    await expect(hp.getByText("Draf", { exact: true }).first()).toBeVisible();
    await expect(hp.getByRole("button", { name: "Hitung ulang" })).toBeVisible();
    await hr.close();
  });

  test("audit log mencatat seluruh alur penggajian", async ({ page }) => {
    await login(page, USERS.pimpinan);
    await page.goto("/audit-log?action=payroll.");
    for (const a of ["payroll.revision", "payroll.revoke", "payroll.issue", "payroll.approve", "payroll.submit"]) await expect(page.getByText(a, { exact: true }).first()).toBeVisible();
    await page.goto("/audit-log?action=attendance.");
    await expect(page.getByText("attendance.correct", { exact: true }).first()).toBeVisible();
  });
});
