# Training & Operations — dokumentasi teknis

Modul operasional pelatihan di dalam **Trilogika Internal Portal** (aplikasi HRIS yang sama, satu login, satu database).
Peran & hak akses untuk pemilik sistem: [TRAINING-PERAN.md](TRAINING-PERAN.md).

> **Status:** terimplementasi dan teruji pada lingkungan development. **Belum** dipasang ke staging/production. Modul **mati secara
> bawaan** (`TRAINING_MODULE_ENABLED=false`). Tidak ada migration, deploy, atau seed yang dijalankan pada data production.

## 1. Hasil audit HRIS (fakta dari repository)

| Area | Temuan |
|---|---|
| Stack | Next.js 16 (App Router), React 19, TypeScript strict, Tailwind 4, Prisma 6.19, PostgreSQL 16, Zod 4, Vitest 5, Playwright. Node ≥ 22 (`.nvmrc` 22), **npm** (`package-lock.json`). Tidak ada `AGENTS.md`/`CLAUDE.md`; acuan = README + `docs/`. |
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

16 tabel baru, semua berawalan `training_`. Kunci primer **UUID** (sama dengan HRIS), kolom `createdAt/updatedAt`, relasi `RESTRICT`.

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

**Sengaja tidak ada:** persentase "beban tim", "kesiapan kegiatan", "ketepatan waktu" — rumus dan datanya belum disepakati. Yang tampil hanya jumlah tugas terbuka/terlambat per orang.

## 4. Role & hak akses

Role HRIS **tidak diubah**. Dua lapis baru: level modul (`training_access`) dan peran proyek (`training_project_members`).
Matriks lengkap, alasan rancangan, dan usulan pemetaan jabatan: **[TRAINING-PERAN.md](TRAINING-PERAN.md)**.
Matriks ditegakkan oleh satu file murni (`src/lib/training/access.ts`) dan diuji di `tests/unit/training-access.test.ts`.

## 5. Perubahan database & migration

Satu migration baru, **murni aditif**: `20261103230905_training_operations`. Tidak ada `DROP`, `RENAME`, atau `ALTER COLUMN`;
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

Nyalakan **hanya** setelah migration diterapkan. Aktivasi bertahap: staging → UAT/pilot → production, masing-masing dengan keputusan eksplisit pemilik sistem.
Mengaktifkan flag tidak memberi siapa pun akses otomatis: Super Admin harus memberi level pada akun yang relevan di **Akses Training**.

## 8. Pengujian

| Jenis | Berkas | Jumlah |
|---|---|---:|
| Unit (logika murni: akses, status, indikator, validasi, usulan level) | `tests/unit/training-access.test.ts`, `training-rules.test.ts` | 32 |
| Integrasi — gerbang akses, IDOR, tim, penjaga DB | `tests/integration/training-access.test.ts` | 25 |
| Integrasi — alur bisnis (proyek→penutupan, dashboard, jadwal, peserta, dokumen, referensi) | `tests/integration/training-flow.test.ts` | 35 |
| Integrasi — modul dimatikan | `tests/integration/training-flag.test.ts` | 3 |
| E2E browser (build produksi) | `tests/e2e/05f-training.spec.ts` | 8 |

Yang dibuktikan khusus: akun tanpa akses/HR → 404; Super Admin & Pemantau hanya-lihat; staf tidak dapat mengubah tugas orang lain; mengganti ID proyek/tugas/anggota/item/jadwal/peserta/dokumen
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
   - HR/karyawan tanpa penugasan tidak melihat menu & mendapat 404 pada URL `/training` · Super Admin melihat dashboard Direktur dan tidak dapat membuat proyek.
   - Manajer membuat proyek dengan PIC + template; Admin Program membuat proyek tanpa PIC (PIC hanya Manajer).
   - Tim disusun; staf hanya mengerjakan tugas miliknya; tugas "perlu diperiksa" tidak dapat diselesaikan penanggung jawabnya sendiri.
   - Jadwal dengan ruangan/instruktur bentrok memunculkan peringatan; kalender per bulan benar dalam WIB.
   - PJ Peserta mengelola peserta; staf tidak melihat kontak; dokumen peserta tak terlihat staf/pemantau.
   - Unggah PDF/PNG/JPEG; berkas palsu (ekstensi .pdf isi lain) ditolak; unduh hanya oleh yang berhak.
   - Penutupan: checklist wajib menghalangi; pengecualian beralasan tercatat; proyek jadi baca-saja; Manajer dapat membuka kembali.
   - Tautan surat tugas hanya oleh yang punya izin HRIS surat tugas; nominal uang harian tidak tampil; referensi sistem lain bertanda "dicatat manual".
   - Karyawan dinonaktifkan di HRIS → tidak dapat masuk; tugasnya ditandai perlu dialihkan.
   - Fitur HRIS (presensi, cuti, slip, surat tugas, uang harian) berjalan sama seperti sebelum modul dinyalakan.
