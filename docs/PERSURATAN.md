# Persuratan (surat, penawaran, SK)

Modul pembuatan surat dengan editor visual, nomor resmi otomatis, PDF ber-QR, dan halaman verifikasi publik. **Default MATI**
(`LETTERS_MODULE_ENABLED=false`): menu tidak tampil, `/persuratan` dan `/api/letters/*` menjawab 404. Halaman verifikasi publik
(`/verifikasi/[token]`) tetap berfungsi agar QR pada surat yang sudah beredar tidak mati. Tahap 1 (dokumen ini) = inti; tahap 2–6
(24 jenis, multi-penandatangan, lampiran, register, Surat Tugas, impor arsip, SK→data karyawan) menyusul.

## Format nomor (master)

`001/TE-EKS/003/I/2026` = **nomor urut** / **TE-{EKS|INT}** (eksternal/internal) / **kode tipe 3 digit** (glosarium Excel; 003 = permohonan
narasumber) / **bulan romawi tanggal terbit** / **tahun terbit**. Nomor diberikan **saat disetujui**, bukan saat draf dibuat, sehingga tidak
ada nomor bolong akibat draf yang dibatalkan.

- Penghitung `letter_counters` per **(seri, tahun)**; dinaikkan dalam transaksi persetujuan dengan *advisory lock*. Bila penerbitan gagal
  (render PDF, dsb.) seluruh transaksi di-rollback dan nomor tidak terpakai.
- *Asumsi yang perlu dikonfirmasi (keputusan #6)*: urutan berjalan per seri+tahun (bukan per kode tipe). Pengaturan → "Nomor urut" dapat
  menaikkan nomor terakhir untuk melanjutkan register yang sudah berjalan (hanya boleh naik).

## Siklus

`Draf → Menunggu penandatangan → Terbit` (cabang: `Dikembalikan` → disunting → ajukan ulang; `Ditolak` final; `Terbit → Dibatalkan` dengan alasan).

| Tindakan | Siapa |
|---|---|
| Buat & sunting draf | Pembuat (karyawan terhubung; Magang hanya jenis yang diizinkan, eksternal biasa) |
| Pilih penandatangan | Pembuat, dari daftar yang berwenang untuk **jenis** itu (aturan menurut peran/tingkat jabatan, bukan nama) |
| Setujui & terbitkan / kembalikan / tolak | Penandatangan = pemeriksa = penyetuju. Tidak boleh menandatangani surat buatan sendiri (kecuali Direktur) |
| Ambil alih | Direktur, setelah N hari kerja sejak diajukan (Pengaturan, bawaan 2). Tercatat `TAKEOVER_*`; Direktur menjadi penandatangan |
| Batalkan surat terbit | Direktur atau penandatangan; nomor tetap tercatat, halaman verifikasi menampilkan "DIBATALKAN" |

Kebijakan jenis (`directorOnly`, `signerJobLevels`, `internAllowed`, `isActive`) diatur Direktur di **Persuratan → Pengaturan**.
Jenis bawaan (disemai idempoten): `EKS-001` Surat Resmi Umum, `EKS-002` Penawaran, `EKS-003` Permohonan Narasumber, `INT-001` SK
(hanya Direktur). Isi awal = templat per jenis (`src/lib/documents/templates.ts`); teks panduan `[…]` yang belum diganti memblokir pengajuan.

## Dokumen & PDF terkunci

- Isi disimpan sebagai **JSON** (ProseMirror, tervalidasi ketat `validateDoc`: hanya node/atribut/mark yang dikenal; tanpa HTML). Editor TipTap
  memakai skema yang sama (`src/lib/documents/editor-extensions.ts`; diuji round-trip dengan fixture).
- Saat disetujui: render PDF (react-pdf, Liberation Serif) berisi kop, nomor, penerima, isi, blok tanda tangan + cap, **QR di kiri**, tembusan,
  nomor halaman → disimpan sebagai `StoredFile` (`LETTER_PDF`, privat) + **SHA-256**. Pembuat/penandatangan/Direktur saja yang dapat membukanya (404 untuk lainnya).
- Sejak Terbit, isi/nomor/PDF/hash **terkunci oleh trigger database** (`HRIS-GUARD`); satu-satunya perubahan sah adalah Dibatalkan. Dokumen tidak dapat
  dihapus; `letter_events` tambah-saja. Setiap tindakan masuk Audit Log.
- Variabel bawaan di isi: `{{nomor}}` dan `{{tanggal}}`.

## Verifikasi publik (QR)

`/verifikasi/<token 32 hex>` (tanpa login, `noindex`): nomor, jenis, perihal (bukan SK), tanggal, penandatangan, status (sah/dibatalkan), SHA-256.
**Isi surat tidak ditampilkan.** Pengunjung dapat memilih PDF di perangkatnya untuk dicocokkan dengan hash (dihitung di peramban; berkas tidak diunggah).
Domain khusus verifikasi ditunda (memakai `APP_URL`); URL QR lama dibiarkan.

## Pengaturan (Direktur)

Kota penerbitan, baris identitas kop, teks kaki, batas eskalasi; cap lembaga; gambar tanda tangan per penandatangan (PNG dinormalisasi); nomor urut.
Alamat/telepon/email/logo kop mengikuti **Pengaturan lembaga** (satu sumber).

## API (`/api/letters`, flag `LETTERS_MODULE_ENABLED`)

`GET,POST /letters` · `GET,PATCH /letters/:id` · `POST /letters/:id/{submit,withdraw,approve,return,reject,cancel}` · `GET /letters/:id/pdf` ·
`GET /letters/types` `PATCH /letters/types/:id` · `GET /letters/signers?typeId=` · `GET,PATCH /letters/settings` `POST /letters/settings/counter`
`POST,DELETE /letters/settings/stamp` `POST,DELETE /letters/signers/:userId/signature` (Direktur).

## Penerapan

Migrasi aditif `20261110090000_persuratan` + `20261110090100_persuratan_file_kind` (enum, 6 tabel, trigger penjaga). **Produksi tidak disentuh**;
terapkan dengan `npm run db:migrate` setelah cadangan, lalu nyalakan flag. Belum ada di tahap 1: multi-penandatangan, lampiran terpisah,
register/dasbor, impor arsip, "Terapkan SK ke data karyawan", Surat Tugas via mesin, ekspor DOCX.
