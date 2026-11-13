/**
 * Training & Operations — BENTROK JADWAL di browser: ruangan dicek menurut LOKASI + RUANGAN + waktu ("Ruang Jasmine" di dua hotel berbeda bukan bentrok),
 * lokasi yang belum jelas ditandai "perlu diperiksa" (bukan dianggap aman) dan bisa diselesaikan dengan melengkapi lokasi lewat dialog Ubah.
 * Dijalankan setelah 05w dan sebelum 06-stage2 (2FA admin). Data disiapkan lewat API.
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

const DAY = isoDatePlus(45);
const A = "Bentrok Lokasi A E2E";
const B = "Bentrok Lokasi B E2E";
const S_ASTON = "Kelas Aston Magelang E2E";
const S_SANTIKA = "Kelas Santika E2E";
const S_ASTON2 = "Kelas Aston Dua E2E";
const S_NOLOC = "Kelas Tanpa Lokasi E2E";
let idA = "", idB = "";

test.describe.configure({ mode: "serial" });

/** Baris jadwal menurut JUDULNYA sendiri ("· Judul"); kalimat peringatan menyebut judul lawan dalam tanda kutip sehingga tidak ikut cocok. */
const row = (page: Page, title: string) => page.getByRole("listitem").filter({ hasText: new RegExp(`· ${title}(?!")`) });

test("persiapan: dua proyek; 'Ruang Jasmine' di Hotel Aston (proyek A) dan di Hotel Santika (proyek B) pada jam yang beririsan TIDAK dianggap bentrok", async ({ browser }) => {
  const { ctx, page } = await as(browser, "ayu");
  const mk = async (name: string) => (await call(page, "post", "/api/training/projects", { name, kind: "REGULAR", startDate: DAY, endDate: DAY, participantsMin: 20 })).id as string;
  idA = await mk(A); idB = await mk(B);
  const sched = (id: string, body: Record<string, unknown>) => call(page, "post", `/api/training/projects/${id}/schedules`, { date: DAY, ...body });
  const a = await sched(idA, { title: S_ASTON, startTime: "09:00", endTime: "17:00", room: "Ruang Jasmine", location: "Hotel Aston Magelang" });
  expect(a.warnings).toEqual([]);
  const b1 = await sched(idB, { title: S_SANTIKA, startTime: "09:00", endTime: "10:00", room: "ruang jasmine", location: "Hotel Santika Yogyakarta" });
  expect(b1.warnings).toEqual([]);                                                      // ruang sama, hotel berbeda → bukan bentrok
  await page.goto(`/training/proyek/${idB}?tab=jadwal`);
  await expect(row(page, S_SANTIKA)).toBeVisible();
  await expect(row(page, S_SANTIKA).getByRole("status")).toHaveCount(0);
  await ctx.close();
});

test("ruangan + lokasi yang sama pada jam beririsan = bentrok pasti; muncul di tab Jadwal kedua proyek dan di Kalender", async ({ browser }) => {
  const { ctx, page } = await as(browser, "ayu");
  const r = await call(page, "post", `/api/training/projects/${idB}/schedules`, { title: S_ASTON2, date: DAY, startTime: "10:00", endTime: "11:00", room: "RUANG JASMINE", location: "aston hotel, magelang" });
  expect(r.warnings).toHaveLength(1);
  expect(r.warnings[0]).toContain("Ruangan yang sama (lokasi sama)");

  await page.goto(`/training/proyek/${idB}?tab=jadwal`);
  const conflict = row(page, S_ASTON2).getByTestId("conflict-ROOM");
  await expect(conflict).toContainText("Ruangan yang sama (lokasi sama) dipakai");
  await expect(conflict).toContainText(S_ASTON);
  await expect(row(page, S_SANTIKA).getByRole("status")).toHaveCount(0);

  await page.goto(`/training/proyek/${idA}?tab=jadwal`);                              // dua arah
  await expect(row(page, S_ASTON).getByTestId("conflict-ROOM")).toContainText(S_ASTON2);

  await page.goto(`/training/kalender?bulan=${DAY.slice(0, 7)}`);
  await expect(row(page, S_ASTON2).getByTestId("conflict-ROOM")).toContainText("Ruangan yang sama (lokasi sama)");
  await ctx.close();
});

test("lokasi belum jelas = 'perlu diperiksa' (bukan dianggap aman); dilengkapi lewat dialog Ubah → peringatan hilang", async ({ browser }) => {
  const { ctx, page } = await as(browser, "ayu");
  const r = await call(page, "post", `/api/training/projects/${idB}/schedules`, { title: S_NOLOC, date: DAY, startTime: "11:00", endTime: "12:00", room: "Ruang Jasmine" });
  expect(r.warnings).toHaveLength(1);
  expect(r.warnings[0]).toMatch(/Bentrok ruangan perlu diperiksa:.*lokasinya belum jelas/);

  await page.goto(`/training/proyek/${idB}?tab=jadwal`);
  const check = row(page, S_NOLOC).getByTestId("conflict-ROOM_CHECK");
  await expect(check).toContainText("Bentrok ruangan perlu diperiksa");
  await expect(check).toContainText("lokasinya belum jelas");
  await expect(check).toContainText(S_ASTON);
  await expect(row(page, S_NOLOC).getByTestId("conflict-ROOM")).toHaveCount(0);       // bukan klaim bentrok pasti

  await row(page, S_NOLOC).getByRole("button", { name: "Ubah" }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByText(/Bentrok ruangan dicek menurut Lokasi \+ Ruangan \+ waktu/)).toBeVisible();
  await dlg.getByLabel("Lokasi / media").fill("Hotel Santika Yogyakarta");
  await dlg.getByRole("button", { name: "Simpan" }).click();
  await expect(page.getByText("Jadwal disimpan.").last()).toBeVisible();
  await expect(row(page, S_NOLOC).getByRole("status")).toHaveCount(0);               // lokasi jelas berbeda dari proyek A → tidak bentrok
  await ctx.close();
});
