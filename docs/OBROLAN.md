# Obrolan Internal (live chat)

Fitur obrolan antar karyawan untuk **berkoordinasi mengenai penugasan**: japri (1 lawan 1), kanal publik (semua karyawan), dan utas yang terikat pada satu penugasan (Surat Tugas atau proyek/tugas Training). **Default mati** (`CHAT_MODULE_ENABLED=false`): menu tidak tampil, `/obrolan` dan `/api/chat/*` menjawab 404, data tidak dihapus.

Rancangan dan pertimbangannya ada di dokumen rancangan teknis (PDF) yang disetujui pemilik sistem; dokumen ini adalah rujukan **apa yang sekarang dibangun**.

## Keputusan pemilik sistem (9 Nov 2026)

| Hal | Keputusan |
|---|---|
| Arti "penugasan" | **Keduanya**: Surat Tugas dan tugas/proyek Training |
| Japri | Tertutup bagi HR; **Direktur boleh membaca** (baca-saja). Setiap pembukaan dicatat di Audit Log **tanpa isi pesan**, paling banyak sekali per percakapan per 24 jam. Karyawan diberi tahu lewat catatan permanen di setiap japri |
| Masa simpan | **6 bulan** (`CHAT_RETENTION_MONTHS`); isi dikosongkan, baris tetap |
| Notifikasi | **Push desktop + lencana** saja. Tanpa email/WhatsApp; isi pesan tidak ikut di notifikasi |

## Jenis ruang dan siapa yang boleh apa

| Jenis | Membaca | Menulis | Catatan |
|---|---|---|---|
| **Japri** | dua orang itu; Direktur (baca-saja, tercatat) | keduanya, selama keduanya aktif | satu japri per pasangan (kunci unik; pembuatan diserialkan, lihat bawah) |
| **Kanal publik** | semua akun aktif | semua akun aktif (kecuali kanal diarsipkan) | kanal "Umum" dibuat otomatis; HR/Direktur dapat membuat kanal lain |
| **Utas penugasan** | siapa pun yang lolos gerbang subjek | penerima tugas / anggota proyek / pemegang kelola; Pemantau baca-saja; surat dibatalkan atau proyek final = baca-saja | dibuka dari tombol **Diskusi** |

Gerbang subjek **meminjam aturan modul asal**: Surat Tugas → penerima tugas atau `assignment:view_all`; proyek/tugas Training → `loadProjectAccess` (hak lihat proyek, sudah memangkas Magang). Keanggotaan tersimpan (`chat_members`) **hanya untuk belum-dibaca dan preferensi — bukan sumber izin**: anggota yang dikeluarkan dari proyek kehilangan akses seketika. Tanpa hak baca → **404** (keberadaan ruang tidak bocor); hak baca tanpa hak tulis → 403. Akses ruang berpusat di `src/server/services/chat/shared.ts` (`resolveAccess`).

## Cara kerja realtime

SSE hanya sebagai **bel**: `GET /api/chat/stream` memeriksa tiap 2 detik (satu kueri) apakah nomor urut/revisi ruang milik pengguna berubah, lalu mengirim `sync {id, lastSeq, rev}`. **Isi pesan tidak pernah lewat aliran**; klien mengambilnya lewat REST yang otorisasinya lengkap (`GET /rooms/:id/messages?afterSeq=`). Tanpa dependensi baru, aman di banyak instance, tanpa lengket-sesi.

- Aliran: maks. 3 per pengguna (yang tertua ditutup), umur 10 menit (klien menyambung ulang otomatis), sesi diperiksa tiap ±60 detik **tanpa menggeser jendela idle**, header `no-transform` + `X-Accel-Buffering: no`.
- Klien (`ChatProvider`): satu aliran per tab dipakai bersama oleh lencana menu dan halaman; aliran putus/terblokir → **polling cadangan tiap 8 detik**; tab tersembunyi > 5 menit → aliran ditutup.
- **Status klien disimpan di store eksternal (`useSyncExternalStore`), bukan React Context.** Nilai context yang berubah menjalar ke seluruh pohon dan memaksa batas Suspense yang masih mengalir dihidrasi lebih awal sehingga konten halaman terduplikasi di DOM (terlihat saat uji E2E). Context hanya membawa referensi store yang tidak pernah berubah.
- Nomor urut per ruang tanpa celah (baris ruang terkunci saat kirim) sehingga kursor `afterSeq` tidak pernah melewatkan pesan. Kirim idempoten lewat `clientMsgId`.

## Fitur

Kirim/baca (muat ke atas), belum-dibaca + penanda "Belum dibaca", **sebut @nama** (token `@[Nama](uuid)`; `@semua` hanya moderator di kanal), balas, **sunting 15 menit** (isi lama disimpan di riwayat), hapus (disembunyikan; isi tersimpan sampai retensi), **kartu rujukan penugasan** (diselesaikan per pembaca: yang tidak berhak hanya melihat "tidak memiliki akses"), moderasi kanal oleh HR/Direktur (alasan wajib, tercatat tanpa isi), **laporkan** pesan (kanal/utas → HR & Direktur; japri tidak), bisukan / mode notifikasi per ruang, **Pemeriksaan Japri** untuk Direktur (`/obrolan/pemeriksaan`).

Isi pesan ditampilkan sebagai **teks biasa** (tanpa HTML/markdown); hanya sebutan dan tautan http(s) yang dibuat berupa elemen, dengan `rel="noopener noreferrer nofollow"`.

## Push desktop

