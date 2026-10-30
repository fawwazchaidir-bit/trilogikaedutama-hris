import { expect, type Page } from "@playwright/test";

export const E2E_PASSWORD = "Demo-E2E-Uji-2026!";
export const USERS = {
  pimpinan: "pimpinan@demo.hris.test",
  hr: "hr@demo.hris.test",
  ayu: "ayu@demo.hris.test",
  budi: "budi@demo.hris.test",
  citra: "citra@demo.hris.test",
} as const;

export async function login(page: Page, email: string, password = E2E_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

export async function logout(page: Page) {
  await page.getByRole("button", { name: "Keluar" }).first().click();
  await page.waitForURL(/\/login/);
}

/** Elemen role="alert" yang berisi teks (pengumuman rute milik Next juga ber-role alert tetapi kosong). */
export function alertWith(scope: Page | import("@playwright/test").Locator, text: string | RegExp = /\S/) {
  return scope.getByRole("alert").filter({ hasText: text });
}

/** Konfirmasi di dalam dialog modal (tombol aksi bernama sama dengan pemicunya). */
export async function confirmDialog(page: Page, name: string | RegExp) {
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  await dlg.getByRole("button", { name }).click();
}

export function isoDatePlus(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const wib = new Date(d.getTime() + 7 * 3_600_000);
  return wib.toISOString().slice(0, 10);
}

/** Tanggal hari kerja (Sen–Jum) terdekat setelah `days` hari. */
export function workdayPlus(days: number): string {
  for (let i = days; ; i++) {
    const iso = isoDatePlus(i);
    const wd = new Date(`${iso}T00:00:00Z`).getUTCDay();
    if (wd >= 1 && wd <= 5) return iso;
  }
}
