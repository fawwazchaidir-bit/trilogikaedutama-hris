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
  Perihal tidak tampil di halaman verifikasi dan notifikasi (judul lampiran tidak pernah tampil di halaman publik; nama jenis surat rahasia ditampilkan generik, kecuali INT-010); pembukaan oleh Direktur/HR dicatat di Audit Log (`letter.view_confidential`).
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
- Saat disetujui: render PDF (react-pdf; isi Liberation Serif, kop Caladea — lihat "Kop surat & layout jenis") berisi kop, nomor, penerima, isi, blok tanda tangan + cap, **QR di kiri**, tembusan,
  kaki halaman (teks lembaga + "Hal. X dari Y") → disimpan sebagai `StoredFile` (`LETTER_PDF`, privat) + **SHA-256**. Pembuat/penandatangan/Direktur saja yang dapat membukanya (404 untuk lainnya).
- Sejak Terbit, isi/nomor/PDF/hash **terkunci oleh trigger database** (`HRIS-GUARD`); satu-satunya perubahan sah adalah Dibatalkan. Dokumen tidak dapat
  dihapus; `letter_events` tambah-saja. Setiap tindakan masuk Audit Log.
- Variabel bawaan di isi: `{{nomor}}`, `{{tanggal}}`, dan `{{perihal}}` (kolom Perihal dalam HURUF BESAR; dipakai judul TENTANG pada Surat Edaran).

## Kop surat & layout jenis

**Kop** (semua surat; format baru): logo di kiri; dari **Pengaturan lembaga** (satu sumber) — *tagline* (Cambria bold 12), **nama lembaga** huruf besar (Cambria bold 14),
alamat (Cambria italic 10), lalu **baris kontak** di bawah alamat (Cambria italic 10): `Email: … | Telp: … | Website: …` — urutan tetap, bagian yang kosong dilewati, dan bila ketiganya
kosong barisnya tidak dicetak sama sekali (kartu Kop di Pengaturan Persuratan menampilkan petunjuk untuk melengkapinya). Spasi di dalam satu bagian ("0274 555 0100") tidak dapat
terpisah antar baris: kontak yang panjang hanya patah **di antara** bagian. **Garis di bawah kop dapat diadakan atau ditiadakan** (kartu *Kop surat* di Pengaturan Persuratan, hanya
Direktur; bawaan: ada). Bila ditiadakan, jarak ke isi surat **tetap sama** (letak isi tidak bergeser; diuji lewat posisi teks). Baris "Vocational Identity Number" **tidak lagi dicetak**
(bidang "Baris identitas" di Pengaturan Persuratan tetap tersimpan sebagai arsip). Pastikan Pengaturan lembaga memuat teks yang diinginkan: Nama = `Trilogika Edutama`, Tagline = `Lembaga Pelatihan Kerja Berbasis Kompetensi`,
Alamat = `Grha Trilogika, Jln. Ontoseno 47, Jambon 01/21, Kel. Trihanggo, Kec. Gamping, Kab. Sleman, Daerah Istimewa Yogyakarta 55291`. Kop slip gaji dan laporan **tidak** berubah.

**Font.** Cambria adalah font berlisensi Microsoft sehingga tidak dapat dibundel. Dipakai **Caladea** (SIL OFL; dirancang metrik-kompatibel dengan Cambria sehingga lebar glif dan
pemenggalan baris sama dengan dokumen Word ber-Cambria). Berkas ada di `public/fonts/Caladea-*.ttf` (+ `LICENSE-Caladea.txt`); mengganti ke Cambria asli cukup menimpa keempat
berkas itu dengan salinan Cambria yang berlisensi (nama berkas dipertahankan). Isi surat biasa tetap Liberation Serif.

**Layout per jenis** (kolom `kind` pada jenis surat; diselaraskan dari katalog master saat jenis dibuka):

