# Checklist Karyawan Masuk & Berhenti

Daftar centang sederhana agar proses saat karyawan masuk dan berhenti **tidak bergantung pada ingatan satu orang**. Sengaja tanpa persetujuan berlapis: HR mencentang, sistem mencatat siapa dan kapan.

## Isi checklist

**Karyawan masuk** (9 butir): data dasar dilengkapi · kontak darurat dilengkapi · kontrak & dokumen dicatat · atasan langsung dan divisi ditetapkan · jadwal kerja ditetapkan · komponen gaji ditetapkan · akun portal dibuat · hak akses sistem sesuai tugas · orientasi dan pelatihan awal dicatat.

**Karyawan berhenti** (5 butir): tanggal berhenti dan dokumen penyelesaian dicatat · tugas dan proyek aktif dialihkan · akun dan sesi dinonaktifkan sesuai keputusan HR · pengembalian aset diperiksa · hak dan kewajiban yang tersisa dicatat.

Butir bawaan berasal dari **template yang disimpan di database** dan dapat diedit dari aplikasi (lihat *Template, penanggung jawab & pengingat*). Kodenya (`src/lib/employee-checklist.ts`) hanya menjadi data awal saat template pertama kali dibuka. Pada tiap checklist HR dapat menandai **Tidak berlaku** (wajib beralasan) dan **menambah butir sendiri** yang hanya berlaku untuk checklist itu.

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
| Berhenti: aset | aset yang masih dipegang / sudah kembali (modul Aset) |
| Berhenti: hak & kewajiban | sisa cuti, uang harian belum diterbitkan bukti penerimaannya, kasbon aktif, status penyelesaian akhir |

Butir **Pengembalian aset** memakai sinyal dari modul **Aset** (lihat `ASET.md`): aset yang belum dikembalikan ditampilkan sebagai peringatan; HR tetap yang menandai butir.

## Template, penanggung jawab & pengingat

**Template** (menu *Masuk & Berhenti → Atur template*, `/masuk-berhenti/template`): HR mengubah judul, keterangan, kelompok, wajib/opsional, **tenggat (hari sejak proses dimulai)**, **penanggung jawab bawaan**, urutan, dan menambah butir baru per jenis (masuk / berhenti). Aturan:

- Perubahan hanya berlaku untuk checklist yang dimulai **sesudahnya**; checklist yang sedang berjalan tidak ikut berubah (supaya orang yang sedang mengerjakan tidak melihat daftar bergeser).
- Butir tidak dihapus, hanya **dinonaktifkan**; butir aktif terakhir tidak bisa dinonaktifkan (checklist kosong tidak ada gunanya).
- Setiap perubahan template dicatat di audit (`checklist.template.*`).

**Penanggung jawab per butir**: tiap butir bisa ditunjuk ke satu akun aktif (bawaan dari template, atau diatur HR per checklist lewat tombol *Atur*). Penanggung jawab **diberi notifikasi** dan boleh menandai **butir itu saja** (bukan butir lain, bukan menyelesaikan/membatalkan proses, bukan melihat daftar lengkap). Butir yang menunggunya tampil di menu **Checklist Saya** (lencana jumlah). Siapa dan kapan yang menandai tetap tercatat.

**Pengingat otomatis**: butir yang masih *Belum* dan bertenggat diingatkan **H-1**, **hari-H**, lalu **tiap pekan selama terlambat**. Penerima: penanggung jawab (bila ada dan masih aktif); bila tidak ada penanggung jawab → HR dan Super Admin; keterlambatan selalu ikut ke HR. Pengingat idempoten (tabel log kunci dedupe), berhenti sendiri bila butir selesai/tidak berlaku atau checklist ditutup. Dijalankan pekerja latar tiap jam (`CHECKLIST_REMINDER_WORKER`, bawaan menyala) atau lewat `POST /api/internal/checklist-reminders` dengan `Authorization: Bearer $CRON_SECRET` bila memakai cron eksternal.

## Menyelesaikan

*Selesaikan proses* hanya aktif bila semua butir wajib **Selesai** atau **Tidak berlaku**. Setelah selesai atau dibatalkan (alasan wajib), checklist dan butirnya **terkunci** — ditegakkan juga oleh trigger database; butir tidak dapat dihapus.

## Layar & akses

- Kartu pada **detail karyawan** (mengerjakan checklist), halaman **Masuk & Berhenti** (semua proses berjalan, terlambat dulu, plus yang baru ditutup), lencana jumlah proses berjalan pada menu.
- Hanya HR dan Super Admin (`employee:manage` untuk mengubah, `employee:view` untuk melihat). Karyawan biasa tidak melihat checklist siapa pun, termasuk miliknya; satu-satunya pengecualian: **butir yang ditunjuk kepadanya** muncul di *Checklist Saya*.
- API: `GET,POST /employees/:id/checklists` · `GET /employee-checklists` · `GET /employee-checklists/mine` · `PATCH /employee-checklists/item/:id` · `POST /employee-checklists/item/:id/assign` · `POST /employee-checklists/:id/{items,complete,cancel}` · `GET,POST /employee-checklist-templates` · `PATCH /employee-checklist-templates/:id` · `POST /employee-checklist-templates/:id/move`.

## Yang belum tercakup

- Butir tambahan pada satu checklist hanya berlaku untuk checklist itu (untuk menambah ke semua checklist baru, ubah template).
- Menonaktifkan karyawan tetap langsung menonaktifkan akun dan sesinya (perilaku lama, aman). Bila akses perlu bertahan sampai serah terima selesai, nonaktifkan karyawan pada saat itu — jangan lebih awal.
- Tidak ada surat keterangan kerja otomatis.
- Aset dan penyelesaian akhir punya dokumen sendiri: [ASET.md](ASET.md) dan [PENYELESAIAN-AKHIR.md](PENYELESAIAN-AKHIR.md). Pesangon, UPMK, UPH, THR, dan pajak **tidak dihitung sistem**.
