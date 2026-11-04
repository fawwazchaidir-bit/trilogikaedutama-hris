# Notifikasi WhatsApp — cara kerja, prasyarat, dan keputusan

Dokumen ini menjelaskan mekanisme yang **sudah ada di kode** (bukan rencana). Semua pesan otomatis di portal — pengingat tenggat H-1/hari-H,
eskalasi Kuning/Merah/terlambat/beban, pesan broadcast Direktur, persetujuan cuti, dan seterusnya — memakai **satu jalur yang sama**.

> **Status jujur:** pembentukan permintaan ke tiap penyedia, antrean, percobaan ulang, dan pencatatan galat diuji dengan pengirim tiruan.
> **Belum pernah diuji ke penyedia WhatsApp sungguhan** (tidak ada kredensial di lingkungan pengembangan). Uji dengan akun uji sebelum dipakai.

## 1. Alur satu pesan

```
Peristiwa (eskalasi, pengingat, broadcast, persetujuan, …)
   │  dalam SATU transaksi database yang sama dengan peristiwanya
   ├─▶ Notifikasi dalam aplikasi (lonceng)                      ← SELALU dibuat
   └─▶ Antrean pengiriman `notification_deliveries` (outbox)    ← hanya bila ketiganya terpenuhi:
          1. server dikonfigurasi (WHATSAPP_PROVIDER + kredensial),
          2. pengguna sudah mengaktifkan saluran WhatsApp di "Keamanan & Notifikasi",
          3. pengguna punya nomor WhatsApp tersimpan.
                │
                ▼
   Pekerja pengiriman (tiap 30 detik di dalam aplikasi, atau dipicu `POST /api/internal/deliveries` ber-CRON_SECRET)
                │  klaim baris atomik (FOR UPDATE SKIP LOCKED → aman di banyak instance)
                ▼
   Penyedia WhatsApp  →  status SENT  /  gagal → dicoba ulang  /  FAILED
```

Karena antrean dibuat **dalam transaksi yang sama** dengan peristiwanya (pola *transactional outbox*), tidak ada pesan "hantu" bila peristiwanya
dibatalkan, dan tidak ada peristiwa yang kehilangan pesannya bila aplikasi mati di tengah jalan.

## 2. Isi pesan

Ringkas dan tanpa data sensitif (angka gaji tidak pernah dikirim):

```
[Nama Lembaga] Judul notifikasi
Ringkasan satu-dua baris (mis. kode proyek · judul tugas)

Buka: https://alamat-aplikasi/…tautan

— Nama Lembaga HRIS
```

## 3. Penyedia yang didukung (`WHATSAPP_PROVIDER`)

| Penyedia | Cara kerja | Prasyarat | Catatan |
|---|---|---|---|
| `cloud_api` | WhatsApp Business **Cloud API resmi Meta** | Akun Meta Business, nomor bisnis, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Pesan **proaktif** (di luar jendela 24 jam sejak pengguna terakhir membalas) **wajib memakai template yang disetujui Meta**. Aplikasi mengirim seluruh teks pesan sebagai **satu variabel** `{{1}}` (isi `WHATSAPP_TEMPLATE_NAME`, `WHATSAPP_TEMPLATE_LANG`); baris baru diubah menjadi " · " karena parameter template tidak boleh berisi baris baru. |
| `fonnte` | Gateway pihak ketiga (`POST` form `target` + `message` dengan token) | Akun Fonnte + nomor WhatsApp yang disambungkan, `WHATSAPP_TOKEN` | Gateway ini menjawab HTTP 200 walau gagal; aplikasi membaca `status` di JSON dan menganggap gagal bila bukan `true`. Pendekatan non-resmi pada umumnya berisiko dibatasi/diblokirnya nomor oleh WhatsApp — pertimbangkan sebelum memakai nomor utama lembaga. |
| `webhook` | `POST` JSON `{channel:"whatsapp", to, text, app}` ke gerbang **milik sendiri** (`WHATSAPP_API_URL`, token opsional sebagai Bearer) | Gerbang yang Anda bangun/kelola | Paling fleksibel; tanggung jawab keandalan ada pada gerbang Anda. |

## 4. Keandalan

