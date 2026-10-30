// Menerapkan migrasi ke database TEST sebelum integration test dijalankan.
import "dotenv/config";
import { execFileSync } from "node:child_process";

export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL belum diatur (lihat .env.example)");
  if (/prod/i.test(url)) throw new Error("TEST_DATABASE_URL tampak seperti database produksi — dibatalkan");
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    stdio: "pipe",
    env: { ...process.env, DATABASE_URL: url },
  });
}
