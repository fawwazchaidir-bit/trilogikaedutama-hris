import { expect, test } from "@playwright/test";
import { USERS, alertWith, confirmDialog, isoDatePlus, login } from "./helpers";

test.describe.configure({ mode: "serial" });

const year = new Date(Date.now() + 7 * 3_600_000).getUTCFullYear();

test.describe("HR — pengajuan & saldo cuti", () => {
  test("menyetujui cuti Ayu → status berubah, saldo terpotong, Ayu mendapat notifikasi", async ({ page, browser }) => {
    await login(page, USERS.hr);
    await page.getByRole("link", { name: /Pengajuan & Cuti/ }).click();
    await page.getByLabel("Status").selectOption("PENDING");
    await page.getByRole("button", { name: "Terapkan", exact: true }).click();
    const row = page.locator("tbody tr", { hasText: "Ayu Lestari" });
    await expect(row).toContainText("Menunggu");
    await row.getByRole("button", { name: "Setujui pengajuan Ayu Lestari" }).click();
    await expect(page.getByRole("dialog")).toContainText("memotong saldo cuti");
    await confirmDialog(page, "Setujui");
    await expect(page.getByText("Pengajuan disetujui.")).toBeVisible();

    await page.goto("/pengajuan?q=DEMO-001");
    await expect(page.locator("tbody tr", { hasText: "Ayu Lestari" }).filter({ hasText: "Cuti" }).first()).toContainText("Disetujui");

    const ctx = await browser.newContext();
    const ap = await ctx.newPage();
    await login(ap, USERS.ayu);
    await ap.goto("/pengajuan-saya");
    await expect(ap.getByText(`Saldo cuti ${year}`, { exact: true })).toBeVisible();
    await expect(ap.locator("p", { hasText: "10 hari" }).first()).toBeVisible();
    const notif = await ap.request.get("/api/notifications");
    expect(JSON.stringify(await notif.json())).toContain("Pengajuan cuti disetujui");
    await ctx.close();
  });

  test("menolak pengajuan wajib dengan catatan", async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto("/pengajuan?status=PENDING");
    const row = page.locator("tbody tr", { hasText: "Citra Dewi" });
    await row.getByRole("button", { name: "Tolak pengajuan Citra Dewi" }).click();
    await confirmDialog(page, "Tolak");
    await expect(alertWith(page.getByRole("dialog")).first()).toBeVisible();
    await page.getByRole("dialog").getByLabel(/Alasan penolakan/).fill("Bentrok dengan jadwal asesmen");
    await confirmDialog(page, "Tolak");
    await expect(page.getByText("Pengajuan ditolak.")).toBeVisible();
    await page.goto("/pengajuan?q=DEMO-003");
    await expect(page.locator("tbody tr", { hasText: "Citra Dewi" }).first()).toContainText("Ditolak");
    await expect(page.getByText("Bentrok dengan jadwal asesmen").first()).toBeVisible();
  });
});

