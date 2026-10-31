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
| 6 | **Shift lintas tengah malam** (mis. 22.00–06.00): jam pulang lebih awal dari jam masuk = berakhir esok harinya. Shift milik **tanggal ia dimulai**; masa tenggang check-out **6 jam** setelah jam pulang; batas "tidak hadir" boleh dini hari berikutnya; durasi maks. 16 jam | Tidak ada | Jadwal & Libur |
| 7 | Absensi berbasis lokasi: perlu atau tidak, titik, radius, WFH/lapangan | Nonaktif | Pengaturan → Kebijakan |
| 8 | **Pencegahan lokasi palsu**: *tandai saja* (disarankan awal) / *tolak yang berisiko sangat tinggi* / mati; daftar **jaringan kantor** (butuh `TRUST_PROXY=true`); mewajibkan jaringan kantor (hanya untuk non-lapangan) | Tandai saja | Pengaturan → Kebijakan |
| 9 | Berapa hari ke belakang izin/sakit/lembur boleh diajukan | 7 hari | Pengaturan → Kebijakan |

## 2. Cuti
| # | Keputusan | Nilai awal |
|---|---|---|
| 10 | ⚠ Kuota cuti tahunan | 12 hari (contoh) — sesuaikan dengan kebijakan & ketentuan berlaku |
| 11 | Hak cuti karyawan baru/kontrak/magang, masa tunggu, sisa cuti tahun lalu (carry-over), cuti khusus (menikah, melahirkan, dll.) | **Tidak otomatis** — atur saldo per karyawan (Atur saldo, boleh kelipatan 0,5). Tidak ada carry-over otomatis. |
| 12 | Saldo boleh minus? | Tidak |
| 13 | Izin & sakit memotong saldo cuti? | Tidak (hanya cuti yang memotong) |
| 14 | **Setengah hari** (izin/sakit/cuti, pagi atau siang): batas pagi/siang = **titik tengah jam kerja** (08.00–16.00 → 12.00). Dihitung 0,5 hari pengajuan + 0,5 hari kerja; bila separuh lainnya tanpa check-in → 0,5 tidak hadir. Satu pengajuan terbuka per tanggal (tidak bisa pagi + siang terpisah — ajukan sehari penuh) | Tersedia |

## 3. Penggajian ⚠
| # | Keputusan | Nilai awal |
|---|---|---|
| 15 | Potongan keterlambatan (per kali / per menit) | **Nonaktif** |
| 16 | Potongan ketidakhadiran (nominal/hari atau gaji ÷ pembagi) | **Nonaktif** |
| 17 | Izin / sakit / cuti ikut memotong gaji? | Izin ya, sakit & cuti tidak (hanya berlaku bila poin 16 aktif) |
| 18 | **Lembur**: *Manual* / ***Hanya yang disetujui & terbukti di absensi*** (disarankan) / *Otomatis dari jam pulang* (tanpa persetujuan); tarif tetap per jam **atau** gaji pokok ÷ pembagi (mis. 173); pengali jam pertama/berikutnya per hari (mis. 1,5× / 2×); minimal/maksimal menit per hari; apakah dibayar hanya sebesar yang terbukti di absensi | **Manual** |
| 19 | **BPJS & PPh 21 otomatis**: nonaktif. Bila diaktifkan: tarif iuran, batas upah, PTKP, tabel TER, lapisan Pasal 17, pengali tanpa NPWP — **semua dapat diubah dan WAJIB Anda verifikasi** (lihat §5) | **Nonaktif** |
| 20 | Komponen potongan kategori BPJS/Pajak yang diisi **manual** per karyawan *menggantikan* perhitungan otomatis untuk karyawan itu | Berlaku |
| 21 | Atribut per karyawan: status PTKP (TK/0…K/3), punya NPWP, peserta BPJS Kesehatan/Ketenagakerjaan. Karyawan baru berstatus magang otomatis bukan peserta BPJS | TK/0, punya NPWP, peserta (magang: bukan) |
| 22 | Komponen pendapatan mana yang masuk **dasar upah BPJS** dan **penghasilan kena pajak** (per komponen) | Gaji pokok + tunjangan jabatan masuk dasar BPJS; semua pendapatan kena pajak |
| 23 | Gaji prorata untuk karyawan masuk/berhenti di tengah periode | **Tidak otomatis** — gunakan *penyesuaian* beralasan |
| 24 | Periode gaji & cut-off absensi, tanggal pembayaran | Dibuat per periode |
| 25 | Siapa yang menyetujui gaji | Super Admin (satu-satunya yang dapat menyetujui/membatalkan) |
| 26 | Format nomor slip | `SG-YYYYMM-Rnn-nnn` (awalan dapat diubah) |

