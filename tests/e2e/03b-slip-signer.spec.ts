import { expect, test } from "@playwright/test";
import { USERS, login } from "./helpers";

// Berjalan setelah 03-hr-admin dan SEBELUM 04-payroll: penanda tangan diatur dulu agar slip yang diterbitkan 04 memuatnya (diperiksa di 05d).
test.describe.configure({ mode: "serial" });

// PNG 1×1 transparan → terlalu kecil (ditolak); PNG tanda tangan 240×90 dibuat di bawah.
async function signaturePng(page: import("@playwright/test").Page): Promise<Buffer> {
  const b64 = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 240; c.height = 90;
    const g = c.getContext("2d")!; g.strokeStyle = "#1a2b6b"; g.lineWidth = 4; g.beginPath(); g.moveTo(10, 70); g.bezierCurveTo(40, 0, 80, 100, 120, 40); g.bezierCurveTo(150, 0, 190, 90, 230, 30); g.stroke();
    return c.toDataURL("image/png").split(",")[1]!;
  });
  return Buffer.from(b64, "base64");
}

test("HR hanya melihat pengaturan penanda tangan (tidak dapat mengubah/mengunggah)", async ({ page }) => {
  await login(page, USERS.hr);
  await page.goto("/pengaturan");
  const form = page.getByRole("form", { name: "Form profil lembaga" });
  await expect(form.getByLabel("Nama penanda tangan")).toBeDisabled();
  await expect(page.locator("#signature-file")).toHaveCount(0);
  const origin = new URL(page.url()).origin;
  expect((await page.request.post("/api/settings/signature", { multipart: { file: { name: "t.png", mimeType: "image/png", buffer: Buffer.from("x") } }, headers: { origin } })).status()).toBe(403);
  expect((await page.request.delete("/api/settings/signature", { headers: { origin } })).status()).toBe(403);
});

test("Super Admin mengatur penanda tangan (nama, jabatan, kota) dan mengunggah gambar tanda tangan; gambar rusak ditolak", async ({ page }) => {
  await login(page, USERS.pimpinan);
  await page.goto("/pengaturan");
  const form = page.getByRole("form", { name: "Form profil lembaga" });
  await form.getByLabel("Nama penanda tangan").fill("Fawwaz Chaidir, S.Psi.");
  await form.getByLabel("Jabatan", { exact: true }).fill("Chief Executive Officer");
  await form.getByLabel("Kota (opsional)").fill("Yogyakarta");
  await form.getByRole("button", { name: "Simpan", exact: true }).click();
  await expect(page.getByText("Profil lembaga disimpan.")).toBeVisible();

  await page.reload();
  await expect(form.getByLabel("Nama penanda tangan")).toHaveValue("Fawwaz Chaidir, S.Psi.");
  await expect(form.getByLabel("Jabatan", { exact: true })).toHaveValue("Chief Executive Officer");
  await expect(form.getByLabel("Kota (opsional)")).toHaveValue("Yogyakarta");

  await expect(page.getByText("Belum ada gambar")).toBeVisible();
  await page.locator("#signature-file").setInputFiles({ name: "bukan.png", mimeType: "image/png", buffer: Buffer.from("ini bukan gambar") });
  await expect(page.getByRole("alert").filter({ hasText: /tidak dapat dibaca|tidak valid|Gunakan gambar/ }).first()).toBeVisible();

  await page.locator("#signature-file").setInputFiles({ name: "tanda-tangan.png", mimeType: "image/png", buffer: await signaturePng(page) });
  await expect(page.getByText("Gambar tanda tangan diperbarui.")).toBeVisible();
  await expect(page.getByRole("img", { name: /Tanda tangan Fawwaz Chaidir/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cabut gambar" })).toBeVisible();
});
