# Checklist Karyawan Masuk & Berhenti

Daftar centang sederhana agar proses saat karyawan masuk dan berhenti **tidak bergantung pada ingatan satu orang**. Sengaja tanpa persetujuan berlapis: HR mencentang, sistem mencatat siapa dan kapan.

## Isi checklist

**Karyawan masuk** (9 butir): data dasar dilengkapi · kontak darurat dilengkapi · kontrak & dokumen dicatat · atasan langsung dan divisi ditetapkan · jadwal kerja ditetapkan · komponen gaji ditetapkan · akun portal dibuat · hak akses sistem sesuai tugas · orientasi dan pelatihan awal dicatat.

**Karyawan berhenti** (5 butir): tanggal berhenti dan dokumen penyelesaian dicatat · tugas dan proyek aktif dialihkan · akun dan sesi dinonaktifkan sesuai keputusan HR · pengembalian aset diperiksa · hak dan kewajiban yang tersisa dicatat.

Butir bawaan berasal dari template (`src/lib/employee-checklist.ts`). Pada tiap checklist HR dapat menandai **Tidak berlaku** (wajib beralasan) dan **menambah butir sendiri** (mis. "Serahkan seragam kerja", opsional atau wajib).

## Kapan dimulai

- **Otomatis saat karyawan ditambahkan** — hanya bila tanggal mulai bekerjanya dalam 30 hari terakhir; karyawan lama dan hasil impor tidak dibanjiri checklist.
- **Otomatis saat karyawan dinonaktifkan** (bila belum ada checklist berhenti yang berjalan).
- **Manual** dari kartu *Checklist masuk & berhenti* pada detail karyawan (mis. memulai proses berhenti sebelum hari terakhir).

Hanya satu proses terbuka per karyawan per jenis (dijaga indeks unik di database); yang sudah selesai/dibatalkan tidak menghalangi proses baru, mis. karyawan kembali bekerja.

## Sinyal otomatis (petunjuk, bukan keputusan)

Di bawah tiap butir sistem menampilkan petunjuk dari data yang ada, mis. *"Belum diisi: telepon, rekening gaji"*, *"Belum ada kontrak yang tercatat"*, *"Masih memegang: 2 tugas Training aktif, 1 keanggotaan proyek aktif, 3 bawahan langsung"*, *"sisa cuti 2026: 7 hari; 1 uang harian belum diterbitkan bukti penerimaannya"*. Sinyal **tidak pernah mencentang sendiri**: butir tetap *Belum* sampai HR menandainya, sehingga siapa dan kapan selalu tercatat.

| Butir | Sinyal dari |
|---|---|
| Data dasar, kontak darurat | telepon, alamat, rekening gaji; kontak darurat (kolom baru pada data karyawan) |
| Kontrak & dokumen | kontrak aktif di menu Dokumen |
| Atasan & divisi | kolom atasan langsung dan divisi |
| Jadwal | penugasan jadwal khusus (bila tidak ada: memakai jadwal bawaan) |
| Komponen gaji | gaji pokok aktif |
| Akun & hak akses | akun tertaut dan aktif; peran akun, level modul Training, keanggotaan proyek |
| Berhenti: dokumen | tanggal berhenti + dokumen lain yang dicatat sejak proses dimulai |
| Berhenti: serah terima | tugas Training aktif, keanggotaan proyek aktif, bawahan langsung, jabatan di Rumus Indikator |
| Berhenti: akun | status akun (menonaktifkan karyawan menonaktifkan akun dan mengakhiri sesinya) |
| Berhenti: hak & kewajiban | sisa cuti, uang harian belum diterbitkan bukti penerimaannya, kasbon aktif |

Pengembalian **aset** belum punya modul inventaris, jadi dicatat sebagai catatan pada butirnya.

## Menyelesaikan

*Selesaikan proses* hanya aktif bila semua butir wajib **Selesai** atau **Tidak berlaku**. Setelah selesai atau dibatalkan (alasan wajib), checklist dan butirnya **terkunci** — ditegakkan juga oleh trigger database; butir tidak dapat dihapus.

## Layar & akses

- Kartu pada **detail karyawan** (mengerjakan checklist), halaman **Masuk & Berhenti** (semua proses berjalan, terlambat dulu, plus yang baru ditutup), lencana jumlah proses berjalan pada menu.
- Hanya HR dan Super Admin (`employee:manage` untuk mengubah, `employee:view` untuk melihat). Karyawan biasa tidak melihat checklist siapa pun, termasuk miliknya.
- API: `GET,POST /employees/:id/checklists` · `GET /employee-checklists` · `PATCH /employee-checklists/item/:id` · `POST /employee-checklists/:id/{items,complete,cancel}`.

## Yang belum tercakup

- Template tidak diedit lewat aplikasi (ubah di kode); butir tambahan hanya berlaku pada satu checklist.
- Belum ada penanggung jawab per butir maupun pengingat otomatis; keterlambatan terlihat pada halaman Masuk & Berhenti dan lencana menu.
- Menonaktifkan karyawan tetap langsung menonaktifkan akun dan sesinya (perilaku lama, aman). Bila akses perlu bertahan sampai serah terima selesai, nonaktifkan karyawan pada saat itu — jangan lebih awal.
- Tidak ada modul aset, penggajian akhir (final settlement), atau surat keterangan kerja otomatis.