## 4. Akses, privasi, notifikasi & operasional
| # | Keputusan |
|---|---|
| 27 | Kebijakan **password** (min. 12 karakter, bukan yang umum). **Lupa password mandiri** (email, tautan 30 menit sekali pakai) aktif bila SMTP dikonfigurasi; reset oleh Admin/HR tetap tersedia. |
| 28 | **2FA (TOTP)**: opsional untuk semua; Super Admin dapat **mewajibkannya untuk Admin/HR & Super Admin**. Tentukan siapa yang menyimpan kode pemulihan Super Admin — kehilangan semua Super Admin ber-2FA tanpa kode pemulihan memerlukan pemulihan lewat terminal (`npm run user:create`). |
| 29 | **Notifikasi email/WhatsApp**: pilih penyedia WhatsApp (Fonnte / Meta Cloud API / webhook sendiri), akun, biaya, dan persetujuan penerima (pelindungan data pribadi). Pesan hanya ringkasan + tautan; angka gaji tidak pernah dikirim. |
| 30 | **Retensi data** (berapa lama data absensi/gaji/audit/lokasi disimpan) dan dasar persetujuan karyawan atas data pribadi & lokasi — konsultasikan kewajiban pelindungan data pribadi yang berlaku. |
| 31 | **Cadangan:** lokasi penyimpanan di luar server, jadwal (harian disarankan), enkripsi arsip, target pemulihan, dan penyimpanan terpisah **`DATA_ENCRYPTION_KEY`** (hilang = nomor rekening & rahasia 2FA tak terbaca). |
| 32 | Hapus akun/data demo: produksi memakai `db:seed` (tanpa data demo). Jangan jalankan seed demo di server produksi. |
| 33 | Hosting, HTTPS, domain, monitoring, dan siapa yang mengelola server/database. |

## 5. ⚠ Wajib diverifikasi sebelum BPJS/PPh 21 otomatis dipakai

Nilai bawaan ditulis berdasarkan ketentuan yang diketahui saat pengembangan dan **bukan nasihat pajak/BPJS**. Anda (atau konsultan) perlu mencocokkan:

- **Tabel TER (PMK 168/2023)** — kategori A (TK/0, TK/1, K/0), B (TK/2, TK/3, K/1, K/2), C (K/3). Pemetaan kategori dan jumlah lapisan (44/40/41) cocok dengan sumber publik, tetapi **ambang & tarif per lapisan harus Anda cocokkan** dengan lampiran peraturan.
- **PTKP** (54 juta + 4,5 juta per status/tanggungan), **biaya jabatan** (5%, maks. 500 ribu/bulan), **lapisan Pasal 17** (5/15/25/30/35%), **pengali tanpa NPWP** (120%).
- **Tarif & batas upah BPJS**: Kesehatan 1%/4% (batas upah 12 juta), JHT 2%/3,7%, JP 1%/2% (**batas upah JP berubah tiap tahun** — nilai bawaan 10.547.400 adalah contoh, perbarui), JKK 0,24% (kelas risiko I; ubah sesuai kelas Anda), JKM 0,3%.
- **Aturan perhitungan** yang diambil aplikasi: bruto = pendapatan kena pajak − potongan absensi/keterlambatan + premi Kesehatan/JKK/JKM yang dibayar perusahaan; Januari–November memakai TER; **masa pajak terakhir** (Desember atau karyawan berhenti pada periode itu) dihitung setahun dan dikurangi PPh yang sudah dipotong (butuh periode gaji sebelumnya berstatus Disetujui/Diterbitkan di sistem; bila tidak lengkap ada peringatan). PTKP & biaya jabatan diprorata untuk karyawan yang bekerja kurang dari setahun. Hasil negatif (lebih potong) dibulatkan ke 0 dengan peringatan — tidak dikembalikan otomatis.
- Pembulatan: half-up pada tiap komponen (belum tentu sama dengan kebiasaan konsultan/aplikasi pajak Anda — cocokkan pada beberapa sampel).

