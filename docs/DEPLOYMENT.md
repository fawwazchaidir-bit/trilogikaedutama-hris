# Deployment & operasional

## Variabel lingkungan (`.env`)

| Variabel | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | ya | `postgresql://user:pass@host:5432/db?schema=public` |
| `DATA_ENCRYPTION_KEY` | ya | 32 byte base64 untuk enkripsi nomor rekening: `openssl rand -base64 32`. **Simpan terpisah dari database & cadangan.** Hilang = nomor rekening tak terbaca; **mengganti nilainya** membuat data lama gagal didekripsi (belum ada rotasi otomatis). |
| `APP_URL` | ya | URL publik. Produksi wajib `https://` (cookie `Secure`/`__Host-`, pemeriksaan Origin). |
| `APP_TIMEZONE` | tidak | Default `Asia/Jakarta`. Semua "hari ini", jam masuk/pulang, dan batas tidak hadir mengacu ke sini. |
| `TRUST_PROXY` | tidak | `true` **hanya** bila di belakang reverse proxy tepercaya (agar rate limit per-IP memakai alamat klien dari `X-Forwarded-For`). |
| `TRUST_PROXY_HOPS` | tidak | Jumlah proxy tepercaya di depan aplikasi (default `1`; Cloudflare → Nginx = `2`). Alamat klien diambil dari `X-Forwarded-For` sebanyak ini dari **kanan** — entri paling kiri dapat dikirim klien sendiri sehingga tidak pernah dipercaya. |
| `LOGIN_MAX_ATTEMPTS` `LOGIN_WINDOW_MINUTES` `LOGIN_LOCKOUT_MINUTES` | tidak | Default 5 / 15 / 15. |
| `SESSION_IDLE_HOURS` `SESSION_ABSOLUTE_DAYS` | tidak | Default 8 jam tak aktif / 7 hari. |
| `MAX_UPLOAD_MB` | tidak | Default 3 (logo, foto, lampiran). |
| `MAX_DOCUMENT_UPLOAD_MB` | tidak | Default 10 (1–50): batas PDF **dokumen/kontrak**. Samakan dengan batas body reverse proxy — Nginx: `client_max_body_size 12m;` (lebih besar sedikit dari nilai ini) — kalau tidak, unggahan besar gagal di proxy sebelum sampai aplikasi. |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `MAIL_FROM` | tidak | Email (notifikasi & **lupa password mandiri**). Tanpa `SMTP_HOST`+`MAIL_FROM` fitur email nonaktif (notifikasi dalam aplikasi tetap jalan; reset oleh Admin/HR tetap ada). `SMTP_SECURE=true` untuk port 465; selain itu STARTTLS. |
| `WHATSAPP_PROVIDER` `WHATSAPP_TOKEN` `WHATSAPP_API_URL` `WHATSAPP_PHONE_NUMBER_ID` `WHATSAPP_TEMPLATE_NAME` `WHATSAPP_TEMPLATE_LANG` | tidak | WhatsApp: `fonnte` (token), `cloud_api` (token + phone number id; template untuk pesan di luar jendela 24 jam), atau `webhook` (POST JSON `{channel,to,text,app}` ke URL Anda). Kosong = nonaktif. |
| `RETENTION_WORKER` | tidak | `true` (default): pekerja retensi foto absensi di dalam aplikasi (2 menit setelah start lalu tiap 6 jam). `false` bila memakai `/api/internal/retention`. Aman di banyak instance. |
| `CONTRACT_REMINDER_WORKER` | tidak | `true` (default): pekerja pengingat kontrak kerja di dalam aplikasi (3 menit setelah start lalu tiap 6 jam; idempoten & aman di banyak instance). `false` bila memakai `POST /api/internal/contract-reminders` (Bearer `CRON_SECRET`), mis. cron harian: `0 7 * * * curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://hris.example.com/api/internal/contract-reminders`. |
| `DELIVERY_WORKER` | tidak | `true` (default): pekerja pengiriman antrean di dalam aplikasi, tiap 30 detik. `false` bila memakai pemicu eksternal. |
| `CRON_SECRET` | tidak | ≥ 16 karakter; mengaktifkan `POST /api/internal/deliveries` (Bearer) untuk cron/systemd timer. |
| `PASSWORD_RESET_MINUTES` | tidak | Masa berlaku tautan lupa password; default 30. |
| `ADMIN_EMAIL` `ADMIN_NAME` `ADMIN_PASSWORD` | seed produksi | Super Admin pertama. Tanpa password default; seed gagal bila lemah. |