Hanya langganan perangkat yang sengaja diaktifkan. Aturan (`shouldPush`): japri/utas = semua pesan; kanal = hanya bila disebut (atau mode "semua"); tidak dikirim bila penerima baru saja melihat ruang (≤ 20 dtk), dibisukan (kecuali disebut), atau dalam jeda 60 detik per ruang (kecuali disebut). Antrean memakai outbox yang sudah ada (`notification_deliveries`, kini dengan kolom `href` dan `tag`); tidak ada baris `Notification` per pesan dan **tidak ada email/WhatsApp**.

## API (`/api/chat/…`, semua memakai pembungkus `route()`)

`GET rooms` · `GET rooms/:id` · `GET|POST rooms/:id/messages` · `POST rooms/:id/read` · `PATCH rooms/:id/prefs` · `POST direct` · `GET directory?q=` · `POST subjects {type,id}` · `GET sync` · `GET refs` · `PATCH|DELETE messages/:id` · `POST messages/:id/report` · `POST messages/:id/moderate` (`chat:moderate`) · `GET|POST channels` · `PATCH channels/:id` · `GET audit/rooms` (`chat:audit_access`) · `GET stream` (SSE).

Izin baru: `chat:moderate` (HR, Direktur) dan `chat:audit_access` (hanya Direktur). Menulis/membaca obrolan biasa tidak memerlukan izin khusus.

## Data dan penjaga basis data

Tabel `chat_rooms`, `chat_members`, `chat_messages`, `chat_mentions`, `chat_message_revisions` (migrasi `20261109130000_obrolan_internal`, `20261109130100_obrolan_rev_retensi`; aditif). Penjaga (`HRIS-GUARD`): bentuk ruang (japri ⇔ `directKey`, kanal ⇔ slug+nama, utas ⇔ jenis+ID subjek), panjang pesan ≤ 4000; **pesan tidak pernah di-`DELETE`**, identitas terkunci, isi hanya berubah lewat sunting atau retensi, pesan yang sudah dibersihkan tak dapat dipulihkan; riwayat sunting tambah-saja (boleh dihapus hanya setelah induknya dibersihkan retensi). `npm run db:verify` ikut memeriksa trigger, japri tepat dua anggota, dan konsistensi nomor urut.

**Membuka japri/utas bersamaan.** Pembuatan ruang + baris anggotanya (`getOrCreateDirect`, `getOrCreateSubjectRoom`) berjalan dalam satu transaksi di bawah kunci penasihat per pasangan/penugasan (`pg_advisory_xact_lock(hashtext('chat:direct:<kunci>'))`), dan baris anggota disisipkan dalam urutan `userId` menaik. Tanpa itu, dua orang yang saling memulai japri pada saat yang sama menyisipkan baris `(ruang, A)` dan `(ruang, B)` dalam urutan berlawanan lalu saling menunggu → deadlock Postgres 40P01 (jarang, tetapi terlihat sebagai galat 500 bagi salah satu pihak). Sekarang pihak kedua menunggu yang pertama selesai, lalu memakai ruang yang sama (`created=false`). Batas "percakapan baru per menit" hanya dipakai bila ruangnya belum ada. Dicakup `tests/integration/chat-direct-concurrency.test.ts` (penyisipan anggota sengaja diperlambat dengan trigger uji agar deadlock muncul setiap kali bila perbaikan dilepas).

## Konfigurasi

| Variabel | Bawaan | Keterangan |
|---|---|---|
| `CHAT_MODULE_ENABLED` | `false` | Menyalakan fitur (menu, halaman, API) |
| `CHAT_WORKER` | `true` | Pekerja retensi + pemulih keanggotaan kanal, tiap 6 jam; idempoten, aman di banyak instance |
| `CHAT_RETENTION_MONTHS` | `6` | 1–60 |

**Proxy:** aliran SSE tidak boleh ditimbun. Nginx: `proxy_buffering off;` (aplikasi sudah mengirim `X-Accel-Buffering: no`) dan `proxy_read_timeout` ≥ 600s; Caddy umumnya meneruskan `text/event-stream` tanpa buffering. **Perilaku di proxy produksi Anda belum teruji** — bila aliran tertahan, klien otomatis memakai polling 8 detik (pesan tetap sampai, hanya tidak serealtime).

## Yang sengaja belum ada

Lampiran berkas, pencarian pesan, grup privat > 2 orang, ekspor percakapan, pembisuan per-orang oleh moderator (moderasi = menyembunyikan pesan), panggilan suara/video, reaksi emoji, indikator mengetik. Push di iOS hanya bekerja bila portal dipasang ke layar utama (batasan platform, sama dengan notifikasi desktop yang ada).

## Privasi dan kepatuhan

Isi obrolan karyawan adalah data pribadi. Siapkan **kebijakan tertulis** (tujuan, siapa yang dapat mengakses dan kapan, masa simpan 6 bulan) dan umumkan kepada karyawan; sebaiknya ditinjau penasihat hukum. Sistem menyediakan kontrolnya: japri tertutup bagi HR, akses Direktur tercatat, retensi otomatis, `legalHold` per ruang (belum ada layar; saat ini diset lewat basis data bila diperlukan).

## Tes

Unit `tests/unit/chat-logic.test.ts`; integrasi `tests/integration/chat.test.ts` (akses/anti-IDOR, urutan di bawah kiriman paralel, idempotensi, belum-dibaca, sebutan, sunting/hapus, moderasi, utas Surat Tugas & Training termasuk kehilangan akses setelah dikeluarkan, kartu rujukan per pembaca, push tidak membanjiri, retensi, penjaga DB) dan `chat-stream.test.ts` (bel SSE, batas aliran, sesi); E2E `tests/e2e/05r-obrolan.spec.ts` (dua peramban saling berkirim + lencana langsung, kanal, pemeriksaan Direktur, tombol Diskusi, polling cadangan saat SSE diblokir).
