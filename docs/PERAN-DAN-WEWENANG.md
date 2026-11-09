# Peran & Wewenang — penyelarasan dengan Buku SOP Trilogika Edutama Rev 0.5

Dokumen ini adalah rujukan tunggal **siapa memegang wewenang apa di Trilogika Internal Portal** setelah penyelarasan dengan
Buku SOP Rev 0.5 (9 November 2026). Modul Training & Operations dirinci lebih lanjut di [TRAINING-PERAN.md](./TRAINING-PERAN.md);
alur atasan–bawahan di [ORGANISASI-ATASAN.md](./ORGANISASI-ATASAN.md); keamanan di [SECURITY.md](./SECURITY.md).

## 1. Model peran: lima sumbu, bukan "satu role per jabatan"

| Sumbu | Nilai | Siapa yang mengatur | Mengubah apa |
|---|---|---|---|
| **Role akun** (tidak diubah) | Karyawan · Admin/HR · Super Admin (tampil sebagai "Direktur (Super Admin)") | Direktur (Admin/HR dan Super Admin); HR (Karyawan) | Menu & izin HRIS |
| **Tingkat jabatan** (baru, `Employee.jobLevel`) | Staf · Supervisor · Manajer | HR atau Direktur, di kartu *Organisasi* karyawan; berlaku-sejak + riwayat | Label, petunjuk hierarki, dan hak **Pemantau otomatis** bagi Manajer |
| **Atasan langsung** (sudah ada) | hubungan atasan–bawahan | HR | Siapa meninjau cuti/izin/sakit/lembur; menu *Persetujuan Tim* |
| **Level modul Training** | Pemantau · Admin Program · **Koordinator Program** | Direktur (menu *Akses Training*) | Wewenang lintas proyek |
| **Peran proyek** (sudah ada) | PIC · Admin Program · PJ Peserta · PJ Materi · PJ Dokumentasi · Staf Pelaksana | Koordinator / PIC per proyek | Wewenang pada satu proyek |

"Supervisor" dan "Manajer" **bukan role keamanan**. Wewenang nyata mereka di portal berasal dari **hubungan atasan** (menyetujui
tim) dan **level Training**, dua mekanisme yang sudah ada dan teruji. Menambah role global berarti menyentuh seluruh matriks
izin HRIS yang berjalan.

### Tingkat jabatan disimpan eksplisit

Tingkat **tidak** diturunkan dari bentuk pohon atasan: bawahan Manajer Marketing & Relations (Admisi 1/2, Social Media) tidak
punya bawahan lagi, sehingga dari pohon saja mereka akan terbaca Supervisor. HR/Direktur mengisinya di kartu *Organisasi*
(sama seperti jabatan: dengan tanggal mulai berlaku, tercatat tambah-saja di riwayat dan Audit Log). Validasi hierarki bersifat
**petunjuk lunak** (mis. atasan seorang Manajer sebaiknya Direktur) dan tidak memblokir penyimpanan. Direktur dikenali dari
role Super Admin, bukan dari kolom tingkat; **Direktur perlu punya data karyawan yang tertaut ke akun Super Admin** agar dapat
menjadi atasan.

### Manajer otomatis = Pemantau Training

SOP memberi Manajer Operasional tugas memeriksa bentrok jadwal dan Manajer Marketing & Relations tugas menerima Jadwal Induk,
sehingga keduanya perlu melihat seluruh program. Karena itu tingkat **Manajer** otomatis berhak sebagai **Pemantau**
(melihat semua proyek; **tidak** mengubah apa pun; kontak dan berkas peserta tetap tersembunyi). Hak ini **dihitung saat
berjalan**, tidak disimpan di tabel akses, sehingga ikut hilang bila tingkatnya berubah. Level yang diberikan Direktur secara
manual **menimpa** hak otomatis (mis. Manajer yang diberi Admin Program berfungsi sebagai Admin Program). Halaman *Akses
Training* menandai "Pemantau (otomatis: tingkat Manajer)".

### Koordinator Program (dulu "Manajer Program")

