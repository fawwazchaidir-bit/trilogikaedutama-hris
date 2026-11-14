/**
 * Training & Operations — JAM KERJA (indikator Beban Tim) tanpa hitung ganda, di browser: hitung ulang idempoten, baris disesuaikan/selesai dipertahankan,
 * "Kembalikan ke template" dengan pratinjau, dan merapikan baris kembar warisan bug (disimulasikan langsung di basis data uji).
 * Dijalankan setelah 05h (pemegang jabatan sudah diisi Direktur) dan sebelum 06-stage2 (2FA admin).
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { PrismaClient } from "@prisma/client";
import { USERS, isoDatePlus, login } from "./helpers";

async function as(browser: Browser, who: keyof typeof USERS, vp = { width: 1360, height: 900 }) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  await login(page, USERS[who]);
  return { ctx, page };
}
const call = async (page: Page, method: "post" | "get" | "patch", url: string, data?: unknown) => {
  const res = await page.request[method](url, { ...(data === undefined ? {} : { data }), headers: { origin: new URL(page.url()).origin } });
  expect(res.ok(), `${method.toUpperCase()} ${url} → ${res.status()} ${await res.text()}`).toBe(true);
  return ((await res.json()) as { data: any }).data; // eslint-disable-line @typescript-eslint/no-explicit-any
};

const PROJECT = "Jam Kerja E2E Magelang";
let projectId = "";
let tab = "";
type Row = { id: string; name: string; hours: number; status: string; adjusted: boolean; templateKey: string | null; source: string };

test.describe.configure({ mode: "serial" });

test("persiapan: Ayu membuat program (template terpasang otomatis); baris jam kerja punya ID asal template", async ({ browser }) => {
  const { ctx, page } = await as(browser, "ayu");
  const created = await call(page, "post", "/api/training/projects", { name: PROJECT, kind: "REGULAR", startDate: isoDatePlus(40), endDate: isoDatePlus(42), participantsMin: 20 });
  projectId = created.id;
  tab = `/training/proyek/${projectId}?tab=pemantauan`;
  const rows = (await call(page, "get", `/api/training/projects/${projectId}/workload`)) as Row[];
  expect(rows.length).toBeGreaterThanOrEqual(2);
  expect(rows.every((r) => r.templateKey && r.source === "TEMPLATE" && !r.adjusted)).toBe(true);
  await ctx.close();
});

test("hitung ulang berulang kali tidak menambah baris; baris yang ditandai Selesai tetap Selesai dan tidak digandakan", async ({ browser }) => {
  const { ctx, page } = await as(browser, "ayu");
  await page.goto(tab);
  const rows = page.getByTestId("workload-row");
  const n = await rows.count();
  expect(n).toBeGreaterThanOrEqual(2);
  const first = rows.first();
  const name = (await first.locator("td").nth(1).textContent())!.trim();
  await first.getByLabel(`Status ${name}`).selectOption("DONE");
  await expect(page.getByTestId("workload-row").filter({ hasText: name }).getByLabel(`Status ${name}`)).toHaveValue("DONE");
  for (let i = 0; i < 2; i++) {
    await page.getByRole("button", { name: "Hitung ulang dari template" }).click();
    await expect(page.getByText("Jam kerja dari template dihitung ulang.").last()).toBeVisible();
    await expect(page.getByTestId("recalc-result")).toContainText("0 baru, 0 diperbarui, 0 dihapus");
    await expect(page.getByTestId("workload-row")).toHaveCount(n);
  }
  await expect(page.getByTestId("workload-row").filter({ hasText: name })).toHaveCount(1);
  await expect(page.getByTestId("workload-row").filter({ hasText: name }).getByLabel(`Status ${name}`)).toHaveValue("DONE");
  await ctx.close();
});

test("baris disesuaikan: dipertahankan saat dihitung ulang (peringatan), lalu 'Kembalikan ke template' menampilkan pratinjau dan memulihkannya", async ({ browser }) => {
  const { ctx, page } = await as(browser, "ayu");
  await page.goto(tab);
  const rows = (await call(page, "get", `/api/training/projects/${projectId}/workload`)) as Row[];
  const target = rows.find((r) => r.status === "OPEN")!;
  await call(page, "patch", `/api/training/workload/${target.id}`, { hours: target.hours + 3 });
  await page.reload();
  const row = page.getByTestId("workload-row").filter({ hasText: target.name });
  await expect(row.getByText("Disesuaikan")).toBeVisible();

  await page.getByRole("button", { name: "Hitung ulang dari template" }).click();
  await expect(page.getByTestId("recalc-result")).toContainText("0 baru, 0 diperbarui, 0 dihapus");
  await expect(page.getByText(/sudah disesuaikan manual sehingga TIDAK ikut berubah/)).toBeVisible();
  await expect(page.getByTestId("workload-row")).toHaveCount(rows.length);
  await expect(row.getByText(String(target.hours + 3), { exact: true })).toBeVisible();

  await row.getByRole("button", { name: `Kembalikan ${target.name} ke template` }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByTestId("revert-changes")).toContainText("Jam");
  await expect(dlg.getByTestId("revert-changes")).toContainText(String(target.hours + 3));
  await dlg.getByRole("button", { name: "Kembalikan ke template" }).click();
  await expect(page.getByText("Baris dikembalikan ke template.").last()).toBeVisible();
  await expect(page.getByTestId("workload-row").filter({ hasText: target.name }).getByText("Disesuaikan")).toHaveCount(0);

  // tidak ada lagi baris yang disesuaikan → tidak ada tombol "Kembalikan ke template" (baris Selesai pun tidak pernah ditawari)
  await expect(page.getByRole("button", { name: /^Kembalikan .* ke template$/ })).toHaveCount(0);
  await ctx.close();
});

const shiftDay = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

test("dialog 'Ubah jam & tanggal': validasi di layar, asal Template tetap, ditandai Disesuaikan, nilai template jadi rujukan, baris Selesai tidak dibuka kembali, riwayat memuat tanggal lama & baru", async ({ browser }) => {
  type R2 = Row & { startDate: string; endDate: string };
  const { ctx, page } = await as(browser, "ayu");
  await page.goto(tab);
  const rows = (await call(page, "get", `/api/training/projects/${projectId}/workload`)) as R2[];
  const target = rows.find((r) => r.status === "OPEN" && r.source === "TEMPLATE" && !r.adjusted)!;
  expect(target, "perlu satu baris template terbuka yang belum disesuaikan").toBeTruthy();
  const row = () => page.getByTestId("workload-row").filter({ hasText: target.name });
  await row().getByRole("button", { name: `Ubah jam dan tanggal ${target.name}` }).click();
  const dlg = page.getByRole("dialog");
  const save = dlg.getByRole("button", { name: "Simpan" });
  await expect(dlg.getByText("Template", { exact: true })).toBeVisible();
  await expect(dlg.getByTestId("workload-template-values")).toContainText(`${target.hours} jam`);
  await expect(save).toBeDisabled();                                                  // belum ada perubahan
  // validasi jam dan tanggal
  await dlg.getByLabel("Jam total").fill("0");
  await expect(dlg.getByText(/lebih dari 0/)).toBeVisible();
  await expect(save).toBeDisabled();
  await dlg.getByLabel("Jam total").fill(String(target.hours + 2));
  await dlg.getByLabel(/^Selesai\b/).fill(shiftDay(target.startDate, -1));
  await expect(dlg.getByText("Tanggal selesai tidak boleh sebelum tanggal mulai")).toBeVisible();
  await expect(save).toBeDisabled();
  const newEnd = shiftDay(target.endDate, 1);
  await dlg.getByLabel(/^Selesai\b/).fill(newEnd);
  await expect(dlg.getByTestId("workload-will-adjust")).toBeVisible();
  await expect(save).toBeEnabled();
  await save.click();
  await expect(page.getByText("Jam dan tanggal diperbarui.").last()).toBeVisible();
  await expect(row().getByText("Disesuaikan")).toBeVisible();
  await expect(row().getByText("Template", { exact: true })).toBeVisible();           // asal baris tidak berubah
  const after = ((await call(page, "get", `/api/training/projects/${projectId}/workload`)) as R2[]).find((r) => r.id === target.id)!;
  expect(after).toMatchObject({ adjusted: true, source: "TEMPLATE", hours: target.hours + 2, endDate: newEnd, startDate: target.startDate, status: "OPEN" });

  // riwayat (audit) memuat tanggal LAMA dan BARU
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
  try {
    const a = await prisma.auditLog.findFirstOrThrow({ where: { action: "training.workload.update", before: { path: ["taskId"], equals: target.id } }, orderBy: { createdAt: "desc" } });
    expect(a.before).toMatchObject({ hours: target.hours, startDate: target.startDate, endDate: target.endDate });
    expect(a.after).toMatchObject({ hours: target.hours + 2, startDate: target.startDate, endDate: newEnd });
  } finally { await prisma.$disconnect(); }

  // kembalikan baris yang disesuaikan ke template agar uji berikutnya berangkat dari keadaan yang sama
  await call(page, "post", `/api/training/workload/${target.id}/revert`, {});

  // baris SELESAI: dapat disesuaikan, tetap Selesai
  const done = rows.find((r) => r.status === "DONE")!;
  expect(done, "perlu satu baris Selesai dari uji sebelumnya").toBeTruthy();
  const drow = page.getByTestId("workload-row").filter({ hasText: done.name });
  await drow.getByRole("button", { name: `Ubah jam dan tanggal ${done.name}` }).click();
  await expect(dlg.getByText(/tetap Selesai setelah diubah/)).toBeVisible();
  await dlg.getByLabel("Jam total").fill(String(done.hours + 1));
  await dlg.getByRole("button", { name: "Simpan" }).click();
  await expect(page.getByText("Jam dan tanggal diperbarui.").last()).toBeVisible();
  await expect(drow.getByLabel(`Status ${done.name}`)).toHaveValue("DONE");
  const doneAfter = ((await call(page, "get", `/api/training/projects/${projectId}/workload`)) as R2[]).find((r) => r.id === done.id)!;
  expect(doneAfter).toMatchObject({ status: "DONE", adjusted: true, hours: done.hours + 1 });
  await ctx.close();
});


test("baris KEMBAR warisan bug: ditandai, tidak diubah saat dihitung ulang; pengguna melihat kedua baris, memilih satu, dan hasilnya tercatat", async ({ browser }) => {
  // Simulasi data lama (sebelum ada ID asal): baris diedit → MANUAL, ditambah salinan template untuk pekerjaan yang sama.
  const prisma = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL! } } });
  let victim: { name: string; hours: number };
  try {
    await prisma.trainingWorkloadTask.updateMany({ where: { projectId }, data: { templateKey: null, adjusted: false, adjustedAt: null, originReviewedAt: null } });
    const rows = await prisma.trainingWorkloadTask.findMany({ where: { projectId, status: "OPEN" }, orderBy: { name: "asc" } });
    const t = rows[0]!;
    victim = { name: t.name, hours: t.hours };
    await prisma.trainingWorkloadTask.update({ where: { id: t.id }, data: { source: "MANUAL", hours: t.hours + 2 } });
    await prisma.trainingWorkloadTask.create({ data: { projectId, employeeId: t.employeeId, name: t.name, hours: t.hours, startDate: t.startDate, endDate: t.endDate, source: "TEMPLATE", roleKey: t.roleKey, createdById: t.createdById } });
  } finally { await prisma.$disconnect(); }

  const { ctx, page } = await as(browser, "ayu");
  await page.goto(tab);
  const total = await page.getByTestId("workload-row").count();
  await expect(page.getByTestId("workload-review-notice")).toContainText("perlu diperiksa asalnya");
  const dupRows = page.getByTestId("workload-row").filter({ hasText: victim.name });
  await expect(dupRows).toHaveCount(2);
  await expect(dupRows.first().getByText("Kembar")).toBeVisible();

  await page.getByRole("button", { name: "Hitung ulang dari template" }).click();
  await expect(page.getByTestId("recalc-result")).toContainText("0 baru, 0 diperbarui, 0 dihapus");   // tidak ada yang ditebak/diubah
  await expect(page.getByTestId("workload-row")).toHaveCount(total);

  await page.getByRole("button", { name: `Rapikan baris kembar ${victim.name}` }).first().click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByTestId("merge-rows").getByRole("listitem")).toHaveCount(2);
  const confirmBtn = dlg.getByRole("button", { name: "Hapus yang lain, pertahankan yang dipilih" });
  await expect(confirmBtn).toBeDisabled();                                   // harus memilih dulu
  await dlg.getByRole("radio", { name: new RegExp(`Pertahankan baris ${victim.name} \\(${victim.hours + 2} jam, manual\\)`) }).check();
  await confirmBtn.click();
  await expect(page.getByText("Baris kembar dirapikan.").last()).toBeVisible();
  await expect(page.getByTestId("workload-row")).toHaveCount(total - 1);
  await expect(page.getByTestId("workload-row").filter({ hasText: victim.name }).getByText("Disesuaikan")).toBeVisible();
  await expect(page.getByTestId("workload-review-notice")).toHaveCount(0);

  await page.goto(`/training/proyek/${projectId}?tab=riwayat`);
  await expect(page.getByText(/dirapikan: 1 dipertahankan, 1 dihapus/)).toBeVisible();
  await ctx.close();
});
