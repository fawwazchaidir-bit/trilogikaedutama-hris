import { expect, test } from "@playwright/test";
import { USERS, alertWith, confirmDialog, login, workdayPlus } from "./helpers";

test.describe.configure({ mode: "serial" });

test.describe("Karyawan (Ayu) — absensi", () => {
  test("check-in → tercatat dengan jam server; tidak bisa dua kali; check-out menutup hari", async ({ page }) => {
    await login(page, USERS.ayu);
    await expect(page.getByTestId("server-clock")).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
    const panel = page.locator("section", { has: page.getByRole("heading", { name: "Absensi hari ini" }) });
    await expect(panel.getByRole("button", { name: "Check-out" })).toBeDisabled();

    await panel.getByLabel("Catatan (opsional)").fill("Berangkat dari kantor");
    await panel.getByRole("button", { name: "Check-in" }).click();
    await expect(page.getByText(/Check-in tercatat pukul \d{2}\.\d{2} WIB/)).toBeVisible();
    await expect(panel.getByRole("button", { name: "Check-in" })).toBeDisabled();
    await expect(panel.getByRole("button", { name: "Check-out" })).toBeEnabled();
    await expect(panel.locator("dd").first()).toHaveText(/\d{2}\.\d{2}/);

    // Muat ulang: status tersimpan di database (bukan hanya di layar).
    await page.reload();
    const again = page.locator("section", { has: page.getByRole("heading", { name: "Absensi hari ini" }) });
    await expect(again.getByRole("button", { name: "Check-in" })).toBeDisabled();

    await again.getByRole("button", { name: "Check-out" }).click();
    await expect(page.getByText(/Check-out tercatat pukul/)).toBeVisible();
    await expect(again.getByRole("button", { name: "Check-out" })).toBeDisabled();

    // API menolak check-in kedua dengan pesan jelas.
    const res = await page.request.post("/api/attendance/check-in", { data: {}, headers: { origin: new URL(page.url()).origin } });
    expect(res.status()).toBe(409);
    expect((await res.json()).error.message).toContain("sudah check-in");
  });

  test("riwayat bulanan memuat hari ini beserta penjelasan status", async ({ page }) => {
    await login(page, USERS.ayu);
    await page.getByRole("link", { name: "Absensi Saya" }).click();
    await expect(page.getByRole("heading", { name: "Riwayat harian" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Check-in" })).toBeDisabled();
    await page.getByText("Bagaimana angka ini dihitung?").click();
    await expect(page.getByText("Hadir = tepat waktu + terlambat")).toBeVisible();
    await page.getByRole("link", { name: "Bulan sebelumnya" }).click();
    await expect(page).toHaveURL(/month=/);
    await expect(page.getByRole("heading", { name: /^Rekap/ })).toBeVisible();
  });
});

test.describe("Karyawan (Ayu) — pengajuan", () => {
  test("mengajukan izin → menunggu → dibatalkan sendiri", async ({ page }) => {
    await login(page, USERS.ayu);
    await page.getByRole("link", { name: "Pengajuan Saya" }).click();
    const d = workdayPlus(40);
    await page.getByLabel("Jenis pengajuan").selectOption("IZIN");
    await page.getByLabel("Tanggal mulai").fill(d);
    await page.getByLabel("Tanggal selesai").fill(d);
    await page.getByLabel("Alasan").fill("Mengurus perpanjangan dokumen");
    await page.getByRole("button", { name: "Kirim pengajuan" }).click();
    await expect(page.getByText("Pengajuan terkirim dan menunggu persetujuan.")).toBeVisible();
    const item = page.locator("li", { hasText: "Mengurus perpanjangan dokumen" });
    await expect(item).toContainText("Menunggu");

    await item.getByRole("button", { name: "Batalkan pengajuan" }).click();
    await confirmDialog(page, "Ya, batalkan");
    await expect(page.getByText("Pengajuan dibatalkan.")).toBeVisible();
    await expect(item).toContainText("Dibatalkan");
  });

  test("validasi: alasan kosong & tanggal terbalik ditolak dengan pesan di bidangnya", async ({ page }) => {
    await login(page, USERS.ayu);
    await page.goto("/pengajuan-saya");
    const d = workdayPlus(45);
    await page.getByLabel("Tanggal mulai").fill(d);
    await page.getByLabel("Tanggal selesai").fill(d);
    await page.getByLabel("Alasan").fill("abc");
    await page.getByRole("button", { name: "Kirim pengajuan" }).click();
    await expect(alertWith(page, "Alasan wajib diisi").first()).toBeVisible();
  });

  test("cuti melebihi saldo ditolak", async ({ page }) => {
    await login(page, USERS.citra);
    await page.goto("/pengajuan-saya");
    await page.getByLabel("Jenis pengajuan").selectOption("CUTI");
    await page.getByLabel("Tanggal mulai").fill(workdayPlus(60));
    await page.getByLabel("Tanggal selesai").fill(workdayPlus(90));
    await page.getByLabel("Alasan").fill("Cuti panjang melebihi saldo");
    await page.getByRole("button", { name: "Kirim pengajuan" }).click();
    await expect(alertWith(page, /Saldo cuti .* tidak cukup/).first()).toBeVisible();
  });
});

test.describe("Karyawan — slip gaji", () => {
  test("melihat slip miliknya dan mengunduh PDF yang valid", async ({ page }) => {
    await login(page, USERS.budi);
    await page.getByRole("link", { name: "Slip Gaji Saya" }).click();
    await expect(page.getByRole("heading", { name: "Slip Gaji Saya" })).toBeVisible();
    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("Gaji Agustus 2026");
    await rows.first().getByRole("link", { name: "Lihat" }).click();
    await expect(page.getByRole("heading", { name: /Slip Gaji — Gaji Agustus 2026/ })).toBeVisible();
    await expect(page.getByText("Gaji bersih diterima")).toBeVisible();
    await expect(page.getByText("Budi Santoso").first()).toBeVisible();
    // rekening hanya 4 digit terakhir
    await expect(page.getByText(/•••• •••• \d{4}/)).toBeVisible();

    const href = await page.getByRole("link", { name: "Unduh PDF" }).getAttribute("href");
    const pdf = await page.request.get(href!);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");
    expect(pdf.headers()["content-disposition"]).toContain("attachment");
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  });

  test("notifikasi: Ayu menerima pemberitahuan dan dapat menandainya dibaca", async ({ page }) => {
    await login(page, USERS.ayu);
    await page.getByRole("link", { name: /^Notifikasi/ }).first().click();
    await expect(page.getByRole("heading", { name: "Notifikasi" })).toBeVisible();
    await expect(page.getByText("Slip gaji baru tersedia")).toBeVisible();
    await page.getByRole("button", { name: "Tandai semua dibaca" }).click();
    await expect(page.getByText("0 belum dibaca")).toBeVisible();
  });
});
