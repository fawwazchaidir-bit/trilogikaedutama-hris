# Keamanan & privasi

| Area | Kontrol |
|---|---|
| **Autentikasi** | Password di-hash **scrypt** (N=2¹⁵, parameter tersimpan → dapat dinaikkan). Kebijakan: ≥ 12 karakter, bukan yang umum, tidak memuat email/nama. Waktu respons disamakan untuk akun tak dikenal (anti user-enumeration). |
| **Sesi** | Cookie `HttpOnly`, `SameSite=Lax`, `Secure` + awalan `__Host-` di HTTPS. Token acak 256-bit; **hanya SHA-256-nya** disimpan. Idle 8 jam / absolut 7 hari; dicabut saat logout, ganti/reset password, ganti peran, atau nonaktif. |
| **Brute force** | Batas percobaan login per email (5/15 menit) dan per IP, atomik di database; dikunci sementara. |
| **Otorisasi (RBAC)** | Matriks di `src/lib/permissions.ts`, **ditegakkan di service layer** (bukan hanya menu). Karyawan: `employeeId` selalu dari sesi, tidak pernah dari input; data orang lain → 403/404 (diuji E2E dengan 2 akun). Halaman terlarang menjawab 404. HR tidak dapat memproses pengajuannya sendiri; hanya Super Admin menyetujui/membatalkan gaji. |
| **CSRF** | Cookie SameSite + pemeriksaan header `Origin` pada semua permintaan yang mengubah data. |
| **Header** | CSP ketat, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, HSTS (produksi). `Permissions-Policy`: kamera/mikrofon mati; geolokasi hanya `self` (fitur absensi lokasi). |
| **Validasi** | Zod di server untuk setiap masukan; `CHECK`/unik/trigger di database sebagai lapis kedua. Kesalahan internal tidak membocorkan detail. |
| **Data sensitif** | Nomor rekening dienkripsi **AES-256-GCM** (kunci dari env; terdeteksi bila dimodifikasi); hanya 4 digit terakhir di layar/slip/ekspor; membuka nomor lengkap hanya admin dan **dicatat di audit**. Slip: nomor rekening tidak pernah lengkap. Unduhan/pembukaan slip dicatat. Ekspor dicatat. Respons berkas `private, no-store`. |
| **Unggahan** | Tipe diverifikasi dari **isi berkas** (magic bytes), bukan ekstensi; SVG ditolak; batas ukuran; akses berkas dibatasi (foto: admin/pemilik; lampiran: peninjau/pengunggah). |
| **Ekspor** | Sel berawalan `= + - @` dinetralkan (CSV/Excel injection). |
| **Audit** | `audit_logs` append-only di level database (trigger) — tidak dapat diubah/dihapus bahkan lewat SQL. Mencatat perubahan karyawan, absensi & koreksi, pengajuan, saldo, jadwal, komponen, penggajian, pengaturan, akun, login/logout, ekspor. |
| **Integritas gaji** | Slip terbit & item/rincian di luar Draf dikunci trigger; alur status divalidasi database; deteksi data basi; riwayat koreksi absensi & buku saldo cuti append-only. |
| **Absensi lokasi** | Opsional; koordinat dibaca **sekali** saat check-in/out, tidak ada pelacakan berkelanjutan, tidak ada selfie. Disimpan hanya bila fitur aktif. **Tidak menjamin anti-manipulasi.** |
| **Rahasia** | Hanya dari environment. Seed produksi tanpa password default. Akun demo ditandai `isDemo` + banner; seed demo menolak produksi/host non-lokal/database berisi. |
| **Cadangan** | Skrip dengan verifikasi arsip + checksum; pemulihan menolak menimpa tanpa konfirmasi (lihat DEPLOYMENT). |

## Catatan & batasan yang perlu Anda ketahui
- Tidak ada 2FA/SSO dan tidak ada "lupa password" mandiri.
- Enkripsi hanya untuk nomor rekening; data lain (gaji, alamat) dilindungi akses & enkripsi disk/cadangan yang Anda siapkan di infrastruktur.
- Dependensi: `npm audit` melaporkan kerentanan pada rantai `prisma` CLI (`deepmerge-ts`) — alat build, bukan jalur permintaan.
- Pindai dan pembaruan dependensi rutin tetap diperlukan; pertimbangkan uji penetrasi independen sebelum menyimpan data nyata.
