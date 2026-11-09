# Panduan Pengguna

## A. Setup awal (Super Admin & HR) — urutan yang disarankan

1. **Masuk** dengan akun Super Admin dari seed produksi → wajib ganti password.
2. **Pengaturan → Profil lembaga & slip**: nama, alamat, telepon, **unggah logo**, awalan nomor slip, dan **penanda tangan slip** (nama, jabatan, kota, lalu *Gambar tanda tangan slip* — PNG/JPG; hanya Super Admin). Tanpa nama penanda tangan, blok tanda tangan tidak dicetak. Berlaku untuk slip yang terbit **setelahnya**; slip lama tidak berubah.
3. **Pengaturan → Kebijakan absensi & cuti** *(Super Admin)*: kuota cuti tahunan, batas pengajuan mundur, menit terlambat dari jam masuk / setelah toleransi, absensi lokasi (opsional). Tekan **Simpan & konfirmasi** — ini menandai kebijakan sudah Anda periksa.
4. **Jadwal & Libur**: periksa jadwal "Reguler" (contoh 08.00–16.00), tambah jadwal lain (mis. Ramadan) dan **penugasan** per karyawan/divisi/seluruh perusahaan dengan rentang tanggal. Isi **hari libur nasional & cuti bersama** (tidak ada daftar bawaan — sesuaikan dengan ketetapan pemerintah tahun berjalan).
5. **Karyawan**: buat divisi lewat **Kelola divisi**, lalu tambah karyawan satu per satu atau **Impor** dari Excel/CSV (unduh templat dulu; divisi baru pada file ikut dibuat otomatis).
6. **Detail karyawan → Komponen gaji**: minimal **Gaji pokok**; tambah tunjangan, uang makan/transport per hari hadir, BPJS/pajak (isi sendiri nominal/persen), kasbon (gunakan tanggal berakhir untuk cicilan), bonus sekali.
7. **Detail karyawan → Buat akun login** (atau menu Akun Pengguna) → sampaikan password sementara lewat kanal aman. **Pengajuan & Cuti → Terapkan kuota** memberi saldo awal tahun berjalan.
8. **Pengaturan → Aturan penggajian** *(Super Admin)*: tentukan potongan terlambat/tidak hadir, apakah izin/sakit/cuti memotong gaji, lembur. Default **semua nonaktif**. Tekan **"Saya sudah memverifikasi aturan ini"** — gaji tidak dapat disetujui sebelum ini.

### Tambahan Tahap 2 (urutan setelah langkah 8)
9. **Pengaturan → Keamanan akun** *(Super Admin)*: wajibkan **2FA** untuk Admin/HR bila diinginkan. Setiap admin menyiapkan 2FA di **Keamanan & Notifikasi** (pindai QR, simpan 10 kode pemulihan).
10. **Pengaturan → Aturan penggajian → Lembur**: pilih "Hanya lembur yang disetujui & terbukti di absensi", isi tarif (atau gaji ÷ 173) dan pengali. **BPJS & PPh 21 otomatis** (opsional): periksa **semua** tarif/tabel terhadap ketentuan terkini (lihat KEPUTUSAN-BISNIS §5), isi status PTKP/NPWP/BPJS tiap karyawan, tandai komponen dasar BPJS & kena pajak, simpan, lalu **konfirmasi**.
11. **Jadwal & Libur**: untuk shift malam buat jadwal dengan jam pulang lebih awal dari jam masuk (mis. 22.00–06.00) → tanda "+1 hari". Tugaskan ke karyawan/divisi yang bekerja malam.
12. **Pengaturan → Kebijakan → Pencegahan lokasi palsu**: mulai dengan *Tandai saja*. **Foto absensi**: untuk karyawan dinas luar pilih *Wajib*, dan matikan radius lokasi — karyawan memotret langsung dari kamera saat Check-in/Check-out, server mencetak waktu server + koordinat pada foto, dan HR melihatnya di *Rekap → rincian karyawan* (kolom *Foto absensi*) atau di *Tinjauan Lokasi*. **Simpan foto absensi (bulan)**: bawaan 6; foto lebih tua dihapus otomatis & permanen (yang sedang ditinjau tidak ikut), tersisa jejak teks waktu/koordinat. Peringatan merah muncul bila Anda menurunkan angkanya. **Pengaturan → Pengiriman email & WhatsApp**: periksa status setelah SMTP/WhatsApp dikonfigurasi (lihat DEPLOYMENT).

