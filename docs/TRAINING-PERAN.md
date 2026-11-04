# Training & Operations — Peran & Hak Akses (untuk pemilik sistem)

Dokumen ini menjawab satu pertanyaan: **siapa boleh melakukan apa di modul Training & Operations**, dan bagaimana
memetakannya ke **bagan organisasi LPK Trilogika Edutama (SOP Rev. 0.5)**. Bagian [Keputusan](#keputusan-yang-perlu-anda-ambil)
di bawah adalah hal yang hanya Anda yang bisa memutuskan.

## 1. Mengapa bukan "satu role per jabatan"

Di HRIS, jabatan (`employees.position`) hanyalah **teks bebas**, dan role global hanya tiga: Super Admin, Admin/HR, Karyawan.
Kalau izin dipasang pada jabatan, tiga hal ini terjadi:

| Situasi nyata | Akibatnya bila izin menempel pada jabatan |
|---|---|
| Orang berpindah jabatan / merangkap (umum di organisasi kecil) | Izin berubah diam-diam, atau kode harus diubah |
| Satu orang memegang dua topi (mis. Staf Adm. & Kurikulum yang juga Fasilitator Kelas) | Satu jabatan tidak cukup mewakili |
| Satu proyek butuh orang dari divisi lain (mis. Staf Admisi membantu in-house training) | Orang itu harus diberi izin luas hanya demi satu proyek |

**Rancangan yang dipakai: hak akses melekat pada *orang* dan *penugasan*, bukan pada teks jabatan.** Ada dua lapis, dan role HRIS
tidak disentuh sama sekali:

```
Role global HRIS (tidak diubah)     Super Admin · Admin/HR · Karyawan     → HRIS: presensi, cuti, slip gaji, dsb.
        +
Level modul (per akun, opsional)    Pemantau · Admin Program · Manajer Program   → apa yang boleh LINTAS proyek
        +
Peran proyek (per penugasan)        Project Manager (PIC) · Admin Program · PJ Peserta ·
                                    PJ Materi · PJ Dokumentasi · Staf Pelaksana   → apa yang boleh PADA proyek itu
```

Akibat yang Anda rasakan:

- **Anggota proyek tidak perlu izin luas.** Cukup ditambahkan ke proyek dengan peran yang sesuai.
- **Pergantian orang = satu klik** (akhiri penugasan, tambahkan penggantinya). Tidak ada kode yang berubah.
- **Offboarding otomatis.** Menonaktifkan karyawan di HRIS sudah menonaktifkan akun dan mencabut sesinya, sehingga akses
  Training ikut hilang. Tugas yang ia tinggalkan ditandai **"sudah tidak di tim — alihkan"** dan dihitung di dashboard risiko.
- **Tidak ada akses tambahan ke data sensitif.** Level modul dan peran proyek *tidak* memberi akses slip gaji, presensi, cuti,
  atau data HR lain. Direktori karyawan di modul ini hanya memuat nama, no. induk, jabatan, dan divisi.
- **Admin/HR bukan otomatis Admin Program.** Admin HRIS tanpa level/keanggotaan tidak melihat modul ini sama sekali (404).
- **Pemeriksa ≠ pelaksana.** Tugas yang ditandai "perlu diperiksa" tidak dapat disetujui oleh penanggung jawabnya sendiri
  (selaras dengan SOP ADK yang memisahkan Pembuat, Pemeriksa, dan Penyetuju).

## 2. Usulan pemetaan berdasarkan bagan organisasi

> Ini **usulan**. Layar *Akses Training* menampilkan kolom "Usulan" dengan logika yang sama, tetapi **tidak pernah menerapkannya
> otomatis** — Super Admin yang memutuskan dan setiap perubahan tercatat di Audit Log.

| Jabatan (bagan) | Role HRIS | Level modul (usulan) | Peran proyek yang lazim | Catatan |
|---|---|---|---|---|
| **Direktur Utama** | Super Admin | *(bawaan)* melihat semua + mengatur akses | — | Hanya-lihat sampai Anda memberi diri sendiri level Manajer Program (lihat Keputusan 1) |
| **Manajer Operasional & Keuangan** | sesuai kebutuhan HR | **Manajer Program** | Project Manager | Kendali operasional; menutup/membatalkan proyek |
| **Supervisor Administrasi & Kurikulum** | Karyawan | **Manajer Program** | PIC / Admin Program | Memegang jadwal induk, materi, instruktur. *Bagan tidak punya jabatan "Manajer Program"; fungsinya dijalankan supervisor ini.* |
| **Staf Adm. & Kurikulum** (Fasilitator Kelas) | Karyawan | **Admin Program** | Admin Program / PJ Materi | Boleh membuat proyek; mengelola hanya proyek yang ia ikuti |
| **Staf Administrasi Umum** (Verifikator Pembayaran) | Karyawan | tanpa level | **PJ Peserta** | Registrasi, logistik, berkas peserta: satu-satunya peran biasa yang melihat kontak & berkas peserta |
| **Supervisor IT & Web Development** | Karyawan | tanpa level | Staf Pelaksana | Platform daring/tracking |
| **Staf Administrasi Keuangan** | Karyawan | tanpa level | — | Invoice, kwitansi, honor ada di **Sistem Keuangan**, bukan modul ini |
| **Manajer Marketing & Relations** | Karyawan | **Pemantau** *(opsional)* | — | Memantau status in-house dari B2B; kontak peserta tetap tersembunyi |
| **Staf Admisi 1 / 2** | Karyawan | tanpa level | Staf Pelaksana *(bila terlibat)* | Prospek & lead tetap di HaloAI |
| **Staf Social Media Specialist** | Karyawan | tanpa level | PJ Dokumentasi *(bila terlibat)* | Hanya mengunggah dokumentasi |
| **Peserta Magang Sosial Media** | Karyawan | tanpa level | PJ Dokumentasi, *hanya* pada proyek tanpa data peserta | Sesuai bagan: *tanpa wewenang persetujuan & akses data* |
| **Instruktur Tetap / Tidak Tetap** | tidak punya akun | — | dicatat di **Direktori Instruktur / Asesor** | Karyawan internal ditautkan ke data karyawan; eksternal cukup kontak operasional |
| **LSP BNSP / Akuntan Eksternal** | tidak punya akun | — | — | Pihak eksternal, di luar portal |

Label SOP keuangan pada bagan (Pembuat, Pemeriksa, Penyetuju, Rekonsiliator, Verifikator Pembayaran, Pemohon Invoice) adalah peran
**di Sistem Keuangan**. Modul ini tidak menyalinnya dan tidak mengubah akses invoice/pembayaran.

## 3. Matriks hak akses

### 3a. Lintas proyek (level modul)

Keputusan 4 Nov 2026: **Direktur/Super Admin boleh mengubah data proyek** (kelola penuh seperti Manajer Program); jumlah pemegang level Manajer Program **tidak dibatasi**.

| Kemampuan | Super Admin | Pemantau | Admin Program | Manajer Program |
|---|:-:|:-:|:-:|:-:|
| Melihat **semua** proyek, dashboard lintas proyek, laporan | ✓ | ✓ | — *(hanya proyek yang diikuti)* | ✓ |
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

### 3b. Pada satu proyek (peran proyek)

| Kemampuan | Manajer Program / Super Admin | PIC | Admin Program | PJ Peserta | PJ Materi / PJ Dokumentasi | Staf | Pemantau |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| Melihat proyek, tugas, jadwal, peserta (tanpa kontak), dokumen | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Mengubah data proyek | ✓ | ✓ | ✓ | — | — | — | — |
| Draf → Persiapan → Berjalan | ✓ | ✓ | — | — | — | — | — |
| **Menutup / membatalkan / membuka kembali proyek** | ✓ | — | — | — | — | — | — |
| Mengatur tim (selain PIC) | ✓ | ✓ | — | — | — | — | — |
| Menetapkan / mengganti PIC | ✓ | — | — | — | — | — | — |
| Membuat, menugaskan, memeriksa tugas | ✓ | ✓ | ✓ | — | — | — | — |
| Mengubah status **tugas miliknya** + berkomentar | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
| Mengelola checklist (terapkan template, tambah/hapus item) | ✓ | ✓ | ✓ | — | — | — | — |
| Menandai item checklist **miliknya** selesai | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |
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
- Proyek **Selesai/Dibatalkan** bersifat baca-saja; hanya Manajer Program yang dapat membuka kembali yang Selesai (dengan alasan).
- Penanggung jawab tugas **harus anggota aktif proyek**.
- Menautkan **surat tugas** juga butuh izin HRIS `assignment:view_all`. Modul ini hanya menampilkan nomor, tujuan, tanggal, dan status — **tidak** nominal uang harian atau daftar penerima.
- Penutupan: semua **checklist wajib** harus selesai. Pengecualian hanya oleh Manajer Program, dengan alasan tertulis; item yang dilewati tercatat di riwayat.

## Status keputusan

| # | Keputusan | Status | Catatan |
|---|---|---|---|
| 1 | **Direktur/Super Admin boleh mengubah data proyek?** | ✅ **Diputuskan: YA** (4 Nov 2026) | Diterapkan di kode & tes. Pemisahan "memantau vs mengeksekusi" tidak lagi dipakai; setiap perubahan tetap tercatat di audit dengan nama pelaku. |
| 2 | **Siapa yang memegang level Manajer Program?** | ✅ **Diputuskan: Direktur yang memberi akses, tanpa batas jumlah** | Tidak ada pembatasan 1–2 orang di kode; ada tes yang membuktikan banyak pemegang. Setiap pemberian/pencabutan tercatat. |
| 3 | **Izinkan dokumen Word/PowerPoint/Excel?** | ⏳ **Penjelasan diberikan; menunggu keputusan Anda** | Lihat penjelasan di bawah. Sampai diputuskan: hanya PDF/PNG/JPEG. |
| 4 | **Retensi & penghapusan permanen dokumen** | ⏳ **Menunggu persetujuan Direktur** | Belum dibangun apa pun: tidak ada penghapusan otomatis maupun permanen. "Hapus" tetap = disembunyikan. Setelah masa retensi diputuskan, ditambah aksi penghapusan permanen khusus Direktur (beralasan, tercatat di audit). |
| 5 | **Rumus indikator beban tim, kesiapan, ketepatan waktu** | ✅ **Diputuskan: memakai dokumen v1.0, dapat diedit di aplikasi** | Rumus tetap di kode; semua angka (bobot, ambang, template, jam standar, kapasitas) diubah Direktur di *Rumus Indikator* — berversi, dapat dikembalikan. Rincian & tafsir: TRAINING-OPS.md §3a. |
| 6 | **Batas ukuran dokumen** | Bawaan | `MAX_DOCUMENT_UPLOAD_MB` = 10 MB, disimpan di PostgreSQL. Volume foto dokumentasi besar sebaiknya pindah ke penyimpanan objek (butuh persetujuan & konfigurasi). |
| 7 | **Manajer Marketing & Relations sebagai Pemantau** | Bawaan: tidak diberi | Beri bila ingin memantau pelaksanaan in-house tanpa bertanya ke tim. |

### Soal #3 — untuk apa "pemeriksaan keamanan tambahan" pada file Word/PowerPoint/Excel?

Singkatnya: PDF dan gambar relatif "pasif" (tampilannya saja), sedangkan file Office adalah **wadah yang bisa membawa program**.

- **Makro**: file `.docm/.xlsm/.pptm` dan format lama `.doc/.xls/.ppt` dapat memuat kode (VBA) yang jalan otomatis saat dibuka. Ini pintu masuk malware paling umum lewat dokumen.
- **Objek tertanam & tautan luar**: Office bisa menyisipkan file lain di dalamnya atau menarik data dari alamat internet saat dibuka — dipakai untuk mencuri data atau memicu unduhan.
- **Berkas ZIP yang disamarkan**: `.docx/.xlsx/.pptx` sebenarnya arsip ZIP. Arsip yang dirancang jahat ("zip bomb") kecil saat diunggah tetapi membengkak berlipat-lipat saat dibuka dan dapat melumpuhkan server.
- **Pemeriksaan isi**: untuk PDF/PNG/JPEG kami cukup memverifikasi tanda pengenal berkas (magic bytes). Untuk Office, pemeriksaan sejenis tidak cukup: perlu memeriksa struktur arsip, menolak makro/objek berbahaya, dan membatasi ukuran setelah dibuka. Aplikasi ini **belum punya pemindai malware**.

Dampak ke operasional: instruktur/PJ materi sering memegang materi dalam PowerPoint/Word, tetapi PDF memenuhi hampir semua kebutuhan arsip proyek (ekspor satu kali).

**Usulan** (bila Anda ingin mengizinkan): hanya `.docx/.xlsx/.pptx` (bukan format makro/lama), diperiksa struktur arsipnya + batas ukuran terurai, ditolak bila ada makro/objek tertanam/tautan luar, selalu diunduh sebagai lampiran (tidak dibuka di peramban), dan ditambah pemindai malware bila infrastrukturnya tersedia.
**Alternatif paling aman & tanpa biaya**: tetap PDF/PNG/JPEG (instruktur mengekspor ke PDF). Beri tahu pilihan Anda — sebelum itu, tidak ada perubahan.
