# Training & Operations — Peran & Hak Akses (untuk pemilik sistem)

Dokumen ini menjawab satu pertanyaan: **siapa boleh melakukan apa di modul Training & Operations**, dan bagaimana
memetakannya ke **bagan organisasi LPK Trilogika Edutama (SOP Rev. 0.5)**. Penyelarasan peran lintas portal (tingkat jabatan, aturan Magang, Pemantau otomatis) dirinci di
[PERAN-DAN-WEWENANG.md](./PERAN-DAN-WEWENANG.md); dokumen ini fokus ke modul Training & Operations.

## 1. Mengapa bukan "satu role per jabatan"

Di HRIS, jabatan (`employees.position`) hanyalah **teks bebas**, dan role global hanya tiga: Super Admin, Admin/HR, Karyawan.
Kalau izin dipasang pada jabatan, tiga hal ini terjadi:

| Situasi nyata | Akibatnya bila izin menempel pada jabatan |
|---|---|
| Orang berpindah jabatan / merangkap (umum di organisasi kecil) | Izin berubah diam-diam, atau kode harus diubah |
| Satu orang memegang dua topi (mis. Staf Adm. & Kurikulum yang juga Fasilitator Kelas) | Satu jabatan tidak cukup mewakili |
| Satu proyek butuh orang dari divisi lain (mis. Staf Admisi membantu in-house training) | Orang itu harus diberi izin luas hanya demi satu proyek |

**Rancangan yang dipakai: hak akses melekat pada *orang* dan *penugasan*, bukan pada teks jabatan.** Role HRIS tidak disentuh;
modul ini menambah dua lapis, dan *Tingkat jabatan* hanya memberi satu hak otomatis (Pemantau untuk Manajer):

```
Role global HRIS (tidak diubah)     Super Admin (Direktur) · Admin/HR · Karyawan     → HRIS: presensi, cuti, slip gaji, dsb.
        +
Tingkat jabatan (atribut karyawan)  Staf · Supervisor · Manajer                      → Manajer otomatis = Pemantau modul ini
        +
Level modul (per akun, opsional)    Pemantau · Admin Program · Koordinator Program   → apa yang boleh LINTAS proyek
        +
Peran proyek (per penugasan)        Project Manager (PIC) · Admin Program · PJ Peserta ·
                                    PJ Materi · PJ Dokumentasi · Staf Pelaksana       → apa yang boleh PADA proyek itu
```

Level modul yang diberikan manual **menimpa** hak otomatis dari tingkat Manajer. Akun karyawan berstatus **Magang** tidak dapat
memegang level modul, peran PIC / Admin Program / PJ Peserta, atau melihat daftar peserta (lihat bagian 3c).

Akibat yang Anda rasakan:

- **Anggota proyek tidak perlu izin luas.** Cukup ditambahkan ke proyek dengan peran yang sesuai.
- **Pergantian orang = satu klik** (akhiri penugasan, tambahkan penggantinya). Tidak ada kode yang berubah.
- **Offboarding otomatis.** Menonaktifkan karyawan di HRIS sudah menonaktifkan akun dan mencabut sesinya, sehingga akses
  Training ikut hilang. Tugas yang ia tinggalkan ditandai **"sudah tidak di tim — alihkan"** dan dihitung di dashboard risiko.
- **Hak "pemilik" tugas/checklist = penanggung jawab DAN anggota aktif.** Nama di kolom penanggung jawab saja tidak cukup. Anggota yang sudah
  dikeluarkan dari tim tetapi masih punya akses lihat (Pemantau, termasuk otomatis untuk tingkat Manajer) **dapat melihat** proyek dan tugas lamanya,
  tetapi **tidak dapat mengubah status tugas atau menandai checklist** atas namanya (pesan: *"Anda sudah tidak menjadi anggota aktif proyek ini …"*); tombolnya
  tidak ditawarkan, dan tugasnya tidak muncul di *Tugas Saya*, lencana terlambat, maupun daftar checklist saya. Pemeriksaan keanggotaan dibaca ulang di
  dalam transaksi dengan kunci baris (tidak ada celah balapan). Pengelola proyek (PIC/Koordinator/Direktur) tetap dapat bertindak atas nama; ditambahkan
  kembali ke tim memulihkan hak itu. Pemantau yang **masih anggota aktif** dan diberi tugas bekerja seperti biasa.
