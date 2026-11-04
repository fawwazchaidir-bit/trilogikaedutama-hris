# Notifikasi desktop (Web Push) — cara kerja, pengaktifan, dan batasan

Notifikasi yang muncul sebagai **notifikasi sistem di komputer** (pojok layar Windows/macOS/Linux), bahkan saat tab portal tidak sedang dibuka — selama
**peramban berjalan**. Tanpa biaya per pesan, tanpa nomor telepon, tanpa penyedia pihak ketiga yang perlu dikontrak. Fitur ini **khusus desktop**
(perangkat seluler tidak ditawari; di ponsel tetap ada notifikasi di dalam aplikasi/lonceng).

Semua pesan otomatis portal memakai jalur yang sama dengan email/WhatsApp: pengingat tenggat H-1/hari-H, eskalasi, broadcast Direktur, persetujuan, dll.

## 1. Alur

```
Peristiwa ──▶ notifyUsers (satu transaksi) ──▶ lonceng dalam aplikasi        (selalu)
                                           ├─▶ antrean `notification_deliveries` saluran PUSH — SATU per perangkat yang diaktifkan pengguna
                                           └─▶ (email / WhatsApp bila dikonfigurasi & dipilih)
Pekerja pengiriman (tiap 30 dtk) ─▶ mengenkripsi pesan untuk peramban itu ─▶ POST ke push service peramban ─▶ peramban menampilkan notifikasi
```

- Pengguna **mengaktifkan sendiri** per peramban: **Keamanan & Notifikasi → Notifikasi desktop → Aktifkan di browser ini** (peramban meminta izin). Tidak ada yang diaktifkan otomatis.
- Pesan **dienkripsi untuk peramban penerima** (RFC 8291, `aes128gcm`) dan ditandatangani dengan kunci VAPID server (RFC 8292). Push service milik peramban
  (Google untuk Chrome/Edge/Opera, Mozilla untuk Firefox, Apple untuk Safari, Microsoft untuk Windows) hanya meneruskan data terenkripsi.
- Klik notifikasi membuka/memfokuskan portal pada halaman terkait (hanya tautan di dalam situs yang dipakai).
- **Keluar dari portal** menghentikan penerimaan di peramban itu (komputer bisa dipakai orang lain); **masuk lagi** mendaftarkannya otomatis bila izin masih diberikan.
  Bila peramban yang sama dipakai pengguna lain, langganan berpindah ke pengguna yang sedang masuk — pemilik lama tidak lagi menerima notifikasi di layar orang lain.
- Langganan yang sudah tidak berlaku (peramban dihapus, izin dicabut) dibersihkan otomatis saat push service menjawab 404/410.
- Maksimal 10 perangkat per pengguna; semuanya terlihat dan dapat dimatikan dari kartu yang sama. Pesan uji dibatasi 5/jam (bersama pesan uji email/WhatsApp).

## 2. Pengaktifan di server (admin sistem)

1. Buat kunci sekali: `npm run push:keys` (hanya mencetak ke layar; tidak menulis berkas dan tidak menghubungi layanan apa pun).
2. Salin ke `.env`: `WEB_PUSH_PUBLIC_KEY`, `WEB_PUSH_PRIVATE_KEY` (**rahasia**, jangan di-commit) dan `WEB_PUSH_SUBJECT` (`mailto:admin@domain` atau URL https situs).
   Di Docker, tiga variabel itu diteruskan lewat `docker-compose.yml`.
3. Mulai ulang aplikasi. Situs harus diakses lewat **https** di production (peramban hanya mengizinkan service worker/push pada https; `localhost` boleh saat pengembangan).
4. Setiap karyawan mengaktifkan sendiri di kartu Notifikasi desktop, lalu klik **Kirim notifikasi uji**.

Mengganti kunci VAPID memutus semua langganan lama: karyawan perlu mengaktifkan ulang. Kunci kosong/tidak sepasang = fitur nonaktif (kartu menampilkan "belum diaktifkan oleh admin").

## 3. Keamanan

- **Anti-SSRF**: alamat langganan datang dari peramban pengguna, jadi server hanya mau mengirim ke host push service resmi
  (`fcm.googleapis.com`, `*.push.services.mozilla.com`, `*.push.apple.com`, `*.notify.windows.com`; https, tanpa kredensial/port khusus). Alamat lain ditolak saat mendaftar **dan** saat mengirim; pengalihan (redirect) tidak diikuti.
- Alamat langganan adalah URL rahasia: tidak ditulis ke audit log dan hanya dikembalikan kepada pemiliknya.
- Notifikasi dapat terbaca orang di dekat layar — judul + ringkasan sama dengan lonceng (kode proyek, judul tugas); angka gaji tidak pernah dikirim. Aktifkan hanya di komputer pribadi.
- Service worker (`/sw.js`) hanya menangani push & klik (tanpa cache/offline) dan mengabaikan tautan di luar situs.

## 4. Batasan jujur

- **Belum diuji ke push service sungguhan** (tidak ada akses jaringan keluar di lingkungan pengembangan). Yang teruji: enkripsi **cocok persis dengan vektor uji RFC 8291**, tanda tangan VAPID diverifikasi, alur antrean/pengiriman/pembersihan, service worker (di sandbox), dan antarmuka. Lakukan uji di staging dengan Chrome/Edge/Firefox sebelum diumumkan.
- Penerima harus punya **peramban yang berjalan** (peramban modern umumnya tetap berjalan di latar belakang; bila ditutup total, pesan menunggu di push service sampai peramban dibuka — TTL 24 jam, setelah itu hilang; notifikasi di lonceng tetap ada).
- Safari (macOS 13+) mendukung Web Push, tetapi perilakunya paling ketat; uji secara khusus bila ada pengguna Safari.
- Tidak ada jam tenang, tidak ada pilihan per jenis pesan, dan satu peristiwa = satu notifikasi per perangkat (sama seperti saluran lain).
- Hanya desktop. Dukungan ponsel (Android/PWA, iOS) sengaja tidak dibuka.
