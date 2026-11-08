import "server-only";
import { z } from "zod";
import { vapidKeysValid } from "@/lib/webpush";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");
const int = (def: number, min = 1, max = 1_000_000) =>
  z.coerce.number().int().min(min).max(max).default(def);
/** String opsional: nilai kosong ("") di .env dianggap tidak diatur. */
const opt = <T extends z.ZodTypeAny>(inner: T) => z.preprocess((v) => (v === "" ? undefined : v), inner.optional());

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL wajib diisi"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  APP_TIMEZONE: z.string().default("Asia/Jakarta").refine((tz) => {
    try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
  }, "APP_TIMEZONE bukan zona waktu IANA yang valid"),
  TRUST_PROXY: bool.default(false),
  /** Jumlah reverse proxy tepercaya di depan aplikasi (1 = Nginx/Caddy langsung; 2 = mis. Cloudflare → Nginx). Alamat klien diambil dari X-Forwarded-For sebanyak ini dari KANAN. */
  TRUST_PROXY_HOPS: int(1, 1, 10),
  LOGIN_MAX_ATTEMPTS: int(5, 1, 100),
  LOGIN_WINDOW_MINUTES: int(15, 1, 1440),
  LOGIN_LOCKOUT_MINUTES: int(15, 1, 1440),
  SESSION_IDLE_HOURS: int(8, 1, 720),
  SESSION_ABSOLUTE_DAYS: int(7, 1, 90),
  MAX_UPLOAD_MB: int(3, 1, 20),
  /** Batas unggahan PDF dokumen kepegawaian (kontrak bermaterai hasil pindai biasanya lebih besar dari foto/lampiran). Jangan lupa menyesuaikan batas body reverse proxy (mis. client_max_body_size). */
  MAX_DOCUMENT_UPLOAD_MB: int(10, 1, 50),

  // ── Notifikasi di luar aplikasi (opsional) ───────────────────────────
  /** Email (SMTP). Tanpa SMTP_HOST, fitur email (notifikasi & lupa password) nonaktif. */
  SMTP_HOST: opt(z.string()),
  SMTP_PORT: int(587, 1, 65535),
  /** true = TLS langsung (port 465); false = STARTTLS bila server mendukung (port 587). */
  SMTP_SECURE: bool.default(false),
  SMTP_USER: opt(z.string()),
  SMTP_PASS: opt(z.string()),
  MAIL_FROM: opt(z.string()),
  /** WhatsApp: pilih penyedia. fonnte = gateway Fonnte; cloud_api = WhatsApp Business Cloud API (Meta); webhook = POST JSON ke URL Anda. */
  WHATSAPP_PROVIDER: opt(z.enum(["fonnte", "cloud_api", "webhook"])),
  WHATSAPP_TOKEN: opt(z.string()),
  /** fonnte: default https://api.fonnte.com/send · webhook: URL tujuan · cloud_api: default https://graph.facebook.com/v21.0 */
  WHATSAPP_API_URL: opt(z.string().url()),
  WHATSAPP_PHONE_NUMBER_ID: opt(z.string()),
  /** cloud_api: nama template pesan (disetujui Meta) dengan SATU variabel isi {{1}}. Kosong = kirim teks biasa (hanya terkirim dalam jendela 24 jam). */
  WHATSAPP_TEMPLATE_NAME: opt(z.string()),
  WHATSAPP_TEMPLATE_LANG: z.string().default("id"),
  /** Rahasia untuk memicu pengiriman antrean lewat HTTP (POST /api/internal/deliveries, header Authorization: Bearer). Kosong = endpoint nonaktif. */
  CRON_SECRET: opt(z.string().min(16, "CRON_SECRET minimal 16 karakter")),
  /** Jalankan pekerja pengiriman di dalam proses aplikasi (default true). Matikan bila memakai pemicu eksternal. */
  DELIVERY_WORKER: bool.default(true),
  /** Jalankan penghapusan foto absensi kedaluwarsa (retensi) di dalam proses aplikasi (default true). Matikan bila memakai pemicu eksternal /api/internal/retention. */
  RETENTION_WORKER: bool.default(true),
  /** Jalankan pengingat kontrak kerja (notifikasi ke pimpinan H-3 bulan, dst.) di dalam proses aplikasi (default true). Matikan bila memakai pemicu eksternal /api/internal/contract-reminders. */
  CONTRACT_REMINDER_WORKER: bool.default(true),
  /** Jalankan pekerja harian Training & Operations (snapshot status, eskalasi, pengingat tenggat H-1/hari-H) di dalam proses aplikasi (default true; hanya bila modul menyala). Matikan bila memakai pemicu eksternal /api/internal/training-daily. */
  TRAINING_WORKER: bool.default(true),
  CHECKLIST_REMINDER_WORKER: bool.default(true),
  /**
   * Notifikasi push desktop (Web Push). Kunci VAPID dibuat sekali dengan `npm run push:keys` lalu disimpan di .env (kunci privat RAHASIA).
   * Kosong = fitur nonaktif. `WEB_PUSH_SUBJECT`: `mailto:` admin atau URL https situs (dikirim ke push service sebagai kontak).
   */
  WEB_PUSH_PUBLIC_KEY: opt(z.string()),
  WEB_PUSH_PRIVATE_KEY: opt(z.string()),
  WEB_PUSH_SUBJECT: opt(z.string().regex(/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/, 'WEB_PUSH_SUBJECT harus "mailto:alamat@email" atau URL https')),
  /** Masa berlaku tautan "lupa password" (menit). */
  PASSWORD_RESET_MINUTES: int(30, 5, 1440),
  /**
   * Modul Training & Operations. DEFAULT MATI: modul baru hanya aktif bila diset "true" secara eksplisit.
   * Mati = menu tidak tampil, halaman /training menjawab 404, API /api/training menjawab 404. Data tidak dihapus.
   */
  TRAINING_MODULE_ENABLED: bool.default(false),
  /** Kunci AES-256 (32 byte, base64) untuk enkripsi nomor rekening. Buat: `openssl rand -base64 32`. */
  DATA_ENCRYPTION_KEY: z.string().refine((v) => {
    try { return Buffer.from(v, "base64").length === 32; } catch { return false; }
  }, "DATA_ENCRYPTION_KEY harus 32 byte dalam base64 (buat dengan: openssl rand -base64 32)"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/** Env divalidasi sekali; kesalahan konfigurasi gagal CEPAT dengan pesan yang jelas. */
export function env(): Env {
  if (!cached) {
    const parsed = schema.safeParse(process.env);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new Error(`Konfigurasi environment tidak valid — ${msg}`);
    }
    cached = parsed.data;
  }
  return cached;
}

