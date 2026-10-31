import { expect, test, type Page } from "@playwright/test";
import { E2E_PASSWORD, USERS, alertWith, login, logout, workdayPlus } from "./helpers";
import { totpAt, totpStep } from "../../src/lib/totp";

test.describe.configure({ mode: "serial" });

/** Kode untuk langkah waktu pertama yang masih diterima server (±1 langkah) DAN lebih baru dari langkah yang sudah dipakai (anti-replay). */
async function codeAfter(secret: string, usedStep: number): Promise<{ code: string; step: number }> {
  for (let i = 0; i < 40; i++) {
    const now = Date.now();
    const step = Math.max(totpStep(now), usedStep + 1);
    if (step <= totpStep(now) + 1) return { code: totpAt(secret, step * 30_000 + 1_000), step };
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("Langkah TOTP baru tidak tersedia");
}

async function submitLogin(page: Page, email: string, password = E2E_PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
}

test.describe("lupa password mandiri", () => {
  test("halaman masuk menautkan ke lupa-password; halaman & API konsisten dengan konfigurasi email", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByText(/Lupa password\?/)).toBeVisible();
    const res = await page.goto("/lupa-password");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Lupa password" })).toBeVisible();

    const api = await page.request.post("/api/auth/forgot", { data: { email: "tidak-ada@demo.hris.test" }, headers: { origin: new URL(page.url()).origin } });
    if (await page.getByText(/belum diaktifkan/).count()) {
      // Email server tidak dikonfigurasi → fitur nonaktif, pesan jelas (bukan diam-diam gagal).
      expect(api.status()).toBe(422);
      expect((await api.json()).error.message).toMatch(/belum diaktifkan/);
    } else {
      // Aktif → jawaban sama untuk akun terdaftar maupun tidak (anti user-enumeration).
      expect(api.status()).toBe(200);
      const known = await page.request.post("/api/auth/forgot", { data: { email: USERS.ayu }, headers: { origin: new URL(page.url()).origin } });
      expect((await known.json()).data.message).toBe((await api.json()).data.message);
    }
  });

  test("tautan reset palsu / kedaluwarsa ditolak dengan pesan jelas", async ({ page }) => {
    await page.goto("/login");
    const origin = new URL(page.url()).origin;
    const res = await page.request.post("/api/auth/reset", { data: { token: "x".repeat(43), newPassword: "Password-Baru-2026!" }, headers: { origin } });
    expect([400, 401, 404, 410, 422]).toContain(res.status());
    expect(JSON.stringify(await res.json())).not.toMatch(/stack|prisma/i);
  });
});