- **Percobaan ulang** dengan jeda bertahap 1, 2, 4, 8 menit … maksimal 1 jam; setelah **5 kali** gagal → status `FAILED` dengan alasan terakhir.
- Pekerja yang mati di tengah memproses: baris "disewa" 5 menit lalu otomatis dicoba lagi.
- Bila pengguna **dinonaktifkan atau mematikan saluran** setelah pesan diantrekan → pesan dilewati (`SKIPPED`), tidak terkirim.
- Super Admin melihat antrean (menunggu/terkirim/gagal) dan alasan galat di **Pengaturan → Pengiriman email & WhatsApp**, dengan tombol *Proses sekarang* dan *Antre ulang yang gagal*.
- Pesan uji dari **Keamanan & Notifikasi** dibatasi 5 per jam.

## 5. Persetujuan penerima

Saluran WhatsApp **bawaan mati**. Tiap karyawan memilih sendiri (dan mengisi nomor; format `08…`/`+62…` dinormalisasi ke `62…`). Jadi tidak ada karyawan yang dikirimi
WhatsApp tanpa memilihnya. Satu pesan dikirim **per orang** (bukan ke grup): broadcast ke 40 karyawan yang memilih WhatsApp = 40 pengiriman.

## 6. Dampaknya pada fitur terbaru

| Fitur | Perilaku bila WhatsApp menyala dan penerima memilihnya |
|---|---|
| Pengingat tenggat H-1/hari-H | Satu pesan per tugas/milestone/item per penerima per hari-tenggat (kunci dedupe mencegah ganda walau pekerja berjalan tiap jam). |
| Eskalasi Kuning/Merah/terlambat/beban | Sekali per episode ke penerima menurut jabatan (lihat TRAINING-OPS.md §3b). |
| Broadcast Direktur (banner + "Kirim juga sebagai notifikasi") | Satu pesan ke setiap akun aktif yang memilih WhatsApp; jeda minimal 10 menit antar broadcast. |

## 7. Yang belum ada (batasan nyata)

- **Tidak ada jam tenang**: pesan dikirim kapan pun peristiwanya terjadi (pekerja berjalan 24 jam), jadi pengingat/eskalasi bisa tiba malam hari.
- Pilihan penerima hanya **per saluran** (WhatsApp/email), belum per jenis pesan (mis. hanya eskalasi, bukan pengingat).
- Belum ada ringkasan gabungan (*digest*) — satu peristiwa = satu pesan.
- Satu arah: balasan karyawan di WhatsApp **tidak** diproses aplikasi; belum ada status "terbaca".
- Belum diuji ke penyedia sungguhan (lihat catatan di atas).

## 8. Keputusan yang diperlukan dari pemilik sistem

1. **Penyedia**: `cloud_api` (resmi, butuh template & verifikasi bisnis) atau gateway pihak ketiga (cepat, tetapi berisiko pada nomor). Biaya dan kategori template ditentukan penyedia/Meta dan dapat berubah — periksa di akun Anda.
2. **Nomor pengirim**: sebaiknya nomor khusus bisnis, bukan nomor pribadi/utama.
3. **Dasar persetujuan & pelindungan data pribadi**: nomor WhatsApp karyawan adalah data pribadi; tetapkan kebijakan (pemberitahuan, hak menolak, retensi).
4. **Template** (bila `cloud_api`): satu template umum dengan satu variabel `{{1}}` sudah cukup bagi semua jenis pesan; ajukan dan tunggu persetujuan.
5. **Jam tenang** dan **filter per jenis pesan**: apakah perlu dibangun sebelum WhatsApp dinyalakan untuk semua.

## 9. Langkah mengaktifkan (staging dulu)

1. Isi `WHATSAPP_PROVIDER` dan kredensialnya di `.env`; mulai ulang aplikasi. (Production hanya atas instruksi terpisah.)
2. Masuk → **Keamanan & Notifikasi** → aktifkan WhatsApp + isi nomor → **Kirim WhatsApp uji**.
3. Pantau **Pengaturan → Pengiriman email & WhatsApp**: status `SENT`, alasan bila `FAILED`.
4. Pilot dengan beberapa karyawan yang bersedia sebelum diumumkan ke semua.