Rahasia hanya dari environment — tidak ada kredensial di kode. `.env` tidak di-commit (`.gitignore`).

## Langkah pertama (server tanpa Docker)

```bash
npm ci
cp .env.example .env     # isi nilai produksi
npm run db:migrate       # prisma migrate deploy
npm run db:seed          # jadwal default + 1 Super Admin (bukan db:seed:dev!)
npm run build && npm start   # port 3000; pasang reverse proxy HTTPS di depannya
```
Health check (tanpa autentikasi): `GET /api/health`.

## Docker (satu server)

```bash
# .env: POSTGRES_PASSWORD, APP_URL, DATA_ENCRYPTION_KEY, ADMIN_EMAIL, ADMIN_PASSWORD
docker compose up -d --build     # db → migrate+seed (sekali) → app (127.0.0.1:3000)
```
Aplikasi hanya mendengarkan loopback; pasang Caddy/Nginx dengan TLS. Contoh Caddy: `hris.contoh.id { reverse_proxy 127.0.0.1:3000 }`.
> Catatan: image belum dibuild di lingkungan pengembangan (tanpa daemon Docker). Mode `standalone` yang dipakai Dockerfile sudah diuji berjalan; uji `compose up --build` di server Anda sebelum produksi.

## Notifikasi email & WhatsApp

1. Isi variabel SMTP/WhatsApp di `.env`, restart aplikasi.
2. Masuk → **Keamanan & Notifikasi → Kirim email/WhatsApp uji** untuk membuktikan konfigurasi bekerja (dibatasi 5/jam).
3. **Pengaturan → Pengiriman email & WhatsApp** menampilkan antrean (menunggu/terkirim/gagal), alasan kegagalan terakhir, serta tombol *Proses sekarang* dan *Antre ulang yang gagal* (Super Admin).
4. Pengguna memilih saluran & nomor WhatsApp sendiri di *Keamanan & Notifikasi* (format 08…/+62… dinormalisasi).
5. Pemicu eksternal (opsional): `DELIVERY_WORKER=false`, `CRON_SECRET=…`, lalu cron tiap menit: `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://hris.contoh.id/api/internal/deliveries`.

Catatan: **WhatsApp Cloud API** hanya mengirim teks bebas dalam jendela 24 jam sejak pesan terakhir pengguna; untuk notifikasi proaktif buat template (satu variabel isi `{{1}}`) di Meta, tunggu disetujui, lalu isi `WHATSAPP_TEMPLATE_NAME`. **Fonnte**: sambungkan perangkat WhatsApp di dashboard Fonnte dan isi tokennya. Integrasi dengan penyedia sungguhan belum diuji di lingkungan pengembangan.

## Jam server
Aplikasi dan PostgreSQL **harus tersinkron NTP** (selisih ≤ beberapa detik). Waktu absensi, masa berlaku sesi/tautan reset, batas laju, dan jendela deteksi lokasi memakai jam aplikasi, sedangkan kolom `createdAt` memakai jam basis data; selisih besar membuat perbandingan keduanya keliru (ditemukan pada uji silang waktu — lihat docs/AUDIT.md).

