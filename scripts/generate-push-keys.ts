/**
 * Membuat pasangan kunci VAPID untuk notifikasi push desktop:   npm run push:keys
 * Salin keduanya ke .env (WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY) dan isi WEB_PUSH_SUBJECT ("mailto:admin@domain" atau URL https situs).
 * Kunci PRIVAT bersifat rahasia: jangan dibagikan atau di-commit. Mengganti kunci memutus semua langganan lama (karyawan perlu mengaktifkan ulang).
 * Skrip ini hanya mencetak ke layar; tidak menulis berkas dan tidak menghubungi layanan apa pun.
 */
import { generateVapidKeys } from "../src/lib/webpush";

const k = generateVapidKeys();
console.log(`WEB_PUSH_PUBLIC_KEY="${k.publicKey}"`);
console.log(`WEB_PUSH_PRIVATE_KEY="${k.privateKey}"`);
console.log('WEB_PUSH_SUBJECT="mailto:admin@contoh.co.id"   # ganti dengan kontak admin Anda');