5. **Pilot** satu proyek nyata dengan tim kecil selama satu siklus pelatihan sebelum persetujuan production.

## 10. Checklist deployment production

Hanya setelah ada **instruksi eksplisit terpisah** dari pemilik sistem. Tugas pengembangan ini tidak menjalankan satu pun langkah di bawah.

- [ ] UAT lulus dan keputusan pada TRAINING-PERAN.md (§Keputusan) sudah diambil.
- [ ] **Backup** production (`npm run db:backup`), arsip diverifikasi, dan **latihan restore** ke database kosong + `db:verify` berhasil.
- [ ] Jadwalkan jam sepi; beri tahu pengguna. Aplikasi versi baru di-deploy dengan `TRAINING_MODULE_ENABLED=false`.
- [ ] `PGOPTIONS='-c lock_timeout=5000' npm run db:migrate` (hanya migration `training_operations` yang baru). Bila gagal karena kunci: ulangi di jam lain; jangan memaksa.
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
3. **Menghapus skema modul (tidak dianjurkan).** Tidak disediakan migration turun. Bila benar-benar perlu, tulis migration terpisah yang ditinjau: menghapus tabel `training_*` **menghilangkan seluruh data modul**; nilai enum `TRAINING_DOCUMENT` tidak dapat dihapus tanpa membuat ulang tipe. Ekspor dulu bila datanya masih berguna.
4. **Restore backup bukan rollback otomatis.** Mengembalikan cadangan menghapus **semua data baru sesudah cadangan** — termasuk data HRIS (presensi, pengajuan, gaji) yang dibuat setelahnya. Gunakan hanya bila data rusak, dengan aplikasi dihentikan, dan setelah menimbang kehilangan data itu. Pilihan 1–2 hampir selalu cukup.

## 12. Fitur yang sudah selesai

Dashboard per peran (Staf, Admin Program, Manajer Program, Direktur) · master program · proyek (daftar dengan cari/filter/urut/halaman/penanda perhatian, detail 9 tab, buat/ubah, alur status,
penutupan, pembatalan, buka kembali) · tim & peran proyek · tugas (prioritas, tenggat, status, perlu-diperiksa, komentar, "Tugas Saya", lencana terlambat) · checklist & template (disalin ke proyek,
wajib untuk penutupan, template standar atas tindakan eksplisit) · jadwal & kalender bulanan (WIB, peringatan bentrok ruangan/instruktur) · peserta (kontak dibatasi) · direktori instruktur/asesor
(internal ditautkan ke karyawan, eksternal tanpa akun) · dokumen proyek privat · tautan surat tugas (referensi) & referensi manual sistem lain · riwayat aktivitas · laporan + unduhan CSV/Excel/PDF ·
pengaturan level akses (Super Admin) dengan usulan dari bagan organisasi · notifikasi dalam aplikasi (tugas baru, ditambahkan ke proyek, menunggu pemeriksaan, perubahan akses) lewat mekanisme existing ·
audit log untuk semua perubahan penting · loading/kosong/galat pada seluruh halaman · tampilan responsif (diuji 390 px) · branding **Trilogika Internal Portal**.

## 13. Keterbatasan & pekerjaan lanjutan

- **Integrasi eksternal belum ada** (lihat §14). Peserta dan referensi dicatat manual.
- **Dokumen**: hanya PDF/PNG/JPEG; "hapus" = sembunyikan (belum ada penghapusan permanen/retensi); disimpan di PostgreSQL (pertimbangkan penyimpanan objek bila volume besar). Tidak ada pemindai malware.
- **Peringatan bentrok** terbatas pada ruangan (label teks) dan instruktur; belum ada master ruangan/sumber daya.
- Kalender berbentuk **daftar per tanggal**, bukan grid bulanan; belum ada ekspor iCal/Google Calendar (sengaja, butuh izin & konfigurasi).
- **Template checklist**: menyimpan mengganti seluruh item; belum ada riwayat versi template.
- **Penghapusan** tugas/peserta/jadwal tidak ada (dibatalkan/diubah statusnya); duplikat salah-ketik tetap terlihat sebagai "Dibatalkan".
- **Notifikasi**: memakai antrean existing (email/WhatsApp bergantung konfigurasi & penyedia yang belum diuji ke layanan sungguhan, sama seperti HRIS).
- Indikator beban tim/kesiapan/ketepatan waktu belum ada (menunggu rumus yang disepakati).
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
