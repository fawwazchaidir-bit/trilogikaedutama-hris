# Aset Perusahaan

Pencatatan aset yang dipinjamkan ke karyawan (laptop, ponsel, kartu akses, kunci, seragam, kendaraan) agar **pengembalian saat karyawan berhenti tidak bergantung pada ingatan**. Sengaja sederhana: bukan sistem inventaris/penyusutan, hanya *siapa memegang apa, sejak kapan, dan dalam kondisi apa dikembalikan*.

## Siklus aset

| Status | Arti | Dari → ke |
|---|---|---|
| **Tersedia** | di kantor, boleh diserahkan | awal; setelah dikembalikan (baik/rusak); setelah ditemukan |
| **Dipinjam** | dipegang satu karyawan | Tersedia → Dipinjam (serah-terima) |
| **Hilang** | dikembalikan sebagai hilang | Dipinjam → Hilang; → Tersedia bila *ditemukan* |
| **Dinonaktifkan** | tidak dipakai lagi (rusak berat, dijual, dihapusbukukan) | Tersedia / Hilang → Dinonaktifkan (alasan wajib). **Terminal.** |

Aturan yang dijaga service **dan** database:

- Satu aset hanya punya **satu pemegang aktif** (indeks unik parsial; dua serah-terima bersamaan → satu yang berhasil, yang lain *409*).
- Serah-terima hanya ke **karyawan aktif**; tanggal tidak di masa depan.
- Pengembalian mencatat **siapa, kapan, kondisi** (Baik / Rusak / Hilang); **rusak dan hilang wajib berketerangan**; tanggal tidak sebelum serah-terima.
- Aset dan riwayat serah-terima **tidak dapat dihapus** (trigger `HRIS-GUARD`); riwayat yang sudah dikembalikan **terkunci**; kode aset (`AST-0001`, dari sequence database) tidak berubah.
- Aset *Dipinjam* tidak bisa dinonaktifkan sebelum dikembalikan.
- Aset yang dikembalikan **rusak** tetap *Tersedia* tetapi diberi penanda "terakhir kembali rusak: …" supaya HR memutuskan memperbaiki atau menonaktifkannya.

## Aset hilang ≠ potong gaji

Sistem **tidak** memotong gaji atas aset hilang atau rusak. Potongan upah dibatasi aturan ketenagakerjaan dan perlu keputusan yang bisa dipertanggungjawabkan. Putusannya urusan HR, dicatat pada penyelesaian akhir (lihat `PENYELESAIAN-AKHIR.md`) sebagai baris manual bila memang berlaku.

## Layar & akses

- Menu **Aset** (`/aset`): daftar dengan ringkasan per status, pencarian (nama, kode, nomor seri, nama pemegang), filter kategori; tombol Daftarkan / Serahkan / Kembalikan / Ubah / Ditemukan / Nonaktifkan. `/aset/:id` memuat riwayat serah-terima lengkap.
- **Detail karyawan** memuat kartu *Aset yang dipegang* dengan tombol *Catat pengembalian* — praktis saat proses berhenti.
- **Checklist karyawan berhenti**, butir *Pengembalian aset diperiksa*, menampilkan sinyal: aset yang belum dikembalikan (peringatan), semua sudah kembali (OK, termasuk jumlah yang kembali rusak/hilang), atau belum ada aset tercatat (info; catat dulu bila ada yang belum terdaftar). Sinyal **tidak pernah mencentang sendiri**; HR yang menandai butir.
- Hanya HR dan Super Admin (`employee:manage` mengubah, `employee:view` melihat). Karyawan biasa tidak melihat menu maupun datanya. Setiap perubahan tercatat di audit (`asset.create|update|assign|return|found|retire`).

## API

`GET,POST /assets` · `GET,PUT /assets/:id` · `POST /assets/:id/{assign,return,retire,found}` · `GET /employees/:id/assets`.

## Belum tercakup

- Tidak ada penyusutan, nilai buku, stok/jumlah (satu baris = satu barang), pemeliharaan berkala, atau unggah foto/berita acara serah-terima.
- Tidak ada pengingat otomatis aset yang lama dipinjam; pemeriksaan terjadi lewat checklist berhenti.
- Tidak ada impor massal; aset didaftarkan satu per satu.