test.describe("lembur dengan persetujuan", () => {
  const date = workdayPlus(1);

  test("karyawan mengajukan lembur; pengajuan ganda untuk tanggal sama ditolak", async ({ page }) => {
    await login(page, USERS.ayu);
    await page.getByRole("navigation", { name: "Menu utama" }).getByRole("link", { name: "Lembur Saya" }).click();
    await expect(page.getByRole("heading", { name: "Lembur Saya" })).toBeVisible();
    const form = page.getByRole("form", { name: "Form pengajuan lembur" });
    await form.getByLabel("Tanggal").fill(date);
    await form.getByLabel("Jam mulai").fill("17:00");
    await form.getByLabel("Durasi (jam)").fill("2");
    await form.getByLabel("Pekerjaan yang dilembur").fill("Menyelesaikan laporan bulanan mendesak");
    await form.getByRole("button", { name: "Kirim pengajuan" }).click();
    await expect(page.getByText("Pengajuan lembur terkirim dan menunggu persetujuan.")).toBeVisible();
    await expect(page.getByText("Menyelesaikan laporan bulanan mendesak")).toBeVisible();

    await form.getByLabel("Pekerjaan yang dilembur").fill("Coba ajukan lagi");
    await form.getByRole("button", { name: "Kirim pengajuan" }).click();
    await expect(alertWith(page, /Sudah ada pengajuan lembur/)).toBeVisible();
  });

  test("durasi tidak valid ditolak; karyawan tidak dapat membuka antrean persetujuan atau API-nya", async ({ page }) => {
    await login(page, USERS.ayu);
    await page.goto("/lembur-saya");
    const form = page.getByRole("form", { name: "Form pengajuan lembur" });
    await form.getByLabel("Tanggal").fill(workdayPlus(2));
    await form.getByLabel("Durasi (jam)").fill("0,1");
    await form.getByLabel("Pekerjaan yang dilembur").fill("Terlalu singkat");
    await form.getByRole("button", { name: "Kirim pengajuan" }).click();
    await expect(alertWith(page, /\S/).first()).toBeVisible();

    expect((await page.goto("/lembur"))?.status()).toBe(404);
    expect((await page.request.get("/api/overtime")).status()).toBe(403);
    const ids = (await (await page.request.get("/api/overtime/mine")).json()).data as { id: string; status: string }[];
    const pending = ids.find((o) => o.status === "PENDING")!;
    const own = await page.request.post(`/api/overtime/${pending.id}/review`, { data: { decision: "APPROVE", approvedMinutes: 60 }, headers: { origin: new URL(page.url()).origin } });
    expect(own.status()).toBe(403); // tidak bisa menyetujui lembur sendiri
  });

  test("HR menyetujui sebagian (90 dari 120 menit); karyawan melihat hasilnya", async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto("/lembur");
    await expect(page.getByRole("heading", { name: "Pengajuan Lembur" })).toBeVisible();
    await page.getByRole("button", { name: /Setujui lembur Ayu Lestari/ }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Menit yang disetujui").fill("999");
    await dlg.getByRole("button", { name: "Setujui", exact: true }).click();
    await expect(alertWith(dlg, /melebihi/i).first()).toBeVisible(); // batas: tidak boleh melebihi yang diajukan
    await dlg.getByLabel("Menit yang disetujui").fill("90");
    await dlg.getByRole("button", { name: "Setujui", exact: true }).click();
    await expect(page.getByText("Lembur disetujui.")).toBeVisible();
    await logout(page);

    await login(page, USERS.ayu);
    await page.goto("/lembur-saya");
    await expect(page.getByText(/Disetujui 1 j 30 m \(kurang dari yang diajukan\)/)).toBeVisible();
  });
});

test.describe("cuti setengah hari", () => {
  test("pengajuan setengah hari (pagi) tercatat 0,5 hari dan disetujui HR", async ({ page }) => {
    const date = workdayPlus(10);
    await login(page, USERS.ayu);
    await page.goto("/pengajuan-saya");
    const form = page.getByRole("form", { name: "Form pengajuan" });
    await form.getByLabel("Jenis pengajuan").selectOption("CUTI");
    await form.getByLabel("Tanggal mulai").fill(date);
    await form.getByLabel("Tanggal selesai").fill(date);
    await form.getByLabel("Bagian hari").selectOption("MORNING");
    await form.getByLabel("Alasan").fill("Urusan keluarga setengah hari");
    await form.getByRole("button", { name: "Kirim pengajuan" }).click();
    await expect(page.getByText("Pengajuan terkirim dan menunggu persetujuan.")).toBeVisible();
    await expect(page.getByText(/Setengah hari \(pagi\) · 0,5 hari kerja/)).toBeVisible();
    await logout(page);

    await login(page, USERS.hr);
    await page.goto("/pengajuan");
    await expect(page.getByText("Setengah hari (pagi)").first()).toBeVisible();
  });
});

test.describe("laporan & analisis (Tahap 2)", () => {
  test("Super Admin: tab laporan termuat, ekspor CSV berisi data; Karyawan tidak punya akses", async ({ page }) => {
    await login(page, USERS.pimpinan);
    await page.goto("/laporan");
    await expect(page.getByRole("heading", { name: "Laporan & Analisis" })).toBeVisible();
    for (const t of ["Ringkasan", "Kehadiran", "Cuti & Lembur", "Biaya SDM", "BPJS & PPh 21", "Karyawan"]) {
      await page.getByRole("link", { name: t, exact: true }).first().click();
      await expect(page.getByRole("heading", { name: "Laporan & Analisis" })).toBeVisible();
    }
    for (const kind of ["kehadiran", "cuti-lembur", "biaya", "kepatuhan", "karyawan"]) {
      const res = await page.request.get(`/api/reports/export?kind=${kind}&format=csv`);
      expect(res.status(), kind).toBe(200);
      expect(res.headers()["content-type"]).toMatch(/csv/);
      expect((await res.text()).length, kind).toBeGreaterThan(20);
    }
    const bad = await page.request.get("/api/reports/export?kind=bukan-laporan&format=csv");
    expect(bad.status()).toBe(422);

    await logout(page);
    await login(page, USERS.ayu);
    expect((await page.goto("/laporan"))?.status()).toBe(404);
    expect((await page.request.get("/api/reports/export?kind=kehadiran&format=csv")).status()).toBe(403);
  });

  test("HR melihat laporan kehadiran tetapi biaya SDM/BPJS-PPh21 mengikuti izin penggajian", async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto("/laporan");
    await expect(page.getByRole("heading", { name: "Laporan & Analisis" })).toBeVisible();
    expect((await page.request.get("/api/reports/export?kind=kehadiran&format=csv")).status()).toBe(200);
    const biaya = await page.request.get("/api/reports/export?kind=biaya&format=csv");
    const nav = await page.getByRole("link", { name: "Biaya SDM", exact: true }).count();
    expect(biaya.status() === 200).toBe(nav > 0); // UI dan API sepakat
  });
});