13. **Pengaturan → Slip gaji → Penanda tangan** (Super Admin): nama, jabatan, kota, dan gambar tanda tangan — dipakai bersama oleh **slip gaji, Surat Tugas, dan Bukti Penerimaan Uang Harian**. **Pengaturan → Kebijakan**: *Kuota cuti tahunan bawaan* dan *Masa kerja minimum sebelum berhak cuti* (bawaan 12 bulan); kebijakan tiap karyawan dapat dikhususkan di halaman karyawan.
14. **Dokumen:** unggah PDF kontrak aktif tiap karyawan (isi tanggal berakhir) agar pengingat H-3 bulan ke pimpinan berjalan. Pastikan `MAX_DOCUMENT_UPLOAD_MB` (dan batas body reverse proxy) cukup untuk hasil pindai Anda.

## B. Karyawan

- **Dashboard / Absensi Saya**: tombol **Check-in** saat mulai dan **Check-out** saat selesai. Jam yang tertera adalah jam server. Bila absensi lokasi aktif, izinkan akses lokasi di browser. Catatan boleh diisi.
  - Terlambat bila check-in melewati *jam masuk + toleransi*. Lupa check-out → tercatat **belum lengkap**; minta HR mengoreksi.
  - Tanda **"Bagaimana angka ini dihitung?"** menjelaskan setiap angka rekap.
- **Shift malam:** check-in saat mulai (mis. 21.55) dan check-out pagi hari berikutnya (mis. 06.05) — keduanya tercatat pada **satu hari kerja** (tanggal shift dimulai). Check-in terlambat dini hari tetap masuk ke shift yang berjalan.
- **Setengah hari:** di *Pengajuan Saya* pilih tanggal tunggal lalu **Bagian hari** (pagi/siang). Pada hari itu Anda **tetap check-in** untuk separuh hari lainnya (jam masuk efektif cuti pagi = tengah jam kerja).
- **Lembur Saya:** ajukan tanggal, jam mulai, durasi, dan pekerjaan. Dibayar hanya bila **disetujui** dan **kehadiran Anda terbukti pada jam lembur yang disetujui**: yang dibayar adalah irisan antara jam lembur disetujui (jam mulai + durasi) dengan waktu Anda benar-benar hadir (check-in sampai check-out), dan hanya waktu setelah jam pulang jadwal. Contoh: pulang 16.00, check-out 17.00, lembur disetujui 18.00–19.00 → tidak dibayar. Status & catatan tampil di sana.
- **Banner beranda *(Direktur/Super Admin)*:** di beranda, tombol **Ubah pesan banner** pada banner → tulis judul, isi, dan (opsional) tanggal berakhir; centang **Kirim juga sebagai notifikasi** bila ingin masuk ke lonceng semua karyawan (email/WhatsApp hanya bagi yang memilihnya). **Kembalikan ke bawaan** memulihkan teks awal. Pesan tampil sebagai teks biasa di beranda seluruh karyawan.
- **Notifikasi desktop** (di komputer): **Keamanan & Notifikasi → Notifikasi desktop → Aktifkan di browser ini**, izinkan notifikasi pada peramban, lalu **Kirim notifikasi uji**. Notifikasi muncul di pojok layar meski tab portal tidak dibuka (peramban harus berjalan). Keluar dari portal menghentikannya di peramban itu; masuk lagi mengaktifkannya kembali otomatis. Aktifkan hanya di komputer pribadi.
- **Keamanan & Notifikasi:** aktifkan **2FA**, atur notifikasi **email/WhatsApp**, kirim pesan uji. **Lupa password?** di halaman masuk → tautan via email (bila diaktifkan) — atau minta HR.
- **Absen berbasis lokasi:** gunakan GPS presisi tinggi dan matikan aplikasi lokasi palsu/mode pengembang; absen yang tampak tidak wajar akan ditandai untuk ditinjau HR (bukan otomatis dianggap curang).
- **Pengajuan Saya**: pilih jenis, tanggal, alasan, lampiran (opsional). Status: Menunggu → Disetujui/Ditolak. Pengajuan *Menunggu* dapat dibatalkan sendiri. Cuti memakai saldo; tanggal akhir pekan/libur tidak dihitung.
- **Slip Gaji Saya**: **Lihat** (layar, nyaman di ponsel) atau **PDF** (satu halaman: ringkasan kehadiran termasuk *Lembur dibayar*, kolom **Catatan** untuk motivasi/peringatan, dan tanda tangan di kanan bawah). Hanya slip yang sudah diterbitkan; slip yang dibatalkan hilang dari daftar Anda.
- **Profil & Jadwal**: data Anda dan jadwal 14 hari. Ubah data lewat HR.
- **Kebijakan cuti Anda** tampil di *Pengajuan Saya*: kuota per tahun dan tanggal Anda **mulai berhak** cuti. Selama belum berhak, pengajuan **cuti** ditolak sistem; **izin dan sakit** tetap dapat diajukan.
- **Surat Tugas Saya**: surat tugas yang menugaskan Anda, **uang harian** yang menjadi hak Anda (hari × tarif), dan **Bukti Penerimaan Uang Harian** (PDF — cetak, tanda tangani basah pada kotak *Penerima*). Dokumen ini terpisah dari slip gaji.
- **Dokumen Saya**: kontrak kerja dan dokumen kepegawaian Anda; klik **Lihat** untuk membuka PDF di aplikasi (di sebagian peramban ponsel gunakan *Buka di tab baru* / *Unduh PDF*).
- **Tombol mata** pada isian password menampilkan/menyembunyikan isinya (pastikan tidak ada yang melihat layar Anda).

