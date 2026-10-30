# Panduan Pengguna

## A. Setup awal (Super Admin & HR) — urutan yang disarankan

1. **Masuk** dengan akun Super Admin dari seed produksi → wajib ganti password.
2. **Pengaturan → Profil lembaga & slip**: nama, alamat, telepon, **unggah logo**, awalan nomor slip.
3. **Pengaturan → Kebijakan absensi & cuti** *(Super Admin)*: kuota cuti tahunan, batas pengajuan mundur, menit terlambat dari jam masuk / setelah toleransi, absensi lokasi (opsional). Tekan **Simpan & konfirmasi** — ini menandai kebijakan sudah Anda periksa.
4. **Jadwal & Libur**: periksa jadwal "Reguler" (contoh 08.00–16.00), tambah jadwal lain (mis. Ramadan) dan **penugasan** per karyawan/divisi/seluruh perusahaan dengan rentang tanggal. Isi **hari libur nasional & cuti bersama** (tidak ada daftar bawaan — sesuaikan dengan ketetapan pemerintah tahun berjalan).
5. **Karyawan**: buat divisi lewat **Kelola divisi**, lalu tambah karyawan satu per satu atau **Impor** dari Excel/CSV (unduh templat dulu; divisi baru pada file ikut dibuat otomatis).
6. **Detail karyawan → Komponen gaji**: minimal **Gaji pokok**; tambah tunjangan, uang makan/transport per hari hadir, BPJS/pajak (isi sendiri nominal/persen), kasbon (gunakan tanggal berakhir untuk cicilan), bonus sekali.
7. **Detail karyawan → Buat akun login** (atau menu Akun Pengguna) → sampaikan password sementara lewat kanal aman. **Pengajuan & Cuti → Terapkan kuota** memberi saldo awal tahun berjalan.
8. **Pengaturan → Aturan penggajian** *(Super Admin)*: tentukan potongan terlambat/tidak hadir, apakah izin/sakit/cuti memotong gaji, lembur. Default **semua nonaktif**. Tekan **"Saya sudah memverifikasi aturan ini"** — gaji tidak dapat disetujui sebelum ini.

## B. Karyawan

- **Dashboard / Absensi Saya**: tombol **Check-in** saat mulai dan **Check-out** saat selesai. Jam yang tertera adalah jam server. Bila absensi lokasi aktif, izinkan akses lokasi di browser. Catatan boleh diisi.
  - Terlambat bila check-in melewati *jam masuk + toleransi*. Lupa check-out → tercatat **belum lengkap**; minta HR mengoreksi.
  - Tanda **"Bagaimana angka ini dihitung?"** menjelaskan setiap angka rekap.
- **Pengajuan Saya**: pilih jenis, tanggal, alasan, lampiran (opsional). Status: Menunggu → Disetujui/Ditolak. Pengajuan *Menunggu* dapat dibatalkan sendiri. Cuti memakai saldo; tanggal akhir pekan/libur tidak dihitung.
- **Slip Gaji Saya**: **Lihat** (layar, nyaman di ponsel) atau **PDF**. Hanya slip yang sudah diterbitkan; slip yang dibatalkan hilang dari daftar Anda.
- **Profil & Jadwal**: data Anda dan jadwal 14 hari. Ubah data lewat HR.

## C. Admin / HR

- **Absensi**: pilih tanggal → lihat siapa hadir/terlambat/belum absen. **Koreksi** (alasan wajib) untuk lupa absen/salah jam, atau hapus catatan keliru. Riwayat koreksi tampil di bawah dan di detail karyawan.
- **Pengajuan & Cuti**: **Setujui** / **Tolak** (catatan wajib saat menolak). HR tidak dapat memproses pengajuannya sendiri (Super Admin yang memprosesnya). Pengajuan yang sudah disetujui dapat **dibatalkan** (alasan wajib; saldo cuti dikembalikan).
- **Rekap Absensi**: Harian / Mingguan / Bulanan / Periode bebas + filter; klik nama untuk rincian harian. **Ekspor** Excel/CSV/PDF mengikuti filter layar.
- **Penggajian**:
  1. **Buat periode gaji** (mis. 1–31 bulan lalu; opsional *periode absensi berbeda* untuk cut-off). Sistem langsung menghitung.
  2. **Periksa** tiap karyawan: komponen, rumus, sumber absensi. Peringatan (mis. absensi belum lengkap, gaji negatif) tampil di tabel. Tambah **penyesuaian** (alasan wajib) bila perlu. Koreksi absensi/komponen lalu klik **Hitung ulang**.
  3. **Ajukan persetujuan** → Pimpinan **Setujui** → HR **Terbitkan slip** (karyawan mendapat notifikasi).
  4. **Unduh semua slip** (1 PDF atau ZIP per karyawan).
  5. Salah? Hanya **Pimpinan** yang dapat *Batalkan penerbitan* (alasan wajib; slip jadi VOID) → HR *Buat revisi* → ulangi alur.
- **Penting:** koreksi absensi *setelah* gaji terbit **tidak** mengubah slip; periode ditandai "Data berubah" sebagai pengingat.

## D. Super Admin / Pimpinan

Semua fitur HR ditambah: **Setujui/Kembalikan** gaji, **Batalkan** periode disetujui/terbit, **Pengaturan** kebijakan & aturan, **Akun Pengguna** (semua peran), **Audit Log** (siapa mengubah apa dan kapan; tidak dapat diubah/dihapus).

## E. Tanya-jawab singkat

- *Lupa password?* Admin/HR → Akun Pengguna → **Reset password** (sesi lama diakhiri; wajib ganti saat login).
- *Karyawan berhenti?* Detail karyawan → **Nonaktifkan** (isi tanggal berhenti). Akun dimatikan, data tetap utuh; hari setelah tanggal berhenti tidak dihitung.
- *Mengapa hari ini "Tidak hadir" padahal baru pagi?* Status itu baru ditetapkan setelah **batas jam tidak hadir** pada jadwal (default 12.00). Sebelumnya "Belum absen".
- *Kenapa cuti saya tidak bisa diajukan?* Saldo/tersedia tidak cukup (saldo dikurangi pengajuan yang menunggu), tanggal bentrok dengan pengajuan lain, atau rentang hanya berisi hari libur.