test.describe("2FA (TOTP) & kode pemulihan", () => {
  let secret = "";
  let usedStep = 0;
  let recovery: string[] = [];

  test("Karyawan mengaktifkan 2FA: password dikonfirmasi, kode salah ditolak, kode benar menampilkan 10 kode pemulihan", async ({ page }) => {
    await login(page, USERS.citra);
    await page.goto("/akun");
    await expect(page.getByRole("heading", { name: "Keamanan & Notifikasi" })).toBeVisible();
    await page.getByRole("button", { name: "Aktifkan 2FA" }).click();
    await page.getByLabel("Konfirmasi dengan password Anda").fill("password-salah-sekali");
    await page.getByRole("button", { name: "Lanjut" }).click();
    await expect(alertWith(page, /\S/).first()).toBeVisible(); // password salah → tidak ada rahasia dikirim
    await page.getByLabel("Konfirmasi dengan password Anda").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Lanjut" }).click();
    const raw = await page.getByTestId("totp-secret").innerText();
    secret = raw.replace(/\s+/g, "");
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await expect(page.getByRole("img", { name: "Kode QR untuk aplikasi autentikator" })).toBeVisible();

    await page.getByLabel("Kode 6 digit").fill("000000");
    await page.getByRole("button", { name: /Konfirmasi & aktifkan/ }).click();
    await expect(alertWith(page, /\S/).first()).toBeVisible();

    const good = await codeAfter(secret, 0);
    usedStep = good.step;
    await page.getByLabel("Kode 6 digit").fill(good.code);
    await page.getByRole("button", { name: /Konfirmasi & aktifkan/ }).click();
    const codes = page.getByTestId("recovery-codes").getByRole("listitem");
    await expect(codes).toHaveCount(10);
    recovery = await codes.allInnerTexts();
    expect(new Set(recovery).size).toBe(10);
    await page.getByRole("button", { name: "Sudah saya simpan" }).click();
    await expect(page.getByText("Aktif", { exact: true }).first()).toBeVisible();
  });

  test("masuk memerlukan kode kedua: kode salah ditolak; kode TOTP baru berhasil; kode lama (replay) ditolak", async ({ page }) => {
    await submitLogin(page, USERS.citra);
    await expect(page.getByRole("form", { name: "Form verifikasi dua langkah" })).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await page.getByLabel("Kode verifikasi").fill("000000");
    await page.getByRole("button", { name: /Verifikasi/ }).click();
    await expect(alertWith(page, /\S/).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    // Kode pada langkah yang sudah dipakai saat aktivasi tidak boleh dipakai ulang.
    await submitLogin(page, USERS.citra);
    await page.getByLabel("Kode verifikasi").fill(totpAt(secret, usedStep * 30_000 + 1_000));
    await page.getByRole("button", { name: /Verifikasi/ }).click();
    await expect(alertWith(page, /\S/).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);

    await submitLogin(page, USERS.citra);
    const next = await codeAfter(secret, usedStep);
    usedStep = next.step;
    await page.getByLabel("Kode verifikasi").fill(next.code);
    await page.getByRole("button", { name: /Verifikasi/ }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    await expect(page.getByRole("navigation", { name: "Menu utama" })).toBeVisible();
  });

  test("kode pemulihan: berlaku sekali saja", async ({ page }) => {
    await submitLogin(page, USERS.citra);
    await page.getByLabel("Kode verifikasi").fill(recovery[0]!);
    await page.getByRole("button", { name: /Verifikasi/ }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));
    await logout(page);

    await submitLogin(page, USERS.citra);
    await page.getByLabel("Kode verifikasi").fill(recovery[0]!);
    await page.getByRole("button", { name: /Verifikasi/ }).click();
    await expect(alertWith(page, /\S/).first()).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("API: sesi tanpa langkah kedua tidak terbentuk; login 2FA menolak tantangan palsu", async ({ page }) => {
    await page.goto("/login");
    const origin = new URL(page.url()).origin;
    const login1 = await page.request.post("/api/auth/login", { data: { email: USERS.citra, password: E2E_PASSWORD }, headers: { origin } });
    expect(login1.status()).toBe(200);
    const body = (await login1.json()).data;
    expect(body.requiresTwoFactor).toBe(true);
    expect(body.user).toBeUndefined(); // belum ada data pengguna sebelum langkah kedua
    expect((await page.request.get("/api/me")).status()).toBe(401);
    const fake = await page.request.post("/api/auth/2fa", { data: { challenge: "tantangan-palsu-" + "a".repeat(30), code: "123456" }, headers: { origin } });
    expect(fake.status()).toBe(401);
    expect((await page.request.get("/api/me")).status()).toBe(401);
  });

  test("mematikan 2FA memerlukan password dan kode baru; setelah itu masuk cukup dengan password", async ({ page }) => {
    await submitLogin(page, USERS.citra);
    const next = await codeAfter(secret, usedStep);
    usedStep = next.step;
    await page.getByLabel("Kode verifikasi").fill(next.code);
    await page.getByRole("button", { name: /Verifikasi/ }).click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"));

    await page.goto("/akun");
    await page.getByRole("button", { name: "Matikan 2FA" }).first().click();
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    const off = await codeAfter(secret, usedStep);
    usedStep = off.step;
    await page.getByLabel("Kode 6 digit").fill(off.code);
    await page.getByRole("button", { name: "Matikan 2FA" }).last().click();
    await expect(page.getByText("2FA dimatikan.")).toBeVisible();
    await logout(page);
    await login(page, USERS.citra); // kembali tanpa langkah kedua
    await expect(page.getByRole("navigation", { name: "Menu utama" })).toBeVisible();
  });
});

test.describe("shift malam (lintas tengah malam)", () => {
  test("HR membuat jadwal malam 22.00–06.00 yang valid; jadwal melebihi 16 jam ditolak", async ({ page }) => {
    await login(page, USERS.hr);
    const origin = new URL(page.url()).origin;
    const ok = await page.request.post("/api/schedules", {
      data: { name: "Shift Malam Uji E2E", workDays: [1, 2, 3, 4, 5], startTime: "22:00", endTime: "06:00", lateToleranceMinutes: 10, absentCutoffTime: "23:30", isDefault: false },
      headers: { origin },
    });
    expect([200, 201], await ok.text()).toContain(ok.status());
    const tooLong = await page.request.post("/api/schedules", {
      data: { name: "Shift Terlalu Panjang", workDays: [1], startTime: "04:00", endTime: "03:00", lateToleranceMinutes: 10, absentCutoffTime: "05:00", isDefault: false },
      headers: { origin },
    });
    expect(tooLong.status()).toBe(422);
    await page.goto("/jadwal");
    await expect(page.getByText("Shift Malam Uji E2E")).toBeVisible();
    await expect(page.getByText(/22\.00.*06\.00/).first()).toBeVisible();
  });
});

test.describe("regresi menu", () => {
  test("menu per peran memuat item Tahap 2 dan tidak membocorkan item admin ke Karyawan", async ({ page }) => {
    await login(page, USERS.ayu);
    const nav = page.getByRole("navigation", { name: "Menu utama" });
    for (const t of ["Lembur Saya", "Keamanan & Notifikasi"]) await expect(nav.getByRole("link", { name: t })).toBeVisible();
    for (const t of ["Pengajuan Lembur", "Laporan & Analisis", "Tinjauan Lokasi"]) await expect(nav.getByRole("link", { name: t, exact: true })).toHaveCount(0);
    await logout(page);
    await login(page, USERS.pimpinan);
    const nav2 = page.getByRole("navigation", { name: "Menu utama" });
    for (const t of ["Pengajuan Lembur", "Laporan & Analisis"]) await expect(nav2.getByRole("link", { name: t, exact: true })).toBeVisible();
  });
});

/** Aktifkan 2FA lewat UI /akun; mengembalikan rahasia & langkah TOTP terakhir yang dipakai. */
async function enableTwoFactorUi(page: Page): Promise<{ secret: string; step: number }> {
  await page.goto("/akun");
  await page.getByRole("button", { name: "Aktifkan 2FA" }).click();
  await page.getByLabel("Konfirmasi dengan password Anda").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Lanjut" }).click();
  const secret = (await page.getByTestId("totp-secret").innerText()).replace(/\s+/g, "");
  const { code, step } = await codeAfter(secret, 0);
  await page.getByLabel("Kode 6 digit").fill(code);
  await page.getByRole("button", { name: /Konfirmasi & aktifkan/ }).click();
  await expect(page.getByTestId("recovery-codes").getByRole("listitem")).toHaveCount(10);
  await page.getByRole("button", { name: "Sudah saya simpan" }).click();
  await expect(page.getByText("Aktif", { exact: true }).first()).toBeVisible();
  return { secret, step };
}

// Ditaruh PALING AKHIR: setelah ini HR & Super Admin memiliki 2FA aktif (database E2E direset pada setiap run).
test.describe("kebijakan wajib 2FA untuk admin", () => {
  test("diwajibkan → HR tanpa 2FA dialihkan ke /akun & API ditolak; setelah aktif normal kembali dan 2FA tak bisa dimatikan; dicabut → bisa", async ({ browser }) => {
    const boss = await browser.newContext();
    const bp = await boss.newPage();
    await login(bp, USERS.pimpinan);
    await bp.goto("/pengaturan");
    const sec = bp.getByRole("form", { name: "Form keamanan akun" });
    await sec.getByLabel(/Wajibkan autentikasi dua langkah/).check();
    await sec.getByRole("button", { name: "Simpan" }).click();
    await expect(bp.getByText("Kebijakan keamanan disimpan.")).toBeVisible();

    // HR (belum 2FA): semua halaman diarahkan ke /akun, API ditolak dengan pesan jelas.
    const hrCtx = await browser.newContext();
    const hp = await hrCtx.newPage();
    await login(hp, USERS.hr);
    await expect(hp).toHaveURL(/\/akun/);
    await expect(hp.getByText(/mewajibkan 2FA/)).toBeVisible();
    await hp.goto("/karyawan");
    await expect(hp).toHaveURL(/\/akun/);
    const blocked = await hp.request.get("/api/employees");
    expect(blocked.status()).toBe(403);
    expect((await blocked.json()).error.message).toMatch(/2FA/);

    // HR mengaktifkan 2FA → akses pulih; tombol "Matikan 2FA" tidak tersedia selama kebijakan berlaku.
    await enableTwoFactorUi(hp);
    expect((await hp.goto("/karyawan"))?.status()).toBe(200);
    expect((await hp.request.get("/api/employees")).status()).toBe(200);
    await hp.goto("/akun");
    await expect(hp.getByRole("button", { name: "Matikan 2FA" })).toHaveCount(0);
    expect((await hp.request.post("/api/account/2fa/disable", { data: { password: E2E_PASSWORD, code: "123456" }, headers: { origin: new URL(hp.url()).origin } })).status()).not.toBe(200);

    // Super Admin sendiri juga wajib 2FA sebelum bisa mencabut kebijakan (tidak ada jalan pintas).
    await bp.goto("/pengaturan");
    await expect(bp).toHaveURL(/\/akun/);
    await enableTwoFactorUi(bp);
    await bp.goto("/pengaturan");
    const sec2 = bp.getByRole("form", { name: "Form keamanan akun" });
    await sec2.getByLabel(/Wajibkan autentikasi dua langkah/).uncheck();
    await sec2.getByRole("button", { name: "Simpan" }).click();
    await expect(bp.getByText("Kebijakan keamanan disimpan.")).toBeVisible();

    // Setelah dicabut: HR boleh mematikan 2FA lagi.
    await hp.goto("/akun");
    await expect(hp.getByRole("button", { name: "Matikan 2FA" }).first()).toBeVisible();
    await boss.close();
    await hrCtx.close();
  });
});