- **Mengakhiri anggota hanya memperingatkan** (tidak menolak): dialog menampilkan jumlah tugas & item checklist yang masih dipegang, hasilnya dilaporkan
  dan dicatat di audit ("perlu dialihkan"). Tugas tidak dialihkan otomatis — itu keputusan PIC.
- **Tidak ada akses tambahan ke data sensitif.** Level modul dan peran proyek *tidak* memberi akses slip gaji, presensi, cuti,
  atau data HR lain. Direktori karyawan di modul ini hanya memuat nama, no. induk, jabatan, dan divisi.
- **Admin/HR bukan otomatis Admin Program.** Admin HRIS tanpa level/keanggotaan tidak melihat modul ini sama sekali (404).
- **Pelaksana, pengirim hasil, dan pemeriksa dipisahkan — tanpa pengecualian.** Pada tugas "perlu diperiksa" tiga identitas disimpan terpisah:
  **pelaksana** (penanggung jawab saat hasil dikirim; salinan yang tidak ikut berubah bila penanggung jawab dialihkan/dikosongkan),
  **pengirim hasil** (akun yang menekan "Kirim ke pemeriksaan", dengan waktunya), dan **pemeriksa** (yang menyelesaikan, dengan waktunya).
  Pemeriksa harus **berbeda** dari pengirim hasil, pelaksana saat dikirim, **dan** penanggung jawab saat ini (selaras dengan SOP ADK yang
  memisahkan Pembuat, Pemeriksa, dan Penyetuju). Jadi PIC yang mengirim hasil atas nama staf tidak dapat memeriksanya sendiri — Koordinator
  Program, Direktur, atau pengelola lain yang memeriksa. Ditegakkan di service **dan** trigger database (`training_tasks_review_guard`); tidak
  ada jalur pengecualian. Tampil di kartu tugas: *Pelaksana · Dikirim oleh · Diperiksa oleh*. Siklus dikosongkan saat hasil ditarik/dikembalikan/dibuka
  kembali (riwayat ada di audit).
- **Mengubah syarat pemeriksaan setelah pekerjaan dimulai wajib beralasan.** Mengganti/mengosongkan penanggung jawab atau menyalakan/mematikan
  "perlu diperiksa" pada tugas yang sudah Dalam proses/Menunggu pemeriksaan/Selesai membutuhkan **alasan** (≥ 5 karakter), dicatat di audit
  (alasan, sebelum/sesudah) **dan** sebagai komentar tugas yang terlihat tim. Sebelum dimulai bebas. **Pelaksana tidak boleh mematikan kewajiban
  pemeriksaan tugasnya sendiri** (kapan pun); saat Menunggu pemeriksaan kewajiban itu tidak dapat dimatikan sama sekali. Tugas lama yang sedang menunggu
  pemeriksaan diisi pengirimnya dari audit saat migrasi.

## 2. Usulan pemetaan berdasarkan bagan organisasi

> Ini **usulan**. Layar *Akses Training* menampilkan kolom "Usulan" dengan logika yang sama, tetapi **tidak pernah menerapkannya
> otomatis** — Super Admin yang memutuskan dan setiap perubahan tercatat di Audit Log.

