/** Pemicu eksternal pekerja harian: /api/internal/training-daily (hanya dengan CRON_SECRET; idempoten). */
import { beforeEach, describe, expect, it } from "vitest";
import { resetDb } from "../helpers/db";
import { seedTraining } from "../helpers/training";
import { POST } from "@/app/api/internal/training-daily/route";

process.env.CRON_SECRET = "uji-cron-secret-0123456789";
const call = (auth?: string) => POST(new Request("http://localhost/api/internal/training-daily", { method: "POST", headers: auth ? { authorization: auth } : {} }));

beforeEach(async () => { await resetDb(); await seedTraining(); });

describe("POST /api/internal/training-daily", () => {
  it("tanpa/dengan rahasia salah → 401; rahasia benar → 200 dengan ringkasan; dijalankan ulang tidak mengirim ulang", async () => {
    expect((await call()).status).toBe(401);
    expect((await call("Bearer salah-salah-salah-salah")).status).toBe(401);
    expect((await call("Basic uji-cron-secret-0123456789")).status).toBe(401);
    const ok = await call("Bearer uji-cron-secret-0123456789");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    const body = (await ok.json()) as { data: { skipped: string | null; snapshots: number; reminders: number; escalations: number } };
    expect(body.data).toEqual({ skipped: null, snapshots: 0, reminders: 0, escalations: 0 });
    const again = (await (await call("Bearer uji-cron-secret-0123456789")).json()) as typeof body;
    expect(again.data.reminders + again.data.escalations).toBe(0);
  });
});
