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

Komponen *per hari hadir* dan *persen dari gaji pokok* tidak dihitung otomatis (butuh rekap kehadiran/dasar); sistem memberi peringatan supaya HR menambah baris manual bila perlu.

## Satu sumber hanya dihitung satu kali

Setiap baris usulan membawa **identitas sumber** yang tetap, bukan sekadar nama/nominal:

| Usulan | Identitas sumber (`sourceKey`) |
|---|---|
| Gaji prorata per komponen | `PRORATA:<id komponen gaji>` |
| Uang cuti sisa | `LEAVE_PAYOUT` |
| Uang harian dinas | `ALLOWANCE:<id penerima surat tugas>` |

Aturannya (diterapkan saat **membuat**, **hitung ulang**, dan **ubah tanggal/dasar/pembagi/catatan** — ketiganya memakai satu jalur yang sama):

1. **Diubah HR** → baris menjadi *Manual* tetapi **tetap membawa identitas sumbernya** (tampil "Manual · menggantikan usulan sistem"). Hitung ulang **tidak membuat usulan yang sama lagi**; baris manual itulah yang dihitung. Contoh: gaji prorata Rp2.727.273 diubah menjadi Rp3.000.000 → setelah hitung ulang tetap **satu** baris gaji (Rp3.000.000), bukan dua.
2. **Dihapus HR** → sumbernya **dikecualikan permanen** dari penyelesaian itu (tabel `final_settlement_exclusions`, tambah-saja). Tidak muncul lagi saat hitung ulang maupun saat data diubah, termasuk bila yang dihapus adalah baris hasil koreksi. Daftar yang dikecualikan tampil di editor (nama, nominal saat dihapus, siapa yang menghapus). Bila ternyata diperlukan, tambahkan sebagai **baris manual** secara sadar. Pengecualian tidak ikut direset oleh perubahan tanggal terakhir bekerja.
3. **Usulan yang belum disentuh** tetap dihitung ulang mengikuti data terkini; usulan **baru** (mis. surat tugas baru) tetap diusulkan.
4. **Baris manual murni** (pesangon, pajak, dst.) tidak punya identitas sumber dan tidak pernah disentuh hitung ulang.
5. Bila nominal usulan sistem terkini **berbeda** dari baris manual penggantinya, muncul peringatan agar penyetuju tahu usulan mana yang tidak dihitung.
6. Penjaga database: indeks unik parsial `(penyelesaian, sourceKey)` — satu sumber **tidak mungkin** menjadi dua baris walau service dilewati.

### Data lama (sebelum identitas sumber ada)

Baris lama tidak punya identitas sumber, jadi sistem **tidak bisa memastikan** mana baris manual yang merupakan koreksi dari usulan sistem. Yang dilakukan sistem:

