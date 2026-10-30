import "dotenv/config";
import { execFileSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { E2E_PASSWORD } from "./helpers";

/** Kosongkan database TEST lalu isi dengan data demo fiktif (lewat seed-dev di proses terpisah). */
export default async function globalSetup() {
  const url = process.env.TEST_DATABASE_URL!;
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url, NODE_ENV: "test", DEV_SEED_PASSWORD: E2E_PASSWORD };
  execFileSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "pipe" });
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const rows = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  } finally { await prisma.$disconnect(); }
  execFileSync("npx", ["tsx", "--conditions=react-server", "prisma/seed-dev.ts"], { env, stdio: "pipe" });
}
