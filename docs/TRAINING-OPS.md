# Training & Operations — dokumentasi teknis

Modul operasional pelatihan di dalam **Trilogika Internal Portal** (aplikasi HRIS yang sama, satu login, satu database).
Peran & hak akses untuk pemilik sistem: [TRAINING-PERAN.md](TRAINING-PERAN.md).

> **Status:** terimplementasi dan teruji pada lingkungan development. **Belum** dipasang ke staging/production. Modul **mati secara
> bawaan** (`TRAINING_MODULE_ENABLED=false`). Tidak ada migration, deploy, atau seed yang dijalankan pada data production.

## 1. Hasil audit HRIS (fakta dari repository)

| Area | Temuan |
|---|---|
| Stack | Next.js 16 (App Router), React 19, TypeScript strict, Tailwind 4, Prisma 6.19, PostgreSQL 16, Zod 4, Vitest 5, Playwright. Node ≥ 22 (`.nvmrc` 22), **npm** (`package-lock.json`). `AGENTS.md` dibuat otomatis oleh `next dev` (catatan versi Next.js); acuan = README + `docs/`. |
| **Cabang** | Fitur **Surat Tugas & Uang Harian**, dokumen kontrak, dan kebijakan cuti per karyawan hanya ada di cabang `claude/confident-carson-uohdwa` (7 commit setelah merge PR #1). Cabang kerja ini awalnya berisi hasil merge PR #1 saja, **tanpa** fitur itu. Cabang itu digabung (merge, tanpa konflik) ke cabang kerja sebelum pengembangan. `claude/hopeful-bell-ilrk9p` identik dengan PR #1 dan tidak berisi apa pun yang lain. |
| Role | Tepat **3**: `SUPER_ADMIN`, `HR_ADMIN`, `EMPLOYEE` (`src/lib/permissions.ts`). Izin ditegakkan di **service layer** (`assertCan`); halaman terlarang menjawab 404. Tidak ada role "Admin Program/Manajer/Direktur" — dan tidak dibuat (lihat §4). |
| Autentikasi | Cookie sesi opaque (hash SHA-256 di DB), password scrypt, pembatasan percobaan, CSRF via Origin, 2FA TOTP (dapat diwajibkan untuk admin), pembatalan sesi saat akun dinonaktifkan. |
| Karyawan & akun | `employees` ↔ `users` (satu-satu opsional). **Menonaktifkan karyawan menonaktifkan akun dan mencabut semua sesinya.** `employees.position` = teks bebas; `divisions` ada; bagan organisasi tidak dimodelkan. |
| Surat tugas & uang harian | `assignment_letters`, `assignment_assignees`, `daily_allowance_receipts`: **dibekukan oleh trigger** (snapshot) setelah terbit. Karena itu modul ini **tidak menambah kolom** ke tabel tersebut (lihat §5). |
| Berkas | `stored_files` (isi di PostgreSQL `bytea`), diakses lewat `/api/files/:id` yang memeriksa izin per jenis berkas; tipe diverifikasi dari magic bytes (PDF/PNG/JPEG); header `nosniff`, CSP sandbox, `Cache-Control: private, no-store`. **Dipakai ulang**, tidak ada penyimpanan cloud baru. |
| Audit | `audit_logs` append-only (trigger). Dipakai ulang. |
| Master peserta / program / proyek | **Tidak ada** entitas yang setara di repository, sehingga tabel baru dibuat. |
| Lingkungan | Hanya variabel env (`.env.example`), `Dockerfile`, `docker-compose.yml`; **tidak ada konfigurasi staging** di repository. Tidak ada `DATABASE_URL` production di lingkungan pengembangan ini. |
| Kualitas | Lint, `tsc --noEmit`, Vitest (unit + integrasi ke PostgreSQL sungguhan), Playwright E2E (build produksi). |
| Baseline sebelum perubahan | typecheck & lint bersih; unit/integrasi **617 lulus, 1 gagal, 2 dilewati**. Satu kegagalan itu cacat tes **bawaan**: `location.test.ts` membandingkan tanggal **UTC** dengan tanggal **WIB**, sehingga gagal pada pukul 17.00–24.00 UTC (lulus 18/18 dengan `TEST_NOW=2026-11-03T05:00:00Z`; juga lulus ketika jam sandbox masuk 00.00 UTC). Tidak diubah. |

## 2. Arsitektur

```
src/lib/training/            logika MURNI tanpa DB (mudah diuji)
  access.ts                    model akses: level modul × peran proyek → kemampuan
  status.ts                    alur status proyek & tugas
  indicators.ts                definisi indikator dashboard (satu-satunya tempat rumus)
  types.ts · misc.ts · suggest.ts · nav.ts
src/lib/validation/training.ts          skema Zod (pesan Bahasa Indonesia)
src/server/services/training/
  access.ts                    GERBANG keamanan: loadProjectAccess, requireAbility, scope daftar, kelola level
  shared.ts                    audit proyek, validasi UUID, tanggal WIB
  projects.ts                  program · proyek · status · tutup/batal/buka kembali · tim
  work.ts                      tugas · komentar · checklist · template
  operations.ts                jadwal · peserta · instruktur · dokumen · referensi (surat tugas, sistem lain)
  insights.ts                  dashboard per peran · pratinjau penutupan · riwayat · laporan
  document-access.ts           izin membuka berkas dokumen proyek (dipanggil readFileForActor)
src/app/api/training/**      46 route tipis: baca body → panggil service
src/app/(app)/training/**    13 halaman server-rendered + layout (gerbang modul) + loading + error
src/components/training/**   komponen klien untuk form/aksi
prisma/migrations/20261103230905_training_operations/
```

Prinsip yang diikuti dari kode existing: `Actor → assertCan → parseInput(zod) → transaction → writeAudit` pada **setiap** fungsi;
uang tidak dipakai; waktu = jam server WIB; tidak ada cascade delete; pesan galat Bahasa Indonesia.

**Gerbang keamanan.** Setiap service yang menyentuh data proyek memanggil `loadProjectAccess(actor, id)`:
(1) modul harus aktif; (2) ID harus UUID sah; (3) kemampuan dihitung dari level modul + peran proyek aktif; (4) tanpa kemampuan
`view` → **404** (bukan 403) sehingga proyek orang lain tidak dapat dibedakan dari yang tidak ada. Daftar, dashboard, laporan,
kalender, "Tugas Saya", dan unduhan berkas semuanya memakai klausa lingkup yang sama (`accessibleProjectWhere`).

**HTTP 404 pada halaman.** `training/layout.tsx` menjalankan gerbang modul sebelum streaming, sehingga akun tanpa akses modul dan
modul yang dimatikan mendapat HTTP 404 sungguhan. Untuk akun yang *punya* akses modul tetapi tidak berhak atas satu halaman/ID tertentu,
Next.js sudah mengirim status 200 sebelum `notFound()` (efek `loading.tsx`): UI "Halaman tidak ditemukan" tampil dan **tidak ada isi
yang bocor**, namun status HTTP-nya 200. API (`/api/training/*`) selalu menjawab 404/403 sungguhan.

## 3. Model data

22 tabel baru (16 pada migration pertama + 6 pada migration indikator), semua berawalan `training_`. Kunci primer **UUID** (sama dengan HRIS), kolom `createdAt/updatedAt`, relasi `RESTRICT`.

```
users ─< training_access (1:1, level modul)
employees ─< training_project_members >─ training_projects >─ training_programs
                       (peran proyek, endedAt)       │
                                                      ├─< training_tasks ─< training_task_comments (append-only)
                                                      ├─< training_project_checklist_items   (salinan template, milik proyek)
                                                      ├─< training_schedules >─ training_project_instructors >─ training_instructors ─ employees?
                                                      ├─< training_participants               (data operasional lokal, source = MANUAL)
                                                      ├─< training_project_documents >─ stored_files (kind TRAINING_DOCUMENT)
                                                      ├─< training_external_refs              (referensi MANUAL; unik per proyek+sistem+ID)
                                                      └─< training_project_assignment_links >─ assignment_letters (hanya referensi)
training_checklist_templates ─< training_checklist_template_items
                                                      ├─< training_milestones                 (indikator: salinan template; tenggat DIHITUNG, tidak disimpan)
                                                      ├─< training_readiness_items            (indikator: item kesiapan terbobot per komponen)
                                                      └─< training_workload_tasks >─ employees (indikator: jam kerja per staf)
employees ─ training_staff_capacity (pengecualian kapasitas)     training_indicator_config (aktif, id = 1) ─< training_indicator_config_versions (append-only)
```

Hal yang disengaja:

- **Tidak ada tabel pengguna/karyawan/role/permission kedua.** `employeeId` merujuk `employees`; level modul hanya `training_access`.
- **Kode proyek** `TRN-2026-0001`: `(seqYear, seqNo)` unik, dibuat di bawah `pg_advisory_xact_lock` (8 pembuatan serentak diuji menghasilkan 8 kode berurutan unik). Tahun = tahun WIB.
- **Satu anggota aktif per (proyek, karyawan)** dan **satu PIC aktif per proyek** — indeks unik parsial `WHERE "endedAt" IS NULL`.
- **Checklist milik proyek.** Item disalin dari template saat diterapkan (`sourceTemplateName` hanya catatan). Mengubah template tidak mengubah proyek yang ada.
- **Checklist & tugas terpisah** agar satu pekerjaan tidak terhitung dua kali: progres kesiapan = item checklist saja.
- **Peserta ≠ pembayaran ≠ kompetensi.** Tidak ada kolom pembayaran/kompetensi dan tidak ada perubahan status otomatis dari sistem lain.
- **Dokumen**: "hapus" = `deletedAt`; baris & berkas tetap sebagai jejak (trigger melarang `DELETE`).
- **Soft-delete tidak dipakai** pada hal lain: proyek tidak dihapus (diselesaikan/dibatalkan), tugas dibatalkan (bukan dihapus), anggota diakhiri (`endedAt`).

### Alur status proyek (juga dijaga trigger database)

```
Draf ──▶ Persiapan ──▶ Berjalan ──▶ Selesai ──(buka kembali, beralasan, Manajer)──▶ Berjalan
  │          │             │
  └──────────┴─────────────┴──▶ Dibatalkan (final, beralasan, Manajer)
```
Persiapan membutuhkan tanggal lengkap + PIC. Selesai hanya lewat alur penutupan (checklist wajib selesai, atau pengecualian beralasan).

### Definisi indikator dashboard (`src/lib/training/indicators.ts`)

| Indikator | Definisi |
|---|---|
| Proyek aktif | status Persiapan atau Berjalan |
| Tugas terlambat | tugas terbuka (Belum/Proses/Menunggu pemeriksaan) dengan tenggat **< hari ini (WIB)**; hari ini bukan terlambat |
| Progres checklist | item selesai ÷ seluruh item; tanpa item → **"Belum tersedia"** (bukan 0%) |
| Perlu perhatian | proyek **aktif** dengan salah satu: tugas terlambat · checklist wajib belum lengkap dan mulai ≤ 7 hari (atau sudah mulai) · belum ada PIC · lewat tanggal selesai belum ditutup |
| Dashboard Staf | hanya tugas & checklist **miliknya** |

### 3a. Indikator pemantauan — Ketepatan Waktu · Kesiapan · Beban Tim

Sumber: dokumen **"Indikator Pemantauan Program Pelatihan Trilogika Edutama" v1.0 (4 November 2026)**. Rumus ada di `src/lib/training/indicators/engine.ts`
(fungsi murni tanpa database; komentar memuat nomor persamaan dokumen) dan **tidak memuat angka tetap**. Semua angka (ambang warna, bobot, template milestone,
jam standar, kapasitas) ada di `config.ts` (nilai bawaan = dokumen) dan disimpan di database sebagai **konfigurasi berversi** yang dapat diubah Direktur di
**Training → Rumus Indikator** tanpa programmer. Batas warna di dokumen adalah *usulan awal* yang ditinjau setelah tiga bulan data berjalan.

| Indikator | Rumus (nomor mengikuti dokumen) | Warna |
|---|---|---|
| **Ketepatan Waktu** | PV = Σ bobot milestone berlaku dengan tenggat ≤ hari ini; EV = Σ bobot yang selesai ≤ hari ini (selesai lebih awal ikut dihitung); **SPI = EV ÷ PV** | SPI ≥ 0,95 Hijau · ≥ 0,85 Kuning · selain itu Merah |
| **Kesiapan** | s = item selesai ÷ item berlaku per komponen; Peserta: min(1, terkonfirmasi ÷ acuan). **IKP = 100 × Σ w·s ÷ Σ w**. Target hari ini = 100 × Σ w·r ÷ Σ w, r = item berlaku jatuh tempo ÷ item berlaku (Peserta: naik bertahap R01→R09 pada reguler; 0→1 pada tenggat daftar peserta kerjasama). **Selisih = IKP − Target** | selisih ≥ 0 Hijau · ≥ −15 Kuning · selain itu Merah |
| **Proyeksi peserta** (reguler) | Proyeksi = terkonfirmasi + (pendaftar 14 hari terakhir ÷ 14) × hari tersisa sampai tutup pendaftaran (bawaan H-3); **Rasio = Proyeksi ÷ peserta minimum** | ≥ 1,0 Hijau · ≥ 0,8 Kuning · Merah (dan **pemicu Merah** mulai H-4) |
| **Beban Tim** | jam tugas minggu m = jam standar × hari kerja tugas di minggu itu ÷ total hari kerja tugas; kapasitas = (hari kerja − cuti) × jam efektif; **Beban = jam ÷ kapasitas**. Beban program = tertinggi dari staf pemegang milestone, minggu berjalan & depan | ≤ 70% ada ruang · ≤ 90% Hijau (ideal) · ≤ 110% Kuning · di atas Overload (Merah); persen **dibulatkan** dulu |
| **Kepadatan kelas (KP)** | KP = (luring + daring + 2 × hybrid) ÷ fasilitator tersedia pada hari itu | > 1,0 → pemicu Merah |
| **Ketimpangan divisi** | beban tertinggi ÷ rerata divisi (≥ 2 orang) | > 1,5 ditandai |
| **Status program** | **terburuk(Ketepatan Waktu; Kesiapan; Beban)**; pemicu Merah langsung menetapkan Merah | — |

**Pemicu Merah langsung:** milestone kritikal lewat tenggat belum selesai · item kesiapan kritikal belum selesai saat tenggatnya lewat atau masih terbuka pada H-1 ·
KP di atas ambang pada hari program berjalan · program reguler mulai H-4 dengan rasio proyeksi < 0,8.

Contoh perhitungan dokumen §7 (HACCP, BNSP, minimum 15, hari ini H-4) **direproduksi sebagai tes integrasi**: SPI 0,84; IKP 56,0 vs target 65,0 (selisih −9,0); rasio 0,89;
status program Merah (milestone kritikal R06 terlambat 3 hari + item kritikal "Jadwal uji dari LSP" terbuka).

**Cara data masuk**

- Proyek punya jenis program (**Reguler B2C / Kerjasama B2B-B2G**), peserta acuan (minimum / jumlah kontrak), BNSP ya/tidak, tanggal permintaan klien (T) dan tutup pendaftaran.
- Saat program dibuat (bila `autoApplyOnCreate`), **template** disalin menjadi milestone, item kesiapan, dan tugas jam kerja milik program itu. **Tenggat tidak disimpan**: dihitung dari
  H (tanggal mulai), hari terakhir, T, atau milestone lain ± hari (kalender atau hari kerja), sehingga ikut bergeser bila tanggal berubah.
- Milestone selesai **dengan bukti** (tautan/rujukan dokumen, dapat dimatikan di konfigurasi) oleh PIC-nya atau pengelola tugas; dapat dibuka kembali dengan alasan. Semua tercatat di audit.
- Peserta ditandai **terkonfirmasi** secara manual (reguler: pembayaran terverifikasi; kerjasama: nama diterima dari klien). Ini **bukan** status pembayaran dari sistem lain.
- Jam kerja per staf dari Tabel Jam Standar (jam tetap + per peserta + per hari kelas), dibagi rata pada hari kerja jendela tugas; tugas manual tidak pernah ditimpa. Kapasitas bawaan 6 jam/hari Senin–Jumat;
  pengecualian per staf oleh Manajer Program/Direktur; cuti **disetujui** dari HRIS mengurangi kapasitas (hanya tanggal & porsi hari yang dibaca).

**Tafsir & penyesuaian yang saya ambil (perlu Anda ketahui — semuanya dapat ditinjau)**

1. *Beban program* memakai staf pemegang milestone yang **masih terbuka** (dokumen: "pemegang milestone"); staf yang seluruh milestone-nya selesai tidak ikut menentukan kesehatan program itu.
2. Komponen tanpa item yang berlaku (mis. Sertifikasi pada program tanpa BNSP, atau Peserta tanpa acuan) **dikeluarkan** dari IKP dan target; pembagi Σw menormalkan sisanya.
3. Peringatan **Ketimpangan** hanya muncul bila beban tertinggi sudah melewati batas "ada ruang" — bila semua orang masih longgar, rasio besar hanyalah noise dari angka kecil.
4. KP dihitung per **hari kerja** antara tanggal mulai dan selesai proyek berstatus Persiapan/Berjalan; jadwal sesi per hari tidak dipakai. Hari libur kalender HRIS hanya dikecualikan bila opsi diaktifkan (dokumen: tanpa hari libur).
5. Daftar **item kesiapan** di luar contoh dokumen (jumlah per komponen sengaja disamakan dengan contoh §7) adalah usulan awal untuk ditinjau bersama tim.
6. "Peserta acuan" = peserta minimum (reguler) atau jumlah peserta di kontrak (kerjasama).

**Langkah "ukur jam nyata (Minggu 0)"** adalah proses manusia, bukan kode: angkanya diganti lewat Rumus Indikator. Eskalasi otomatis, aturan "Kuning berturut-turut", dan pengingat tenggat sudah dibangun (§3b).

**Siapa melakukan apa:** semua pengguna modul dapat *melihat* rumus dan parameter; **hanya Super Admin** yang mengubah (versi baru, catatan perubahan, dapat dikembalikan ke bawaan — riwayat tidak dihapus,
tabel riwayat di database append-only). Konfigurasi yang rusak (mis. disunting langsung di DB) **tidak pernah dipakai menghitung**: dipakai bawaan dokumen dan ditandai.
Efek perubahan: ambang/bobot/kapasitas/proyeksi/KP/wajib-bukti **langsung** berlaku; template milestone/item dan PIC berlaku untuk **program baru**; jam standar & pemegang jabatan berlaku saat jam kerja dihitung ulang
(otomatis bila tanggal, peserta acuan, moda, atau jenis program berubah; atau tombol "Hitung ulang dari template").

### 3b. Otomasi: snapshot harian, eskalasi, pengingat tenggat

**Pekerja harian** (`src/server/services/training/automation.ts`) berjalan di dalam aplikasi tiap jam (`TRAINING_WORKER`, bawaan menyala bila modul menyala; 5 menit setelah start untuk pertama kali) atau dipicu penjadwal eksternal:
`curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://…/api/internal/training-daily` (404 bila `CRON_SECRET` kosong; 401 bila salah). **Idempoten**: setiap pesan punya kunci unik *per penerima* di `training_reminder_log`, jadi menjalankannya berulang atau di banyak instance tidak menggandakan pesan.
Notifikasi memakai outbox yang sudah ada: dalam aplikasi selalu; email/WhatsApp hanya bila dikonfigurasi dan dipilih pengguna.

| Peristiwa (dokumen §5.2) | Penerima (lewat **jabatan → pemegang jabatan**) | Kunci dedupe (sekali per…) |
|---|---|---|
| Program **Kuning** | PIC program | episode Kuning (hari awal deret) |
| Kuning **2 hari kerja berturut-turut** (ambang dapat diubah) | atasan langsung PIC + PIC; wajib **rencana pemulihan** di portal | episode Kuning |
| Program **Merah** | pelaksana (SPV Kurikulum) — atau Manajer Pemasaran bila penyebabnya proyeksi peserta/jabatan pemasaran — + Manajer Operasional + PIC | episode Merah |
| **Merah pada H-7…H-1** | Manajer Operasional + SPV Kurikulum (+ Manajer Pemasaran untuk kerjasama: klien diberi tahu tertulis) | episode Merah |
| Milestone terlambat > ambang (3 hari) | atasan langsung pemegang **jabatan milestone itu** (naik satu tingkat); tanpa atasan di portal → Direktur | milestone |
| Beban staf Overload **2 minggu berturut-turut** | Manajer Operasional dan Keuangan (bukan orangnya sendiri) | staf + minggu |
| **Pengingat tenggat H-1 dan hari-H**: tugas (Belum/Proses), milestone, item kesiapan, dimulainya pelaksanaan program | penanggung jawab **yang masih boleh membuka proyek** (level modul / Super Admin, atau anggota aktif); bila sudah dikeluarkan dari proyek atau tidak lagi berhak → **PIC program** (tugas diberi judul "Tugas tanpa penanggung jawab aktif…"; milestone/item tanpa penanggung jawab yang berhak → PIC). Program: seluruh anggota aktif | entitas + tanggal tenggat + H-1/H + penerima |

Aturan penting:
- **Deret berturut-turut** dihitung dari *snapshot status harian* (`training_status_snapshots`, satu baris per program per tanggal WIB; pekerja menimpa baris hari yang sama). Hanya **hari kerja** yang dihitung; akhir pekan dilewati (tidak memutus). Hari kerja tanpa snapshot **memutus** deret — tanpa data tidak ada klaim "berturut-turut". Karena status dinilai saat pekerja berjalan, Kuning pagi yang sudah Hijau siang tetap tercatat pagi itu.
- Penerima ditentukan dari konfigurasi (Rumus Indikator → *Eskalasi & pengingat otomatis*): `reportsTo` (atasan per jabatan — **usulan** dari bagan organisasi, HRIS belum menyimpan atasan langsung), peran Merah, dan peran beban. **Tanpa penerima yang dapat dijangkau** (jabatan belum diisi, karyawan nonaktif) → **Direktur (Super Admin)**, agar pesan penting tidak hilang diam-diam.
- Hanya program **Persiapan/Berjalan** yang templatenya sudah diterapkan yang dinilai; Draf, Selesai, Dibatalkan tidak. Karyawan nonaktif tidak menerima pesan.
- **Catatan pemulihan** (`training_recovery_notes`, append-only + audit) ditulis di tab Pemantauan oleh pengelola tugas proyek; hanya catatan, tidak mengubah tenggat (tenggat tetap dihitung dari rumus).
- Setiap jenis pengingat dan eskalasi dapat dimatikan di konfigurasi. Mematikan **tidak** menghapus riwayat.

## 4. Role & hak akses

Role HRIS **tidak diubah**. Dua lapis baru: level modul (`training_access`) dan peran proyek (`training_project_members`).
Matriks lengkap, alasan rancangan, dan usulan pemetaan jabatan: **[TRAINING-PERAN.md](TRAINING-PERAN.md)**.
**Keputusan pemilik sistem (4 Nov 2026):** Direktur/Super Admin **boleh mengubah data proyek** (kelola penuh lintas proyek, sama dengan Manajer Program; hanya Super Admin yang mengatur level akses dan mengubah rumus indikator);
jumlah pemegang level **Manajer Program tidak dibatasi** — Direktur yang memberi akses.
Matriks ditegakkan oleh satu file murni (`src/lib/training/access.ts`) dan diuji di `tests/unit/training-access.test.ts`.

## 5. Perubahan database & migration

Tiga migration baru, **murni aditif**: `20261103230905_training_operations` (modul), `20261104033508_training_indicators` (indikator pemantauan) dan `20261104143000_training_automation` (tabel `training_status_snapshots`, `training_reminder_log`, `training_recovery_notes`; `CHECK` nilai status, trigger append-only catatan pemulihan).

**Migration indikator** — menambah 6 tabel (`training_milestones`, `training_readiness_items`, `training_workload_tasks`, `training_staff_capacity`, `training_indicator_config`,
`training_indicator_config_versions`), 5 tipe enum baru, kolom baru pada `training_projects` (jenis program, peserta min/maks, BNSP, tanggal T, tutup pendaftaran, waktu template diterapkan; semuanya
berdefault/nullable) dan satu kolom nullable `confirmedAt` pada `training_participants`. `CHECK` (bobot/offset/selesai-vs-tidak-berlaku/jam & jendela tugas/kapasitas/konfigurasi tunggal) dan trigger
append-only pada `training_indicator_config_versions`. Tidak ada `DROP`/`RENAME`/`ALTER COLUMN`; baris proyek/peserta lama tetap valid (default `REGULAR`, tanpa template). Proyek yang dibuat **sebelum**
migration ini ditampilkan "Template pemantauan belum diterapkan" sampai tombolnya ditekan (tidak ada backfill otomatis).

**Migration pertama** (modul): tidak ada `DROP`, `RENAME`, atau `ALTER COLUMN`;
satu-satunya `ALTER` pada objek existing adalah `ALTER TYPE "FileKind" ADD VALUE 'TRAINING_DOCUMENT'` (pola yang sama dengan migration sebelumnya).
Migration lama tidak diubah. Model Prisma existing hanya mendapat **relasi balik** (tanpa kolom di tabel `users`, `employees`, `stored_files`, `assignment_letters`).

Isi tambahan SQL (di luar hasil generator Prisma): indeks unik tanpa membedakan huruf (nama program/template), indeks unik parsial (anggota & PIC),
`CHECK` (tanggal, kode, konsistensi Selesai/Dibatalkan, selesai tugas/checklist, tanda waktu), dan 3 trigger:
`training_projects_guard` (alur status sah, proyek tak dapat dihapus, kode tak berubah), `training_project_documents_guard`,
`training_task_comments_append_only`.

**Relasi ke HRIS tanpa menyentuh tabel yang dibekukan.** Referensi proyek ↔ surat tugas disimpan di `training_project_assignment_links`
(milik modul ini, FK ke `assignment_letters` dengan `RESTRICT`). Surat tugas lama **tidak diubah** dan tidak perlu backfill; hubungannya opsional.
Uang harian terhubung lewat surat tugasnya (satu perjalanan = satu surat). Status/persetujuan/pembayaran tetap di HRIS; menjadi anggota proyek
**tidak** membuat atau menyetujui uang harian.

**Risiko penguncian (locking).** `CREATE TABLE`/`CREATE INDEX` pada tabel baru tidak mengunci tabel existing. `ADD VALUE` pada enum berlangsung seketika.
Pembuatan FK dari tabel baru yang masih kosong ke `users`, `employees`, `stored_files`, dan `assignment_letters` mengambil kunci `SHARE ROW EXCLUSIVE`
**sangat singkat** pada tabel yang dirujuk (validasi hanya memindai tabel baru yang kosong), tetapi dapat *mengantre* di belakang transaksi panjang.
Mitigasi: jalankan di jam sepi dan beri batas tunggu — `PGOPTIONS='-c lock_timeout=5000' npm run db:migrate`.

**Integritas & pemulihan.** `npm run db:verify` kini ikut memeriksa tabel/trigger/dokumen modul ini setelah pemulihan cadangan.

## 6. Menjalankan di development

Prasyarat: Node ≥ 22, PostgreSQL ≥ 14 (sebaiknya 16). Gunakan database **kosong dan terpisah** dari production.

```bash
npm ci
cp .env.example .env     # isi DATABASE_URL, TEST_DATABASE_URL, DATA_ENCRYPTION_KEY; set TRAINING_MODULE_ENABLED="true"
npm run db:migrate       # menerapkan semua migration (termasuk training_operations)
npm run db:seed:dev      # data HRIS DEMO fiktif + akun demo
npm run db:seed:training-demo   # data DEMO modul ini (lihat batasan di bawah)
npm run dev
```

Akun demo (`@demo.hris.test`): `pimpinan` = Super Admin (melihat semua), `ayu` = Manajer Program, `budi` = Admin Program, `citra` = anggota (PJ Peserta),
`hr` = **tanpa akses** (menunjukkan bahwa admin HRIS bukan Admin Program).

`db:seed:training-demo` **menolak** berjalan bila `NODE_ENV=production`, host database bukan lokal, `TRAINING_MODULE_ENABLED` bukan `true`, atau
sudah ada proyek. Data dibuat lewat service (bukan SQL), diberi label `[DEMO]`, dan **tidak berjalan otomatis di production**. Bila seed gagal di tengah
jalan, jangan hapus data: pakai database baru yang kosong.

## 7. Feature flag

`TRAINING_MODULE_ENABLED` (env, **bawaan `false`**). Di Docker, variabel ini diteruskan lewat `docker-compose.yml` (bawaan `false`).

| Keadaan | Efek |
|---|---|
| `false` | Menu tidak tampil; `/training/*` → HTTP 404; `/api/training/*` → 404; unggah/unduh dokumen proyek ditolak; seed demo menolak jalan. **Data tidak dihapus**; HRIS tidak terpengaruh. |
| `true` | Menu tampil bagi yang punya akses modul (Super Admin, pemegang level, atau anggota aktif proyek). |

`TRAINING_WORKER` (bawaan `true`) mengatur pekerja harian di dalam aplikasi (§3b); matikan bila memakai pemicu eksternal `/api/internal/training-daily`. Pekerja hanya bekerja saat modul menyala.

Nyalakan **hanya** setelah migration diterapkan. Aktivasi bertahap: staging → UAT/pilot → production, masing-masing dengan keputusan eksplisit pemilik sistem.
Mengaktifkan flag tidak memberi siapa pun akses otomatis: Super Admin harus memberi level pada akun yang relevan di **Akses Training**.

## 8. Pengujian

| Jenis | Berkas | Jumlah |
|---|---|---:|
| Unit (logika murni: akses, status, indikator dashboard, validasi, usulan level) | `tests/unit/training-access.test.ts`, `training-rules.test.ts` | 32 |
| Integrasi — gerbang akses, IDOR, tim, penjaga DB, aturan akses untuk pekerja latar belakang | `tests/integration/training-access.test.ts` | 27 |
| Integrasi — alur bisnis (proyek→penutupan, dashboard, jadwal, peserta, dokumen, referensi) | `tests/integration/training-flow.test.ts` | 35 |
| Integrasi — modul dimatikan | `tests/integration/training-flag.test.ts` | 3 |
| Unit — mesin indikator, konfigurasi, skema PATCH, eskalasi & deret hari kerja, waktu relatif | `tests/unit/training-indicators.test.ts`, `training-validation.test.ts`, `training-escalation.test.ts`, `nav-pref.test.ts`, `format-timeago.test.ts` | 60 |
| Integrasi — indikator, konfigurasi berversi, template, hak akses, beban/KP | `tests/integration/training-indicators.test.ts` | 45 |
| Integrasi — otomasi: pengingat H-1/hari-H, snapshot, eskalasi, Kuning berturut-turut, beban berlebih, catatan pemulihan | `tests/integration/training-automation.test.ts` | 23 |
| Integrasi — data beranda (lingkup akses) & pemicu pekerja harian (401/200/idempoten) | `tests/integration/training-home.test.ts`, `training-daily-route.test.ts` | 5 |
| E2E browser (build produksi) | `tests/e2e/05f-training.spec.ts`, `05g-sidebar.spec.ts`, `05h-indicators.spec.ts`, `05i-portal.spec.ts` | 26 (8 + 5 + 7 + 6) |

Yang dibuktikan khusus: akun tanpa akses/HR → 404; Pemantau hanya-lihat, Super Admin (Direktur) kelola penuh; staf tidak dapat mengubah tugas orang lain; mengganti ID proyek/tugas/anggota/item/jadwal/peserta/dokumen
tidak membuka proyek lain; berkas dokumen tidak dapat dibuka di luar lingkup; kontak peserta/instruktur tersembunyi; kode proyek unik saat 8 pembuatan serentak; trigger & CHECK menolak SQL langsung;
tes berjalan benar pada jam dengan tanggal UTC ≠ WIB, pergantian tahun, dan tahun depan (`TEST_NOW`).

```bash
npm run lint && npm run typecheck
npm test                      # unit + integrasi (TEST_DATABASE_URL; tabelnya DIKOSONGKAN)
TEST_NOW=2026-11-03T20:00:00Z npm test        # uji silang waktu (tanggal UTC ≠ WIB)
PW_CHROMIUM_PATH=/opt/pw-browsers/chromium npm run test:e2e   # di sandbox; di mesin lain: npx playwright install chromium
```

## 9. Rencana staging & UAT

1. **Staging** = salinan terpisah dari production (database, `APP_URL`, `.env`). Restore cadangan production yang **disamarkan** (nama, kontak, rekening) ke staging; jangan memakai data asli tanpa dasar yang jelas.
2. `npm run db:backup` → latih `db:restore` + `db:verify` pada staging. Terapkan migration (`PGOPTIONS='-c lock_timeout=5000' npm run db:migrate`). **Flag masih `false`**: pastikan seluruh HRIS normal.
3. Set `TRAINING_MODULE_ENABLED=true`. Super Admin memberi level di **Akses Training** (pemetaan usulan di TRAINING-PERAN.md). Opsional: `db:seed:training-demo` **hanya** bila database staging memang tidak berisi data nyata.
4. **Skenario UAT** (tiap butir lulus/gagal dicatat):
   - HR/karyawan tanpa penugasan tidak melihat menu & mendapat 404 pada URL `/training` · Super Admin melihat dashboard Direktur dan dapat membuat/mengubah proyek.
   - Manajer membuat proyek dengan PIC + template; Admin Program membuat proyek tanpa PIC (PIC hanya Manajer).
   - Tim disusun; staf hanya mengerjakan tugas miliknya; tugas "perlu diperiksa" tidak dapat diselesaikan penanggung jawabnya sendiri.
   - Jadwal dengan ruangan/instruktur bentrok memunculkan peringatan; kalender per bulan benar dalam WIB.
   - PJ Peserta mengelola peserta; staf tidak melihat kontak; dokumen peserta tak terlihat staf/pemantau.
   - Unggah PDF/PNG/JPEG; berkas palsu (ekstensi .pdf isi lain) ditolak; unduh hanya oleh yang berhak.
   - Penutupan: checklist wajib menghalangi; pengecualian beralasan tercatat; proyek jadi baca-saja; Manajer dapat membuka kembali.
   - Tautan surat tugas hanya oleh yang punya izin HRIS surat tugas; nominal uang harian tidak tampil; referensi sistem lain bertanda "dicatat manual".
   - Karyawan dinonaktifkan di HRIS → tidak dapat masuk; tugasnya ditandai perlu dialihkan.
   - **Indikator**: Direktur mengubah ambang di Rumus Indikator → versi baru + audit; program baru mendapat 16/18 milestone otomatis; contoh dokumen §7 menghasilkan Merah; milestone tanpa bukti ditolak;
     peta beban menandai overload 2 minggu; kepadatan kelas > 1,0 memicu Merah; anggota biasa tidak melihat beban rekan; isi pemegang jabatan sebelum program pertama dibuat.
   - Fitur HRIS (presensi, cuti, slip, surat tugas, uang harian) berjalan sama seperti sebelum modul dinyalakan.
5. **Pilot** satu proyek nyata dengan tim kecil selama satu siklus pelatihan sebelum persetujuan production.

## 10. Checklist deployment production

Hanya setelah ada **instruksi eksplisit terpisah** dari pemilik sistem. Tugas pengembangan ini tidak menjalankan satu pun langkah di bawah.

- [ ] UAT lulus dan keputusan pada TRAINING-PERAN.md (§Status keputusan) sudah diambil — butir #3 (file Office) dan #4 (retensi) masih menunggu.
- [ ] **Backup** production (`npm run db:backup`), arsip diverifikasi, dan **latihan restore** ke database kosong + `db:verify` berhasil.
- [ ] Jadwalkan jam sepi; beri tahu pengguna. Aplikasi versi baru di-deploy dengan `TRAINING_MODULE_ENABLED=false`.
- [ ] `PGOPTIONS='-c lock_timeout=5000' npm run db:migrate` (migration `training_operations` dan `training_indicators` yang baru). Bila gagal karena kunci: ulangi di jam lain; jangan memaksa.
- [ ] `npm run db:verify`; cek HRIS (login, presensi, cuti, slip, surat tugas, uang harian) normal.
- [ ] **Jangan** menjalankan `db:seed:dev` / `db:seed:training-demo` di production (keduanya memang menolak).
- [ ] Set `TRAINING_MODULE_ENABLED=true` (di Docker: `.env` lalu `docker compose up -d app`). Super Admin memberi level hanya kepada pihak yang disetujui.
- [ ] Pantau log galat 1–2 hari; tinjau Audit Log (`training.*`).
- [ ] Naikkan `MAX_DOCUMENT_UPLOAD_MB` bila perlu (bawaan 10 MB) dan perhatikan pertumbuhan database (berkas tersimpan di PostgreSQL).

## 11. Rencana rollback

Urutkan dari yang paling aman.

1. **Nonaktifkan modul (cepat, tanpa kehilangan data).** `TRAINING_MODULE_ENABLED=false` lalu mulai ulang aplikasi. Menu hilang, halaman/API 404. Data tetap utuh; HRIS tidak terpengaruh. Nyalakan kembali kapan saja.
2. **Kembali ke versi aplikasi sebelumnya (skema tetap).** Aman: migration hanya **menambah** tabel dan satu nilai enum; versi lama tidak menyentuh tabel `training_*` dan tidak pernah membaca massal `stored_files` (diverifikasi: hanya `findUnique` per-ID dan `DELETE … WHERE kind = 'ATTENDANCE_PHOTO'`).
   Satu catatan: bila URL `/api/files/<id>` milik **dokumen proyek** dibuka di versi lama, jawabannya galat/ditolak (tidak ada data yang terbuka).
   Migration indikator juga murni penambahan; versi aplikasi lama mengabaikan tabel/kolom barunya. Konfigurasi indikator dapat dikembalikan ke bawaan dokumen kapan saja dari layar Rumus Indikator (versi baru; riwayat tetap).
3. **Menghapus skema modul (tidak dianjurkan).** Tidak disediakan migration turun. Bila benar-benar perlu, tulis migration terpisah yang ditinjau: menghapus tabel `training_*` **menghilangkan seluruh data modul**; nilai enum `TRAINING_DOCUMENT` tidak dapat dihapus tanpa membuat ulang tipe. Ekspor dulu bila datanya masih berguna.
4. **Restore backup bukan rollback otomatis.** Mengembalikan cadangan menghapus **semua data baru sesudah cadangan** — termasuk data HRIS (presensi, pengajuan, gaji) yang dibuat setelahnya. Gunakan hanya bila data rusak, dengan aplikasi dihentikan, dan setelah menimbang kehilangan data itu. Pilihan 1–2 hampir selalu cukup.

## 12. Fitur yang sudah selesai

Dashboard per peran (Staf, Admin Program, Manajer Program, Direktur) · master program · proyek (daftar dengan cari/filter/urut/halaman/penanda perhatian, detail 9 tab, buat/ubah, alur status,
penutupan, pembatalan, buka kembali) · tim & peran proyek · tugas (prioritas, tenggat, status, perlu-diperiksa, komentar, "Tugas Saya", lencana terlambat) · checklist & template (disalin ke proyek,
wajib untuk penutupan, template standar atas tindakan eksplisit) · jadwal & kalender bulanan (WIB, peringatan bentrok ruangan/instruktur) · peserta (kontak dibatasi) · direktori instruktur/asesor
(internal ditautkan ke karyawan, eksternal tanpa akun) · dokumen proyek privat · tautan surat tugas (referensi) & referensi manual sistem lain · riwayat aktivitas · laporan + unduhan CSV/Excel/PDF ·
pengaturan level akses (Super Admin) dengan usulan dari bagan organisasi · notifikasi dalam aplikasi (tugas baru, ditambahkan ke proyek, menunggu pemeriksaan, perubahan akses) lewat mekanisme existing ·
**indikator pemantauan** (Ketepatan Waktu, Kesiapan, Beban Tim, proyeksi peserta, kepadatan kelas; tab Pemantauan per proyek, halaman Pemantauan Program, peta beban tim) dengan **rumus & parameter yang dapat diedit Direktur di aplikasi** (berversi) ·
**antarmuka portal** (sidebar maroon yang dapat disembunyikan & grupnya dilipat, bilah atas dengan pencarian cepat Ctrl+K — menu + proyek dalam lingkup akses —, notifikasi, dan menu pengguna; beranda per peran dengan sapaan, banner, menu utama, kartu ringkasan, grafik aktivitas 14 hari, proyek saya, kalender, aktivitas terbaru) · **eskalasi otomatis, deret Kuning berturut-turut, pengingat tenggat H-1/hari-H, catatan pemulihan** (§3b) · preferensi sidebar tersimpan per perangkat · audit log untuk semua perubahan penting · loading/kosong/galat pada seluruh halaman · tampilan responsif (diuji 390 px) · branding **Trilogika Internal Portal**.

## 13. Keterbatasan & pekerjaan lanjutan

- **Integrasi eksternal belum ada** (lihat §14). Peserta dan referensi dicatat manual.
- **Dokumen**: hanya PDF/PNG/JPEG; "hapus" = sembunyikan (belum ada penghapusan permanen/retensi); disimpan di PostgreSQL (pertimbangkan penyimpanan objek bila volume besar). Tidak ada pemindai malware.
- **Peringatan bentrok** terbatas pada ruangan (label teks) dan instruktur; belum ada master ruangan/sumber daya.
- Kalender berbentuk **daftar per tanggal**, bukan grid bulanan; belum ada ekspor iCal/Google Calendar (sengaja, butuh izin & konfigurasi).
- **Template checklist**: menyimpan mengganti seluruh item; belum ada riwayat versi template.
- **Penghapusan** tugas/peserta/jadwal tidak ada (dibatalkan/diubah statusnya); duplikat salah-ketik tetap terlihat sebagai "Dibatalkan".
- **Notifikasi**: memakai antrean existing (email/WhatsApp bergantung konfigurasi & penyedia yang belum diuji ke layanan sungguhan, sama seperti HRIS).
- **Indikator & otomasi**: garis atasan per jabatan adalah usulan (HRIS belum menyimpan atasan langsung); pesan eskalasi/pengingat hanya sebatas notifikasi (dalam aplikasi; email/WhatsApp sesuai konfigurasi pengguna) — tidak ada tindakan otomatis pada data; item kesiapan di luar contoh dokumen adalah usulan; "terkonfirmasi" dicatat manual (bukan status pembayaran).
- **Retensi & penghapusan permanen dokumen**: *menunggu persetujuan Direktur* — belum dibangun (tidak ada penghapusan otomatis atau permanen). Setelah masa retensi diputuskan, dapat ditambah aksi penghapusan permanen khusus Direktur dengan audit.
- **Dokumen Word/PowerPoint/Excel**: **tidak diizinkan** (keputusan pemilik sistem 4 Nov 2026): hanya PDF/PNG/JPEG; materi diekspor ke PDF (lihat TRAINING-PERAN.md, keputusan #3).
- Halaman terlarang untuk akun yang *punya* akses modul menampilkan UI "tidak ditemukan" dengan status HTTP 200 (lihat §2).
- Teks 2FA issuer ("Trilogika HRIS") dan subjek email tidak diganti agar tidak membingungkan pengguna aplikasi autentikator yang sudah terdaftar.

## 14. Rancangan integrasi (referensi — belum dibangun)

**Temuan:** tidak ditemukan dokumentasi API, kontrak, kunci, atau webhook untuk HaloAI, Website, maupun Sistem Keuangan di repository ini.
Karena itu **tidak ada endpoint, kunci, webhook, atau sinkronisasi yang dibuat atau diasumsikan**, dan antarmuka menulis "dicatat manual — belum ada integrasi".
Yang disiapkan hanya kerangka data yang aman dan idempoten: `training_external_refs` (unik per `projectId + system + externalId`) dan kolom `training_participants.source` (`MANUAL` sekarang).

| | Website (registrasi) | HaloAI (CRM) | Sistem Keuangan |
|---|---|---|---|
| **Sumber utama (system of record)** | pendaftaran peserta online | prospek, deal, aktivitas | invoice, transaksi, pembayaran |
| **Ditampilkan sebagai referensi di portal** | ID pendaftaran/program; jumlah pendaftar | ID prospek/deal pada proyek in-house | nomor invoice & statusnya (hanya status, bukan nominal, kecuali berizin) |
| **Arah data** | Website → portal (baca) | HaloAI → portal (baca) | Keuangan → portal (baca status); portal → Keuangan hanya bila disepakati |
| **Mekanisme yang perlu diverifikasi** | API baca / ekspor terjadwal / webhook | API baca / webhook | API baca / ekspor |
| **Data ganda** | `(system, externalId)` unik; upsert idempoten; peserta manual yang cocok ditandai untuk ditinjau, **tidak digabung otomatis** | sama | sama |
| **Kegagalan sinkronisasi** | pencatatan percobaan ulang bertahap (pola outbox yang sudah ada), tanpa menyimpan muatan sensitif; tampilkan "terakhir sinkron" | sama | sama |
| **Akses & audit** | kunci API di env (tidak di kode), hak baca minimum, setiap sinkronisasi tercatat di `audit_logs` | sama | sama; **status pembayaran ≠ status peserta ≠ status kompetensi** — tidak pernah diubah otomatis |

Prasyarat sebelum membangun apa pun: kontrak API tertulis, akses non-production untuk uji, persetujuan pemilik tiap sistem, dan keputusan siapa menjadi sumber kebenaran bila data berbeda.
