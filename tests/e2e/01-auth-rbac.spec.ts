import { expect, test } from "@playwright/test";
import { E2E_PASSWORD, USERS, alertWith, login, logout } from "./helpers";

test.describe("login & hak akses", () => {
  test("belum login → diarahkan ke halaman masuk", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: "Trilogika Edutama" })).toBeVisible();
  });

  test("password salah → pesan jelas, tetap di halaman masuk", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(USERS.ayu);
    await page.getByLabel("Password").fill("salah-salah-123");
    await page.getByRole("button", { name: "Masuk" }).click();
    await expect(alertWith(page, "Email atau password salah")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("Karyawan: hanya menu layanan mandiri; halaman admin tidak ditemukan", async ({ page }) => {
    await login(page, USERS.ayu);
    const nav = page.getByRole("navigation", { name: "Menu utama" });
    for (const t of ["Dashboard", "Absensi Saya", "Pengajuan Saya", "Slip Gaji Saya", "Profil & Jadwal"]) await expect(nav.getByRole("link", { name: t })).toBeVisible();
    for (const t of ["Karyawan", "Penggajian", "Audit Log", "Pengaturan", "Rekap Absensi", "Akun Pengguna"]) await expect(nav.getByRole("link", { name: t, exact: true })).toHaveCount(0);
    for (const path of ["/karyawan", "/penggajian", "/audit-log", "/rekap", "/pengaturan", "/pengguna", "/jadwal", "/absensi", "/pengajuan"]) {
      const res = await page.goto(path);
      expect(res?.status(), path).toBe(404);
      await expect(page.getByText("Halaman tidak ditemukan")).toBeVisible();
    }
  });

  test("Karyawan: API admin ditolak di sisi server (bukan hanya disembunyikan di UI)", async ({ page }) => {
    await login(page, USERS.ayu);
    for (const path of ["/api/employees", "/api/payroll", "/api/audit-logs", "/api/users", "/api/leaves", "/api/schedules", "/api/settings"]) {
      expect((await page.request.get(path)).status(), path).toBe(403);
    }
    const post = await page.request.post("/api/employees", { data: { employeeNo: "X-1" }, headers: { origin: new URL(page.url()).origin } });
    expect(post.status()).toBe(403);
  });

  test("Karyawan tidak dapat melihat slip, rekap, atau profil karyawan lain", async ({ browser }) => {
    const budi = await browser.newContext();
    const bp = await budi.newPage();
    await login(bp, USERS.budi);
    const budiSlips = (await (await bp.request.get("/api/payslips")).json()).data as { id: string }[];
    expect(budiSlips.length).toBeGreaterThan(0);
    const budiEmp = (await (await bp.request.get("/api/me")).json()).data.employeeId as string;

    const ayu = await browser.newContext();
    const ap = await ayu.newPage();
    await login(ap, USERS.ayu);
    expect((await ap.request.get(`/api/payslips/${budiSlips[0]!.id}/pdf`)).status()).toBe(404);
    expect((await ap.request.get(`/api/employees/${budiEmp}`)).status()).toBe(403);
    expect((await ap.request.get(`/api/recap/detail?employeeId=${budiEmp}&month=2026-08`)).status()).toBe(403);
    expect((await ap.request.get(`/api/leave-balance?employeeId=${budiEmp}`)).status()).toBe(403);
    expect((await ap.request.get(`/api/attendance/corrections?employeeId=${budiEmp}`)).status()).toBe(200); // dikunci ke diri sendiri
    const rows = (await (await ap.request.get(`/api/attendance/corrections?employeeId=${budiEmp}`)).json()).data as { employeeId: string }[];
    expect(rows.every((r) => r.employeeId !== budiEmp)).toBe(true);
    const page = await ayu.newPage();
    expect((await page.goto(`/slip/${budiSlips[0]!.id}`))?.status()).toBe(404);
    await budi.close(); await ayu.close();
  });

  test("HR: menu operasional ya; Audit Log & persetujuan gaji tidak", async ({ page }) => {
    await login(page, USERS.hr);
    const nav = page.getByRole("navigation", { name: "Menu utama" });
    for (const t of ["Karyawan", "Jadwal & Libur", "Absensi", "Rekap Absensi", "Penggajian", "Pengaturan", "Akun Pengguna"]) await expect(nav.getByRole("link", { name: t, exact: true })).toBeVisible();
    await expect(nav.getByRole("link", { name: /^Pengajuan & Cuti/ })).toBeVisible(); // nama memuat lencana jumlah menunggu
    await expect(nav.getByRole("link", { name: "Audit Log" })).toHaveCount(0);
    expect((await page.goto("/audit-log"))?.status()).toBe(404);
    expect((await page.request.get("/api/audit-logs")).status()).toBe(403);
  });

  test("Super Admin melihat Audit Log; logout mengakhiri sesi", async ({ page }) => {
    await login(page, USERS.pimpinan);
    await page.getByRole("link", { name: "Audit Log" }).click();
    await expect(page.getByRole("heading", { name: "Audit Log" })).toBeVisible();
    await expect(page.getByText("payroll.issue").first()).toBeVisible();
    await logout(page);
    expect((await page.request.get("/api/me")).status()).toBe(401);
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });

  test("login ulang dengan password yang benar berhasil", async ({ page }) => {
    await login(page, USERS.citra, E2E_PASSWORD);
    await expect(page.getByRole("heading", { name: /Halo, Citra/ })).toBeVisible();
  });
});

test.describe("ponsel", () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test("menu geser membuka & menutup; tidak ada scroll horizontal", async ({ page }) => {
    await login(page, USERS.ayu);
    await page.getByRole("button", { name: "Buka menu" }).click();
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
    await page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Profil & Jadwal" }).click();
    await expect(page.getByRole("heading", { name: "Profil & Jadwal" })).toBeVisible();
    const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(w.sw).toBeLessThanOrEqual(w.cw);
  });
});
