// Integration test SELALU memakai TEST_DATABASE_URL — tidak pernah DATABASE_URL (development/production).
import "dotenv/config";

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error("TEST_DATABASE_URL belum diatur (lihat .env.example)");
if (/prod/i.test(testUrl)) throw new Error("TEST_DATABASE_URL tampak seperti database produksi — dibatalkan");
process.env.DATABASE_URL = testUrl;
process.env.APP_TIMEZONE = "Asia/Jakarta";
process.env.APP_URL = "http://localhost:3000";
// Modul Training & Operations aktif untuk tes (default aplikasi MATI). Tes bendera memakai berkasnya sendiri.
process.env.TRAINING_MODULE_ENABLED ||= "true";
process.env.DATA_ENCRYPTION_KEY ||= "dGVzdC1vbmx5LWtleS0zMi1ieXRlcy1sb25nLSEhISE=";
