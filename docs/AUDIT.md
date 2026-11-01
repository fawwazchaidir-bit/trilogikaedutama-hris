# Laporan audit pra-PR (Tahap 2)

Audit menyeluruh sebelum PR: statis, silang waktu/zona, sapuan seluruh rute API, uji petik antar sistem, beban ringan, dan latihan pemasangan.
Tujuannya **menemukan bug**, bukan membuktikan tidak ada bug — daftar "Batasan" di bawah menyebut apa yang **tidak** tercakup.

## Ringkasan temuan

| # | Temuan | Dampak | Status |
|---|---|---|---|
| 1 | **Alamat IP dari `X-Forwarded-For` entri kiri dapat dipalsukan klien** (dulu dipakai untuk "jaringan kantor") | Karyawan dapat berpura-pura berada di Wi-Fi kantor | Diperbaiki (entri yang ditambahkan proxy, `TRUST_PROXY_HOPS`); fitur jaringan kantor dihapus seluruhnya |
| 2 | **Cache kebijakan "2FA wajib" tidak terhapus di halaman** (variabel modul berbeda antara RSC dan route handler pada build produksi) | Admin tanpa 2FA tetap bisa membuka halaman ≤ 15 detik setelah kebijakan diwajibkan | Diperbaiki (`globalThis`), ditemukan E2E |
| 3 | **Respons JSON API tanpa `Cache-Control`** (data gaji/absensi) | Risiko tersimpan di cache perantara/peramban | Diperbaiki: `no-store` pada semua JSON sukses & galat; diuji di seluruh rute GET |
| 4 | Unggahan (logo, foto karyawan, impor) dibaca ke memori **sebelum** izin diperiksa | Pengguna login tanpa izin dapat membuat server membaca badan ≤ 3 MB per permintaan | Diperbaiki: izin diperiksa lebih dulu (403) |
| 5 | Id ngawur di URL (`/api/overtime/xyz/review`) menghasilkan **500** | Galat server, bukan 404 | Diperbaiki (P2023 → 404); kini dijaga sapuan rute |
| 6 | **21 tes bertanggal tetap akan gagal sendiri mulai ±Jan–Mar 2027** (tanggal Jan/Mar 2026 + aturan mundur 365 hari) | CI menjadi merah tanpa perubahan kode | Diperbaiki: `pinNow()` mempatok titik awal waktu; terbukti lulus pada `TEST_NOW=2027-06-01` |
| 7 | 2 tes E2E lama menulis nama bulan tetap ("Gaji Agustus/September 2026") | Gagal saat bulan berganti (terjadi nyata saat tanggal berganti ke November) | Diperbaiki: label dihitung dari tanggal |
| 8 | `db:verify` tidak mencakup tabel/trigger Tahap 2 | Pemulihan cadangan bisa lolos verifikasi walau trigger bukti foto/lembur hilang | Diperbaiki: 10 trigger yang diharapkan + konsistensi foto/retensi + berkas yatim |
| 9 | **Foto absensi (berwajah) dan lampiran cuti/sakit disajikan `private, max-age=3600, immutable`** — tersimpan di cache peramban 1 jam, termasuk di perangkat bersama setelah keluar | Data pribadi sensitif dapat dibuka lewat cache/tombol kembali | Diperbaiki: `private, no-store` untuk foto absensi & lampiran; logo/foto profil tetap boleh di-cache pribadi; diuji E2E |
| 10 | Pada beberapa rute **validasi masukan dijalankan sebelum pemeriksaan izin** (mis. `POST /api/users {}` oleh Karyawan → 422, bukan 403) | Tidak ada kebocoran data; hanya urutan pemeriksaan | Diperiksa dengan badan **valid**: tetap 403 dan tidak ada perubahan tersimpan (diuji). Urutan tidak diubah |
| 11 | **Unggah logo, foto karyawan (dan tanda tangan) lewat rute sungguhan SELALU ditolak "File … tidak valid"** — berkas dibuat dalam satu transaksi, lalu dipasang oleh fungsi yang membuka transaksi TERPISAH yang tidak melihat baris yang belum ter-commit. Ada sejak Tahap 1; tidak tertangkap karena tidak ada tes yang melewati rute unggah (tes layanan memakai berkas yang sudah ter-commit) | Logo & foto profil tidak dapat diganti oleh pengguna | Diperbaiki (transaksi diteruskan); E2E kini mengunggah logo, foto karyawan, dan tanda tangan lewat rute. Ditemukan saat fitur tanda tangan slip dites — **bukti bahwa tes lapisan layanan saja tidak cukup; pertahankan E2E pada rute** |