| kind | jenis | blok atas | catatan |
|---|---|---|---|
| `SURAT` | hampir semua jenis | Nomor / Lampiran / Perihal + tempat-tanggal, alamat tujuan ringkas (`Yth. …` / `di tempat`), salam | — |
| `SK` | INT-001 | judul + diktum disusun di kertas | "Ditetapkan di / Pada tanggal" di akhir |
| `TUGAS` | INT-002 | seperti SURAT; isi dibangkitkan dari data penugasan | — |
| `EDARAN` | INT-005 Surat edaran | judul **MEMO INTERNAL** (tebal bergaris bawah), `Nomor : {{nomor}}`, **TENTANG** + `{{perihal}}` tebal huruf besar — semua di kertas | tanpa penerima, salam, penutup, tempat-tanggal; isi **Cambria-kompatibel 12 pt, spasi 1,5**, daftar bernomor dengan jarak bawah |

Surat Edaran meniru contoh "Memo Internal" Trilogika. Panel *Data surat* hanya menampilkan Penandatangan, Perihal (dicetak sebagai judul TENTANG), dan Tembusan. QR verifikasi dan blok
tanda tangan + cap tetap dicetak. Saat jenis lama berubah layout (mis. INT-005 sebelumnya `SURAT`), `ensureDefaultTypes` menyelaraskan `kind`, templat awal, dan salam/penutup jenis itu;
**surat yang sudah dibuat memegang salinan isinya sendiri dan surat terbit memakai PDF terkunci, sehingga tidak berubah**.

**Catatan teknis renderer.** (1) `lineHeight` TIDAK boleh dipasang di level `Page`: teks `render` pada elemen `fixed` (nomor halaman) lalu tercetak di luar kertas (y ≈ −8000), sehingga
kaki halaman tidak pernah tampil. Tinggi baris dipasang per teks dalam satuan pt lewat konteks `LayoutCtx` (uji `documents-pdf.test.ts` memeriksa posisi kaki di tiap halaman).
(2) Kaki halaman = `View fixed` ber-`render` (halaman pertama dapat dikosongkan beserta garisnya) berisi teks ber-font eksplisit (elemen `fixed` tidak mewarisi font halaman). (3) Teks yang dibuat saat pemenggalan halaman (prop `render`: kaki halaman) tidak ikut fase pemuatan font react-pdf → font kaki halaman dipramuat dengan `Font.load` (bobot numerik 400/700) di `renderDocumentPdf`; tanpa itu teks jatuh ke Helvetica bawaan. (4) `createContext` tidak boleh dipakai di modul PDF (ditolak build Next di sisi server): pengaturan tata letak diteruskan sebagai prop `lay`.

## Tata letak PDF: tanda tangan banyak pihak, isi panjang, lekukan, tabel, total halaman

Temuan audit visual (Bukti Visual Audit Persuratan) yang diperbaiki di renderer (`src/server/pdf/DocumentPdf.tsx`), semuanya diuji lewat **posisi kata di kertas**
(`pdftotext -bbox`, `tests/helpers/pdf-words.ts`) — bukan sekadar teks hasil ekstraksi:

1. **Tanda tangan tidak lagi terpotong.** Satu pihak: QR di kiri, penandatangan di kanan (tata letak lama). Dua pihak atau lebih: **grid dua kolom**; tiap baris tanda tangan tidak
   pernah terbelah, tetapi baris berikutnya **pindah ke halaman berikutnya** bila tidak muat — tidak ada nama/tanda tangan yang keluar kertas (batas sistem: penandatangan utama + 6
   tambahan = 7 pihak). QR mengisi sel kosong di baris terakhir (jumlah ganjil) atau baris sendiri di bawah (jumlah genap, dijaga bersama baris tanda tangan terakhir). Akar masalah lama:
   kotak 200 pt tidak muat berdampingan di sisi kanan QR sehingga semua tertumpuk vertikal di dalam satu blok `wrap={false}` yang lebih tinggi dari halaman.