## Foto absensi (bukti dinas luar)
Tidak butuh konfigurasi jaringan. Aplikasi memakai **sharp** (pengolah gambar native; ikut terpasang lewat `npm ci`, memerlukan Linux glibc seperti image `node:22-bookworm-slim`, bukan Alpine) dan font cap di `public/fonts/` (DejaVu Sans Mono Bold, lisensi bebas — ikut disalin ke image oleh `COPY public`). Cap digambar sebagai path vektor, jadi **tidak perlu menginstal font di server**. Kamera & lokasi di browser hanya bekerja lewat **HTTPS**. Foto disimpan di basis data (tabel `stored_files`, ±100–400 KB per foto): perhitungkan pertumbuhan penyimpanan & cadangan (±2 foto/karyawan/hari) dan tentukan masa simpan di Pengaturan (bawaan 6 bulan; foto lebih tua dihapus otomatis tiap 6 jam, ukuran basis data lalu stabil — ruang yang dibebaskan dipakai ulang oleh PostgreSQL). Foto yang dihapus **masih ada di cadangan** sampai `BACKUP_KEEP_DAYS` lewat. Pemicu eksternal (opsional): `RETENTION_WORKER=false` + `CRON_SECRET`, lalu cron harian `curl -fsS -X POST -H "Authorization: Bearer $CRON_SECRET" https://hris.contoh.id/api/internal/retention`.

## Cadangan & pemulihan

```bash
# Cadangan (format custom + verifikasi arsip + checksum + retensi)
DATABASE_URL=… BACKUP_DIR=/var/backups/trilogika-hris BACKUP_KEEP_DAYS=30 npm run db:backup
# cron harian 01.30:
# 30 1 * * *  cd /opt/trilogika-hris && npm run -s db:backup >> /var/log/trilogika-hris-backup.log 2>&1

# LATIHAN pemulihan (disarankan rutin) — ke database kosong:
createdb hris_restore_check
TARGET_URL=postgresql://…/hris_restore_check npm run db:restore -- backups/hris_YYYYMMDD_HHMMSS.dump
DATABASE_URL=postgresql://…/hris_restore_check npm run db:verify     # jumlah baris + integritas (slip vs item, trigger terpasang)

# Pemulihan nyata ke database berisi — hentikan aplikasi dulu:
CONFIRM_RESTORE=yes TARGET_URL=… npm run db:restore -- backups/hris_….dump
```
- Skrip menolak menimpa database berisi tanpa `CONFIRM_RESTORE=yes` dan memeriksa checksum.
- **Salin arsip ke penyimpanan di luar server** (terenkripsi). Arsip berisi data pribadi & gaji.
- Cadangkan `DATA_ENCRYPTION_KEY` **secara terpisah** dari arsip.
- Pemulihan ke versi aplikasi yang lebih lama tidak didukung: jalankan versi aplikasi yang sama atau lebih baru, lalu `npm run db:migrate`.
- Latihan pemulihan diverifikasi di lingkungan pengembangan: dump 22 tabel (versi Tahap 1; Tahap 2 menambah tabel: pengajuan lembur, catatan lokasi, antrean pengiriman, pemulihan 2FA, tantangan login, token reset) → pulih ke DB kosong → `db:verify` lulus → penimpaan tanpa konfirmasi ditolak.

## Pemeliharaan
- **Pembaruan:** `git pull` → `npm ci` → `npm run db:migrate` → `npm run build` → restart. Migrasi bersifat maju-saja; cadangkan sebelum migrasi.
- **Pemulihan akses:** `NEW_USER_PASSWORD='…' npm run user:create -- --email … --name "…" --role SUPER_ADMIN`.
- **Sesi & rate-limit** dibersihkan otomatis (sesi kedaluwarsa > 30 hari dihapus saat login).
- **Audit dependensi:** CI menjalankan `npm audit --omit=dev` (informasi). Peringatan `prisma`/`deepmerge-ts` saat ini hanya menyangkut CLI Prisma (alat build), bukan kode yang melayani permintaan.