Bug logika pada fitur Tahap 2 yang ditemukan **selama pengembangan** (sebelum audit ini) tercatat pada riwayat commit, mis.: status check-out shift malam, `inBpjsBase` bernilai nol, larik konfigurasi bersama yang tertimpa, CIDR IPv4-mapped, histogram jam kedatangan.

## Apa yang dijalankan dan hasilnya

### A. Statis & higiene
- `tsc --noEmit` dan `eslint .`: bersih. Tidak ada rahasia di berkas terlacak maupun riwayat git; `.env` tidak pernah dikomit; tidak ada blob > 1 MB.
- Tidak ada `eval`/`new Function`; satu `dangerouslySetInnerHTML` (SVG kode QR yang dibuat server dari data tanpa teks pengguna); satu `$queryRawUnsafe` (skrip `verify-db`, nama tabel konstan).
- Tinjauan otorisasi layanan: seluruh fungsi layanan ber-`actor` diperiksa; yang tampak tanpa `assertCan` (akun sendiri, notifikasi sendiri, 2FA sendiri, rekap yang dikunci ke diri sendiri, impor via fungsi `analyze` yang memeriksa izin, pengguna via `assertManages`) terbukti terlindungi lewat jalur lain.
- `npm audit --omit=dev`: 11 temuan (3 tinggi, 8 sedang), **semuanya transitif**: `deepmerge-ts` (pada CLI Prisma — hanya saat migrasi, bukan jalur permintaan) dan `minimatch`/`archiver` (dependensi ExcelJS; dipakai menulis XLSX, bukan mencocokkan pola dari masukan pengguna). Perbaikan otomatis memerlukan `--force` (mengganti versi mayor) sehingga **tidak dilakukan** menjelang PR; dipantau di CI (`npm audit` informatif). Sharp dan opentype.js (dependensi baru) tidak menambah temuan.

### B. Silang waktu & zona (jam palsu `TEST_NOW`)
- Unit (284 tes) lulus pada 6 tanggal batas (pergantian tahun, 29 Feb 2028, tanggal UTC ≠ WIB, dst.).
- Integrasi pada 2026-12-31 17:30 UTC (= 00:30 WIB 1 Jan), 2027-01-01, 2027-02-15, 2027-06-01. Ditemukan temuan #6. **14 tes selalu gagal pada tanggal yang dimajukan** — itu **artefak uji**, bukan bug: kolom `createdAt DEFAULT now()` memakai jam basis data asli sedangkan `Date` aplikasi dimajukan (jendela 15 menit/24 jam, batas laju, sesi). Di produksi kedua jam sama; **syaratnya jam server aplikasi dan basis data tersinkron (NTP)** — dicatat di DEPLOYMENT.
- Zona proses `America/Los_Angeles` dan `Pacific/Kiritimati` (UTC+14): unit 284/284 dan integrasi 268/268 lulus (+2 dilewati: uji beban opt-in); semua perhitungan memakai `APP_TIMEZONE`, bukan zona server.

### C. Sapuan seluruh rute API (E2E, build produksi) — `tests/e2e/05c-sweep.spec.ts`
Rute ditemukan **otomatis** dari `src/app/api` (±100 pasang rute × metode) dan dijalankan sebagai anonim, Karyawan, HR, Super Admin:
anonim → 401 di semua rute non-publik; **tanpa respons 5xx** untuk GET (UUID kosong / id ngawur), badan `{}`, JSON rusak, `text/plain`, `null`; **tidak ada bocoran Prisma/stack** pada galat; CSRF (tanpa/asing Origin → 403) di setiap rute pengubah; batas hak akses Karyawan/HR/Super Admin; rekap dikunci ke diri sendiri (JSON & CSV); eskalasi hak dengan **badan valid** (Karyawan/HR tidak dapat membuat atau mengubah akun di atas haknya; Super Admin tetap utuh); `no-store` pada JSON; header keamanan & cookie sesi (HttpOnly, SameSite=Lax).