- **Penugasan di jadwal:** bila ada surat tugas untuk Anda, jadwal di *Profil & Jadwal* menampilkan "Dinas luar — tujuan". Itu hanya penanda: kehadiran tetap Anda catat di *Absensi Saya* dan dinilai sesuai kebijakan absensi. Lihat [PENUGASAN-JADWAL.md](PENUGASAN-JADWAL.md).
- **Atasan & Persetujuan Tim:** atasan langsung Anda tampil di *Profil & Jadwal*. Bila Anda atasan seseorang, menu **Persetujuan Tim** muncul: tinjau cuti, izin, sakit, dan lembur bawahan Anda di sana, dan tunjuk **pengganti** saat Anda cuti atau dinas luar. Anda tidak dapat memproses pengajuan sendiri. Lihat [ORGANISASI-ATASAN.md](ORGANISASI-ATASAN.md).

### Obrolan (bila diaktifkan)

Menu **Obrolan** (Layanan Saya) untuk berkoordinasi: **Japri** (tombol "Japri" → pilih rekan), **kanal publik** (semua karyawan dapat membaca dan menulis; mulai dengan kanal "Umum"), dan **utas penugasan** — buka tombol **Diskusi** pada Surat Tugas Saya atau pada tugas/proyek Training; hanya yang terlibat dalam penugasan itu yang dapat membaca. Tulis `@` lalu nama untuk menyebut seseorang; tombol **Penugasan** menyisipkan kartu penugasan Anda (orang yang tidak berhak melihatnya hanya melihat "tidak memiliki akses"). Pesan dapat disunting 15 menit pertama dan dihapus; lencana di menu menyala saat ada pesan baru, dan push desktop (bila Anda mengaktifkannya di *Keamanan & Notifikasi*) hanya untuk japri, utas, dan sebutan. **Privasi:** japri tidak dapat dibaca HR; Direktur dapat memeriksanya bila perlu dan setiap pembukaan tercatat. Pesan disimpan 6 bulan. Jangan menempel data pribadi peserta atau data gaji di kanal publik. Lihat [OBROLAN.md](OBROLAN.md).

## C. Admin / HR