Mengubah konfigurasi **mencabut konfirmasi aturan penggajian**; gaji tidak dapat disetujui sampai Super Admin mengonfirmasi ulang.

## Keterbatasan saat ini (jujur)

- **Lokasi palsu tidak dapat dicegah 100%** oleh aplikasi web. Pencegahan bersifat berlapis: kesegaran pembacaan, akurasi/presisi tidak wajar, titik persis di pusat kantor, koordinat identik berulang/antar karyawan, perpindahan mustahil, perangkat baru/dipakai bergantian, dan **jaringan kantor** (satu-satunya sinyal yang tidak bergantung pada GPS). Skor adalah **indikator untuk ditinjau HR**, bukan bukti. Seseorang yang mengendalikan permintaan (mis. memanggil API langsung) tetap dapat mengirim data buatan — mitigasinya jaringan kantor wajib + tinjauan HR. Penanda "mock location" sungguhan hanya tersedia bila nanti dibuat aplikasi pembungkus (Android/iOS) yang mengirim `mocked`.
- Posisi dari Wi-Fi/jaringan (laptop) sering identik tiap hari; karena itu sinyal "koordinat identik" hanya berlaku untuk akurasi setara-GPS (< 25 m).
- **Notifikasi WhatsApp/email belum diuji terhadap penyedia sungguhan** di lingkungan pengembangan (tidak ada kredensial): pembentukan permintaan, antrean, percobaan ulang, dan pencatatan galat diuji dengan pengirim tiruan. Uji dengan "Kirim email/WhatsApp uji" di *Keamanan & Notifikasi* sebelum diandalkan. WhatsApp Cloud API memerlukan template yang disetujui Meta untuk pesan di luar jendela 24 jam.
- Pekerja pengiriman berjalan di dalam proses aplikasi (tiap 30 detik); untuk beberapa instance aman (SKIP LOCKED). Lonjakan besar notifikasi (ratusan karyawan sekaligus saat slip terbit) terkirim bertahap.
- **Belum ada:** SSO, edit profil oleh karyawan, multi-lokasi kantor, selfie (sengaja tidak dibuat), pelacakan sisa pinjaman (kasbon hanya potongan berjangka), carry-over cuti otomatis, prorata gaji otomatis, PPh 21 untuk penghasilan tidak teratur/pesangon/THR dengan tarif khusus (gunakan komponen sekali + verifikasi manual), PPh 21 ditanggung perusahaan (gross-up), K/I (penghasilan istri digabung), kategori TER harian.
- **Lembur:** satu pengajuan terbuka per karyawan per tanggal; pengali jam per hari (bukan per hari libur/kerja berbeda seperti ketentuan lembur hari libur) — untuk lembur hari libur dengan tarif berbeda, gunakan komponen/penyesuaian manual.
- **Penyesuaian pendapatan manual** tidak ikut dasar PPh 21/BPJS otomatis (peringatan ditampilkan); catat bonus sebagai komponen sekali (ONE_TIME) agar ikut terhitung.
- **Satu rentang jam per hari** per jadwal; satu penugasan aktif per target pada satu waktu.
- **Docker:** `Dockerfile` & `docker-compose.yml` disediakan dan mode `standalone` yang dipakainya sudah diuji berjalan, tetapi image **belum dibuild** di lingkungan pengembangan ini (tanpa daemon Docker). Uji `docker compose up --build` di server Anda.
- Angka dan tarif pada **data demo** (termasuk "BPJS 1%") hanya contoh.
