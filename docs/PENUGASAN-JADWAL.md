# Penugasan (Surat Tugas) di Jadwal & Ketersediaan Tim

Surat tugas yang **terbit** kini tampil pada jadwal kerja orang yang ditugaskan dan pada halaman **Ketersediaan Tim**, supaya admin program lain tahu siapa yang sudah punya penugasan. Contoh: Hazwan ditugaskan ke Surakarta 3–5 November → jadwalnya menampilkan **"Dinas luar — Surakarta"** pada tanggal itu.

## Prinsip: penugasan ≠ kehadiran

Surat tugas hanya **penanda jadwal** (`DayResult.duty`). Ia **tidak** mengubah:

- status harian (Hadir / Terlambat / Tidak hadir / Libur …) dan pecahan hari,
- rekap absensi, potongan, dan perhitungan gaji (hash sumber gaji `sourceHash` tidak memuatnya, jadi periode gaji tidak ditandai "data berubah"),
- saldo cuti atau kebijakan lokasi/foto absensi.

Kehadiran tetap hanya berasal dari **catatan check-in/out** menurut kebijakan absensi yang dipilih. Orang yang bertugas tetapi tidak mencatat kehadiran tetap berstatus *Tidak hadir* pada rekap — penanda DL membantu HR melihat konteksnya. Tes unit dan integrasi menegaskan ini (status/rekap/hash identik dengan dan tanpa penugasan; uji mutasi memastikan tes gagal bila penanda mengubah status).

## Di mana tampil

| Layar | Tampilan |
|---|---|
| **Profil & Jadwal** (karyawan) | Lencana "Dinas luar — tujuan" pada kolom Keterangan 14 hari |
| **Absensi Saya** (hari ini) | Catatan: "Surat tugas bukan bukti hadir: tetap catat kehadiran sesuai kebijakan" |
| **Absensi Saya / Rekap detail** | Keterangan harian ditambah "Penugasan: Dinas luar — tujuan" |
| **Ketersediaan Tim** (`/ketersediaan`) | Grid orang × hari: `DL · tujuan`, `Cuti`, `Izin/sakit`, `—` (libur), `●` (tersedia); ringkasan hari ini; filter divisi dan nama |

Surat tugas yang **dibatalkan** tidak tampil. Penanda mencakup tanggal mulai–selesai surat secara inklusif, termasuk akhir pekan (status hari libur tetap *Libur*).

## Siapa melihat apa

- **HR & Super Admin** (`assignment:view_all`): penugasan dengan nomor surat (tooltip).
- **Pemegang level modul Training** (Koordinator Program, Admin Program, Pemantau): tujuan dinas saja — **tanpa nomor dan maksud surat**. Anggota proyek biasa tanpa level tidak punya menu, halaman, maupun API (403/404).
- Izin dan sakit **digabung** ("Izin/sakit") agar alasan kesehatan tidak terbuka; cuti ditampilkan sebagai "Cuti".
- Karyawan melihat penugasannya sendiri pada jadwal pribadinya.

## API

`GET /api/availability?from=&days=&divisionId=&q=` — `days` 1–31 (bawaan 14), `from` bawaan awal pekan ini. Mengembalikan baris per karyawan aktif, sel per hari (`off`, `leave`, `half`, `duty`), ringkasan hari ini, dan daftar divisi.

## Yang belum tercakup

- Jenis kerja lain pada tabel usulan (**WFH**, **WFO**, **kegiatan luar kota** berbasis tanggal proyek) belum dimodelkan; WFH memerlukan kebijakan dan persetujuan tersendiri.
- Peringatan **bentrok** saat menerbitkan surat tugas (orang sudah cuti/sudah ditugaskan di tanggal itu) belum ada; Ketersediaan Tim dipakai untuk memeriksa sebelum menugaskan.
- Tautan ke **proyek Training** pada sel ketersediaan belum ditampilkan (tautan surat tugas ↔ proyek sudah ada di modul Training).

> **Pembaruan:** Surat Tugas baru kini dibuat lewat modul Persuratan (jenis INT-002, nomor master TE-INT) — lihat [PERSURATAN.md](PERSURATAN.md) §Tahap 4. Halaman/menu admin "Surat Tugas" lama dipindah ke Persuratan → "Surat Tugas & Uang Harian".