| Jabatan (bagan) | Role HRIS | Level modul (usulan) | Peran proyek yang lazim | Catatan |
|---|---|---|---|---|
| **Direktur Utama** | Super Admin | *(bawaan)* kelola penuh semua proyek + mengatur akses & rumus indikator | — | Keputusan 4 Nov 2026: Direktur boleh mengubah data proyek |
| **Manajer Operasional & Keuangan** | sesuai kebutuhan HR | **Pemantau otomatis** (tingkat Manajer); level manual bila perlu mengelola | Project Manager | SOP: memeriksa bentrok jadwal sebelum Berita Acara. Kontak peserta tetap tersembunyi kecuali diberi level manual |
| **Supervisor Administrasi & Kurikulum** | Karyawan | **Koordinator Program** *(ditunjuk manual oleh Direktur)* | PIC / Admin Program | Memegang jadwal induk, materi, instruktur (PIC ADK/001, 002, 004, 009). *Bagan tidak punya jabatan "Koordinator Program"; fungsinya dijalankan supervisor ini.* |
| **Staf Adm. & Kurikulum** (Fasilitator Kelas) | Karyawan | **Admin Program** | Admin Program / PJ Materi | Boleh membuat proyek; mengelola hanya proyek yang ia ikuti |
| **Staf Administrasi Umum** (Verifikator Pembayaran) | Karyawan | tanpa level | **PJ Peserta** | Registrasi, logistik, berkas peserta: satu-satunya peran biasa yang melihat kontak & berkas peserta |
| **Supervisor IT & Web Development** | Karyawan | tanpa level | Staf Pelaksana | Platform daring/tracking |
| **Staf Administrasi Keuangan** | Karyawan | tanpa level | — | Invoice, kwitansi, honor ada di **Sistem Keuangan**, bukan modul ini |
| **Manajer Marketing & Relations** | Karyawan | **Pemantau otomatis** (tingkat Manajer) | — | Menerima Jadwal Induk dan memantau status in-house dari B2B; kontak peserta tetap tersembunyi. Setara dengan Manajer Operasional — dibedakan domain (divisi) |
| **Staf Admisi 1 / 2** | Karyawan | tanpa level | Staf Pelaksana *(bila terlibat)* | Prospek & lead tetap di HaloAI |
| **Staf Social Media Specialist** | Karyawan | tanpa level | PJ Dokumentasi *(bila terlibat)* | Hanya mengunggah dokumentasi |
| **Peserta Magang Sosial Media** | Karyawan (status **Magang**) | **tidak dapat diberi level** | Staf Pelaksana / PJ Materi / PJ Dokumentasi saja | Sesuai bagan: *tanpa wewenang persetujuan & akses data*. Ditegakkan sistem — lihat bagian 3c |
| **Instruktur Tetap / Tidak Tetap** | tidak punya akun | — | dicatat di **Direktori Instruktur / Asesor** | Karyawan internal ditautkan ke data karyawan; eksternal cukup kontak operasional |
| **LSP BNSP / Akuntan Eksternal** | tidak punya akun | — | — | Pihak eksternal, di luar portal |

Label SOP keuangan pada bagan (Pembuat, Pemeriksa, Penyetuju, Rekonsiliator, Verifikator Pembayaran, Pemohon Invoice) adalah peran
**di Sistem Keuangan**. Modul ini tidak menyalinnya dan tidak mengubah akses invoice/pembayaran.

## 3. Matriks hak akses

### 3a. Lintas proyek (level modul)

Keputusan 4 Nov 2026: **Direktur/Super Admin boleh mengubah data proyek** (kelola penuh seperti Koordinator Program); jumlah pemegang level Koordinator Program **tidak dibatasi**.

