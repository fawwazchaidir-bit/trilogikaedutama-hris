/**
 * Training & Operations — PENUTUPAN PROYEK di browser: ringkasan satu layar, keputusan per tugas terbuka (tindak lanjut / batal),
 * pelonggaran checklist wajib (alasan, hanya Koordinator Program saat Berjalan, harus diakui), dan tindak lanjut yang tetap dapat dikerjakan.
 * Dijalankan setelah 05f (level Ayu = Koordinator Program, Budi = Admin Program) dan sebelum 06-stage2 (2FA admin). Data disiapkan lewat API.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { USERS, isoDatePlus, login } from "./helpers";

async function as(browser: Browser, who: keyof typeof USERS, vp = { width: 1360, height: 900 }) {
  const ctx = await browser.newContext({ viewport: vp });
  const page = await ctx.newPage();
  await login(page, USERS[who]);
  return { ctx, page };
}
const api = async (page: Page, method: "post" | "get", url: string, data?: unknown) => {
  const res = await page.request[method](url, { ...(data === undefined ? {} : { data }), headers: { origin: new URL(page.url()).origin } });
  expect(res.ok(), `${method.toUpperCase()} ${url} → ${res.status()} ${await res.text()}`).toBe(true);
  return ((await res.json()) as { data: any }).data; // eslint-disable-line @typescript-eslint/no-explicit-any
};

const PROJECT = "Penutupan E2E Surakarta";
const T_KEEP = "Kirim sertifikat E2E";
const T_DROP = "Foto dokumentasi E2E";
const ITEM = "Laporan akhir E2E";
let projectUrl = "";
let projectId = "";

test.describe.configure({ mode: "serial" });

test("persiapan: Ayu (Koordinator Program) membuat proyek Berjalan dengan PIC Citra, staf Budi, dua tugas terbuka, dan satu checklist wajib", async ({ browser }) => {
  const { ctx, page } = await as(browser, "ayu");
  const dir = (await api(page, "get", "/api/training/directory")) as { id: string; fullName: string }[];
  const emp = (name: string) => dir.find((d) => d.fullName.includes(name))!.id;
  const created = await api(page, "post", "/api/training/projects", { name: PROJECT, kind: "REGULAR", startDate: isoDatePlus(3), endDate: isoDatePlus(5), picEmployeeId: emp("Citra") });
  projectId = created.id;
  projectUrl = `/training/proyek/${projectId}`;
  await api(page, "post", `/api/training/projects/${projectId}/members`, { employeeId: emp("Budi"), role: "STAFF" });
  await api(page, "post", `/api/training/projects/${projectId}/status`, { to: "PREPARATION" });
  await api(page, "post", `/api/training/projects/${projectId}/status`, { to: "RUNNING" });
  await api(page, "post", `/api/training/projects/${projectId}/tasks`, { title: T_KEEP, assigneeId: emp("Budi"), dueDate: isoDatePlus(6) });
  await api(page, "post", `/api/training/projects/${projectId}/tasks`, { title: T_DROP, assigneeId: emp("Budi"), dueDate: isoDatePlus(2) });
  await api(page, "post", `/api/training/projects/${projectId}/checklist`, { phase: "CLOSING", title: ITEM, isRequired: true });
  await page.goto(projectUrl);
  await expect(page.getByRole("heading", { name: PROJECT })).toBeVisible();
  await ctx.close();
});

test("checklist wajib saat Berjalan: PIC (Citra) tidak dapat melonggarkan — hanya diberi tahu; Koordinator Program dapat, dengan alasan", async ({ browser }) => {
  const pic = await as(browser, "citra");
  await pic.page.goto(`${projectUrl}?tab=tugas`);
  await expect(pic.page.getByText(/hanya dapat dilakukan Koordinator Program atau Direktur/)).toBeVisible();
  await expect(pic.page.getByRole("button", { name: `Jadikan item ${ITEM} tidak wajib` })).toHaveCount(0);
  await expect(pic.page.getByRole("button", { name: `Hapus item ${ITEM}` })).toHaveCount(0);
  await pic.ctx.close();

  const { ctx, page } = await as(browser, "ayu");
  await page.goto(`${projectUrl}?tab=tugas`);
  await page.getByRole("button", { name: `Jadikan item ${ITEM} tidak wajib` }).click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByText(/dicatat sebagai pelonggaran/)).toBeVisible();
  const confirmBtn = dlg.getByRole("button", { name: "Jadikan tidak wajib" });
  await expect(confirmBtn).toBeDisabled();                                   // alasan wajib
  await dlg.getByLabel("Alasan").fill("Klien tidak meminta laporan akhir");
  await confirmBtn.click();
  await expect(page.getByText("Item dijadikan tidak wajib.").last()).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: ITEM }).getByText("Wajib", { exact: true })).toHaveCount(0);
  await page.goto(`${projectUrl}?tab=riwayat`);
  await expect(page.getByText(/dijadikan TIDAK WAJIB \(pelonggaran\)/)).toBeVisible();
  await expect(page.getByText(/Alasan: Klien tidak meminta laporan akhir/)).toBeVisible();
  await ctx.close();
});

test("penutupan: ringkasan menampilkan tugas terbuka & pelonggaran; tombol baru aktif setelah semua tugas diputuskan dan pelonggaran diakui", async ({ browser }) => {
  const { ctx, page } = await as(browser, "ayu");
  await page.goto(`${projectUrl}?tab=penutupan`);
  await expect(page.getByRole("heading", { name: "Ringkasan penutupan" })).toBeVisible();
  await expect(page.getByTestId("closure-relaxations")).toContainText(ITEM);
  await expect(page.getByTestId("closure-relaxations")).toContainText("Klien tidak meminta laporan akhir");
  await expect(page.getByTestId("closure-task")).toHaveCount(2);

  await page.getByLabel("Catatan hasil pelaksanaan").fill("Pelatihan berjalan lancar; sertifikat menyusul.");
  const closeBtn = page.getByRole("button", { name: "Tutup proyek…" });
  await expect(closeBtn).toBeDisabled();                                     // tugas belum diputuskan & pelonggaran belum diakui

  await page.getByLabel(`Keputusan untuk tugas ${T_KEEP}`).selectOption("FOLLOW_UP");
  await page.getByLabel(`Penanggung jawab tindak lanjut ${T_KEEP}`).selectOption({ label: "Budi Santoso" });
  await page.getByLabel(`Tenggat tindak lanjut ${T_KEEP}`).fill(isoDatePlus(8));
  await page.getByLabel(`Keputusan untuk tugas ${T_DROP}`).selectOption("CANCEL");
  await expect(closeBtn).toBeDisabled();                                     // pembatalan belum beralasan
  await page.getByLabel(`Alasan pembatalan ${T_DROP}`).fill("Acara tidak didokumentasikan");
  await expect(closeBtn).toBeDisabled();                                     // pelonggaran belum diakui
  await page.getByRole("checkbox", { name: /Saya telah memeriksa/ }).check();
  await expect(closeBtn).toBeEnabled();

  await closeBtn.click();
  const dlg = page.getByRole("dialog");
  await expect(dlg.getByText(/1 tugas menjadi tindak lanjut/)).toBeVisible();
  await expect(dlg.getByText(/1 tugas dibatalkan/)).toBeVisible();
  await expect(dlg.getByText(/1 pelonggaran checklist wajib diakui/)).toBeVisible();
  await dlg.getByRole("button", { name: "Ya, tutup proyek" }).click();
  await expect(page.getByText("Proyek ditutup.").last()).toBeVisible();
  await expect(page.getByText(/Ditutup dengan pengecualian/)).toHaveCount(0);   // checklist wajib tidak ada yang tersisa → bersih
  await expect(page.getByTestId("closure-followups")).toContainText(T_KEEP);
  await expect(page.getByTestId("closure-followups")).not.toContainText(T_DROP);

  await page.goto(`${projectUrl}?tab=riwayat`);
  await expect(page.getByText(/ditutup; tugas terbuka: 1 jadi tindak lanjut, 1 dibatalkan; 1 pelonggaran checklist wajib diakui/)).toBeVisible();
  await ctx.close();
});

test("setelah ditutup: Budi tetap dapat mengerjakan tindak lanjut (Tugas Saya), tugas yang dibatalkan tidak terbuka; tugas lain terkunci", async ({ browser }) => {
  const { ctx, page } = await as(browser, "budi");
  await page.goto("/training/tugas-saya");
  const item = page.getByRole("listitem").filter({ hasText: T_KEEP });
  await expect(item).toBeVisible();
  await expect(item.getByText("Tindak lanjut", { exact: true })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: T_DROP })).toHaveCount(0);   // dibatalkan: tidak ada di daftar terbuka
  await item.getByRole("button", { name: "Ubah status" }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("Status baru").selectOption({ label: "Dalam proses" });
  await dlg.getByRole("button", { name: "Simpan" }).click();
  await expect(page.getByText("Status tugas diperbarui.").last()).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: T_KEEP }).getByText("Dalam proses")).toBeVisible();

  // Di tab Tugas proyek: tindak lanjut punya aksi; tugas yang dibatalkan tidak.
  await page.goto(`${projectUrl}?tab=tugas`);
  await expect(page.getByText(/kecuali tugas tindak lanjut/)).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: T_KEEP }).getByRole("button", { name: "Ubah status" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: T_DROP }).getByRole("button", { name: "Ubah status" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tugas baru" })).toHaveCount(0);
  await ctx.close();
});
