import "dotenv/config";
import { defineConfig } from "@playwright/test";
import { generateVapidKeys } from "./src/lib/webpush";
const VAPID = generateVapidKeys();

const PORT = Number(process.env.E2E_PORT ?? 3101);
const BASE = `http://127.0.0.1:${PORT}`;
const TEST_DB = process.env.TEST_DATABASE_URL;
if (!TEST_DB) throw new Error("TEST_DATABASE_URL wajib diisi untuk E2E (database terpisah — isinya akan DIKOSONGKAN).");
if (/prod/i.test(TEST_DB)) throw new Error("TEST_DATABASE_URL tampak seperti database produksi — dibatalkan.");

export default defineConfig({
  testDir: "tests/e2e",
  outputDir: "tests/e2e/.artifacts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [["list"]],
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: BASE,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "id-ID",
    timezoneId: "Asia/Jakarta",
    // Di CI: `npx playwright install chromium`. Di sandbox ini: PW_CHROMIUM_PATH=/opt/pw-browsers/chromium
    launchOptions: {
      executablePath: process.env.PW_CHROMIUM_PATH || undefined,
      // Kamera palsu (video uji) untuk menguji foto absensi tanpa perangkat keras; izin kamera diberikan otomatis.
      args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
    },
  },
  // Build produksi sungguhan (sekaligus memverifikasi `next build`) dengan database TEST.
  webServer: {
    command: `npm run build && npx next start -H 127.0.0.1 -p ${PORT}`,
    url: `${BASE}/login`,
    timeout: 300_000,
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL: TEST_DB, APP_URL: BASE, NODE_ENV: "production", APP_TIMEZONE: "Asia/Jakarta", TRUST_PROXY: "false",
      DATA_ENCRYPTION_KEY: process.env.DATA_ENCRYPTION_KEY ?? "",
      // Modul Training & Operations default MATI di aplikasi; E2E menyalakannya secara eksplisit (tidak bergantung pada .env lokal).
      TRAINING_MODULE_ENABLED: "true",
      // Obrolan internal juga default MATI; E2E menyalakannya (pekerja dimatikan agar deterministik).
      CHAT_MODULE_ENABLED: "true", CHAT_WORKER: "false", LETTERS_MODULE_ENABLED: "true", LETTERS_WORKER: "false",
      // Pekerja harian dimatikan agar tes deterministik. CRON_SECRET sengaja TIDAK diset: sweep API memastikan pemicu internal menjawab 404 tanpa rahasia.
      TRAINING_WORKER: "false", CHECKLIST_REMINDER_WORKER: "false",
      // Kunci VAPID SEMENTARA untuk server uji (dibuat ulang tiap menjalankan Playwright; tidak disimpan di mana pun).
      WEB_PUSH_PUBLIC_KEY: VAPID.publicKey, WEB_PUSH_PRIVATE_KEY: VAPID.privateKey, WEB_PUSH_SUBJECT: "mailto:e2e@trilogika.test",
    },
  },
});