export const emailConfigured = (): boolean => !!env().SMTP_HOST && !!env().MAIL_FROM;

/** Apakah modul Training & Operations diaktifkan (feature flag TRAINING_MODULE_ENABLED). */
export const trainingEnabled = (): boolean => env().TRAINING_MODULE_ENABLED;

export function whatsappConfigured(): boolean {
  const e = env();
  if (!e.WHATSAPP_PROVIDER) return false;
  if (e.WHATSAPP_PROVIDER === "webhook") return !!e.WHATSAPP_API_URL;
  if (e.WHATSAPP_PROVIDER === "cloud_api") return !!e.WHATSAPP_TOKEN && !!e.WHATSAPP_PHONE_NUMBER_ID;
  return !!e.WHATSAPP_TOKEN; // fonnte
}

/** Web Push siap bila ketiganya terisi DAN kunci VAPID sah & sepasang. */
export function pushConfigured(): boolean {
  const e = env();
  return !!e.WEB_PUSH_PUBLIC_KEY && !!e.WEB_PUSH_PRIVATE_KEY && !!e.WEB_PUSH_SUBJECT && vapidKeysValid({ publicKey: e.WEB_PUSH_PUBLIC_KEY, privateKey: e.WEB_PUSH_PRIVATE_KEY });
}

export function isSecureDeployment(): boolean {
  return env().APP_URL.startsWith("https://");
}