- **Absensi**: pilih tanggal → lihat siapa hadir/terlambat/belum absen. **Koreksi** (alasan wajib) untuk lupa absen/salah jam, atau hapus catatan keliru. Riwayat koreksi tampil di bawah dan di detail karyawan.
- **Pengajuan & Cuti**: **Setujui** / **Tolak** (catatan wajib saat menolak). HR tidak dapat memproses pengajuannya sendiri (Super Admin yang memprosesnya). Pengajuan yang sudah disetujui dapat **dibatalkan** (alasan wajib; saldo cuti dikembalikan).
- **Rekap Absensi**: Harian / Mingguan / Bulanan / Periode bebas + filter; klik nama untuk rincian harian. **Ekspor** Excel/CSV/PDF mengikuti filter layar.
- **Pengajuan Lembur**: **Setujui** (menit boleh dikurangi), **Tolak** (catatan wajib), atau **Batalkan** yang sudah disetujui (alasan wajib). Periode gaji yang terdampak diberi tahu; yang sudah dihitung ditandai "Data berubah".
- **Tinjauan Lokasi**: antrean absensi lokasi yang ditandai/ditolak — lihat sinyal & titik di peta, lalu **Wajar** atau **Indikasi manipulasi** (catatan wajib). Tinjauan tidak mengubah absensi; gunakan **Koreksi** bila perlu.
- **Laporan & Analisis**: Ringkasan (KPI vs bulan lalu, tren 6 bulan, temuan), Kehadiran (per divisi, hari dalam seminggu, jam datang, peringkat), Cuti & Lembur, **Biaya SDM**, **BPJS & PPh 21** (rekap untuk pembayaran iuran/pelaporan), Karyawan (headcount, turnover, masa kerja). Ekspor Excel/CSV/PDF.
- **Penggajian**:
  1. **Buat periode gaji** (mis. 1–31 bulan lalu; opsional *periode absensi berbeda* untuk cut-off). Sistem langsung menghitung.
  2. **Periksa** tiap karyawan: komponen, rumus, sumber absensi. Peringatan (mis. absensi belum lengkap, gaji negatif) tampil di tabel. Tambah **penyesuaian** (alasan wajib) bila perlu. Koreksi absensi/komponen lalu klik **Hitung ulang**.
  2b. Isi **Catatan slip** per karyawan (motivasi / peringatan, maks. 400 karakter) di halaman rincian karyawan sebelum periode diajukan; kolom Catatan di slip selalu tampil ("-" bila kosong).
  3. **Ajukan persetujuan** → Pimpinan **Setujui** → HR **Terbitkan slip** (karyawan mendapat notifikasi).
  4. **Unduh semua slip** (1 PDF atau ZIP per karyawan).
  5. Salah? Hanya **Pimpinan** yang dapat *Batalkan penerbitan* (alasan wajib; slip jadi VOID) → HR *Buat revisi* → ulangi alur.
