# Deployment & operasional

## Variabel lingkungan (`.env`)

| Variabel | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | ya | `postgresql://user:pass@host:5432/db?schema=public` |
| `DATA_ENCRYPTION_KEY` | ya | 32 byte base64 untuk enkripsi nomor rekening: `openssl rand -base64 32`. **Simpan terpisah dari database & cadangan.** Hilang = nomor rekening tak terbaca; **mengganti nilainya** membuat data lama gagal didekripsi (belum ada rotasi otomatis). |
| `APP_URL` | ya | URL publik. Produksi wajib `https://` (cookie `Secure`/`__Host-`, pemeriksaan Origin). |
| `APP_TIMEZONE` | tidak | Default `Asia/Jakarta`. Semua "hari ini", jam masuk/pulang, dan batas tidak hadir mengacu ke sini. |
| `TRUST_PROXY` | tidak | `true` **hanya** bila di belakang reverse proxy tepercaya (agar rate limit per-IP memakai `X-Forwarded-For`). |
| `LOGIN_MAX_ATTEMPTS` `LOGIN_WINDOW_MINUTES` `LOGIN_LOCKOUT_MINUTES` | tidak | Default 5 / 15 / 15. |
| `SESSION_IDLE_HOURS` `SESSION_ABSOLUTE_DAYS` | tidak | Default 8 jam tak aktif / 7 hari. |
| `MAX_UPLOAD_MB` | tidak | Default 3. |
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
- Latihan pemulihan diverifikasi di lingkungan pengembangan: dump 22 tabel → pulih ke DB kosong → `db:verify` lulus → penimpaan tanpa konfirmasi ditolak.

## Pemeliharaan
- **Pembaruan:** `git pull` → `npm ci` → `npm run db:migrate` → `npm run build` → restart. Migrasi bersifat maju-saja; cadangkan sebelum migrasi.
- **Pemulihan akses:** `NEW_USER_PASSWORD='…' npm run user:create -- --email … --name "…" --role SUPER_ADMIN`.
- **Sesi & rate-limit** dibersihkan otomatis (sesi kedaluwarsa > 30 hari dihapus saat login).
- **Audit dependensi:** CI menjalankan `npm audit --omit=dev` (informasi). Peringatan `prisma`/`deepmerge-ts` saat ini hanya menyangkut CLI Prisma (alat build), bukan kode yang melayani permintaan.
