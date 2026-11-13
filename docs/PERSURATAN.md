# Persuratan (surat, penawaran, SK)

Modul pembuatan surat dengan editor visual, nomor resmi otomatis, PDF ber-QR, dan halaman verifikasi publik. **Default MATI**
(`LETTERS_MODULE_ENABLED=false`): menu tidak tampil, `/persuratan` dan `/api/letters/*` menjawab 404. Halaman verifikasi publik
(`/verifikasi/[token]`) tetap berfungsi agar QR pada surat yang sudah beredar tidak mati. Tahap 1 (dokumen ini) = inti; tahap 2–6
(24 jenis, multi-penandatangan, lampiran, register, Surat Tugas, impor arsip, SK→data karyawan) menyusul.

## Kesiapan & bendera (surat tugas)

Surat tugas baru **hanya** dibuat lewat modul ini; jalur lama dihapus. Maka bendera `LETTERS_MODULE_ENABLED` (bawaan mati) menentukan apakah surat tugas baru dapat dibuat. Panduan peluncuran: [DEPLOYMENT.md](DEPLOYMENT.md#prasyarat-peluncuran-persuratan--surat-tugas).

| Operasi | Bendera **menyala** | Bendera **mati** |
|---|---|---|
| Membuat surat tugas | HR (tertaut ke data karyawan) & Direktur: draf | HR/Direktur: penjelasan *"Persuratan belum diaktifkan … `npm run check:config`"* (409); staf: 404 |
| Persetujuan | ajukan → penandatangan menyetujui → terbit (nomor Persuratan, surat tugas terbentuk) | dokumen yang sudah ada **dijeda** (penjelasan bagi yang berwenang); tidak ada yang dihapus |
| Pembatalan | dari dokumen, berantai ke surat tugasnya | surat tugas yang sudah terbit dibatalkan lewat layanan penugasan (`POST /assignments/:id/cancel`) |
| Uang harian (Bukti Penerimaan) | berfungsi | berfungsi — tidak bergantung bendera |
| Surat Tugas Saya, verifikasi QR | berfungsi | berfungsi |
| Menu | *Persuratan* | *Surat Tugas & Uang Harian* (jalan pintas) dengan pemberitahuan di halamannya |

`checkLettersReadiness()` (`server/services/letters/readiness.ts`) membaca konfigurasi dan dipakai tiga tempat: `npm run check:config`, log awal, dan kartu **Pengaturan → Kesiapan Persuratan**.
Matriks di atas diuji dengan satu berkas (`tests/integration/letters-flag-matrix.test.ts`) yang dijalankan dua kali (`npm run test:letters-flags`), ditambah e2e `05t-letters-flag` (server kedua dengan bendera mati).

## Format nomor (master)

`001/TE-EKS/003/I/2026` = **nomor urut** / **TE-{EKS|INT}** (eksternal/internal) / **kode tipe 3 digit** (glosarium Excel; 003 = permohonan
narasumber) / **bulan romawi tanggal terbit** / **tahun terbit**. Nomor diberikan **saat disetujui**, bukan saat draf dibuat, sehingga tidak
ada nomor bolong akibat draf yang dibatalkan.

- Penghitung `letter_counters` per **(seri, tahun)**; dinaikkan dalam transaksi persetujuan dengan *advisory lock*. Bila penerbitan gagal
  (render PDF, dsb.) seluruh transaksi di-rollback dan nomor tidak terpakai.
- **Nomor urut dipisah per seri**: TE-EKS dan TE-INT masing-masing 001, 002, … per tahun (keputusan Direktur; berbeda dari Excel yang global), kembali ke 001 di tahun baru;
  nomor surat batal tidak dipakai ulang. Pengaturan → "Nomor urut" (Direktur) menaikkan nomor terakhir per seri/tahun untuk melanjutkan register yang sudah berjalan (hanya boleh naik).
- **Kode jenis = master Excel** (sheet Referensi): EKS-001 Penawaran B2C, 002 Penawaran B2B, 003 Permohonan narasumber, 004 Penawaran/ajakan kerja sama,
  005 Permohonan & perizinan, 006 Undangan, 007 Pemberitahuan, 008 Sertifikasi/uji kompetensi, 009 Keterangan & rekomendasi, 010 Keuangan & penagihan,
  011 Umum lainnya, 012 Perjanjian (MoU/PKS), 013 Berita acara; INT-001 SK, 002 Surat tugas, 003 Pemberitahuan, 004 Undangan rapat, 005 Edaran,
  006 Peringatan, 007 Izin/persetujuan, 008 Berita acara, 009 Evaluasi & pembinaan, 010 Keterangan kerja, 011 Administrasi lainnya. Kode lama tidak dipakai lagi.

## Siklus

`Draf → Menunggu penandatangan → Terbit` (cabang: `Dikembalikan` → disunting → ajukan ulang; `Ditolak` final; `Terbit → Dibatalkan` dengan alasan).

| Tindakan | Siapa |
|---|---|
| Buat & sunting draf | Pembuat (karyawan terhubung; Magang hanya jenis yang diizinkan, eksternal biasa) |
| Pilih penandatangan | Pembuat, dari daftar yang berwenang untuk **jenis** itu (aturan menurut peran/tingkat jabatan, bukan nama) |
| Setujui & terbitkan / kembalikan / tolak | Penandatangan = pemeriksa = penyetuju. Tidak boleh menandatangani surat buatan sendiri (kecuali Direktur) |
| Ambil alih | Direktur, setelah N hari kerja sejak diajukan (Pengaturan, bawaan 2). Tercatat `TAKEOVER_*`; Direktur menjadi penandatangan |
| Batalkan surat terbit | Direktur atau penandatangan; nomor tetap tercatat, halaman verifikasi menampilkan "DIBATALKAN" (tanpa alasan), unduhan PDF menjadi salinan status bertanda DIBATALKAN — lihat [Surat yang dibatalkan](#surat-yang-dibatalkan) |

Kebijakan jenis (`directorOnly`, `signerJobLevels`, `internAllowed`, `isActive`) diatur Direktur di **Persuratan → Pengaturan**.
Seluruh 24 jenis katalog master disemai idempoten (penandatangan awal: Direktur saja untuk 006–010 & 012 EKS, INT-001/006/010; selain itu Direktur atau Manajer). Isi awal = templat per jenis (`src/lib/documents/templates.ts`); teks panduan `[…]` yang belum diganti memblokir pengajuan.

## Tahap 2a (ditambahkan)

- **HR sebagai penandatangan**: khusus INT-007 (izin/persetujuan), INT-010 (keterangan kerja), INT-011 (administrasi internal) — flag `hrCanSign` pada jenis.
- **Surat Rahasia** (INT-006, 009, 010; flag `confidential`): hanya pembuat, penandatangan, penandatangan tambahan, dan Direktur; HR hanya INT-010 (`hrCanView`).
  Perihal dan judul lampiran tidak tampil di halaman verifikasi dan notifikasi; pembukaan oleh Direktur/HR dicatat di Audit Log (`letter.view_confidential`).
- **Multi-penandatangan** (EKS-013, INT-008; `multiSigner`): penandatangan utama + hingga 6 penandatangan tambahan — *internal* (akun portal; wajib menandatangani lewat
  tombol "Tandatangani bagian saya" sebelum surat dapat diterbitkan) atau *mitra luar* (slot kosong di PDF untuk tanda tangan basah). Tabel `letter_signatories` dikunci trigger sejak Menunggu.
- **Tanda tangan pribadi**: Direktur untuk siapa saja; pemilik akun sendiri bila ia Direktur/Supervisor/Manajer/HR (tombol "Tanda tangan saya"). Berkas `LETTER_SIGNATURE`
  hanya dapat dibuka pemilik & Direktur. **Cap** (satu, diunggah Direktur) dipakai pada semua surat, internal maupun eksternal.
- Nomor urut **dipisah per seri** (EKS/INT), bukan global seperti Excel.

## Tahap 2b: lampiran & mode arsip-saja

**Lampiran** (maks. 10 per surat; hanya pembuat, saat Draf/Dikembalikan; terkunci sejak diajukan oleh trigger):
- *Dari editor*: halaman lampiran berjudul di PDF surat (variabel `{{nomor}}`/`{{tanggal}}` ikut diganti).
- *PDF buatan luar sistem* (diunggah; harus PDF biasa tanpa sandi, ≤ 200 halaman, ≤ `MAX_DOCUMENT_UPLOAD_MB`):
  - **Digabung**: halamannya ditempel di belakang PDF surat (pdf-lib) sehingga **satu hash** mencakup surat + lampiran.
  - **Terpisah**: berkas disimpan sendiri dengan **SHA-256 sendiri**; halaman verifikasi mencantumkan judul, jumlah halaman, dan hash (nama berkas **tidak** ditampilkan; pada surat rahasia/SK judulnya disamarkan "Lampiran n"), serta pengunjung dapat mencocokkan PDF lampirannya (di peramban, tanpa unggah).
- Berkas lampiran (`LETTER_ATTACHMENT`) hanya dapat dibuka pihak yang berhak melihat surat. Bila "Lampiran" di atas surat dikosongkan, jumlah berkas lampiran dihitung otomatis.

**Arsip-saja** (centang saat membuat surat; untuk surat yang disusun & ditandatangani basah di luar portal, mis. MoU/PKS):
1. Pembuat mengisi perihal + penandatangan, mengajukan; penandatangan menyetujui → **nomor resmi terbit** (urutan seri yang sama, tanpa lubang), tanpa PDF dari portal.
2. Nomor dicantumkan di surat fisik; setelah ditandatangani, pembuat/penandatangan/Direktur **mengunggah PDF pindaian sekali** → hash tercatat dan terkunci (koreksi = batalkan lalu daftarkan ulang).
3. Halaman verifikasi menampilkan nomor (sah) dan, setelah pindaian diunggah, hash-nya; sebelum itu "PDF pindaian belum diunggah".

## Tahap 3: penawaran, register, dasbor

- **Corong penjualan** (jenis `funnel`: EKS-001 Penawaran B2C, EKS-002 Penawaran B2B, EKS-004 Penawaran/ajakan kerja sama). Kartu "Penawaran & penjualan" pada surat: klien/instansi, ID lead CRM
  (HaloAI — hanya rujukan teks), produk (daftar di Pengaturan), PIC, nilai potensi, jadwal follow-up, catatan. Dapat diisi sejak draf; status baru sejak surat terbit.
- **Status** mengikuti Excel: *Draft* (belum terbit/belum ditandai terkirim) → *Terkirim* → *Follow-up* → *Negosiasi* → *Deal* / *Tolak* → *Selesai* (hanya dari Deal; final); *Batal* diturunkan dari surat batal/ditolak.
  **Deal wajib nilai deal > 0 dan bukti** (berkas PO/persetujuan klien berformat **PDF atau JPG**) **atau catatan bukti**. Setiap perubahan tercatat di riwayat surat + Audit Log. Nilai tidak pernah tampil di verifikasi publik.
- **Siapa mengelola**: pembuat, penandatangan, PIC, Direktur, dan Manajer (tingkat jabatan; Manajer juga dapat melihat penawaran corong agar tim pemasaran memantau pipeline).
- **Buat proyek in-house**: dari penawaran Deal (modul Training menyala, pelaku berhak membuat proyek) → proyek berjenis In-house dengan klien & catatan "Dari penawaran <nomor>"; tautan disimpan (`letter_project_links`). Harga tidak disalin ke proyek.
- **Register** (`/persuratan/register`, Direktur & Manajer): semua surat bernomor per tahun, kolom Excel (No., tanggal, nomor, jenis, tujuan, perihal, produk, PIC, status, potensi, deal, follow-up + alert TERLAMBAT), filter, **ekspor CSV** (dicatat audit; sel berawalan `= + - @` dinetralkan).
  Manajer hanya melihat jenis corong; surat Rahasia tampil tanpa perihal.
- **Dasbor** (`/persuratan/dasbor`): ringkasan seperti Excel (terbit, dibatalkan, terkirim, pipeline, deal, tolak, konversi, win rate, nilai pipeline, nilai deal, capaian vs target, follow-up terlambat) + per jenis, status, produk, **per PIC**, **per bulan**.
  *Deal* dihitung dari status Deal, atau Selesai yang bernilai deal. Target revenue tahunan (bawaan Rp10 miliar) dan daftar produk diatur Direktur di Pengaturan.
- **Pengingat follow-up**: pekerja dalam proses (tiap jam; `LETTERS_WORKER`) mengirim notifikasi ke PIC (atau pembuat) bila jadwal jatuh tempo/terlambat, sekali per hari per surat, hanya untuk status Terkirim/Follow-up/Negosiasi.

## Tahap 4: Surat Tugas lewat Persuratan (INT-002)

- **Pembuatan Surat Tugas pindah ke Persuratan**: menu admin "Surat Tugas" dihapus (alamat `/surat-tugas` dialihkan); **hanya HR dan Direktur** yang dapat membuat draf INT-002
  (`adminCreateOnly`; jenis tersembunyi bagi yang lain). "Surat Tugas Saya" untuk karyawan **tetap** dan hanya menampilkan surat atas namanya.
- **Data penugasan terstruktur** (maksud, lokasi, tanggal, uraian, penerima + uang harian per hari/jumlah hari) diisi di panel "Data penugasan". **Isi surat dibangkitkan otomatis**
  dari data itu (tabel penerima + rincian); isi tidak diketik, uang harian tidak dicetak di surat. Aturan lama berlaku: karyawan nonaktif ditolak; HR tidak boleh menugaskan dirinya
  (Direktur boleh).
- **Persetujuan penandatangan** (Direktur/Manajer, kebijakan per jenis) = penerbitan: dalam satu transaksi terbit **nomor master** (`NNN/TE-INT/002/…`), dokumen terkunci, dan
  `AssignmentLetter` dibuat dengan nomor yang sama (tanpa penomoran lama `/ST/`) sehingga jadwal, Ketersediaan Tim, "Surat Tugas Saya", tautan proyek Training, dan Diskusi Obrolan
  tetap bekerja. PDF resmi = PDF dokumen (kop, QR, tanda tangan, cap). Bila penerbitan penugasan gagal, nomor tidak terpakai.
- **Pembatalan** dilakukan dari dokumen surat dan berantai membatalkan surat tugasnya; **diblok selama masih ada Bukti Penerimaan Uang Harian aktif** (Direktur membatalkan buktinya dulu).
- **Uang Harian & Bukti Penerimaan**: HR dan Direktur, di halaman **Persuratan → Surat Tugas & Uang Harian** (`/persuratan/surat-tugas`; juga memuat surat tugas lama). Penomoran bukti tidak berubah (`…/BPUH/…`).
  Surat tugas lama tetap utuh dengan nomor lamanya (arsip); pembatalannya masih lewat tombol di halaman itu.
  **Uang harian yang sudah masuk Penyelesaian Akhir** ditandai di halaman ini dan **tidak dapat dibuatkan Bukti Penerimaan terpisah** (agar tidak dibayar dua kali); lihat [PENYELESAIAN-AKHIR.md](PENYELESAIAN-AKHIR.md#uang-harian--bukti-penerimaan-tidak-dibayar-dua-kali).
- Data penugasan ikut dibekukan sejak terbit (trigger database).

## Divisi penandatangan & ambil alih

- **Kolom Divisi** pada bagan hak tanda tangan (`LetterType.signerDivisionIds`): membatasi Manajer/Supervisor ke divisi tertentu (kosong = semua divisi). Direktur dan HR (`hrCanSign`) tidak terikat divisi;
  karyawan tanpa divisi tidak lolos jenis yang dibatasi divisi. Dibaca dari kolom "Penanda tangan (usulan)" Register: "Direktur / Manajer Pemasaran & Kerjasama" = **salah satu** dari keduanya
  (Manajer Operasional **tidak** dapat menyetujui, dan sebaliknya); "Direktur/Manajer Pemasaran/Manajer Operasional" = tanpa pembatasan divisi, **staf memilih ke siapa mengajukan**.
- Tombol **"Terapkan usulan Register"** mengisi divisi (EKS-001…005 → divisi Pemasaran; EKS-013 & INT-002 → divisi Operasional/Administrasi/Keuangan/Kurikulum) dengan mencocokkan **nama divisi**; jenis yang
  sudah dibatasi atau tanpa divisi bernama mirip dilewati (ringkasan ditampilkan). Direktur dapat menyesuaikan per jenis.
- Dropdown "Penandatangan" menampilkan nama · jabatan · divisi; penegakan di server (memilih, mengajukan, dan menyetujui) memakai aturan yang sama sehingga tidak dapat dilewati.
- **Ambil alih Direktur**: surat yang diajukan ke Manajer dapat disetujui/dikembalikan/ditolak Direktur setelah batas eskalasi (Pengaturan, hari kerja; **0 = kapan saja**). Yang menandatangani dan tercetak di PDF
  adalah **Direktur** (nama, jabatan, tanda tangan, cap); halaman verifikasi dan Register menampilkan Direktur sebagai penandatangan. Jejaknya: riwayat `TAKEOVER_*` "(semula diajukan ke <nama>)",
  snapshot `takeoverFromUserId`, Audit Log, dan notifikasi ke penandatangan semula.

## Dokumen & PDF terkunci

- Isi disimpan sebagai **JSON** (ProseMirror, tervalidasi ketat `validateDoc`: hanya node/atribut/mark yang dikenal; tanpa HTML). Editor TipTap
  memakai skema yang sama (`src/lib/documents/editor-extensions.ts`; diuji round-trip dengan fixture).
- Saat disetujui: render PDF (react-pdf, Liberation Serif) berisi kop, nomor, penerima, isi, blok tanda tangan + cap, **QR di kiri**, tembusan,
  nomor halaman → disimpan sebagai `StoredFile` (`LETTER_PDF`, privat) + **SHA-256**. Pembuat/penandatangan/Direktur saja yang dapat membukanya (404 untuk lainnya).
- Sejak Terbit, isi/nomor/PDF/hash **terkunci oleh trigger database** (`HRIS-GUARD`); satu-satunya perubahan sah adalah Dibatalkan. Dokumen tidak dapat
  dihapus; `letter_events` tambah-saja. Setiap tindakan masuk Audit Log.
- Variabel bawaan di isi: `{{nomor}}` dan `{{tanggal}}`.

## Verifikasi publik (QR)

`/verifikasi/<token 32 hex>` (tanpa login, `noindex`): hanya **informasi pengenal yang aman** — nomor, jenis, tanggal, penandatangan, status (sah/dibatalkan), SHA-256,
dan lampiran (judul, jumlah halaman, hash). **Isi surat tidak ditampilkan.** Pengunjung dapat memilih PDF di perangkatnya untuk dicocokkan dengan hash
(dihitung di peramban; berkas tidak diunggah).

| Informasi | Halaman publik | Pengguna berwenang (halaman surat di Persuratan) |
|---|---|---|
| Nomor, jenis, tanggal, penandatangan, status, hash | ya | ya |
| Perihal | ya, **kecuali** surat rahasia atau SK | ya |
| Judul lampiran | ya, **kecuali** surat rahasia atau SK (diganti "Lampiran n") | ya |
| Nama berkas lampiran | **tidak pernah** (sering memuat nama klien/orang) | ya |
| **Alasan pembatalan** | **tidak pernah** (catatan internal; bisa memuat sengketa/nama klien) | ya (kotak "Dibatalkan: …") |

Untuk surat dibatalkan, halaman publik hanya berkata dokumen tidak berlaku, pengunjung diminta tidak memakai salinan yang dimiliki, dan alasan hanya diberikan kepada pihak berwenang.
Domain khusus verifikasi ditunda (memakai `APP_URL`); URL QR lama dibiarkan.

## Surat yang dibatalkan

PDF **asli** (yang dulu diterbitkan) tidak pernah diubah atau dihapus — trigger penjaga menguncinya sebagai arsip. Yang berubah adalah apa yang **diberikan saat diunduh**:

- **Unduhan bawaan = salinan status.** `GET /letters/:id/pdf` dan `GET /assignments/:id/pdf` untuk surat berstatus Dibatalkan menghasilkan PDF yang sama dengan watermark
  diagonal merah **DIBATALKAN** di setiap halaman, pita keterangan "SALINAN STATUS — DOKUMEN INI TELAH DIBATALKAN dan tidak berlaku … salinan ini bukan berkas asli", dan metadata berkas (`Subject`) berisi DIBATALKAN. Nama berkas berakhiran `-DIBATALKAN`.
  Respons memuat header `X-Document-Status: CANCELLED`. (`src/lib/documents/cancelled-stamp.ts`, pdf-lib.) Hash salinan bertanda **berbeda** dari SHA-256 surat asli (yang tercantum di halaman verifikasi) — itu disengaja; pita menyatakan bahwa salinan ini bukan berkas asli.
- **Arsip asli = permintaan eksplisit.** `GET /letters/:id/pdf?asli=1` (tautan "unduh arsip asli" pada kotak pembatalan di halaman surat) mengembalikan berkas yang tepat
  seperti diterbitkan (`X-Document-Status: CANCELLED-ORIGINAL`, nama `…-ASLI-ARSIP.pdf`) dan **dicatat di Audit Log** (`letter.pdf_original_cancelled`). Hak aksesnya sama dengan pratinjau; surat rahasia tetap 404 bagi yang tak berhak.
- **Surat Tugas** (INT-002) hanya mengenal salinan status: karyawan penerima dan HR tidak memperoleh PDF asli yang tidak bertanda dari jalur Surat Tugas; audit `assignment.download` menandai "(salinan status DIBATALKAN)".
  Surat Tugas lama yang dirender dari data (bukan mesin dokumen) memakai tanda batal bawaan penerbit lama.
- **Layar**: kotak pembatalan di halaman surat, tulisan di daftar Surat Tugas (HR) dan "Surat Tugas Saya", label tombol "Salinan status (DIBATALKAN)", dan peringatan di dialog pembatalan.

> **Batas yang harus dipahami:** tanda pada unduhan baru **tidak mengubah berkas yang sudah dimiliki penerima** (email, WhatsApp, cetakan). Karena itu pembatalan
> **wajib disertai pemberitahuan kepada penerima menurut prosedur Trilogika** (hubungi langsung/surat pemberitahuan pembatalan). Sistem membantu dengan peringatan di dialog pembatalan dan
> notifikasi otomatis kepada karyawan yang ditugaskan ("Hentikan penggunaan salinan PDF … yang sudah Anda terima; unduhan baru bertanda DIBATALKAN"), tetapi tidak menggantikan pemberitahuan resmi kepada pihak luar.

## Pengaturan (Direktur)

Kota penerbitan, baris identitas kop, teks kaki, batas eskalasi; cap lembaga; gambar tanda tangan per penandatangan (PNG dinormalisasi); nomor urut.
Alamat/telepon/email/logo kop mengikuti **Pengaturan lembaga** (satu sumber).

## API (`/api/letters`, flag `LETTERS_MODULE_ENABLED`)

`GET,POST /letters` · `GET,PATCH /letters/:id` · `POST /letters/:id/{submit,withdraw,approve,return,reject,cancel}` · `GET /letters/:id/pdf[?asli=1]` ·
`GET /letters/types` `PATCH /letters/types/:id` · `GET /letters/signers?typeId=` · `GET,PATCH /letters/settings` `POST /letters/settings/counter`
`POST,DELETE /letters/settings/stamp` `POST,DELETE /letters/signers/:userId/signature` (Direktur).

## Penerapan

Migrasi aditif `20261110090000_persuratan` + `20261110090100_persuratan_file_kind` (enum, 6 tabel, trigger penjaga). **Produksi tidak disentuh**;
terapkan dengan `npm run db:migrate` setelah cadangan, lalu nyalakan flag. Belum ada di tahap 1: multi-penandatangan, lampiran terpisah,
register/dasbor, impor arsip, "Terapkan SK ke data karyawan", Surat Tugas via mesin, ekspor DOCX.