2. **Isi panjang mengalir antar halaman.** react-pdf meletakkan elemen `wrap={false}` yang lebih tinggi dari halaman secara utuh dan membiarkannya meluber (menimpa QR/tanda tangan,
   sebagian isi hilang). Kini butir daftar, baris tabel, dan "ekor surat" (satuan isi terakhir + penutup + baris tanda tangan pertama) dijaga satu halaman **hanya bila diperkirakan
   pendek** (`src/lib/documents/layout-estimate.ts`: ≤ 60% tinggi halaman); yang panjang dibiarkan terpecah. Paragraf terbelah dengan aturan yatim/janda 2 baris. Diuji dengan satu
   paragraf ±5.000 dan ±12.000 karakter, butir daftar, baris tabel, dan butir diktum yang lebih tinggi dari satu halaman (tidak ada kata hilang/di luar kertas/saling menimpa).
3. **"Baris pertama menjorok" kini tercetak.** `textIndent` react-pdf dibaca dari atribut *run pertama* paragraf dan tidak diwariskan ke anak `<Text>`; lekukan 1,25 cm kini dipasang
   pada run pertama. Tes membandingkan posisi x kata pertama (paragraf menjorok vs tidak) dan baris lanjutan.
4. **Total halaman mengikuti berkas gabungan.** Lampiran PDF *digabung* dibaca lebih dulu dan halamannya ditambahkan ke token `{total}` (`Hal. 1 dari 3` untuk surat 1 halaman +
   lampiran 2 halaman). Lampiran *terpisah* tidak dihitung; **halaman lampiran unggahan tidak diubah** (tidak diberi kaki).
5. **Tabel sel gabungan sampai tepi.** Lebar sel dihitung dari indeks **kolom** (colspan dan rowspan, `src/lib/documents/table-grid.ts`), bukan indeks sel dalam baris; sel
   rowspan menempati kolomnya di baris-baris berikutnya (penampung kosong, garis bawah hanya di baris terakhir); baris bergerigi diisi sel kosong; `colWidths` yang tidak cocok
   dengan jumlah kolom (mis. kolom ditambah di editor) → lebar rata. **Tabel yang ditempel dari Word** diuji di editor sungguhan (e2e `05z`): colspan/rowspan terbaca, tersimpan,
   dan PDF-nya rata kanan. Belum ada tombol "gabung sel" di toolbar editor (penggabungan hanya lewat tempel).

**Format.** Alamat tujuan ringkas: `Yth. {penerima pertama}` (awalan tidak tebal) pada satu baris, baris berikutnya, lalu `di tempat` (tempat bawaan "Tempat" ditulis huruf kecil; kota
yang diketik dipertahankan, mis. `di Yogyakarta`). Salam baku `Dengan hormat,` (huruf kapital hanya di awal): jenis bawaan yang masih memakai `Dengan Hormat,` dirapikan otomatis
**hanya bila nilainya persis bawaan lama**; salam yang sudah diubah Direktur dan surat yang sudah ada tidak disentuh. Keterangan di bawah QR: *"Dokumen ini terdaftar dalam sistem
Trilogika. Pindai kode QR untuk memeriksa statusnya."* (QR memeriksa status/keterdaftaran dokumen — gambar tanda tangan dicetak langsung di PDF).

**Editor ≈ PDF.** Kertas di editor kini berlebar tetap 21 cm (isi 17 cm = area isi PDF), diskalakan (`zoom`) bila kolom lebih sempit sehingga pemenggalan baris tidak berubah karena
lebar layar (`src/components/letters/paper.tsx`); font memakai **berkas yang sama** dengan PDF (`@font-face` dari `public/fonts`); surat biasa 11 pt spasi 1,3; **Surat Edaran** Cambria-
kompatibel (Caladea) 12 pt spasi 1,5; jarak antarparagraf 6 pt; daftar, judul, tabel, dan blok rincian menyamai PDF. **Batas yang diketahui:** pustaka PDF memampatkan spasi hingga
50% (`shrinkWhitespaceFactor`, tertanam di react-pdf) sehingga PDF dapat memuat ±1 kata lebih banyak per baris daripada peramban — jumlah baris di editor bisa beberapa persen lebih
banyak (tidak pernah lebih sedikit; diuji ≤ 12% untuk paragraf 500+ kata). **Pratinjau PDF tetap acuan akhir.** Margin halaman (kiri/kanan 2 cm, atas 1,5 cm, bawah 2,1 cm) **tidak
diubah**: usulan margin 3 cm/2,5 cm untuk arsip/penjilidan menunggu format resmi Trilogika dan akan menambah jumlah halaman.