| Kemampuan | Super Admin | Pemantau | Admin Program | Koordinator Program |
|---|:-:|:-:|:-:|:-:|
| Melihat **semua** proyek, dashboard lintas proyek, laporan | ✓ | ✓ *(termasuk otomatis untuk tingkat Manajer)* | — *(hanya proyek yang diikuti)* | ✓ |
| Membuat proyek baru | ✓ | — | ✓ | ✓ |
| Menetapkan Project Manager (PIC) | ✓ | — | — | ✓ |
| Mengelola program & template checklist | ✓ | — | — | ✓ |
| Mengelola direktori instruktur/asesor (+ melihat kontaknya) | ✓ | — | ✓ | ✓ |
| Mengubah data pada proyek mana pun | ✓ | — | — | ✓ |
| Mengatur level modul siapa pun | **✓** | — | — | — |
| **Melihat** rumus & parameter indikator | ✓ | ✓ | ✓ | ✓ |
| **Mengubah** rumus & parameter indikator (versi baru, bisa dikembalikan) | **✓** | — | — | — |
| Mengatur kapasitas per staf (paruh waktu, dst.) | ✓ | — | — | ✓ |
| Melihat peta beban **seluruh tim** & kepadatan kelas | ✓ | ✓ | — *(hanya bebannya sendiri)* | ✓ |
| Menerima eskalasi otomatis & pengingat tenggat | sesuai jabatan di Rumus Indikator; selalu jatuh ke Direktur bila penerima tidak terjangkau | — | sebagai penanggung jawab / anggota | sesuai jabatan |

### 3b. Pada satu proyek (peran proyek)

| Kemampuan | Koordinator Program / Super Admin | PIC | Admin Program | PJ Peserta | PJ Materi / PJ Dokumentasi | Staf | Pemantau |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Melihat proyek, tugas, jadwal, dokumen | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Mengubah data proyek | ✓ | ✓ | ✓ | — | — | — | — |
| Draf → Persiapan → Berjalan | ✓ | ✓ | — | — | — | — | — |
| **Menutup / membatalkan / membuka kembali proyek** | ✓ | — | — | — | — | — | — |
| Mengatur tim (selain PIC) | ✓ | ✓ | — | — | — | — | — |
| Menetapkan / mengganti PIC | ✓ | — | — | — | — | — | — |
| Membuat, menugaskan, memeriksa tugas | ✓ | ✓ | ✓ | — | — | — | — |
| Mengubah status **tugas miliknya** + berkomentar | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Mengelola checklist (terapkan template, tambah/hapus item) | ✓ | ✓ | ✓ | — | — | — | — |
| Menandai item checklist **miliknya** selesai | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Melihat **daftar** peserta (tanpa kontak) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Mengelola peserta **+ melihat kontak & dokumen peserta** | ✓ | ✓ | ✓ | ✓ | — | — | — |
| Mengelola jadwal | ✓ | ✓ | ✓ | — | — | — | — |
| Menugaskan instruktur/asesor **+ melihat kontaknya** | ✓ | ✓ | ✓ | — | — | — | — |
| Mengunggah dokumen | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
| Menghapus dokumen orang lain *(pengunggah selalu boleh menghapus miliknya)* | ✓ | ✓ | ✓ | — | — | — | — |
| Menautkan surat tugas / mencatat referensi sistem lain | ✓ | ✓ | — | — | — | — | — |
| Menerapkan template pemantauan; mengubah status item kesiapan, "tidak berlaku" | ✓ | ✓ | ✓ | — | — | — | — |
| Menyelesaikan milestone *(PIC milestone boleh menyelesaikan miliknya sendiri; wajib bukti)* | ✓ | ✓ | ✓ | milik sendiri | milik sendiri | milik sendiri | — |
| Melihat jam kerja per staf pada proyek | ✓ | ✓ | ✓ | hanya miliknya | hanya miliknya | hanya miliknya | ✓ |

Aturan tambahan yang dijaga server:

