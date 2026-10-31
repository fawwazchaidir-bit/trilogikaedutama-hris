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
  attendance.ts   status harian + rekap (deriveDay, shiftWindow, resolveSchedule, summarizeDays) — shift malam & setengah hari
  payroll.ts      perhitungan gaji (komponen, aturan, lembur, rumus tertulis) · statutory.ts BPJS & PPh 21 (TER + true-up)
  analytics.ts    rasio/tren/sebaran untuk laporan · location-risk.ts penilaian risiko lokasi · ip.ts cocokkan IP/CIDR
  totp.ts         TOTP/HOTP (RFC 6238/4226) + kode pemulihan · phone.ts normalisasi nomor WhatsApp
  geo.ts          geofence (haversine) · time.ts zona waktu & tanggal · money.ts rupiah (bilangan bulat)
  permissions.ts  matriks RBAC + menu
src/server/
  services/       satu file per domain; SETIAP fungsi memeriksa izin (assertCan) dan menulis audit dalam transaksi yang sama
                  (attendance, leave, overtime, payroll, settings, location, reports, two-factor, password-reset, account, …)
  notify/         transport SMTP & WhatsApp, outbox (deliveries.ts), pekerja (worker.ts, dinyalakan oleh src/instrumentation.ts)
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

### Tambahan Tahap 2
8. **Shift lintas tengah malam.** Semua perbandingan waktu memakai **instan absolut** (`shiftWindow`: mulai, selesai, titik tengah, batas tidak hadir, batas "belum lengkap"), bukan menit-dalam-hari. Shift **dimiliki tanggal ia dimulai**. Saat punch, `resolveWorkDate` menentukan tanggal kerja: check-in kemarin yang belum check-out dan masih dalam masa tenggang (6 jam setelah jam pulang) → punch ini menutup shift kemarin; shift kemarin berjalan tanpa check-in → check-in terlambat ke shift itu; selain itu hari ini.
9. **Hari pecahan.** `DayResult.fractions` membagi satu hari terjadwal ke {hadir, izin, sakit, cuti, tidak hadir, belum dinilai} yang berjumlah 1; rekap, saldo (`leave_balance_entries.days` kelipatan 0,5, dijaga CHECK), dan gaji memakai pecahan yang sama. Identitas rekap tetap berlaku (diuji acak).
10. **Lembur.** Pengajuan → persetujuan (menit boleh dikurangi) → dibayar `min(disetujui, terbukti di absensi)` per hari, dibatasi maksimum/minimum, tarif tetap atau gaji pokok ÷ pembagi dengan pengali jam pertama/berikutnya; dibulatkan sekali di akhir. Persetujuan masuk hash "data berubah" hanya bila mode periode = APPROVED (hash periode lama tidak berubah).
11. **BPJS & PPh 21.** `computeStatutory` murni: BPJS per komponen (batas upah), PPh 21 TER bulanan; masa pajak terakhir = setahun − sudah dipotong (YTD dari item periode Disetujui/Diterbitkan). Komponen manual BPJS/Pajak menggantikan otomatis. Hasil disimpan di `payroll_items.statutory`; porsi perusahaan tidak mengurangi gaji bersih (tampil di slip sebagai informasi).
12. **Notifikasi.** `notifyUsers` menulis notifikasi dalam aplikasi **dan** baris `notification_deliveries` (outbox) dalam transaksi peristiwa; pekerja memproses dengan klaim `SKIP LOCKED`, percobaan ulang bertahap.
13. **Integritas lokasi.** `assessRisk` (murni) → skor & flag; `decide(mode, skor)` → diterima/ditandai/ditolak; semua tercatat di `location_checks` untuk tinjauan HR.

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
`attendances` (unik per karyawan-hari) · `attendance_corrections` (append-only) · `leave_requests` (+`dayPart`) · `leave_balance_entries` (append-only, pecahan 0,5) · `overtime_requests` ·
`location_checks` · `notification_deliveries` · `two_factor_recovery_codes` · `login_challenges` · `password_reset_tokens` ·
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