## Templat isi 24 jenis

Setiap jenis surat kini punya templat isi **sendiri** (`src/lib/documents/templates-isi.ts`; sebelumnya 17 jenis memakai kerangka umum `[isi surat]`, dan tiga penawaran berisi sama):
Penawaran B2C/B2B/ajakan kerja sama, Permohonan & perizinan, Undangan, Pemberitahuan, Permohonan sertifikasi/uji kompetensi (LSP), Keterangan & rekomendasi, Keuangan & penagihan,
Surat umum (ucapan terima kasih), Perjanjian (kerangka pasal), Berita acara (eksternal dan internal), serta Pemberitahuan, Undangan rapat, Peringatan, Izin/persetujuan, Evaluasi &
pembinaan, Keterangan kerja (tanpa data gaji), dan Administrasi (internal). Bagian **[bertanda kurung siku]** wajib diganti sebelum surat dapat diajukan. *Perjanjian*, *Peringatan*,
dan *Evaluasi* adalah **kerangka**: wajib ditinjau pihak hukum/HR sebelum dipakai. **Peningkatan database lama:** `ensureDefaultTypes` mengganti templat HANYA pada jenis yang
templatnya **persis** kerangka umum lama (dibandingkan dengan JSON kanonik); templat yang sudah diubah Direktur dan surat yang sudah dibuat tidak disentuh. Surat Tugas (INT-02)
isinya dibangkitkan dari data penugasan.

## Kaki halaman (footer)

Satu konfigurasi (**Pengaturan Persuratan → Kaki halaman (footer)**, hanya Direktur) berlaku untuk **semua halaman PDF yang dibuat sistem**: halaman surat, SK, dan halaman lampiran dari
editor. Lampiran PDF unggahan yang "digabung" adalah berkas pihak lain dan tidak diubah.

| Pengaturan | Pilihan |
|---|---|
| Tampilkan kaki halaman | hidup/mati |
| Isi | **tiga zona** — kiri (kolom lama `footerText`), tengah, kanan; masing-masing maks 200 karakter, boleh kosong |
| Token | `{halaman}` `{total}` `{nomor}` (nomor surat; "(draf)" sebelum terbit) `{tanggal}`; salah ketik seperti `{halamn}` **ditolak** (tidak dicetak apa adanya) |
| Font | Times New Roman (Liberation Serif), Arial (Liberation Sans), Cambria (Caladea), Calibri (Carlito) — keempatnya tertanam di PDF (SIL OFL, `public/fonts`) |
| Ukuran | 6–14 pt, kelipatan 0,5 |
| Gaya | tebal, miring, garis bawah, warna `#RRGGBB` |
| Garis pemisah | garis tipis di atas kaki halaman |
| Halaman | tampilkan di halaman pertama; tampilkan di halaman lampiran |

**Bawaan** (tidak mengubah tampilan sebelum fitur ini): zona kiri = teks kaki yang sudah ada, kanan = `Hal. {halaman} dari {total}`, miring, abu-abu `#444444`, 8,5 pt, Liberation Serif.
Penomoran berlanjut lintas surat + lampiran ("Hal. 3 dari 3"). Halaman lampiran **tidak lagi** memakai label khusus "Lampiran <nomor>" (judul dan nomor surat sudah di atas halaman lampiran);
bila ingin nomor di setiap halaman, pakai `{nomor}`.

- **Lebar zona** sebanding panjang teks contoh (teks pendek tidak memenuhi 1/3 lebar); satu zona saja memakai seluruh lebar. Teks panjang/ukuran besar membungkus; padding bawah halaman
  bertambah otomatis (`footerReserve`) agar isi tidak tertimpa; konfigurasi bawaan tidak mengubah pemenggalan halaman.