Level modul `MANAGER` diganti nama di database menjadi `COORDINATOR` (migrasi `20261109090000_roles_job_level_coordinator`)
agar tidak bentrok dengan tingkat jabatan "Manajer". Secara fungsi, Koordinator Program = **Supervisor Administrasi &
Kurikulum** (PIC SOP ADK/001, 002, 004, 009). Ditunjuk **manual oleh Direktur**; jumlah pemegangnya tidak dibatasi.

## 2. Matriks wewenang (cakupan portal)

| Wewenang | Karyawan | Supervisor | Manajer | Admin/HR | Koordinator Program | Direktur |
|---|:-:|:-:|:-:|:-:|:-:|:-:|
| Layanan mandiri (presensi, cuti, lembur, slip) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Meninjau pengajuan **bawahan langsung** | — | ✓ | ✓ | memantau | — | ✓ |
| Eskalasi bila atasan tidak ada | — | ✓ | ✓ | — | — | ✓ |
| Data karyawan, jadwal, absensi, dokumen | — | — | — | ✓ | — | ✓ |
| **Menyiapkan** gaji & penyelesaian akhir | — | — | — | ✓ | — | ✓ (bawaan) |
| **Menyetujui** gaji & penyelesaian akhir | — | — | — | — | — | ✓ |
| Melihat seluruh program (Pemantau, tanpa kontak peserta) | — | — | ✓ **otomatis** | — | ✓ | ✓ |
| Membuat & mengelola program/proyek, menetapkan PIC, menutup proyek | — | — | — | — | ✓ | ✓ |
| Mengatur akses Training & rumus indikator | — | — | — | — | — | ✓ |
| Audit Log, akun semua peran, pengaturan | — | — | — | akun Karyawan | — | ✓ |

Catatan keputusan (9 November 2026):

- **Fungsi Admin/HR dipegang Direktur** sampai Direktur memberi role Admin/HR kepada seseorang. Menyiapkan **dan** menyetujui gaji
  oleh Direktur diperbolehkan (tidak ada larangan menyiapkan-lalu-menyetujui sendiri); jejaknya tetap di Audit Log.
- Manajer Operasional dan Manajer Marketing & Relations **setara**; dibedakan lingkup domain, yang mengikuti **divisi** orangnya.
- Tidak ada pengunci rangkap fungsi. Larangan memproses **pengajuan milik sendiri** tetap berlaku (konflik kepentingan).
- Persetujuan jadwal cukup dicatat sebagai **butir checklist** proyek (template mengikuti SOP ADK/004), tanpa alur persetujuan baru.

## 3. Aturan karyawan berstatus Magang

SOP: Magang **tanpa wewenang persetujuan dan akses data**. Ditegakkan di tiga lapis:

1. **Pintu pemberian** (service) — satu modul pusat `src/server/services/function-guard.ts`:
   role akun Admin/HR/Super Admin, level modul Training, peran proyek PIC / Admin Program / PJ Peserta, atasan langsung,
   pengganti peninjau, dan tingkat Supervisor/Manajer **ditolak** untuk Magang.
2. **Saat berjalan** (`src/lib/training/access.ts`) — walau data menyimpang (mis. baris diubah langsung di database), akun
   Magang tidak punya level, tidak melihat daftar peserta, dan wewenang proyeknya dipangkas ke **melihat + mengunggah dokumen**.
3. **Database** — CHECK `employees_intern_staff_level`: Magang hanya boleh bertingkat Staf.

**Daftar peserta** (menu Peserta, tab Peserta, API) tertutup bagi Magang; **angka agregat** di dashboard tetap tampil.
**Mengubah status menjadi Magang diblok** selama karyawan masih memegang salah satu fungsi di atas; pesan galat menyebut daftar
yang harus dicabut dulu (sistem tidak mencabut otomatis).

## 4. Pemetaan jabatan SOP → portal

