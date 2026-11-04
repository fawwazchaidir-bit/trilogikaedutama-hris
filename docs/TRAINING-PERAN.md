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

| Kemampuan | Super Admin | Pemantau | Admin Program | Manajer Program |
|---|:-:|:-:|:-:|:-:|
| Melihat **semua** proyek, dashboard lintas proyek, laporan | ✓ | ✓ | — *(hanya proyek yang diikuti)* | ✓ |
| Membuat proyek baru | — | — | ✓ | ✓ |
| Menetapkan Project Manager (PIC) | — | — | — | ✓ |
| Mengelola program & template checklist | — | — | — | ✓ |
| Mengelola direktori instruktur/asesor (+ melihat kontaknya) | — | — | ✓ | ✓ |
| Mengatur level modul siapa pun | **✓** | — | — | — |
| Mengubah data pada proyek mana pun | — | — | — | ✓ |

### 3b. Pada satu proyek (peran proyek)

| Kemampuan | Manajer Program | PIC | Admin Program | PJ Peserta | PJ Materi / PJ Dokumentasi | Staf | Pemantau / Super Admin |
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

Aturan tambahan yang dijaga server:

- Proyek yang **bukan lingkup Anda menjawab 404** (bukan 403): keberadaannya tidak bocor, dan mengganti ID di URL tidak memberi apa-apa.
- Proyek **Selesai/Dibatalkan** bersifat baca-saja; hanya Manajer Program yang dapat membuka kembali yang Selesai (dengan alasan).
- Penanggung jawab tugas **harus anggota aktif proyek**.
- Menautkan **surat tugas** juga butuh izin HRIS `assignment:view_all`. Modul ini hanya menampilkan nomor, tujuan, tanggal, dan status — **tidak** nominal uang harian atau daftar penerima.
- Penutupan: semua **checklist wajib** harus selesai. Pengecualian hanya oleh Manajer Program, dengan alasan tertulis; item yang dilewati tercatat di riwayat.

## Keputusan yang perlu Anda ambil

Nilai bawaan sudah aman; ubah hanya bila Anda memutuskan lain.

| # | Keputusan | Bawaan saat ini | Alternatif & dampaknya |
|---|---|---|---|
| 1 | **Apakah Direktur/Super Admin boleh mengubah data proyek?** | Tidak. Hanya memantau, mengatur akses, dan melihat laporan. Untuk mengubah, beri diri sendiri level Manajer Program (tercatat di audit). | Memberi level Manajer Program ke akun Anda secara permanen: lebih praktis, tetapi hilang pemisahan "memantau vs mengeksekusi". |
| 2 | **Siapa yang memegang level Manajer Program?** | Usulan: Manajer Operasional & Keuangan **dan** Supervisor Adm. & Kurikulum. | Hanya Manajer Ops & Keu → lebih ketat, tetapi semua pembuatan PIC, penutupan, dan pembatalan proyek menumpuk di satu orang yang juga memegang keuangan. |
| 3 | **Format dokumen yang diizinkan** | PDF, PNG, JPEG (diverifikasi dari isi berkas). | Menambah Word/PowerPoint/Excel membutuhkan verifikasi berkas Office yang lebih ketat (risiko makro). Sementara, ekspor materi ke PDF. |
| 4 | **Penghapusan permanen & retensi dokumen** | "Hapus" = disembunyikan; berkas tetap ada sebagai jejak. | Kebijakan retensi (mis. 5 tahun lalu dihapus otomatis) perlu keputusan hukum/operasional. |
| 5 | **Rumus indikator "beban tim", "kesiapan kegiatan", "ketepatan waktu"** | Tidak ditampilkan sebagai persen; hanya jumlah tugas terbuka/terlambat per orang. | Sepakati rumus & data masukannya dulu, baru ditambahkan. |
| 6 | **Batas ukuran dokumen** | `MAX_DOCUMENT_UPLOAD_MB` = 10 MB, disimpan di PostgreSQL. | Volume foto dokumentasi besar sebaiknya pindah ke penyimpanan objek (butuh persetujuan & konfigurasi). |
| 7 | **Manajer Marketing & Relations sebagai Pemantau** | Tidak diberi (opsional). | Beri bila ingin memantau pelaksanaan in-house tanpa bertanya ke tim. |