- **Surat Tugas** (menu; halaman *Surat Tugas & Uang Harian* — HR atau Pimpinan): **Terbitkan Surat Tugas** → isi maksud, lokasi, tanggal, pilih karyawan dan **uang harian per hari** (kolom *Hari* kosong = seluruh lama penugasan, hari kalender). Karyawan diberi notifikasi. Setelah uang diserahkan (tunai/transfer), klik **Terbitkan bukti penerimaan** pada penerimanya → unduh PDF, cetak, penerima menandatangani basah. HR tidak dapat menugaskan/menerbitkan bukti untuk dirinya sendiri (Super Admin). Salah? Surat tugas dibatalkan beralasan (hanya bila tidak ada bukti aktif); **bukti** hanya dapat dibatalkan Super Admin, lalu boleh diterbitkan ulang. Uang harian **tidak masuk slip gaji**.
- **Dokumen**: **Unggah dokumen** (PDF; kontrak wajib bertanggal mulai, tanggal berakhir kosong = tanpa batas waktu). Tab ringkasan menunjukkan *Perlu keputusan pimpinan*, *Menunggu kontrak perpanjangan*, dan *Segera berakhir*. Setelah pimpinan memutuskan **lanjut**, klik **Unggah perpanjangan** (kontrak lama ditandai *Sudah diperpanjang*). Salah unggah → **Arsipkan** (alasan wajib; berkas tetap tersimpan).
- **Kebijakan cuti per karyawan**: *Karyawan → detail → Kebijakan cuti karyawan* → **Ubah kebijakan** (berhak sejak / kuota / saldo negatif; alasan wajib). **Beri kuota {tahun}** memberi saldo awal satu karyawan sesuai kebijakannya; *Pengajuan & Cuti → Terapkan kuota* melakukannya untuk semua karyawan aktif yang belum punya saldo awal — yang belum berhak dilewati dan disebutkan. Jalankan lagi saat ada karyawan yang baru berhak.
- **Karyawan masuk & berhenti:** checklist dimulai otomatis saat karyawan baru ditambahkan atau karyawan dinonaktifkan. Kerjakan di kartu *Checklist masuk & berhenti* pada detail karyawan (atau lihat semua proses di menu **Masuk & Berhenti**); sistem memberi petunjuk dari data, Anda yang menandai Selesai / Tidak berlaku. Lihat [MASUK-BERHENTI.md](MASUK-BERHENTI.md).
- **Template & penanggung jawab checklist:** menu **Masuk & Berhenti → Atur template** mengubah butir, tenggat, dan penanggung jawab bawaan untuk checklist **baru**. Penanggung jawab diberi tahu, diingatkan menjelang/ setelah tenggat, dan mengerjakan butirnya di menu **Checklist Saya**.
- **Aset:** menu **Aset** untuk mendaftarkan, menyerahkan, dan mencatat pengembalian (baik/rusak/hilang). Saat karyawan berhenti, aset yang masih dipegang muncul sebagai peringatan pada butir *Pengembalian aset*; aset juga dapat dikembalikan dari detail karyawan. Lihat [ASET.md](ASET.md).
- **Penyelesaian akhir:** menu **Penyelesaian Akhir** (Admin/HR menyiapkan, pimpinan menyetujui). Periksa usulan sistem dan **isi sendiri** pesangon, UPMK, UPH, THR, dan pajak sebagai baris manual — sistem tidak menghitungnya. Lihat [PENYELESAIAN-AKHIR.md](PENYELESAIAN-AKHIR.md).
- **Organisasi & atasan:** di *Detail karyawan → Organisasi & atasan langsung*, tetapkan atasan dan ubah divisi/jabatan/status/**tingkat jabatan (Staf, Supervisor, Manajer)** dengan **tanggal berlaku**; riwayat tercatat otomatis. HR tetap melihat semua pengajuan dan dapat memprosesnya bila atasan tidak sempat (tercatat sebagai diproses HR).
- **Penting:** koreksi absensi *setelah* gaji terbit **tidak** mengubah slip; periode ditandai "Data berubah" sebagai pengingat. Sebelum slip terbit, perubahan **komponen gaji** (nominal, rumus, masa berlaku, tambah/nonaktif) sesudah Hitung juga menandai karyawan itu "Data berubah" dan memblokir Ajukan/Setujui/Terbitkan sampai Anda menekan **Hitung ulang** (Kembalikan ke Draf dulu bila sudah diajukan).

## D. Direktur (Super Admin)

Semua fitur HR ditambah: **keputusan lanjut/tidak kontrak** (*Dokumen* → *Putuskan lanjut/tidak*; Anda menerima notifikasi H-3 bulan, H-1 bulan, H-14 hari sebelum kontrak berakhir), **membatalkan Bukti Penerimaan Uang Harian**, **Setujui/Kembalikan** gaji, **Batalkan** periode disetujui/terbit, **Pengaturan** kebijakan & aturan, **Akun Pengguna** (semua peran), **Audit Log** (siapa mengubah apa dan kapan; tidak dapat diubah/dihapus).

**Fungsi Admin/HR ada pada Direktur** sampai Direktur memberi role Admin/HR kepada seseorang; Direktur boleh menyiapkan sekaligus menyetujui gaji (jejaknya di Audit Log). Di menu *Akses Training*, Direktur menunjuk **Koordinator Program** (biasanya Supervisor Administrasi & Kurikulum); karyawan bertingkat **Manajer** otomatis menjadi **Pemantau** (hanya baca). Karyawan berstatus **Magang** tidak dapat diberi wewenang persetujuan maupun akses data peserta — sistem menolaknya. Rincian: [PERAN-DAN-WEWENANG.md](PERAN-DAN-WEWENANG.md).

## E. Tanya-jawab singkat

- *Lupa password?* Mandiri lewat email (bila diaktifkan) — akun ber-2FA juga perlu kode. Atau Admin/HR → Akun Pengguna → **Reset password** (sesi lama diakhiri; wajib ganti saat login).
- *Ponsel 2FA hilang?* Pakai **kode pemulihan**. Tanpa itu, Super Admin lain → Akun Pengguna → **Reset 2FA**.
- *Mengapa PPh 21 Desember berbeda tajam?* Desember (atau bulan terakhir karyawan) dihitung setahun lalu dikurangi yang sudah dipotong; periksa peringatan data bulan sebelumnya pada rincian item gaji.
- *Karyawan berhenti?* Detail karyawan → **Nonaktifkan** (isi tanggal berhenti). Akun dimatikan, data tetap utuh; hari setelah tanggal berhenti tidak dihitung.
- *Mengapa hari ini "Tidak hadir" padahal baru pagi?* Status itu baru ditetapkan setelah **batas jam tidak hadir** pada jadwal (default 12.00). Sebelumnya "Belum absen".
- *Kenapa cuti saya tidak bisa diajukan?* Saldo/tersedia tidak cukup (saldo dikurangi pengajuan yang menunggu; pengajuan lintas tahun dicadangkan per tahun sesuai hari kerjanya), tanggal bentrok dengan pengajuan lain, atau rentang hanya berisi hari libur.
