# Trilogika Internal Portal — HRIS & Training Operations Trilogika Edutama

Aplikasi web internal untuk **data karyawan, absensi, rekap otomatis, penggajian, dan slip gaji (PDF)** — Bahasa Indonesia,
responsif (komputer & ponsel), tampilan mengikuti aplikasi invoice Trilogika agar familier.

**Satu portal, satu akun:** HRIS (di bawah) + modul **Training & Operations** untuk mengelola proyek/pelaksanaan pelatihan dari persiapan sampai penutupan — lihat [bagian modul](#trilogika-internal-portal--training--operations) dan [docs/TRAINING-OPS.md](docs/TRAINING-OPS.md). Modul baru **mati secara bawaan** (`TRAINING_MODULE_ENABLED`).

> **Bukan mockup.** Setiap tombol terhubung ke database PostgreSQL dan diuji: 713 tes unit/integrasi (terhadap PostgreSQL sungguhan; 2 dilewati)
> dan 100 tes E2E di browser (login → absensi → pengajuan → persetujuan → penggajian → slip PDF → pembatalan/revisi → 2FA → lembur → laporan → surat tugas & uang harian → dokumen kontrak → kebijakan cuti → proyek pelatihan).
> Data demo bersifat fiktif. **Baca [docs/KEPUTUSAN-BISNIS.md](docs/KEPUTUSAN-BISNIS.md) sebelum dipakai operasional.**

## Peran

| Peran | Ringkasan hak akses |
|---|---|
| **Super Admin / Pimpinan** | Semua: akun admin & karyawan (termasuk reset 2FA), kebijakan absensi/cuti/keamanan, aturan penggajian & BPJS/PPh 21, **persetujuan** & pembatalan penggajian, audit log, laporan. |
| **Admin / HR** | Data karyawan, jadwal & hari libur, koreksi absensi (beralasan), proses izin/sakit/cuti & lembur, tinjauan lokasi, rekap & laporan, komponen gaji, menghitung & **menerbitkan** gaji, unduh slip. **Tidak** dapat menyetujui gaji, mengubah aturan penggajian/BPJS/PPh 21/kebijakan/keamanan, mengelola akun admin, atau melihat audit log. |
| **Karyawan** | Profil & jadwal sendiri, check-in/out, riwayat & rekap sendiri, mengajukan izin/sakit/cuti (termasuk setengah hari) dan lembur, melihat & mengunduh **slip miliknya** yang sudah terbit, mengatur 2FA & notifikasi. Tidak dapat melihat data orang lain — dipaksa di sisi server, bukan hanya disembunyikan di menu. |

## Fitur Tahap 1 (berfungsi)

| Area | Isi |
|---|---|
| **Login & hak akses** | Sesi berbasis cookie (token acak, hanya hash-nya di database), password scrypt, pembatasan percobaan login, RBAC di service layer, CSRF (Origin), header keamanan. |
| **Karyawan** | Tambah/ubah/nonaktifkan (tidak dihapus), foto, divisi, status (tetap/kontrak/magang), rekening **terenkripsi** (AES-256-GCM, hanya 4 digit terakhir tampil), pencarian + filter divisi/status, ekspor Excel/CSV. |
| **Jadwal & kalender** | Jam kerja, hari kerja, toleransi, batas jam "tidak hadir"; penugasan per karyawan › divisi › seluruh perusahaan › default, dengan rentang tanggal (mis. Ramadan); hari libur & hari kerja khusus. |
| **Absensi** | Check-in/out memakai **jam server (WIB)**; satu catatan per karyawan per hari (check-in ganda mustahil, juga saat klik ganda); catatan opsional; status: hadir, terlambat, izin, sakit, cuti, tidak hadir, belum check-out, libur. |
| **Koreksi absensi** | Admin mengoreksi dengan **alasan wajib**; riwayat sebelum/sesudah, waktu, dan pelaku disimpan append-only. |
| **Pengajuan & cuti** | Izin/sakit/cuti + lampiran; setujui/tolak dengan catatan; yang disetujui otomatis masuk rekap; saldo cuti per karyawan (buku saldo append-only, kuota & kebijakan dapat diatur). |
| **Rekap** | Harian, mingguan, bulanan, periode bebas; filter nama/divisi/status; angka dapat ditelusuri per hari beserta penjelasannya; ekspor Excel/CSV/PDF. |
| **Penggajian** | Komponen per karyawan (nominal tetap / × hari hadir / % gaji pokok; tetap atau sekali), aturan opsional (potongan terlambat/tidak hadir, lembur), pemeriksaan rinci + rumus, penyesuaian beralasan, alur **Draf → Menunggu persetujuan → Disetujui → Diterbitkan**, kunci setelah terbit, pembatalan/revisi dengan jejak. |
| **Slip gaji** | PDF A4 profesional (logo dari Pengaturan), rupiah, ringkasan kehadiran, rekening disamarkan, unduh per karyawan atau seluruh periode (1 PDF / ZIP). Dirender dari **snapshot** yang terkunci. |
| **Dashboard** | Admin: hadir/terlambat/belum absen, pengajuan menunggu, absensi belum lengkap, status & total gaji. Karyawan: jadwal, tombol absen, rekap bulan ini, status pengajuan, slip terbaru. |

## Fitur Tahap 2 (berfungsi — diuji)

| Fitur | Isi |
|---|---|
| **Shift lintas tengah malam** | Jadwal 22.00–06.00 dst. (maks. 16 jam); shift milik tanggal ia dimulai; check-out dini hari menutup shift kemarin (masa tenggang 6 jam); koreksi admin & dashboard mengikuti. |
| **Izin/sakit/cuti setengah hari** | Pagi/siang, pecahan 0,5 di rekap, saldo, buku saldo, gaji; jam masuk efektif cuti pagi = tengah shift. |
| **Atasan langsung & alur tinjauan** | Atasan langsung, tanggal berlaku jabatan, riwayat mutasi append-only; cuti & lembur ditinjau atasan (atau pengganti / eskalasi saat atasan cuti), HR memantau dan memproses bila perlu; tak seorang pun menyetujui pengajuannya sendiri — [docs/ORGANISASI-ATASAN.md](docs/ORGANISASI-ATASAN.md). |
| **Lembur dengan persetujuan** | Pengajuan → setujui/kurangi/tolak → dibayar sesuai bukti absensi; tarif tetap atau gaji ÷ pembagi; pengali jam; bukti = irisan jam lembur disetujui dengan kehadiran nyata; periode gaji ditandai "Data berubah" bila persetujuan lembur atau komponen gaji berubah setelah dihitung. |
| **BPJS & PPh 21 otomatis** | BPJS (Kesehatan, JHT, JP, JKK, JKM; porsi karyawan & perusahaan), PPh 21 TER + true-up masa pajak terakhir; semua tarif/tabel dapat diubah; komponen manual menggantikan otomatis; konfirmasi Super Admin wajib. **Nonaktif secara bawaan & wajib diverifikasi.** |
| **Lupa password mandiri** | Email, tautan sekali pakai 30 menit, anti-enumerasi, dibatasi, akun ber-2FA wajib kode. |
| **2FA (TOTP)** | Aplikasi autentikator + QR, 10 kode pemulihan, anti-replay, dapat diwajibkan untuk admin, reset oleh Super Admin. |
| **Notifikasi email/WhatsApp** | Selain dalam aplikasi: SMTP, WhatsApp (Fonnte / Meta Cloud API / webhook), antrean transaksional + percobaan ulang, preferensi per pengguna, pesan uji, status antrean di Pengaturan. Mekanisme, prasyarat, dan batasan: [docs/NOTIFIKASI-WHATSAPP.md](docs/NOTIFIKASI-WHATSAPP.md). **Notifikasi desktop (Web Push)** — notifikasi sistem di komputer tanpa biaya per pesan, diaktifkan sendiri per peramban: [docs/NOTIFIKASI-DESKTOP.md](docs/NOTIFIKASI-DESKTOP.md). |
| **Foto absensi bercap** | Foto dari kamera saat check-in/out; **server** mencetak waktu server + koordinat + nama pada foto (tanpa syarat Wi-Fi/jaringan kantor — cocok untuk **dinas luar**), EXIF dibuang, disimpan sebagai bukti append-only, ditinjau HR di rekap & Tinjauan Lokasi. Mati / opsional / wajib. **Retensi otomatis** (bawaan 6 bulan; jejak teks tetap, yang sedang ditinjau dikecualikan, tiap penghapusan diaudit). **Bukti untuk ditinjau manusia, bukan jaminan keaslian.** |
| **Pencegahan lokasi palsu** | Penilaian risiko berlapis (kesegaran, akurasi/presisi, titik pusat, koordinat berulang/bersama, perpindahan mustahil, perangkat) → tandai/tolak, antrean Tinjauan Lokasi (memuat tautan foto). **Tidak menjamin anti-manipulasi** — lihat batasan. |
| **Laporan & analisis lanjutan** | `/laporan`: ringkasan eksekutif (KPI vs bulan lalu, tren, temuan), kehadiran, cuti & lembur, biaya SDM, rekap BPJS & PPh 21, headcount & turnover; ekspor Excel/CSV/PDF. |
| Absensi berbasis lokasi · Impor karyawan | Sejak sebelumnya (titik + radius; impor Excel/CSV atomik). |

## Fitur Tahap 3 (permintaan pimpinan — berfungsi, diuji)

| Fitur | Isi |
|---|---|
| **Nama aplikasi & password** | Seluruh antarmuka memakai nama **Internal Human Resources Information System**. Semua isian password (masuk, atur ulang, ganti password, konfirmasi 2FA, password sementara akun) punya tombol **tampil/sembunyikan**; bawaan tersembunyi. |
| **Surat Tugas & Bukti Penerimaan Uang Harian** | HR/Pimpinan menerbitkan **Surat Tugas** (nomor `001/ST/XI/2026`, tujuan, tanggal, karyawan yang ditunjuk + uang harian per orang) sebagai **dasar** uang harian. Untuk tiap penerima dan **tiap perjalanan** diterbitkan **Bukti Penerimaan Uang Harian** (`001/BPUH/XI/2026`) dengan **blok tanda tangan yang sama dengan slip gaji** + kotak tanda tangan basah penerima (dan kotak meterai bila > Rp 5 juta). **Berdiri sendiri di luar slip gaji**: tidak menyentuh komponen, perhitungan, maupun PDF slip. Dibekukan (snapshot + trigger), nomor per tahun, dibatalkan beralasan (bukti hanya Super Admin), karyawan melihat & mengunduh miliknya (*Surat Tugas Saya*). |
| **Dokumen (kontrak kerja)** | Unggah **PDF kontrak bermaterai bertanda tangan basah** (hasil pindai, hanya PDF, ≤ `MAX_DOCUMENT_UPLOAD_MB`) per karyawan, **dilihat langsung di aplikasi** (penampil PDF dalam dialog / tab baru / unduh). Tanggal berakhir kosong = tanpa batas waktu. **Pimpinan diberi notifikasi H-3 bulan** sebelum kontrak berakhir (ditegaskan H-1 bulan & H-14 hari selama belum diputuskan) untuk memutuskan **lanjut / tidak** (Super Admin; tidak lanjut wajib beralasan). Lanjut → HR mengunggah kontrak perpanjangan (menutup pengingat kontrak lama). Dokumen tidak dihapus (arsip beralasan); karyawan melihat dokumennya sendiri (*Dokumen Saya*). |
| **Kebijakan cuti per karyawan** | Tiap karyawan punya kebijakan cuti sendiri: **berhak sejak** (bawaan: mulai bekerja + masa kerja minimum, 12 bulan), **kuota/tahun**, dan **boleh saldo negatif** — masing-masing ikut bawaan lembaga atau **dikhususkan** (wajib alasan, diaudit, karyawan diberi tahu). Contoh: karyawan A bekerja > 1 tahun mendapat 12 hari; karyawan B baru 2 bulan **belum berhak** (pengajuan cuti ditolak dengan alasan jelas; izin/sakit tetap boleh). Pemberian kuota tahunan mengikuti kebijakan masing-masing (yang belum berhak dilewati). |

Batasan yang jujur (lokasi palsu tidak 100% dapat dicegah di web, integrasi WhatsApp/email belum diuji ke penyedia sungguhan, tabel pajak wajib diverifikasi) ada di [docs/KEPUTUSAN-BISNIS.md](docs/KEPUTUSAN-BISNIS.md).

## Trilogika Internal Portal — Training & Operations

Modul untuk satu siklus pelatihan: **program → proyek/batch → tim → tugas & checklist → jadwal → peserta → instruktur/asesor → dokumen → penutupan → laporan**.
Memakai akun, karyawan, audit, dan penyimpanan berkas HRIS yang sudah ada; hanya menambah tabel `training_*` (tidak mengubah tabel HRIS).

| Area | Isi |
|---|---|
| **Akses** | Role HRIS **tidak diubah**. Di atasnya: *level modul* (Pemantau · Admin Program · Manajer Program, diatur Super Admin) + *peran proyek* (PIC · Admin Program · PJ Peserta · PJ Materi · PJ Dokumentasi · Staf). Admin HRIS **tidak otomatis** punya akses. Direktur (Super Admin) kelola penuh seperti Manajer Program; jumlah pemegang level Manajer Program tidak dibatasi. Proyek di luar lingkup menjawab 404. |
| **Antarmuka portal** | Sidebar maroon (dapat disembunyikan, grup dapat dilipat), bilah atas dengan **pencarian cepat Ctrl+K** (menu + proyek dalam lingkup akses), notifikasi, dan menu pengguna; beranda per peran (sapaan, **banner pesan Direktur yang dapat diubah** untuk broadcast ke seluruh karyawan, menu utama, kartu ringkasan, grafik aktivitas, proyek saya, kalender, aktivitas terbaru) — semua angka dari data nyata. |
| **Dashboard** | Per peran (Staf, Admin Program, Manajer Program, Direktur), dihitung dari data nyata dengan definisi indikator tertulis. Persentase tidak dikarang: angka ringkasan dashboard dihitung dari data, sedangkan indikator terformula ada di baris **Pemantauan**. |
| **Pemantauan** | Indikator **Ketepatan Waktu (SPI), Kesiapan (IKP vs target), Beban Tim, proyeksi peserta, kepadatan kelas paralel** menurut dokumen *Indikator Pemantauan Program Pelatihan v1.0*; status program = terburuk dari ketiganya + pemicu Merah. Parameter (bobot, ambang warna, template milestone, jam standar, kapasitas) **diubah Direktur di aplikasi** (*Rumus Indikator*, berversi, dapat dikembalikan) — rumus tetap di kode. **Eskalasi otomatis** (Kuning/Merah/terlambat/beban), aturan **Kuning berturut-turut**, dan **pengingat tenggat H-1/hari-H** dikirim oleh pekerja harian (idempoten); catatan pemulihan ditulis di portal. |
| **Proyek** | Kode `TRN-2026-0001` (aman saat dibuat bersamaan), alur Draf → Persiapan → Berjalan → Selesai/Dibatalkan, cari/filter/urut, penanda "perlu perhatian", detail 9 tab, riwayat aktivitas. |
| **Tugas & checklist** | Prioritas, tenggat, komentar, "Tugas Saya"; tugas "perlu diperiksa" tidak dapat disetujui penanggung jawabnya sendiri. Template checklist **disalin** ke proyek; item wajib menentukan penutupan. |
| **Jadwal** | Daftar & kalender bulanan WIB; peringatan bentrok ruangan/instruktur lintas proyek. |
| **Peserta & instruktur** | Data operasional lokal (input manual); kontak hanya untuk yang berwenang; instruktur internal ditautkan ke karyawan, eksternal tanpa akun. |
| **Dokumen** | Privat (PDF/PNG/JPEG), izin diperiksa pada setiap unduhan. |
| **Penutupan** | Checklist wajib harus selesai; pengecualian hanya Manajer Program dengan alasan tertulis; sesudahnya proyek baca-saja (dapat dibuka kembali). |
| **Referensi** | Surat tugas HRIS ditautkan sebagai referensi (tabel milik modul; surat tugas tetap beku). Referensi Website/HaloAI/Sistem Keuangan dicatat **manual — belum ada integrasi**. |

Aktifkan di development: set `TRAINING_MODULE_ENABLED="true"` di `.env`, `npm run db:migrate`, `npm run db:seed:dev`, `npm run db:seed:training-demo`.
Peran & keputusan untuk pemilik sistem: [docs/TRAINING-PERAN.md](docs/TRAINING-PERAN.md). Audit, arsitektur, staging/UAT, deployment, rollback: [docs/TRAINING-OPS.md](docs/TRAINING-OPS.md).

## Teknologi

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Tailwind CSS 4 · PostgreSQL 16 · Prisma 6 · `@react-pdf/renderer` · ExcelJS · Zod · Vitest · Playwright.
Alasan pemilihan: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Mulai cepat (lokal)

Prasyarat: **Node.js ≥ 22**, **PostgreSQL ≥ 14**, dan `poppler-utils` (hanya untuk tes PDF).

```bash
npm ci
cp .env.example .env            # isi DATABASE_URL, TEST_DATABASE_URL, DATA_ENCRYPTION_KEY (openssl rand -base64 32)
createdb trilogika_hris && createdb trilogika_hris_test

npm run db:migrate              # terapkan migrasi
npm run db:seed:dev             # data DEMO fiktif + akun demo (password dicetak sekali / dari DEV_SEED_PASSWORD)
npm run dev                     # http://localhost:3000
```

Akun demo (**hanya untuk pengujian**, ditandai banner kuning di aplikasi): `pimpinan@`, `hr@`, `ayu@`, `budi@`, `citra@` `demo.hris.test`.
Seed demo **menolak** berjalan bila `NODE_ENV=production`, host database bukan lokal, atau database sudah berisi data.

**Produksi** memakai `npm run db:seed` (bukan `:dev`): membuat jadwal default + **satu** Super Admin dari `ADMIN_EMAIL`/`ADMIN_PASSWORD`
(tanpa password default; gagal bila lemah). Panduan lengkap: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` / `build` / `start` | Pengembangan / build produksi / jalankan build |
| `npm run lint` · `typecheck` | ESLint · TypeScript strict |
| `npm test` | Unit + integrasi (PostgreSQL `TEST_DATABASE_URL`; tabelnya dikosongkan) |
| `npm run test:e2e` | E2E Playwright (build produksi + DB test; di sandbox: `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium`) |
| `npm run db:migrate` · `db:seed` · `db:seed:dev` · `db:seed:training-demo` | Migrasi · seed produksi · seed demo HRIS · seed demo Training & Operations (hanya dev/staging lokal) |
| `npm run db:backup` · `db:restore` · `db:verify` | Cadangan · pemulihan · verifikasi hasil pemulihan |
| `npm run user:create` | Buat akun dari terminal (pemulihan akses) |
| `npm run typecheck` | Pemeriksaan tipe (strict) |

## Dokumentasi

- [PANDUAN-PENGGUNA](docs/PANDUAN-PENGGUNA.md) — setup awal & penggunaan per peran
- [KEPUTUSAN-BISNIS](docs/KEPUTUSAN-BISNIS.md) — **hal yang perlu Anda tentukan sebelum operasional** + keterbatasan
- [ARCHITECTURE](docs/ARCHITECTURE.md) — struktur, basis data, cara status & gaji dihitung
- [SECURITY](docs/SECURITY.md) — kontrol keamanan & privasi
- [AUDIT](docs/AUDIT.md) — hasil audit pra-PR (temuan & perbaikan, uji silang waktu/zona, sapuan rute API, uji antar sistem, latihan pemasangan) dan **batasannya**
- [DEPLOYMENT](docs/DEPLOYMENT.md) — konfigurasi, Docker, cadangan/pemulihan
- [API](docs/API.md) — daftar endpoint (termasuk `/api/training/*`)
- [TRAINING-OPS](docs/TRAINING-OPS.md) — modul Training & Operations: audit, arsitektur, model data, feature flag, staging/UAT, deployment, rollback, rancangan integrasi
- [TRAINING-PERAN](docs/TRAINING-PERAN.md) — peran & hak akses modul, usulan pemetaan dari bagan organisasi, keputusan untuk pemilik sistem