- **Pratinjau** di layar: baris pratinjau cepat (perkiraan, memakai tumpukan font CSS) dan tombol **Pratinjau PDF** (`POST /api/letters/settings/footer-preview`): PDF dua halaman (surat + lampiran
  contoh, kop asli lembaga, isi fiktif) dengan konfigurasi yang *sedang disunting* — belum perlu disimpan; bagian yang tidak dikirim memakai nilai tersimpan.
- **Penyimpanan**: kolom `letter_settings.footer*` (migrasi aditif `20261114120000_letter_footer_settings`, dengan CHECK ukuran/warna/font). `PATCH /api/letters/settings` menerima objek `footer`
  (sebagian saja) dan nama lama `footerText` (= zona kiri; bila dihilangkan **tidak** menghapus teks kiri). Perubahan tercatat di Audit Log. Data kaki yang rusak di basis data jatuh ke bawaan
  (PDF tidak pernah gagal karena kaki halaman).
- Kop slip gaji dan laporan tidak terpengaruh.

## Verifikasi publik (QR)

`/verifikasi/<token 32 hex>` (tanpa login, `noindex`): hanya **informasi pengenal yang aman** — nomor, jenis, tanggal, penandatangan, status (sah/dibatalkan), SHA-256,
dan lampiran (judul, jumlah halaman, hash). **Isi surat tidak ditampilkan.** Pengunjung dapat memilih PDF di perangkatnya untuk dicocokkan dengan hash
(dihitung di peramban; berkas tidak diunggah).

| Informasi | Halaman publik | Pengguna berwenang (halaman surat di Persuratan) |
|---|---|---|
| Nomor, tanggal, penandatangan, status, hash | ya | ya |
| Jenis surat | ya, **kecuali** surat rahasia **INT-006 dan INT-009**: ditampilkan generik **"Surat rahasia (internal)"** — nama jenisnya ("Surat peringatan", "Surat evaluasi dan pembinaan") sendiri mengungkap sifat surat. **INT-010 Surat keterangan kerja** sengaja tetap menampilkan nama aslinya: tujuannya memang diverifikasi pihak luar (pemberi kerja baru, bank, dst.); perihal, judul/nama file lampiran, dan alasan pembatalannya tetap tersembunyi. Daftar pengecualian: `PUBLIC_TYPE_NAME_ALLOWED` (`src/lib/documents/templates.ts`) | ya |
| Perihal | ya, **kecuali** surat rahasia atau SK | ya |
| Judul lampiran | **tidak pernah** (selalu "Lampiran n" + jumlah halaman + hash; judul bisa memuat nama klien/isi sensitif, dan hash cukup untuk mencocokkan berkas) | ya |
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

Kota penerbitan, baris identitas (arsip; tidak dicetak), **kop surat** (garis di bawah kop; isi kop dari Pengaturan lembaga), **kaki halaman** (lihat bagian di atas), batas eskalasi; cap lembaga; gambar tanda tangan per penandatangan (PNG dinormalisasi); nomor urut.
Nama/tagline/alamat/email/telepon/website/logo kop mengikuti **Pengaturan lembaga** (satu sumber; kesiapan sistem memperingatkan bila alamat, email, telepon, atau website kosong).

## API (`/api/letters`, flag `LETTERS_MODULE_ENABLED`)

`GET,POST /letters` · `GET,PATCH /letters/:id` · `POST /letters/:id/{submit,withdraw,approve,return,reject,cancel}` · `GET /letters/:id/pdf[?asli=1]` ·
`GET /letters/types` `PATCH /letters/types/:id` · `GET /letters/signers?typeId=` · `GET,PATCH /letters/settings` `POST /letters/settings/counter`
`POST,DELETE /letters/settings/stamp` `POST,DELETE /letters/signers/:userId/signature` (Direktur).

## Penerapan

Migrasi aditif `20261110090000_persuratan` + `20261110090100_persuratan_file_kind` (enum, 6 tabel, trigger penjaga). **Produksi tidak disentuh**;
terapkan dengan `npm run db:migrate` setelah cadangan, lalu nyalakan flag. Belum ada di tahap 1: multi-penandatangan, lampiran terpisah,
register/dasbor, impor arsip, "Terapkan SK ke data karyawan", Surat Tugas via mesin, ekspor DOCX.
