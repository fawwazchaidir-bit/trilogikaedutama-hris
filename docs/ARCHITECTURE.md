# Arsitektur

## Mengapa stack ini

| Pilihan | Alasan singkat |
|---|---|
| **Next.js (App Router) + React + TypeScript strict** | Satu basis kode untuk halaman (server-rendered, cepat di ponsel) dan API; tipe ketat mengurangi galat perhitungan uang/tanggal. Sama dengan aplikasi invoice → tim, deploy, dan pola keamanan yang sudah dikenal. |
| **PostgreSQL + Prisma** | Data HR/gaji butuh transaksi, kunci baris, `CHECK`, dan **trigger** (append-only, kunci slip). Prisma memberi tipe & migrasi; SQL mentah dipakai di tempat yang memang perlu (kunci advisory, trigger). SQLite tidak cocok untuk penggunaan bersamaan oleh banyak karyawan. |
| **Tailwind 4** | Desain konsisten dengan aplikasi invoice (merah/putih/hitam), responsif. |
| **`@react-pdf/renderer`** | Slip PDF dihasilkan di server dari data terstruktur (tanpa browser headless), font bawaan PDF sehingga tidak butuh koneksi keluar. |
| **Zod** | Validasi di server dengan pesan Bahasa Indonesia yang sama untuk API, seed, dan tes. |

## Lapisan

```
src/lib/        logika MURNI tanpa database (mudah diuji)
  attendance.ts   status harian + rekap (deriveDay, resolveSchedule, summarizeDays)
  payroll.ts      perhitungan gaji (komponen, aturan, rumus tertulis)
  geo.ts          geofence (haversine) · time.ts zona waktu & tanggal · money.ts rupiah (bilangan bulat)
  permissions.ts  matriks RBAC + menu
src/server/
  services/       satu file per domain; SETIAP fungsi memeriksa izin (assertCan) dan menulis audit dalam transaksi yang sama
  auth/ http.ts   sesi, scrypt, rate limit, CSRF, pemetaan galat → JSON
  pdf/            slip & laporan PDF       export.ts  CSV/Excel (dengan penetral rumus)
src/app/api/      route tipis: baca body → panggil service
src/app/(app)/    halaman server-rendered; komponen klien hanya untuk form/aksi
prisma/           schema, migrasi (+ trigger), seed produksi & demo
```

Izin ditegakkan di **service layer**: menyembunyikan menu hanya kosmetik. Halaman terlarang menjawab 404 (tidak membocorkan keberadaannya).

## Prinsip penting

1. **Status harian dihitung, tidak disimpan.** `deriveDay` menurunkan Hadir/Terlambat/Izin/Sakit/Cuti/Tidak hadir/Libur dari: jadwal yang berlaku + kalender + pengajuan *disetujui* + catatan absensi. Karena itu perubahan jadwal/koreksi/persetujuan langsung tercermin, dan setiap angka punya penjelasan per hari. Identitas yang diuji acak (500 skenario):
   `hari terjadwal = hadir + izin + sakit + cuti + tidak hadir + belum dinilai`.
2. **Prioritas jadwal:** penugasan karyawan › divisi › seluruh perusahaan › jadwal default; pada level sama, tanggal mulai terbaru menang.
3. **Prioritas status satu hari:** di luar masa kerja → ada check-in (hadir/terlambat) → bukan hari kerja (libur) → pengajuan disetujui → tidak hadir/belum absen/mendatang.
4. **Waktu = jam server** (`APP_TIMEZONE`, default Asia/Jakarta). Klien tidak pernah mengirim waktu absen.
5. **Uang = bilangan bulat Rupiah** (BigInt di DB); pembagian memakai satu aturan pembulatan half-up di akhir hitung.
6. **Slip = snapshot terkunci.** Saat terbit, isi slip (lembaga, karyawan, rincian, rumus, total, ringkasan absensi) disalin ke `payslips.snapshot`. PDF & tampilan layar dirender dari snapshot. Perubahan absensi/komponen sesudahnya **tidak** mengubah slip; sistem menandai `Data berubah` pada periode agar pimpinan dapat membatalkan & merevisi.
7. **Deteksi data basi:** tiap item menyimpan hash rekap harian sumber. Ajukan/setujui/terbitkan diblokir bila hash berubah (harus hitung ulang).

## Alur penggajian

```
DRAF ──ajukan──▶ MENUNGGU PERSETUJUAN ──setujui (Pimpinan; aturan harus terkonfirmasi)──▶ DISETUJUI ──terbitkan (HR)──▶ DITERBITKAN
  ▲                    │ kembalikan (catatan)            │ batalkan persetujuan                          │
  └────────────────────┴─────────────────────────────────┘                                               ▼
     (hitung ulang, penyesuaian beralasan hanya di DRAF)                         batalkan penerbitan (Pimpinan, alasan) → slip VOID → buat REVISI (DRAF baru, jejak revisionOf)
```
Syarat ajukan: ada karyawan, tidak ada gaji bersih negatif, periode absensi sudah berakhir, data tidak basi.

## Model data (ringkas)

`users` · `sessions` · `employees`(+rekening terenkripsi) · `divisions` · `work_schedules` · `schedule_assignments` · `calendar_days` ·
`attendances` (unik per karyawan-hari) · `attendance_corrections` (append-only) · `leave_requests` · `leave_balance_entries` (append-only) ·
`salary_components` · `payroll_runs` · `payroll_items` · `payroll_item_lines` · `payslips` (snapshot, terkunci) · `company_settings` (singleton) ·
`stored_files` · `notifications` · `audit_logs` (append-only) · `rate_limit_buckets`.

### Penjagaan di level database (migrasi `integrity_guards`)
- Trigger append-only: `audit_logs`, `attendance_corrections`, `leave_balance_entries`.
- `payslips`: tidak boleh dihapus/diubah isinya; hanya `ACTIVE → VOIDED` dengan alasan.
- `payroll_items` / `payroll_item_lines`: hanya dapat berubah saat periode berstatus `DRAFT`.
- `payroll_runs`: alur status yang sah saja; periode & aturan terkunci setelah diajukan.
- `leave_requests`: setelah diputuskan, isi beku (hanya `APPROVED → CANCELLED`).
- `CHECK`: jam valid, check-out > check-in, tanggal tidak terbalik, nominal ≥ 0, identitas gaji bersih, persen komponen, dll.
- Unik tanpa membedakan huruf: nomor induk, nama divisi, nama jadwal; tepat satu jadwal default.
Pesan trigger diawali `HRIS-GUARD:` dan ditampilkan apa adanya ke pengguna.

## Konkurensi
Satu catatan absensi per karyawan-hari dijaga `UNIQUE`; `check-out` memakai `UPDATE … WHERE checkOutAt IS NULL`. Pengajuan/persetujuan cuti memakai kunci advisory per karyawan; pembuatan periode gaji dan penugasan jadwal memakai kunci advisory global — semuanya diuji dengan permintaan paralel.
