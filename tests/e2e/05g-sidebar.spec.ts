/**
 * Sidebar: bawaan terbuka; seluruh sidebar dapat disembunyikan; grup menu dapat dilipat (dropdown); pilihan bertahan setelah muat ulang
 * (cookie → tanpa kedip); gulir tanpa scrollbar yang tampak. Tidak bergantung pada data modul Training (memakai grup "Layanan Saya").
 */
import { expect, test, type Page } from "@playwright/test";
import { USERS, login } from "./helpers";

const nav = (page: Page) => page.getByRole("navigation", { name: "Menu utama" });
const groupBtn = (page: Page, name: string) => nav(page).getByRole("button", { name });

test("bawaan: sidebar terbuka dan semua grup terbuka; tombol grup mengumumkan keadaannya", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.budi);
  await expect(nav(page)).toBeVisible();
  await expect(groupBtn(page, "Layanan Saya")).toHaveAttribute("aria-expanded", "true");
  await expect(nav(page).getByRole("link", { name: "Absensi Saya" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Tampilkan menu samping" })).toHaveCount(0);
  await ctx.close();
});

test("grup dapat dilipat sebagai dropdown, bertahan setelah muat ulang, dan terbuka otomatis saat menuju halaman di dalamnya", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.budi);
  await page.goto("/dashboard");
  await groupBtn(page, "Layanan Saya").click();
  await expect(groupBtn(page, "Layanan Saya")).toHaveAttribute("aria-expanded", "false");
  await expect(nav(page).getByRole("link", { name: "Absensi Saya" })).toBeHidden(); // butir di grup yang dilipat tidak dapat difokus/diklik
  await expect(nav(page).getByRole("link", { name: "Dashboard", exact: true })).toBeVisible(); // grup tanpa judul tidak ikut dilipat

  await page.reload(); // cookie dibaca server → langsung dalam keadaan terlipat, tanpa kedip
  await expect(groupBtn(page, "Layanan Saya")).toHaveAttribute("aria-expanded", "false");

  await page.goto("/absensi-saya"); // halaman di dalam grup yang dilipat → grup terbuka agar butir aktif terlihat
  await expect(groupBtn(page, "Layanan Saya")).toHaveAttribute("aria-expanded", "true");
  await expect(nav(page).getByRole("link", { name: "Absensi Saya" })).toHaveAttribute("aria-current", "page");

  await groupBtn(page, "Layanan Saya").click(); // melipat sengaja pada halaman aktif dihormati
  await expect(groupBtn(page, "Layanan Saya")).toHaveAttribute("aria-expanded", "false");
  await groupBtn(page, "Layanan Saya").click();
  await expect(groupBtn(page, "Layanan Saya")).toHaveAttribute("aria-expanded", "true");
  await ctx.close();
});

test("seluruh sidebar dapat disembunyikan dan ditampilkan lagi; pilihan bertahan setelah muat ulang", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  const page = await ctx.newPage();
  await login(page, USERS.budi);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Sembunyikan menu samping" }).click();
  await expect(nav(page)).toBeHidden();
  const widthHidden = await page.locator("main").evaluate((el) => el.getBoundingClientRect().width);
  expect(widthHidden).toBeGreaterThan(1200); // konten memakai lebar penuh

  await page.reload();
  await expect(nav(page)).toBeHidden();
  await expect(page.getByRole("button", { name: "Tampilkan menu samping" })).toBeVisible();

  await page.getByRole("button", { name: "Tampilkan menu samping" }).click();
  await expect(nav(page)).toBeVisible();
  await page.reload();
  await expect(nav(page)).toBeVisible();
  await ctx.close();
});

test("gulir menu tanpa scrollbar yang tampak (tetap dapat digulir) pada layar pendek", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 1360, height: 520 } });
  const page = await ctx.newPage();
  await login(page, USERS.hr);
  await page.goto("/dashboard");
  const info = await nav(page).evaluate((node) => {
    const el = node as HTMLElement;
    const cs = getComputedStyle(el);
    return { scrollbarWidth: cs.scrollbarWidth, overflowY: cs.overflowY, scrollable: el.scrollHeight > el.clientHeight, gutter: el.offsetWidth - el.clientWidth, canScroll: (() => { el.scrollTop = 40; return el.scrollTop > 0; })() };
  });
  expect(info.scrollbarWidth).toBe("none");
  expect(info.overflowY).toBe("auto");
  expect(info.scrollable).toBe(true); // HR memiliki banyak menu → memang perlu gulir
  expect(info.gutter).toBe(0); // tidak ada lajur scrollbar
  expect(info.canScroll).toBe(true);
  await ctx.close();
});

test("ponsel: grup menu pada laci juga dapat dilipat", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await login(page, USERS.budi);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Buka menu" }).click();
  const drawer = page.getByRole("dialog", { name: "Menu" });
  await expect(drawer.getByRole("link", { name: "Absensi Saya" })).toBeVisible();
  await drawer.getByRole("button", { name: "Layanan Saya" }).click();
  await expect(drawer.getByRole("link", { name: "Absensi Saya" })).toBeHidden();
  await expect(drawer.getByRole("button", { name: "Sembunyikan menu samping" })).toBeHidden(); // tombol sembunyikan khusus desktop
  await ctx.close();
});