- Editor menampilkan peringatan **"Kemungkinan hitungan ganda"** bila ada baris manual tanpa tautan sumber di samping baris sistem pada kategori yang juga diusulkan sistem (gaji prorata, uang cuti, uang harian). Hitung ulang pertama setelah pembaruan ini memberi identitas pada usulan baru, sehingga tidak bertambah ganda lagi.
- **Audit baca-saja** untuk pimpinan (`payroll:approve`): `GET /api/final-settlements/audit-duplicates` mendaftar penyelesaian yang belum dibatalkan (termasuk yang sudah *Disetujui*/*Dibayar*) dengan pola tersebut, beserta baris dan total per kategori. Daftar ini **terduga**, bukan pasti — baris manual murni yang sah juga tercantum; periksa nominalnya. Audit tidak mengubah data apa pun.
- Penyelesaian *Draf* yang terduga ganda: hapus salah satu baris yang kembar (baris sistem yang dihapus kini dikecualikan permanen). Yang sudah *Disetujui* terkunci; koreksinya lewat pembatalan oleh pimpinan (bila belum dibayar) lalu disiapkan ulang, atau penyesuaian di luar aplikasi bila sudah dibayar.

## Uang harian & Bukti Penerimaan (tidak dibayar dua kali)

Uang harian dinas bisa dibayar lewat **dua jalur**: Bukti Penerimaan Uang Harian per perjalanan (modul Surat Tugas) atau sebagai baris penyelesaian akhir. Supaya satu uang tidak dibayar/dicatat dua kali, baris uang harian **ditautkan ke penerima surat tugas** (`assigneeId`) dan kedua jalur saling mengunci:

| Keadaan | Perilaku |
|---|---|
| Uang harian **sudah masuk** penyelesaian akhir yang berlaku (Draf, Menunggu, Disetujui, Dibayar) | **Bukti Penerimaan terpisah ditolak** (pesan menyebut statusnya). Dijaga juga oleh trigger database |
| Bukti Penerimaan aktif **sudah ada** | tidak diusulkan, dan baris untuk penerima itu tidak dapat dimasukkan (trigger database) |
| Bukti terbit **setelah** draf dibuat (keadaan berubah) | muncul peringatan "Uang harian bermasalah" di editor; **diajukan, disetujui, dan dicatat dibayar diperiksa ulang** dan ditolak sampai barisnya dihapus (kembalikan ke Draf bila perlu) atau bukti yang keliru dibatalkan |
| Surat tugas dibatalkan setelah barisnya masuk | ditolak saat diajukan/disetujui/dibayar; hitung ulang membuangnya. Pembatalan surat tugas **ditolak** bila uangnya sudah di penyelesaian yang Disetujui/Dibayar |
| Penyelesaian **Dibatalkan** | penanda dilepas — penerima kembali "menunggu bukti" dan bukti boleh diterbitkan |

Di **Persuratan → Surat Tugas & Uang Harian**, penerima yang uangnya masuk penyelesaian akhir ditandai *Termasuk penyelesaian akhir · \<status\>* (atau *Dibayar lewat penyelesaian akhir · \<tanggal\>*) dengan tautan ke penyelesaiannya; tombol Terbitkan bukti tidak muncul. Penerima itu **tidak dihitung** pada lencana/filter "menunggu bukti penerimaan" maupun sinyal checklist berhenti. **Tidak ada Bukti Penerimaan yang dibuat otomatis** — pembayaran dicatat di penyelesaian akhir.

**Audit data lama** (baca-saja, pimpinan `payroll:approve`): `GET /api/final-settlements/audit-allowance` mendaftar uang harian yang **sudah terlanjur tercatat dua kali** (ada di penyelesaian yang belum dibatalkan *dan* punya Bukti Penerimaan aktif). Migrasi menautkan baris lama bila kecocokannya tunggal (karyawan sama, nominal sama, nomor surat tugas ada pada rumus baris); yang meragukan atau sudah diubah manual dibiarkan dan tidak muncul di audit. Koreksi dilakukan secara sah: batalkan bukti (Super Admin) atau kembalikan/batalkan penyelesaian akhir.

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

Baris hanya dapat berubah saat induknya **Draf** (trigger); setelah diajukan, tanggal/dasar/total tidak dapat diubah diam-diam (kembalikan ke Draf dulu); loncatan status ilegal ditolak; *Dibayar*/*Dibatalkan* terkunci; penyelesaian tidak dihapus; nominal baris > 0 dan kategori sesuai jenis (pajak = potongan); total = pendapatan − potongan; bersih tidak negatif sejak diajukan. Satu identitas sumber hanya boleh satu baris per penyelesaian; pengecualian usulan hanya bisa ditambah saat Draf dan tidak pernah diubah/dihapus. Setiap langkah tercatat di audit (`settlement.*`).

## Integrasi

Butir **Hak dan kewajiban tersisa dicatat** pada checklist karyawan berhenti menampilkan status penyelesaian akhir (belum dibuat / Draf / Menunggu / Disetujui / Dibayar). Sinyal tidak pernah mencentang sendiri.

## API

`GET,POST /final-settlements` · `GET,PATCH /final-settlements/:id` · `POST /final-settlements/:id/{recompute,lines,submit,return,approve,paid,cancel}` · `PATCH,DELETE /final-settlements/line/:id`.

## Belum tercakup

- Tidak membuat slip/PDF penyelesaian, tidak mentransfer uang, tidak membuat bukti potong pajak.
- Tidak menghitung pesangon/UPMK/UPH/THR/pajak/BPJS; tidak melacak sisa saldo kasbon.
- Prorata satu bulan (bulan terakhir bekerja) berbasis bulan kalender; pola cut-off penggajian yang berbeda perlu dicek manual (lihat peringatan periode gaji).
- Tanpa potongan ketidakhadiran/keterlambatan otomatis pada bulan terakhir; tambahkan manual bila berlaku.