- Proyek yang **bukan lingkup Anda menjawab 404** (bukan 403): keberadaannya tidak bocor, dan mengganti ID di URL tidak memberi apa-apa.
- Proyek **Selesai/Dibatalkan** bersifat baca-saja; hanya Koordinator Program yang dapat membuka kembali yang Selesai (dengan alasan).
- Penanggung jawab tugas **harus anggota aktif proyek**.
- Menautkan **surat tugas** juga butuh izin HRIS `assignment:view_all`. Modul ini hanya menampilkan nomor, tujuan, tanggal, dan status — **tidak** nominal uang harian atau daftar penerima.
- Penutupan: semua **checklist wajib** harus selesai. Pengecualian hanya oleh Koordinator Program, dengan alasan tertulis; item yang dilewati tercatat di riwayat.

### 3c. Akun berstatus Magang (SOP Rev. 0.5: tanpa wewenang persetujuan & akses data)

Aturan ini ditegakkan di **setiap pintu pemberian** (service) dan **saat berjalan** (lib akses), bukan sekadar anjuran:

| Hal | Perlakuan untuk karyawan berstatus Magang |
|---|---|
| Role akun Admin/HR atau Super Admin | Ditolak (buat akun maupun ubah akun) |
| Level modul Training (semua level) | Ditolak; baris level yang menyusup langsung ke tabel **diabaikan** saat berjalan |
| Peran proyek PIC / Admin Program / PJ Peserta | Ditolak; peran yang menyusup langsung ke tabel dipangkas ke kemampuan **melihat + mengunggah dokumen** |
| Atasan langsung, pengganti peninjau, tingkat Supervisor/Manajer | Ditolak (DB juga menolak lewat CHECK `employees_intern_staff_level`) |
| **Daftar** peserta (menu Peserta, tab Peserta, API) | Tertutup (403); menu disembunyikan. Angka agregat di dashboard tetap tampil |
| **Nama peserta di audit proyek** (tab *Riwayat*, "Aktivitas terbaru" di beranda Training) | **Disembunyikan seluruhnya**: baris `training.participant.*` (tambah, status, konfirmasi, ubah data) tidak ditampilkan, sehingga pembatasan peserta berlaku di semua jalur baca, bukan hanya daftar peserta. Disaring di query (total & halaman akurat); aksi peserta baru otomatis ikut tersaring lewat awalan. Data audit aslinya tidak dihapus (tetap terlihat di Log Audit Super Admin) |
| Dokumen **peserta** (unggah/hapus/dibuka) di audit proyek | Judulnya hanya terlihat oleh pengelola peserta proyek itu (juga berlaku untuk Staf biasa & Pemantau yang tidak berhak membuka dokumennya) |
| Mengubah status karyawan menjadi Magang | **Diblok** selama masih memegang salah satu hal di atas; pesan kesalahan menyebut daftar yang harus dicabut dulu (tidak dicabut otomatis) |

## Status keputusan