| Jabatan (SOP/bagan) | Role akun | Tingkat | Level Training | Catatan |
|---|---|---|---|---|
| Direktur Utama | Super Admin | — | penuh (bawaan) | Memegang fungsi Admin/HR sampai ada role HR; tanda tangan Berita Acara Jadwal (butir checklist) |
| Manajer Operasional & Keuangan | Karyawan | Manajer | Pemantau otomatis | Memeriksa bentrok jadwal; atasan Supervisor Adm & Kurikulum dan Supervisor IT |
| Manajer Marketing & Relations | Karyawan | Manajer | Pemantau otomatis | Menerima Jadwal Induk; atasan Admisi 1/2 dan Social Media |
| Supervisor Administrasi & Kurikulum | Karyawan | Supervisor | **Koordinator Program** (manual) | PIC jadwal induk, silabus, instruktur |
| Supervisor IT & Web Development | Karyawan | Supervisor | — | Atasan: Manajer Operasional, lalu Direktur |
| Staf Adm & Kurikulum / Fasilitator | Karyawan | Staf | Admin Program (manual) | |
| Staf Administrasi Umum / Keuangan | Karyawan | Staf | — | PJ Peserta per proyek |
| Staf Admisi 1 / 2, Social Media | Karyawan | Staf | — | |
| Peserta Magang | Karyawan (status **Magang**) | Staf | **tidak dapat** | Aturan bagian 3 |

Admin/HR tidak ada di SOP; fungsi ini sementara dipegang Direktur.

## 5. Konfigurasi awal (data, bukan kode)

| Hal | Isi |
|---|---|
| Divisi | "Administrasi & Kurikulum" dan "Marketing & Relations" |
| Atasan langsung | Manajer Ops dan Manajer M&R → Direktur; Supervisor Adm & Kurikulum → Manajer Ops; Supervisor IT → Manajer Ops; Admisi 1/2 dan Social Media → Manajer M&R; Magang → Social Media |
| Tingkat jabatan | Sesuai tabel bagian 4 (kartu *Organisasi*) |
| Jadwal kerja | Shift 1: 08.00–16.30 (kantor); Shift 2: 13.00–21.30 (dari rumah); Senin–Jumat |
| Kebijakan absensi (global) | Foto absensi **Wajib** + wajib sertakan koordinat; absensi berbasis lokasi (radius kantor) **dimatikan** (`locationEnabled=false`); mode risiko lokasi *Tandai saja* |
| Level Training | Supervisor Adm & Kurikulum → Koordinator Program (ditunjuk Direktur); Manajer otomatis Pemantau |

Tentang absensi shift 2: kode sudah menyimpan koordinat dan cap waktu pada foto absensi dan menyediakan tautan peta di rekap
karyawan, sehingga "yang penting tag lokasi terlihat" cukup dengan konfigurasi di atas. Kebijakan berlaku untuk **semua**
karyawan (tidak per shift); foto lama dihapus otomatis sesuai masa simpan, jejak teks koordinat tetap ada.

## 6. Template checklist proyek (SOP ADK/004, 008, 009)

Template standar proyek baru disesuaikan SOP, termasuk "Jadwal diperiksa bebas bentrok sumber daya (Manajer Operasional &
Keuangan)" dan "Berita Acara Persetujuan Jadwal ditandatangani (Direktur)" (`DEFAULT_TEMPLATE_ITEMS` di
`src/lib/training/misc.ts`). Template tetap dapat diubah Koordinator Program/Direktur di aplikasi; perubahan hanya memengaruhi
proyek baru.

## 7. Migrasi & penerapan

- Migrasi `20261109090000_roles_job_level_coordinator`: rename nilai enum `TrainingLevel` `MANAGER` → `COORDINATOR` (data akses
  ikut berganti otomatis), enum `JobLevel` + kolom `employees.jobLevel` (bawaan `STAFF`), kolom `jobLevel` pada riwayat organisasi,
  CHECK Magang. Aditif; pembalikan = rename sebaliknya.
- **Produksi tidak disentuh oleh pekerjaan ini.** Terapkan dengan `npm run db:migrate` setelah **membuat cadangan**. Setelah
  migrasi, semua karyawan bertingkat Staf; HR perlu mengisi tingkat Supervisor/Manajer di kartu *Organisasi*.
- Belum dibangun (sengaja): kolom *Tingkat* pada impor karyawan dan input tingkat pada formulir tambah karyawan — tingkat
  diisi lewat kartu *Organisasi* (bawaan Staf).