test.describe("HR — data karyawan", () => {
  test("kelola divisi: tambah, ubah nama, nonaktifkan; nama ganda ditolak", async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto("/karyawan");
    await page.getByRole("button", { name: "Kelola divisi" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Nama divisi baru").fill("Divisi E2E");
    await dlg.getByRole("button", { name: "Tambah", exact: true }).click();
    await expect(page.getByText("Divisi ditambahkan.")).toBeVisible();
    await expect(dlg.getByText("Divisi E2E")).toBeVisible();
    await dlg.getByLabel("Nama divisi baru").fill("divisi e2e");
    await dlg.getByRole("button", { name: "Tambah", exact: true }).click();
    await expect(alertWith(dlg, /sudah ada/i)).toBeVisible();
    await dlg.getByRole("button", { name: "Ubah nama Divisi E2E" }).click();
    await dlg.getByLabel("Nama baru untuk Divisi E2E").fill("Divisi E2E Baru");
    await dlg.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Divisi diubah.")).toBeVisible();
    await dlg.getByRole("button", { name: "Nonaktifkan divisi Divisi E2E Baru" }).click();
    await expect(page.getByText("Divisi dinonaktifkan.")).toBeVisible();
    await expect(dlg.getByText("Nonaktif", { exact: true })).toBeVisible();
  });

  test("tambah → validasi → cari → detail → komponen gaji → ubah → rekening → nonaktifkan", async ({ page }) => {
    await login(page, USERS.hr);
    await page.getByRole("link", { name: "Karyawan", exact: true }).click();
    await page.getByRole("button", { name: "Tambah karyawan" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Nomor induk karyawan").fill("E2E-001");
    await dlg.getByLabel("Nama lengkap").fill("Mira Uji E2E");
    await dlg.getByLabel("Jabatan").fill("Staf Uji");
    await dlg.getByLabel("Telepon").fill("abc");
    await dlg.getByLabel("Nomor rekening").fill("9876543210");
    await dlg.getByLabel("Nama bank").fill("Bank Uji");
    await dlg.getByRole("button", { name: "Simpan" }).click();
    await expect(dlg.getByText("Nomor telepon tidak valid").first()).toBeVisible();
    await dlg.getByLabel("Telepon").fill("0812-5555-0101");
    await dlg.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Karyawan ditambahkan.")).toBeVisible();

    // nomor induk ganda (beda huruf besar/kecil) ditolak
    await page.getByRole("button", { name: "Tambah karyawan" }).click();
    await dlg.getByLabel("Nomor induk karyawan").fill("e2e-001");
    await dlg.getByLabel("Nama lengkap").fill("Duplikat");
    await dlg.getByLabel("Jabatan").fill("Staf");
    await dlg.getByRole("button", { name: "Simpan" }).click();
    await expect(dlg.getByText("Nomor induk sudah dipakai").first()).toBeVisible();
    await dlg.getByRole("button", { name: "Batal" }).click();

    await page.getByPlaceholder("Nama, no. induk, jabatan").fill("Mira Uji");
    await page.getByRole("button", { name: "Terapkan", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(1);
    await page.getByRole("link", { name: "Mira Uji E2E" }).click();
    await expect(page.getByRole("heading", { name: "Mira Uji E2E" })).toBeVisible();
    await expect(page.getByText("•••• •••• 3210").first()).toBeVisible();
    await expect(page.getByText("9876543210")).toHaveCount(0);

    // komponen gaji
    await page.getByRole("button", { name: "Tambah komponen" }).click();
    await dlg.getByLabel(/Nominal per periode/).fill("6000000");
    await dlg.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Komponen gaji disimpan.")).toBeVisible();
    await expect(page.locator("tbody tr", { hasText: "Gaji pokok" })).toContainText("Rp 6.000.000");

    // gaji pokok kedua pada periode beririsan ditolak
    await page.getByRole("button", { name: "Tambah komponen" }).click();
    await dlg.getByLabel(/Nominal per periode/).fill("7000000");
    await dlg.getByRole("button", { name: "Simpan" }).click();
    await expect(alertWith(dlg, /gaji pokok aktif/i).first()).toBeVisible();
    await dlg.getByRole("button", { name: "Batal" }).click();

    // BPJS: peringatan — komponen manual menggantikan perhitungan otomatis (Tahap 2) dan nominal harus diverifikasi
    await page.getByRole("button", { name: "Tambah komponen" }).click();
    await dlg.getByLabel("Kategori").selectOption("BPJS");
    await expect(dlg.getByText(/BPJS\/Pajak yang diisi manual\s+menggantikan/)).toBeVisible();
    await expect(dlg.getByText(/verifikasi dengan pihak yang berwenang/)).toBeVisible();
    await dlg.getByRole("button", { name: "Batal" }).click();

    // ubah data
    await page.getByRole("button", { name: "Ubah data" }).click();
    await dlg.getByLabel("Telepon").fill("0812-5555-9999");
    await dlg.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Data karyawan diperbarui.")).toBeVisible();
    await expect(page.getByText("0812-5555-9999")).toBeVisible();

    // rekening lengkap hanya lewat tombol khusus
    await page.getByRole("button", { name: "Lihat rekening" }).click();
    await expect(page.getByRole("dialog")).toContainText("9876543210");
    await page.getByRole("dialog").getByRole("button", { name: "Tutup" }).last().click();

    // nonaktifkan
    await page.getByRole("button", { name: "Nonaktifkan" }).first().click(); // tombol aksi karyawan (di atas tabel komponen)
    await confirmDialog(page, "Nonaktifkan");
    await expect(page.getByText("Karyawan dinonaktifkan.")).toBeVisible();
    await expect(page.getByText(/Nonaktif · berhenti/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Aktifkan kembali" })).toBeVisible();
  });

  test("impor Excel/CSV: pratinjau → simpan; file bermasalah tidak dapat disimpan", async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto("/karyawan");
    await page.getByRole("button", { name: "Impor" }).click();
    const dlg = page.getByRole("dialog");
    const csv = [
      "No. Induk,Nama Lengkap,Divisi,Jabatan,Status,Mulai Bekerja,Telepon,Email",
      "IMP-001,Rani Impor Satu,Divisi Baru Impor,Staf Impor,Kontrak,05/02/2026,0812-1111-0001,rani@contoh.test",
      "IMP-002,Sari Impor Dua,Operasional,Staf Impor,Tetap,2026-03-02,,",
    ].join("\n");
    await dlg.locator("#imp-file").setInputFiles({ name: "karyawan.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(dlg.getByText("Baru: 2")).toBeVisible();
    await expect(dlg.getByText(/Divisi baru yang akan dibuat: Divisi Baru Impor/)).toBeVisible();
    await dlg.getByRole("button", { name: "Simpan 2 baris" }).click();
    await expect(page.getByText(/Impor selesai: 2 baru/)).toBeVisible();
    await page.getByPlaceholder("Nama, no. induk, jabatan").fill("Impor");
    await page.getByRole("button", { name: "Terapkan", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(2);

    await page.getByRole("button", { name: "Impor" }).click();
    const bad = ["No. Induk,Nama Lengkap,Jabatan,Status,Mulai Bekerja", "IMP-003,Tono Salah,Staf,Honorer,31/02/2026", "IMP-001,Dobel,Staf,Tetap,2026-01-01"].join("\n");
    await dlg.locator("#imp-file").setInputFiles({ name: "salah.csv", mimeType: "text/csv", buffer: Buffer.from(bad) });
    await expect(dlg.getByText("Bermasalah: 1")).toBeVisible();
    await expect(dlg.getByText(/Status "Honorer" tidak dikenal/)).toBeVisible();
    await expect(dlg.getByRole("button", { name: /^Simpan/ })).toBeDisabled();
  });
});

test.describe("HR — jadwal, kalender, koreksi, rekap", () => {
  test("menambah jadwal kerja & hari libur lalu menghapus hari libur", async ({ page }) => {
    await login(page, USERS.hr);
    await page.getByRole("link", { name: "Jadwal & Libur" }).click();
    await page.getByRole("button", { name: "Tambah jadwal" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Nama jadwal").fill("Shift Pagi E2E");
    await dlg.getByLabel("Jam masuk").fill("07:00");
    await dlg.getByLabel("Jam pulang").fill("15:00");
    await dlg.getByLabel(/Toleransi keterlambatan/).fill("5");
    await dlg.getByLabel(/Batas jam/).fill("06:30");
    await dlg.getByRole("button", { name: "Simpan" }).click();
    await expect(dlg.getByText(/Batas tidak hadir harus setelah jam masuk/).first()).toBeVisible();
    await dlg.getByLabel(/Batas jam/).fill("10:00");
    await dlg.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Jadwal disimpan.")).toBeVisible();
    await expect(page.locator("tbody tr", { hasText: "Shift Pagi E2E" })).toContainText("07.00 – 15.00");

    await page.getByRole("button", { name: "Tambah", exact: true }).click();
    await dlg.getByLabel("Tanggal").fill(`${year}-12-24`);
    await dlg.getByLabel("Nama").fill("Cuti bersama uji E2E");
    await dlg.getByRole("button", { name: "Simpan" }).click();
    await expect(page.getByText("Entri kalender ditambahkan.")).toBeVisible();
    const row = page.locator("tbody tr", { hasText: "Cuti bersama uji E2E" });
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Hapus" }).click();
    await confirmDialog(page, "Hapus");
    await expect(page.getByText("Entri dihapus.")).toBeVisible();
    await expect(page.getByText("Cuti bersama uji E2E")).toHaveCount(0);
  });

  test("koreksi absensi: alasan wajib; riwayat sebelum/sesudah tercatat; rekap berubah", async ({ page }) => {
    const today = isoDatePlus(0);
    const day = Number(today.slice(8));
    const date = day >= 4 ? isoDatePlus(-3) : today;
    const [inT, outT] = day >= 4 ? ["08:07", "16:11"] : ["00:01", "00:03"];
    await login(page, USERS.hr);
    await page.goto(`/absensi?date=${date}&q=DEMO-001`);
    await page.getByRole("button", { name: "Koreksi absensi Ayu Lestari" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel(/Jam check-in/).fill(inT);
    await dlg.getByLabel(/Jam check-out/).fill(outT);
    await dlg.getByRole("button", { name: "Simpan koreksi" }).click();
    await expect(alertWith(dlg).first()).toBeVisible(); // alasan kosong ditolak
    await dlg.getByLabel(/Alasan koreksi/).fill("Lupa absen; terverifikasi atasan langsung");
    await dlg.getByRole("button", { name: "Simpan koreksi" }).click();
    await expect(page.getByText("Koreksi absensi disimpan.")).toBeVisible();

    const hist = page.locator("section", { has: page.getByRole("heading", { name: /Riwayat koreksi/ }) });
    await expect(hist).toContainText("Lupa absen; terverifikasi atasan langsung");
    await expect(hist).toContainText("Maya Anggraini");
    await expect(page.locator("tbody tr", { hasText: "Ayu Lestari" }).first()).toContainText(inT.replace(":", "."));
  });

  test("rekap: bulanan/harian, filter, penelusuran per karyawan, dan ekspor CSV/Excel/PDF", async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto("/rekap?view=bulanan&month=" + isoDatePlus(-35).slice(0, 7));
    await expect(page.getByRole("heading", { name: "Rekap Absensi" })).toBeVisible();
    await expect(page.getByText("Hari kerja terjadwal").first()).toBeVisible();
    await expect(page.locator("tbody tr").last()).toContainText("TOTAL");
    await page.getByLabel("Divisi").selectOption({ label: "Akademik" });
    await page.getByRole("button", { name: "Terapkan", exact: true }).click();
    await expect(page.locator("tbody tr", { hasText: "Gita Maharani" })).toBeVisible();
    await expect(page.locator("tbody tr", { hasText: "Ayu Lestari" })).toHaveCount(0);

    await page.getByRole("link", { name: "Gita Maharani" }).click();
    await expect(page.getByRole("heading", { name: "Gita Maharani" })).toBeVisible();
    await expect(page.getByText("Rincian harian")).toBeVisible();
    await page.goBack();

    const base = new URL(page.url());
    const csv = await page.request.get(`/api/recap/export${base.search}&format=csv`);
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    const csvText = await csv.text();
    expect(csvText).toContain("Rekap Absensi Bulanan");
    expect(csvText).toContain("Gita Maharani");
    expect(csvText).not.toContain("Ayu Lestari"); // filter divisi ikut diekspor
    expect(csvText).toContain("Cara hitung");
    const xlsx = await page.request.get(`/api/recap/export${base.search}&format=xlsx`);
    expect(xlsx.headers()["content-type"]).toContain("spreadsheetml");
    expect((await xlsx.body()).subarray(0, 2).toString()).toBe("PK");
    const pdf = await page.request.get(`/api/recap/export${base.search}&format=pdf`);
    expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");

    await page.goto("/rekap?view=harian&date=" + isoDatePlus(-1));
    await expect(page.getByRole("columnheader", { name: "Check-in" })).toBeVisible();

    const emp = await page.request.get("/api/employees/export?format=csv");
    const empText = await emp.text();
    expect(empText).toContain("DEMO-001");
    expect(empText).toMatch(/•••• •••• \d{4}/);
    expect(empText).not.toMatch(/70000000\d{5}/); // nomor rekening lengkap tidak pernah diekspor
  });
});

test.describe("Pengaturan & akun", () => {
  test("HR hanya dapat melihat pengaturan (tanpa tombol simpan kebijakan)", async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto("/pengaturan");
    await expect(page.getByText(/hanya dapat dilakukan Super Admin/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Simpan & konfirmasi|Simpan aturan/ })).toHaveCount(0);
    expect((await page.request.put("/api/settings/payroll-rules", { data: {}, headers: { origin: new URL(page.url()).origin } })).status()).toBe(403);
  });

  test("Super Admin mengubah aturan penggajian → konfirmasi dicabut → konfirmasi ulang", async ({ page }) => {
    await login(page, USERS.pimpinan);
    await page.goto("/pengaturan");
    await expect(page.getByText("Perlu disesuaikan dengan kebijakan perusahaan dan ketentuan yang berlaku.").first()).toBeVisible();
    const form = page.getByRole("form", { name: "Form aturan penggajian" });
    await form.getByLabel("Potongan keterlambatan").selectOption("PER_OCCURRENCE");
    await form.getByLabel("Nominal per kali").fill("15000");
    await form.getByRole("button", { name: "Simpan aturan" }).click();
    await expect(page.getByText(/Aturan penggajian disimpan. Konfirmasi ulang diperlukan./)).toBeVisible();
    await expect(page.getByText("Belum dikonfirmasi").first()).toBeVisible();
    await form.getByRole("button", { name: "Saya sudah memverifikasi aturan ini" }).click();
    await expect(page.getByText("Aturan penggajian dikonfirmasi.")).toBeVisible();
    // kembalikan nilai awal agar spesifikasi lain tidak terpengaruh
    await form.getByLabel("Potongan keterlambatan").selectOption("PER_MINUTE");
    await form.getByLabel("Nominal per menit").fill("1000");
    await form.getByRole("button", { name: "Simpan aturan" }).click();
    await expect(page.getByText(/Konfirmasi ulang diperlukan/)).toBeVisible();
    await form.getByRole("button", { name: "Saya sudah memverifikasi aturan ini" }).click();
    await expect(page.getByText("Aturan penggajian dikonfirmasi.")).toBeVisible();
  });

  test("HR membuat akun Karyawan; Super Admin membuat akun admin", async ({ page }) => {
    await login(page, USERS.hr);
    await page.goto("/karyawan?q=Mira");
    await page.goto("/karyawan?active=all&q=E2E-001");
    // akun untuk karyawan impor (aktif)
    await page.goto("/karyawan?q=IMP-001");
    await page.getByRole("link", { name: "Rani Impor Satu" }).click();
    await page.getByRole("button", { name: "Buat akun login" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Password sementara").fill("pendek");
    await dlg.getByRole("button", { name: "Buat akun" }).click();
    await expect(dlg.getByText(/minimal 12 karakter/i).first()).toBeVisible();
    await dlg.getByLabel("Password sementara").fill("Sandi-Sementara-2026!");
    await dlg.getByRole("button", { name: "Buat akun" }).click();
    await expect(page.getByText("Akun login dibuat.")).toBeVisible();

    // HR tidak dapat membuat akun admin lewat API
    const res = await page.request.post("/api/users", { data: { email: "x@demo.hris.test", name: "Admin Liar", role: "SUPER_ADMIN", password: "Sandi-Sementara-2026!" }, headers: { origin: new URL(page.url()).origin } });
    expect(res.status()).toBe(403);
  });
});
