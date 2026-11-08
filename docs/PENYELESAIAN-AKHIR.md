# Penyelesaian Akhir (Final Settlement)

Hak dan kewajiban finansial saat karyawan berhenti, dalam satu dokumen yang **dapat diperiksa penyetuju** sebelum dibayar. Menu **Penyelesaian Akhir** (`/penyelesaian-akhir`) dan kartu *Penyelesaian akhir* pada detail karyawan yang nonaktif / sedang dalam proses berhenti.

## Apa yang dihitung sistem — dan apa yang tidak

Prinsipnya sama dengan penggajian: **tidak ada tarif atau aturan baku yang ditanam**. Sistem hanya menghitung yang murni berasal dari data perusahaan, dan menulis **rumusnya** pada tiap baris.

| Baris | Dihitung sistem? | Dasar |
|---|---|---|
| **Gaji prorata bulan terakhir** | Ya (usulan) | tiap komponen pendapatan *nominal tetap* yang berlaku × hari dikerjakan ÷ hari bulan itu, dibulatkan half-up. Dasar: **hari kerja terjadwal** (jadwal & kalender libur karyawan) atau **hari kalender**, dipilih HR |
| **Uang cuti sisa** | Hanya bila HR mengisi **pembagi** | gaji pokok × sisa hari cuti tahun berjalan ÷ pembagi. Pembagi dari kebijakan perusahaan; tanpa pembagi → hanya peringatan |
| **Uang harian dinas belum dibayar** | Ya (usulan) | uang harian pada surat tugas terbit yang belum diterbitkan bukti penerimaannya |
| Pesangon, UPMK, UPH / hak lain, THR prorata | **Tidak** | HR mengisi baris manual sesuai perjanjian/ketentuan yang berlaku |
| Pajak (PPh 21), BPJS, sisa kasbon, ganti rugi aset, potongan lain | **Tidak** | baris manual; pajak dari hasil hitung yang sah (mis. konsultan pajak) |

Komponen *per hari hadir* dan *persen dari gaji pokok* tidak dihitung otomatis (butuh rekap kehadiran/dasar); sistem memberi peringatan supaya HR menambah baris manual bila perlu. Baris usulan sistem yang **diubah** HR menjadi baris manual (tidak ditimpa saat hitung ulang).

## Peringatan (dihitung langsung dari data terkini)

Ditampilkan di atas editor selama Draf/Menunggu persetujuan: periode gaji yang **sudah memuat karyawan** pada bulan terakhir (agar gaji tidak terhitung ganda), kasbon/pinjaman aktif (sisa saldo tidak dilacak), aset belum dikembalikan atau dikembalikan rusak/hilang, tanggal berhenti pada data karyawan berbeda dengan tanggal di sini, komponen yang berubah di tengah bulan, sisa cuti yang belum dihitung. **Aset hilang/rusak tidak otomatis memotong gaji** — potongan upah dibatasi aturan dan butuh dasar yang bisa dipertanggungjawabkan.

## Alur

```
Draf ──ajukan──▶ Menunggu persetujuan ──setujui──▶ Disetujui ──catat dibayar──▶ Dibayar (terkunci)
  ▲                      │ kembalikan (catatan wajib)
  └──────────────────────┘          ↘ batalkan (alasan wajib) dari Draf/Menunggu/Disetujui
```

- **HR menyiapkan** (`payroll:prepare`): membuat, mengubah tanggal/dasar/pembagi, menambah-mengubah-menghapus baris, mengajukan, mencatat dibayar, membatalkan Draf/Menunggu.
- **Pimpinan menyetujui** (`payroll:approve`): menyetujui atau mengembalikan ke Draf dengan catatan. **Tidak boleh menyetujui penyelesaian miliknya sendiri.** Pembatalan yang sudah *Disetujui* hanya oleh pimpinan (`payroll:revoke`).
- Pimpinan diberi notifikasi saat diajukan; penyusun diberi notifikasi saat disetujui/dikembalikan.
- Tidak bisa diajukan tanpa baris, atau bila **total potongan melebihi total pendapatan** (hak akhir tidak boleh menjadi negatif).
- **Pembayaran dilakukan di luar aplikasi**; sistem hanya mencatat tanggal dan referensinya. Setelah *Dibayar* terkunci dan tidak dapat dibatalkan.
- Satu penyelesaian yang berlaku per karyawan; yang dibatalkan tidak menghalangi pembuatan yang baru.

## Penjaga database

Baris hanya dapat berubah saat induknya **Draf** (trigger); setelah diajukan, tanggal/dasar/total tidak dapat diubah diam-diam (kembalikan ke Draf dulu); loncatan status ilegal ditolak; *Dibayar*/*Dibatalkan* terkunci; penyelesaian tidak dihapus; nominal baris > 0 dan kategori sesuai jenis (pajak = potongan); total = pendapatan − potongan; bersih tidak negatif sejak diajukan. Setiap langkah tercatat di audit (`settlement.*`).

## Integrasi

Butir **Hak dan kewajiban tersisa dicatat** pada checklist karyawan berhenti menampilkan status penyelesaian akhir (belum dibuat / Draf / Menunggu / Disetujui / Dibayar). Sinyal tidak pernah mencentang sendiri.

## API

`GET,POST /final-settlements` · `GET,PATCH /final-settlements/:id` · `POST /final-settlements/:id/{recompute,lines,submit,return,approve,paid,cancel}` · `PATCH,DELETE /final-settlements/line/:id`.

## Belum tercakup

- Tidak membuat slip/PDF penyelesaian, tidak mentransfer uang, tidak membuat bukti potong pajak.
- Tidak menghitung pesangon/UPMK/UPH/THR/pajak/BPJS; tidak melacak sisa saldo kasbon.
- Prorata satu bulan (bulan terakhir bekerja) berbasis bulan kalender; pola cut-off penggajian yang berbeda perlu dicek manual (lihat peringatan periode gaji).
- Tanpa potongan ketidakhadiran/keterlambatan otomatis pada bulan terakhir; tambahkan manual bila berlaku.
