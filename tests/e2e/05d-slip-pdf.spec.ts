import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { USERS, demoPayrollMonths, login } from "./helpers";

// Berjalan setelah 04-payroll (slip sudah terbit) dan sebelum 05c-sweep yang mencabut gambar tanda tangan.
// Slip yang diterbitkan 04 sudah DIBATALKAN (dan karyawan tidak melihatnya), jadi diperiksa lewat HR pada periode berstatus Dibatalkan —
// snapshot-nya tetap membekukan penanda tangan yang berlaku saat terbit.
test("slip gaji yang diterbitkan memuat penanda tangan di kanan bawah, kolom CATATAN, satu halaman, gambar tanda tangan tertanam; tampilan layar sama", async ({ page }) => {
  await login(page, USERS.hr);
  const runs = (await (await page.request.get("/api/payroll?all=1")).json()).data as { id: string; label: string; status: string }[];
  const run = runs.find((r) => r.label === demoPayrollMonths().pendingRun && r.status === "CANCELLED")!;
  expect(run, "periode yang diterbitkan lalu dibatalkan oleh 04").toBeTruthy();
  const detail = (await (await page.request.get(`/api/payroll/${run.id}`)).json()).data as { items: { employeeNo: string; payslipId: string | null }[] };
  const slipId = detail.items.find((i) => i.employeeNo === "DEMO-002")!.payslipId!; // Budi Santoso
  expect(slipId).toBeTruthy();

  const res = await page.request.get(`/api/payslips/${slipId}/pdf`);
  expect(res.status()).toBe(200);
  const dir = mkdtempSync(join(tmpdir(), "slip-e2e-"));
  const f = join(dir, "slip.pdf");
  writeFileSync(f, await res.body());
  const info = execFileSync("pdfinfo", [f], { encoding: "utf8" });
  expect(Number(/Pages:\s+(\d+)/.exec(info)![1])).toBe(1);
  const text = execFileSync("pdftotext", ["-layout", f, "-"], { encoding: "utf8" });
  for (const t of ["SLIP GAJI", "CATATAN", "Yogyakarta,", "Chief Executive Officer", "Fawwaz Chaidir, S.Psi.", "GAJI BERSIH DITERIMA", "RINGKASAN KEHADIRAN", "Budi Santoso"]) expect(text, t).toContain(t);
  // tanda tangan di bawah catatan dan di separuh kanan halaman
  const bbox = execFileSync("pdftotext", ["-bbox", f, "-"], { encoding: "utf8" });
  const word = (w: string) => { const m = new RegExp(`<word xMin="([\\d.]+)" yMin="([\\d.]+)" xMax="[\\d.]+" yMax="([\\d.]+)">${w}</word>`).exec(bbox)!; return { x: +m[1]!, y0: +m[2]!, y1: +m[3]! }; };
  expect(word("Fawwaz").x).toBeGreaterThan(595 / 2);
  expect(word("Fawwaz").y0).toBeGreaterThan(word("CATATAN").y1);
  const images = execFileSync("pdfimages", ["-list", f], { encoding: "utf8" }).split("\n").filter((l) => /^\s*\d+\s+\d+\s+image/.test(l)).length;
  expect(images, "logo + gambar tanda tangan").toBeGreaterThanOrEqual(2);

  await page.goto(`/slip/${slipId}`);
  await expect(page.getByLabel("Catatan")).toBeVisible();
  await expect(page.getByLabel("Penanda tangan")).toContainText("Fawwaz Chaidir, S.Psi.");
  await expect(page.getByLabel("Penanda tangan").getByRole("img", { name: /Tanda tangan Fawwaz/ })).toBeVisible();
});
