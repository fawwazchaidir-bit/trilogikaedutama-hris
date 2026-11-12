/**
 * Training & Operations — PENANDA TUGAS OPERASIONAL pada peta beban tim, di browser: tugas terbuka / terlambat / menunggu pemeriksaan ditampilkan terpisah dari
 * beban jam standar, "Perlu dicek" muncul bila beban jam masih longgar tetapi tugas terbuka banyak, dan keterangan definisinya tertulis.
 * Dijalankan setelah 05h (pemegang jabatan) dan 05u (tindak lanjut) dan sebelum 06-stage2 (2FA admin). Data disiapkan lewat API.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { USERS, isoDatePlus, login } from "./helpers";

async function as(browser: Browser, who: keyof typeof USERS, vp = { width: 1360, height: 900 }) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  await login(page, USERS[who]);
  return { ctx, page };
}
const call = async (page: Page, method: "post" | "get", url: string, data?: unknown) => {
  const res = await page.request[method](url, { ...(data === undefined ? {} : { data }), headers: { origin: new URL(page.url()).origin } });
  expect(res.ok(), `${method.toUpperCase()} ${url} → ${res.status()} ${await res.text()}`).toBe(true);
  return ((await res.json()) as { data: any }).data; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const num = async (loc: import("@playwright/test").Locator, re: RegExp) => Number(re.exec((await loc.textContent()) ?? "")?.[1] ?? NaN);

let budiId = "";
let projectId = "";
let before = { open: 0, overdue: 0 };

test.describe.configure({ mode: "serial" });

test("legenda peta beban: jam standar = estimasi (bukan catatan waktu aktual), tugas = saat ini, penanda hanya meminta diperiksa", async ({ browser }) => {
  const { ctx, page } = await as(browser, "ayu");
  await page.goto("/training/pemantauan?tab=tim");
  const legend = page.getByTestId("heatmap-legend");
  await expect(legend).toContainText("estimasi berdasarkan template dan penyesuaian");
  await expect(legend).toContainText("bukan catatan waktu kerja aktual");
  await expect(legend).toContainText("tidak dijumlahkan dengan jumlah tugas");
  await expect(legend).toContainText("seluruh tugas terbuka saat ini");
  await expect(legend).toContainText("terlambat adalah bagian dari tugas terbuka");
  await expect(legend).toContainText("≥ 5 tugas terbuka atau ≥ 1 tugas terlambat");
  await expect(legend).toContainText("bukan penilaian kinerja");
  await expect(page.getByRole("columnheader", { name: "Tugas operasional (saat ini)" })).toBeVisible();
  await ctx.close();
});

test("persiapan: Budi menerima 5 tugas terbuka (1 terlambat) di proyek baru; angka bertambah tepat 5 dan 1", async ({ browser }) => {
  const { ctx, page } = await as(browser, "ayu");
  const dir = (await call(page, "get", "/api/training/directory")) as { id: string; fullName: string }[];
  budiId = dir.find((d) => d.fullName.includes("Budi"))!.id;
  const read = async () => {
    await page.goto("/training/pemantauan?tab=tim");
    const row = page.getByTestId(`operational-${budiId}`);
    if ((await row.count()) === 0) return { open: 0, overdue: 0 };
    return { open: await num(row, /(\d+)\s*terbuka/), overdue: await num(row, /(\d+)\s*terlambat/) };
  };
  before = await read();
  const created = await call(page, "post", "/api/training/projects", { name: "Penanda Operasional E2E", kind: "REGULAR", startDate: isoDatePlus(60), endDate: isoDatePlus(61) });
  projectId = created.id;
  await call(page, "post", `/api/training/projects/${projectId}/members`, { employeeId: budiId, role: "STAFF" });
  for (let i = 1; i <= 5; i++) await call(page, "post", `/api/training/projects/${projectId}/tasks`, { title: `Tugas operasional ${i}`, assigneeId: budiId, dueDate: i === 1 ? isoDatePlus(-1) : isoDatePlus(10 + i) });
  const after = await read();
  expect(after.open).toBe(before.open + 5);
  expect(after.overdue).toBe(before.overdue + 1);
  await ctx.close();
});

test("peta beban: baris Budi menampilkan terbuka / terlambat (dari terbuka) / menunggu pemeriksaan, dan 'Perlu dicek' karena beban jam masih longgar", async ({ browser }) => {
  const { ctx, page } = await as(browser, "ayu");
  await page.goto("/training/pemantauan?tab=tim");
  const row = page.getByRole("row").filter({ hasText: "Budi Santoso" });
  await expect(row.getByTestId(`operational-${budiId}`)).toContainText(`${before.open + 5} terbuka`);
  await expect(row.getByTestId(`operational-${budiId}`)).toContainText(`${before.overdue + 1} terlambat`);
  await expect(row.getByTestId(`operational-${budiId}`)).toContainText("menunggu pemeriksaan");
  await expect(row.getByText("Perlu dicek")).toBeVisible();
  await expect(row.getByText(/Beban jam standar minggu ini masih longgar, tetapi ada \d+ tugas terbuka \(batas 5\)/)).toBeVisible();
  await ctx.close();
});

test("anggota biasa (Budi) melihat barisnya sendiri dengan penanda yang sama; dasbor tim memuat kolom 'Menunggu pemeriksaan (dari terbuka)'", async ({ browser }) => {
  const b = await as(browser, "budi");
  await b.page.goto("/training/pemantauan?tab=tim");
  await expect(b.page.getByText("Anda melihat beban Anda sendiri")).toBeVisible();
  await expect(b.page.getByTestId(`operational-${budiId}`)).toContainText(`${before.open + 5} terbuka`);
  await expect(b.page.getByRole("row").filter({ hasText: "Budi Santoso" }).getByText("Perlu dicek")).toBeVisible();
  await b.ctx.close();

  const a = await as(browser, "ayu");
  await a.page.goto("/training");
  await expect(a.page.getByRole("columnheader", { name: "Menunggu pemeriksaan (dari terbuka)" })).toBeVisible();
  await expect(a.page.getByRole("columnheader", { name: "Terlambat (dari terbuka)" })).toBeVisible();
  await a.ctx.close();
});
