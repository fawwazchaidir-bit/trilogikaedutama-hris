# Hal yang perlu Anda tentukan sebelum operasional

Aplikasi sengaja **tidak mengunci** kebijakan perusahaan. Semua di bawah ini adalah *pengaturan yang dapat diubah* dengan nilai awal yang
**perlu dikonfirmasi**. Tanda ⚠ = berdampak pada uang karyawan.

## 1. Absensi & jadwal
| # | Keputusan | Nilai awal di aplikasi | Dimana diatur |
|---|---|---|---|
| 1 | Hari & jam kerja, toleransi keterlambatan | Sen–Jum 08.00–16.00, toleransi 15 mnt | Jadwal & Libur |
| 2 | Batas jam "tidak hadir" (hari berjalan) | 12.00 | Jadwal & Libur |
| 3 | ⚠ Menit terlambat dihitung dari **jam masuk** atau **setelah toleransi** | Dari jam masuk (masuk 08.21 = 21 mnt) | Pengaturan → Kebijakan |
| 4 | **Hari libur nasional & cuti bersama** tahun berjalan | Kosong (demo hanya memuat 5 tanggal tetap sebagai *contoh*) | Jadwal & Libur — input manual dari SKB resmi |
| 5 | Jadwal khusus (Ramadan, shift) & siapa yang berlaku | Tidak ada | Jadwal & Libur → Penugasan |
| 6 | Absensi berbasis lokasi: perlu atau tidak, titik, radius, WFH/lapangan | Nonaktif | Pengaturan → Kebijakan |
| 7 | Berapa hari ke belakang izin/sakit boleh diajukan | 7 hari | Pengaturan → Kebijakan |

## 2. Cuti
| # | Keputusan | Nilai awal |
|---|---|---|
| 8 | ⚠ Kuota cuti tahunan | 12 hari (contoh) — sesuaikan dengan kebijakan & ketentuan berlaku |
| 9 | Hak cuti karyawan baru/kontrak/magang, masa tunggu, sisa cuti tahun lalu (carry-over), cuti khusus (menikah, melahirkan, dll.) | **Tidak otomatis** — atur saldo per karyawan (Atur saldo). Tidak ada carry-over otomatis. |
| 10 | Saldo boleh minus? | Tidak |
| 11 | Izin & sakit memotong saldo cuti? | Tidak (hanya cuti yang memotong) |

## 3. Penggajian ⚠
| # | Keputusan | Nilai awal |
|---|---|---|
| 12 | Potongan keterlambatan (per kali / per menit) | **Nonaktif** |
| 13 | Potongan ketidakhadiran (nominal/hari atau gaji ÷ pembagi) | **Nonaktif** |
| 14 | Izin / sakit / cuti ikut memotong gaji? | Izin ya, sakit & cuti tidak (hanya berlaku bila poin 13 aktif) |
| 15 | Lembur: manual atau otomatis dari jam pulang; tarif; minimal/maksimal menit | Manual |
| 16 | **BPJS Kesehatan/Ketenagakerjaan & PPh 21**: tarif, dasar pengenaan, siapa menanggung | **Tidak ada tarif bawaan.** Input sebagai komponen per karyawan (nominal atau % gaji pokok). Verifikasi dengan konsultan pajak/BPJS. |
| 17 | Gaji prorata untuk karyawan masuk/berhenti di tengah periode | **Tidak otomatis** — gunakan *penyesuaian* beralasan |
| 18 | Periode gaji & cut-off absensi, tanggal pembayaran | Dibuat per periode |
| 19 | Siapa yang menyetujui gaji | Super Admin (satu-satunya yang dapat menyetujui/membatalkan) |
| 20 | Format nomor slip | `SG-YYYYMM-Rnn-nnn` (awalan dapat diubah) |

## 4. Akses, privasi, & operasional
| # | Keputusan |
|---|---|
| 21 | Kebijakan **password** (min. 12 karakter, bukan yang umum) & kanal pengiriman password sementara. Tidak ada 2FA & tidak ada "lupa password" mandiri via email — reset oleh Admin/HR. |
| 22 | **Retensi data** (berapa lama data absensi/gaji/audit disimpan) dan dasar persetujuan karyawan atas data pribadi & lokasi — konsultasikan kewajiban pelindungan data pribadi yang berlaku. |
| 23 | **Cadangan:** lokasi penyimpanan di luar server, jadwal (harian disarankan), enkripsi arsip, target pemulihan, dan penyimpanan terpisah **`DATA_ENCRYPTION_KEY`** (hilang = nomor rekening tak terbaca). |
| 24 | Hapus akun/data demo: produksi memakai `db:seed` (tanpa data demo). Jangan jalankan seed demo di server produksi. |
| 25 | Hosting, HTTPS, domain, monitoring, dan siapa yang mengelola server/database. |

## Keterbatasan saat ini (jujur)

- **Belum ada:** laporan & analisis lanjutan (Tahap 2), notifikasi email/WhatsApp/push (hanya dalam aplikasi), lupa-password mandiri, 2FA/SSO, edit profil oleh karyawan, multi-lokasi kantor, selfie (sengaja tidak dibuat).
- **Belum didukung:** shift yang melewati tengah malam, cuti setengah hari, lembur dengan alur persetujuan, penghitungan BPJS/PPh 21 otomatis, prorata gaji otomatis, pelacakan sisa pinjaman (kasbon hanya sebagai potongan berjangka), carry-over cuti otomatis.
- **Lokasi perangkat tidak menjamin anti-manipulasi** (aplikasi lokasi palsu dapat mengakali); fungsinya alat bantu.
- **Satu rentang jam per hari** per jadwal; satu penugasan aktif per target pada satu waktu.
- **Docker:** `Dockerfile` & `docker-compose.yml` disediakan dan mode `standalone` yang dipakainya sudah diuji berjalan, tetapi image **belum dibuild** di lingkungan pengembangan ini (tanpa daemon Docker). Uji `docker compose up --build` di server Anda.
- Angka dan tarif pada **data demo** (termasuk "BPJS 1%") hanya contoh.
