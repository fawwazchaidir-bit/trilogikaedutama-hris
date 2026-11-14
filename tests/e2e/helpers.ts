import { expect, type Page } from "@playwright/test";
import { monthLabel } from "../../src/lib/format";

export const E2E_PASSWORD = "Demo-E2E-Uji-2026!";
export const USERS = {
  pimpinan: "pimpinan@demo.hris.test",
  hr: "hr@demo.hris.test",
  ayu: "ayu@demo.hris.test",
  budi: "budi@demo.hris.test",
  citra: "citra@demo.hris.test",
} as const;

/**
 * Buka halaman masuk dengan tahan-banting. Setelah keluar, aplikasi memanggil router.push("/login") lalu router.refresh(); bila tes langsung memanggil page.goto("/login")
 * selagi navigasi/refresh itu masih berjalan, Playwright dapat gagal dengan "Navigation to /login is interrupted by another navigation" (terlihat sebagai tes kode pemulihan 2FA
 * yang gagal di CI sementara lima tes sesudahnya terlewati). Navigasi yang disela diulang; lalu tunggu formulir masuk benar-benar siap.
 */
export async function gotoLogin(page: Page) {
  for (let attempt = 0; ; attempt++) {
    // Tunggu "load" (bawaan), BUKAN "domcontentloaded": mengisi formulir sebelum hidrasi React selesai membuat tombol Masuk mengirim formulir bawaan peramban (GET /login?…), bukan login.
    try { await page.goto("/login"); break; }
    catch (e) {
      if (attempt >= 3 || !/interrupted by another navigation|ERR_ABORTED|frame was detached/i.test(String(e))) throw e;
      await page.waitForLoadState("domcontentloaded").catch(() => undefined);
    }
  }
  await page.getByRole("button", { name: "Masuk" }).waitFor();
}

export async function login(page: Page, email: string, password = E2E_PASSWORD) {
  await gotoLogin(page);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

export async function logout(page: Page) {
  // Keluar ada di menu pengguna (pojok kanan atas): buka dulu menunya.
  await page.getByRole("button", { name: "Menu pengguna" }).filter({ visible: true }).first().click();
  await page.getByRole("menuitem", { name: "Keluar" }).click();
  await page.waitForURL(/\/login/);
  // router.push + router.refresh() setelah keluar masih berjalan: tunggu formulir masuk siap dan jaringan tenang agar navigasi berikutnya tidak menyelanya.
  await page.getByRole("button", { name: "Masuk" }).waitFor();
  await page.waitForLoadState("networkidle").catch(() => undefined);
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

/**
 * Periode gaji pada data demo/dev (prisma/seed-demo.ts): bulan LALU = periode berjalan yang belum disetujui, dua bulan lalu = sudah
 * terbit. Dihitung dari tanggal hari ini (WIB) — JANGAN menulis nama bulan secara tetap pada tes (berganti tiap pergantian bulan).
 */
export function demoPayrollMonths() {
  const [y, m] = isoDatePlus(0).split("-").map(Number) as [number, number];
  const ym = (back: number) => { const t = y * 12 + (m - 1) - back; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
  const pending = ym(1), issued = ym(2);
  return { pending, issued, pendingRun: `Gaji ${monthLabel(pending)}`, issuedRun: `Gaji ${monthLabel(issued)}` };
}

/** Tautan di sidebar. Beranda juga memuat tile menu bernama sama, jadi tautan menu dicari di dalam navigasi utama. */
export const menuLink = (page: Page, name: string | RegExp) => page.getByRole("navigation", { name: "Menu utama" }).getByRole("link", { name });

/**
 * Terbitkan Surat Tugas lewat Persuratan (INT-002) untuk kebutuhan E2E: HR membuat + mengisi data penugasan + mengajukan, Direktur menyetujui.
 * Mengembalikan id surat tugas (AssignmentLetter), nomor master, dan id dokumen Persuratan.
 */
export async function issueAssignmentViaLetters(
  hr: import("@playwright/test").APIRequestContext, director: import("@playwright/test").APIRequestContext, base: string,
  assignment: { purpose: string; destination: string; startDate: string; endDate: string; assignees: { employeeId: string; dailyRate: number }[]; details?: string | null },
): Promise<{ id: string; number: string; letterId: string }> {
  const h = { origin: base };
  const types = (await (await hr.get("/api/letters/types")).json()).data as { id: string; kind: string }[];
  const typeId = types.find((t) => t.kind === "TUGAS")!.id;
  const created = await hr.post("/api/letters", { data: { typeId }, headers: h });
  if (created.status() !== 201) throw new Error(`buat surat tugas: ${created.status()} ${await created.text()}`);
  const letterId = (await created.json()).data.id as string;
  const signers = (await (await hr.get(`/api/letters/signers?typeId=${typeId}`)).json()).data as { userId: string }[];
  const patch = await hr.patch(`/api/letters/${letterId}`, { data: { assignment: { details: null, ...assignment }, signerId: signers[0]!.userId }, headers: h });
  if (patch.status() !== 200) throw new Error(`isi penugasan: ${patch.status()} ${await patch.text()}`);
  const sub = await hr.post(`/api/letters/${letterId}/submit`, { headers: h });
  if (sub.status() !== 200) throw new Error(`ajukan: ${sub.status()} ${await sub.text()}`);
  const ok = await director.post(`/api/letters/${letterId}/approve`, { headers: h });
  if (ok.status() !== 200) throw new Error(`setujui: ${ok.status()} ${await ok.text()}`);
  const d = (await ok.json()).data as { number: string; assignmentId: string };
  return { id: d.assignmentId, number: d.number, letterId };
}
