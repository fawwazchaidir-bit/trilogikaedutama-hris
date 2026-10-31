# Trilogika HRIS — Mini HRIS Trilogika Edutama

Aplikasi web internal untuk **data karyawan, absensi, rekap otomatis, penggajian, dan slip gaji (PDF)** — Bahasa Indonesia,
responsif (komputer & ponsel), tampilan mengikuti aplikasi invoice Trilogika agar familier.

> **Bukan mockup.** Setiap tombol terhubung ke database PostgreSQL dan diuji: 516 tes unit/integrasi (terhadap PostgreSQL sungguhan)
> dan 59 tes E2E di browser (login → absensi → pengajuan → persetujuan → penggajian → slip PDF → pembatalan/revisi → 2FA → lembur → laporan).
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
| **Lembur dengan persetujuan** | Pengajuan → setujui/kurangi/tolak → dibayar sesuai bukti absensi; tarif tetap atau gaji ÷ pembagi; pengali jam; periode gaji ditandai "Data berubah" bila persetujuan berubah. |
| **BPJS & PPh 21 otomatis** | BPJS (Kesehatan, JHT, JP, JKK, JKM; porsi karyawan & perusahaan), PPh 21 TER + true-up masa pajak terakhir; semua tarif/tabel dapat diubah; komponen manual menggantikan otomatis; konfirmasi Super Admin wajib. **Nonaktif secara bawaan & wajib diverifikasi.** |
| **Lupa password mandiri** | Email, tautan sekali pakai 30 menit, anti-enumerasi, dibatasi, akun ber-2FA wajib kode. |
| **2FA (TOTP)** | Aplikasi autentikator + QR, 10 kode pemulihan, anti-replay, dapat diwajibkan untuk admin, reset oleh Super Admin. |
| **Notifikasi email/WhatsApp** | Selain dalam aplikasi: SMTP, WhatsApp (Fonnte / Meta Cloud API / webhook), antrean transaksional + percobaan ulang, preferensi per pengguna, pesan uji, status antrean di Pengaturan. |
| **Foto absensi bercap** | Foto dari kamera saat check-in/out; **server** mencetak waktu server + koordinat + nama pada foto (tanpa syarat Wi-Fi/jaringan kantor — cocok untuk **dinas luar**), EXIF dibuang, disimpan sebagai bukti append-only, ditinjau HR di rekap & Tinjauan Lokasi. Mati / opsional / wajib. **Bukti untuk ditinjau manusia, bukan jaminan keaslian.** |
| **Pencegahan lokasi palsu** | Penilaian risiko berlapis (kesegaran, akurasi/presisi, titik pusat, koordinat berulang/bersama, perpindahan mustahil, perangkat) → tandai/tolak, antrean Tinjauan Lokasi (memuat tautan foto). **Tidak menjamin anti-manipulasi** — lihat batasan. |
| **Laporan & analisis lanjutan** | `/laporan`: ringkasan eksekutif (KPI vs bulan lalu, tren, temuan), kehadiran, cuti & lembur, biaya SDM, rekap BPJS & PPh 21, headcount & turnover; ekspor Excel/CSV/PDF. |
| Absensi berbasis lokasi · Impor karyawan | Sejak sebelumnya (titik + radius; impor Excel/CSV atomik). |

Batasan yang jujur (lokasi palsu tidak 100% dapat dicegah di web, integrasi WhatsApp/email belum diuji ke penyedia sungguhan, tabel pajak wajib diverifikasi) ada di [docs/KEPUTUSAN-BISNIS.md](docs/KEPUTUSAN-BISNIS.md).

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
| `npm run db:migrate` · `db:seed` · `db:seed:dev` | Migrasi · seed produksi · seed demo |
| `npm run db:backup` · `db:restore` · `db:verify` | Cadangan · pemulihan · verifikasi hasil pemulihan |
| `npm run user:create` | Buat akun dari terminal (pemulihan akses) |
| `npm run typecheck` | Pemeriksaan tipe (strict) |

## Dokumentasi

- [PANDUAN-PENGGUNA](docs/PANDUAN-PENGGUNA.md) — setup awal & penggunaan per peran
- [KEPUTUSAN-BISNIS](docs/KEPUTUSAN-BISNIS.md) — **hal yang perlu Anda tentukan sebelum operasional** + keterbatasan
- [ARCHITECTURE](docs/ARCHITECTURE.md) — struktur, basis data, cara status & gaji dihitung
- [SECURITY](docs/SECURITY.md) — kontrol keamanan & privasi
- [DEPLOYMENT](docs/DEPLOYMENT.md) — konfigurasi, Docker, cadangan/pemulihan
- [API](docs/API.md) — daftar endpoint