### D. Uji petik antar sistem — `tests/integration/cross-system.test.ts`
Satu skenario (shift malam, cuti setengah hari, izin setengah hari, sakit, lembur, terlambat, tidak hadir, lupa check-out, foto, BPJS/PPh 21, periode gaji sampai slip terbit; semua tanggal relatif ke bulan lalu). Angka yang sama dibandingkan lintas modul — **identik** di: rekap (daftar/rincian/rentang), laporan kehadiran, absensi sumber penggajian, slip; saldo cuti = buku besar = rekap; lembur = laporan = gaji (dihitung manual: 120 menit × Rp20.000/jam = Rp40.000); biaya SDM & kepatuhan = jumlah item; foto = jumlah punch dengan waktu cap = waktu absensi; notifikasi & audit lengkap; integritas basis data (gaji bersih, slip aktif, saldo, foto yatim).

### Beban ringan (opt-in `PERF=1`) — `tests/integration/performance-smoke.test.ts`
| Operasi | 300 karyawan | 900 karyawan |
|---|---|---|
| Rekap bulanan semua karyawan | 1,0 s | 2,7 s |
| Dasbor admin | 0,9 s | 2,8 s |
| Laporan kehadiran | 0,9 s | 3,0 s |
| Buat + hitung periode gaji | 1,2 s | 3,2 s |
| **Ringkasan eksekutif (tren 6 bulan)** | **3,3 s** | **9,9 s** |

Pertumbuhan **linear** (3× karyawan ≈ 3× waktu), tidak ada ledakan kuadratik. Ringkasan eksekutif adalah halaman terberat (menghitung 6 bulan absensi tiap dibuka); aman untuk ratusan karyawan, perlu cache bila perusahaan melewati ±500 karyawan.

### E. Latihan pemasangan (basis data sementara)
Install bersih dari nol (5 migrasi, **tanpa drift** terhadap `schema.prisma`) → seed produksi (idempoten; bawaan aman: foto OFF, retensi 6 bulan, lokasi FLAG, 2FA opsional) → seed demo → `db:verify` lulus → backup → restore ke basis data baru (jumlah baris identik, trigger ikut terpulihkan, restore menolak menimpa DB berisi tanpa `CONFIRM_RESTORE`) → **upgrade dari data Tahap 1** (2 migrasi awal + data → migrasi penuh; data utuh, bawaan baru benar). **Build standalone** (isi image Docker: `standalone` + `static` + `public`) dijalankan dengan `node server.js`: sharp, `@img/sharp-linux-x64`, opentype.js, dan font cap ikut terbawa; alur foto absensi (tanpa foto 422; dengan foto 200; cap benar-benar tergambar pada piksel; unduh JPEG), retensi lewat `POST /api/internal/retention` (rahasia benar 200, salah 401), tanpa galat modul di log.

## Batasan (jujur)
- **Tidak ada audit pihak ketiga / uji penetrasi**; yang dilakukan adalah pengujian otomatis dan tinjauan sistematis. Nol bug tidak dapat dibuktikan.
- **Image Docker sendiri tidak dibangun** (tidak ada Docker di lingkungan audit); isi image ditiru dari keluaran `standalone` sesuai `Dockerfile`. Uji `docker build` & `docker compose up` tetap perlu dilakukan sekali di mesin Anda.
- **Email dan WhatsApp belum diuji ke penyedia sungguhan** (hanya pengirim tiruan).
- Cap foto menjamin **waktu server dan koordinat yang dikirim perangkat** — bukan keaslian isi foto atau lokasi (lihat SECURITY).
- Tabel pajak/BPJS bawaan **harus diverifikasi** konsultan pajak sebelum diaktifkan; fitur nonaktif secara bawaan.
- Uji beban memakai satu mesin & PostgreSQL lokal; waktu produksi akan berbeda (jaringan, spesifikasi).
- Audit tidak menguji browser selain Chromium, dan tidak menguji aksesibilitas secara formal.

## Cara mengulang
```bash
npm run lint && npm run typecheck && npm test                  # unit + integrasi (PostgreSQL uji)
npm run test:e2e                                               # build produksi + browser (termasuk sapuan rute 05c)
TEST_NOW=2027-01-01T01:00:00Z npx vitest run                   # uji silang waktu (14 tes jam-DB wajar gagal; lihat bagian B)
TZ=Pacific/Kiritimati npx vitest run                           # uji zona proses
PERF=1 PERF_EMPLOYEES=300 npx vitest run --project integration tests/integration/performance-smoke.test.ts
DATABASE_URL=… npm run db:verify                               # integritas basis data / hasil pemulihan
```