| # | Keputusan | Status | Catatan |
|---|---|---|---|
| 1 | **Direktur/Super Admin boleh mengubah data proyek?** | ✅ **Diputuskan: YA** (4 Nov 2026) | Diterapkan di kode & tes. Pemisahan "memantau vs mengeksekusi" tidak lagi dipakai; setiap perubahan tetap tercatat di audit dengan nama pelaku. |
| 2 | **Siapa yang memegang level Koordinator Program?** | ✅ **Diputuskan: Direktur yang memberi akses, tanpa batas jumlah** | Tidak ada pembatasan 1–2 orang di kode; ada tes yang membuktikan banyak pemegang. Setiap pemberian/pencabutan tercatat. |
| 3 | **Izinkan dokumen Word/PowerPoint/Excel?** | ✅ **Diputuskan: TIDAK — PDF/PNG/JPEG saja** (4 Nov 2026) | Materi instruktur diekspor ke PDF. Penjelasan risikonya tetap di bawah sebagai dasar keputusan; bila kelak ingin dibuka, ikuti usulan pemeriksaan di bawah. |
| 4 | **Retensi & penghapusan permanen dokumen** | ⏳ **Menunggu persetujuan Direktur** | Belum dibangun apa pun: tidak ada penghapusan otomatis maupun permanen. "Hapus" tetap = disembunyikan. Setelah masa retensi diputuskan, ditambah aksi penghapusan permanen khusus Direktur (beralasan, tercatat di audit). |
| 5 | **Rumus indikator beban tim, kesiapan, ketepatan waktu** | ✅ **Diputuskan: memakai dokumen v1.0, dapat diedit di aplikasi** | Rumus tetap di kode; semua angka (bobot, ambang, template, jam standar, kapasitas) diubah Direktur di *Rumus Indikator* — berversi, dapat dikembalikan. Rincian & tafsir: TRAINING-OPS.md §3a. |
| 6 | **Batas ukuran dokumen** | Bawaan | `MAX_DOCUMENT_UPLOAD_MB` = 10 MB, disimpan di PostgreSQL. Volume foto dokumentasi besar sebaiknya pindah ke penyimpanan objek (butuh persetujuan & konfigurasi). |
| 7 | **Manajer sebagai Pemantau** | ✅ **Diputuskan: otomatis** (9 Nov 2026) | Tingkat jabatan Manajer = Pemantau (hanya baca, kontak peserta tersembunyi), dihitung saat berjalan. Level manual menimpa; Magang tidak pernah berlaku. |
| 8 | **Nama level "Manajer Program"** | ✅ **Diganti "Koordinator Program"** (9 Nov 2026) | Di database `TrainingLevel.COORDINATOR` (migrasi `20261109090000`), agar tidak rancu dengan tingkat jabatan "Manajer". |
| 9 | **Aturan Magang** | ✅ **Diputuskan** (9 Nov 2026) | Lihat 3c. Mengubah status menjadi Magang diblok bila masih memegang fungsi. |

### Soal #3 — untuk apa "pemeriksaan keamanan tambahan" pada file Word/PowerPoint/Excel?

Singkatnya: PDF dan gambar relatif "pasif" (tampilannya saja), sedangkan file Office adalah **wadah yang bisa membawa program**.

- **Makro**: file `.docm/.xlsm/.pptm` dan format lama `.doc/.xls/.ppt` dapat memuat kode (VBA) yang jalan otomatis saat dibuka. Ini pintu masuk malware paling umum lewat dokumen.
- **Objek tertanam & tautan luar**: Office bisa menyisipkan file lain di dalamnya atau menarik data dari alamat internet saat dibuka — dipakai untuk mencuri data atau memicu unduhan.
- **Berkas ZIP yang disamarkan**: `.docx/.xlsx/.pptx` sebenarnya arsip ZIP. Arsip yang dirancang jahat ("zip bomb") kecil saat diunggah tetapi membengkak berlipat-lipat saat dibuka dan dapat melumpuhkan server.
- **Pemeriksaan isi**: untuk PDF/PNG/JPEG kami cukup memverifikasi tanda pengenal berkas (magic bytes). Untuk Office, pemeriksaan sejenis tidak cukup: perlu memeriksa struktur arsip, menolak makro/objek berbahaya, dan membatasi ukuran setelah dibuka. Aplikasi ini **belum punya pemindai malware**.

Dampak ke operasional: instruktur/PJ materi sering memegang materi dalam PowerPoint/Word, tetapi PDF memenuhi hampir semua kebutuhan arsip proyek (ekspor satu kali).

**Keputusan: PDF/PNG/JPEG saja.** Bila kelak ingin mengizinkan Office, usulannya: hanya `.docx/.xlsx/.pptx` (bukan format makro/lama), diperiksa struktur arsipnya + batas ukuran terurai, ditolak bila ada makro/objek tertanam/tautan luar, selalu diunduh sebagai lampiran (tidak dibuka di peramban), dan ditambah pemindai malware bila infrastrukturnya tersedia.
**Pilihan yang dipakai sekarang (paling aman, tanpa biaya)**: PDF/PNG/JPEG; instruktur mengekspor materi ke PDF.
