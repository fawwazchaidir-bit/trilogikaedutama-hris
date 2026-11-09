# Struktur Organisasi & Alur Tinjauan

Setiap karyawan kini punya **divisi, jabatan, status, atasan langsung, tanggal mulai berlaku**, dan **riwayat perubahannya**. Atasan langsung menentukan siapa yang meninjau cuti dan lembur. Alurnya sengaja sederhana (tim kecil):

> Karyawan mengajukan → **atasan langsung** meninjau → **HR** memantau, dan memproses bila diperlukan.

## Konsep

| Istilah | Arti |
|---|---|
| **Atasan langsung** | Atasan kepegawaian seseorang (kolom `employees.supervisorId`). **Bukan** PIC proyek Training: menjadi anggota proyek yang dipimpin orang lain tidak mengubah atasan. |
| **Tingkat jabatan** | Staf · Supervisor · Manajer (`employees.jobLevel`, bawaan Staf), disimpan **eksplisit** dan ikut tercatat di riwayat (`JOB_LEVEL`). Manajer otomatis menjadi Pemantau Training; Magang hanya boleh Staf. Tidak menentukan siapa yang meninjau (itu atasan langsung). Lihat [PERAN-DAN-WEWENANG.md](./PERAN-DAN-WEWENANG.md). |
| **Berlaku sejak** | Tanggal mulai berlaku divisi/jabatan/status saat ini (`positionEffectiveFrom`; kosong = sejak mulai bekerja). Mengganti atasan saja **tidak** menggeser tanggal ini. |
| **Riwayat** | Tabel `employee_org_history`, **tambah-saja** (trigger menolak ubah/hapus). Tiap baris menyimpan divisi, jabatan, status, tingkat jabatan, atasan, apa yang berubah, catatan, pencatat. |
| **Pengganti** | Penunjukan sementara (`supervisor_delegations`, maks. 90 hari): selama rentang itu, pengganti ikut berwenang meninjau pengajuan bawahan langsung atasan tersebut. Dibatalkan, tidak dihapus. |
| **Eskalasi** | Bila atasan tidak ada hari ini (nonaktif, atau cuti/izin/sakit sehari penuh yang disetujui) **dan** tidak punya pengganti, wewenang naik ke atasannya, paling banyak tiga tingkat. |

## Siapa berwenang meninjau pengajuan X

1. **Atasan langsung X** (selalu, selama aktif) → dicatat `SUPERVISOR`.
2. **Pengganti** yang berlaku hari ini untuk atasan X → `DELEGATE`.
3. **Atasan dari atasan** hanya bila tingkat di bawahnya tidak tercakup (tidak ada dan tanpa pengganti) → `ESCALATION`.
4. **HR / Super Admin** lewat izin peran (`leave:review`, `overtime:review`): memantau semua dan **memproses bila diperlukan** → `HR`. Bila HR itu juga atasan sah, kapasitas atasan yang dicatat.
5. **Tidak seorang pun** meninjau pengajuannya sendiri. Satu-satunya pengecualian (perilaku lama): **Super Admin yang belum punya atasan langsung** (puncak organisasi), karena tanpa itu pengajuan pimpinan tidak bisa diproses.

Aturan ada di satu fungsi murni (`src/lib/org-review.ts`) yang diuji tersendiri, dan dipakai untuk otorisasi, notifikasi, serta daftar tim.

Karyawan **tanpa atasan** diperlakukan persis seperti sebelumnya: HR dan Super Admin diberi tahu dan memprosesnya. Fitur ini tidak mengubah apa pun sampai atasan ditetapkan.

## Notifikasi

- Pengajuan masuk → atasan langsung + pengganti (+ eskalasi bila atasan tidak ada) diberi tahu, tautan ke **Persetujuan Tim**. HR tidak dibanjiri notifikasi, tetapi tetap melihat seluruh pengajuan di halaman HR (lencana jumlah menunggu tidak berubah).
- Bila tak seorang pun peninjau tim punya akun aktif → jatuh ke HR & Super Admin seperti semula.
- Perubahan jabatan/atasan memberi tahu karyawan; atasan baru diberi tahu soal bawahan barunya; pengganti diberi tahu saat ditunjuk.

## Layar

- **Detail karyawan → Organisasi & atasan langsung** (HR): data saat ini, bawahan langsung, riwayat berurutan, dan dialog *Ubah jabatan / atasan* dengan tanggal mulai berlaku dan catatan.
- **Persetujuan Tim** (menu muncul hanya bagi yang sedang menjadi atasan/pengganti/eskalasi): cuti, izin, sakit, dan lembur yang menunggu, plus panel **Pengganti saat saya tidak ada**.
- **Profil & Jadwal** (karyawan): atasan langsung dan tanggal mulai berlaku jabatan.

## Aturan perubahan

- Lewat satu jalur (`changeOrg`) atau formulir data karyawan yang lama — **keduanya mencatat riwayat**. Karyawan lama tanpa riwayat mendapat baris awal (*Data awal*) tepat sebelum perubahan pertamanya; tidak ada migrasi data massal.
- Tanggal berlaku **tidak boleh di masa depan** dan tidak boleh lebih awal dari perubahan struktural sebelumnya (jabatan tidak berbalik arah dalam riwayat).
- Atasan harus karyawan aktif; **rantai melingkar ditolak** (di service dan di trigger database). Karyawan nonaktif tidak diubah.
- **Petunjuk hierarki (lunak, tidak memblokir):** atasan seorang Manajer sebaiknya Direktur; atasan Supervisor sebaiknya Manajer atau Direktur; atasan Staf sebaiknya Supervisor atau Manajer. Petunjuk tampil di kartu Organisasi.
- **Aturan Magang:** Magang tidak boleh menjadi atasan langsung atau pengganti peninjau, hanya bertingkat Staf, dan status tidak dapat diubah menjadi Magang selama karyawan masih memegang fungsi (atasan bagi bawahan aktif, pengganti, level/peran Training, role Admin/HR).
- Status karyawan memakai nilai yang sudah ada (Tetap, Kontrak, Magang); "Aktif/Nonaktif" tetap penanda terpisah. Menambah nilai baru (mis. masa percobaan) perlu perubahan kecil terpisah.

## Yang belum tercakup

- **Surat Tugas** tidak punya langkah persetujuan (HR menerbitkan langsung), jadi tidak ada yang bisa dialihkan ke atasan. **Kinerja** belum ada modulnya.
- **Eskalasi Training** (`reportsTo` pada Rumus Indikator) masih memakai konfigurasi per jabatan; belum membaca atasan langsung dari data karyawan.
- Impor karyawan massal belum membawa kolom atasan maupun tingkat jabatan; atur lewat kartu Organisasi (tingkat bawaan Staf).

## Keamanan

- Pelaku bukan atasan/pengganti → `403`; atasan yang membuka pengajuan **di luar timnya** → `404` (keberadaan pengajuan orang lain tidak bocor).
- Daftar tim diturunkan dari graf yang sama dengan otorisasi, jadi tidak ada jalur ke pengajuan yang tidak boleh ditinjau.
- Setiap keputusan mencatat kapasitas peninjau (`reviewedAs`) di cuti dan lembur, selain audit log.
