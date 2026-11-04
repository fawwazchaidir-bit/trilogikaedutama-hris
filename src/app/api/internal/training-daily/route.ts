import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { runTrainingDailyJob } from "@/server/services/training/automation";

/**
 * Pemicu pekerja harian Training & Operations (snapshot status, eskalasi, pengingat tenggat) untuk penjadwal eksternal:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://hris.example.com/api/internal/training-daily
 * Nonaktif (404) bila CRON_SECRET tidak diatur. Idempoten (aman dipanggil berkali-kali). Bukan endpoint browser — tidak memakai cookie sesi.
 */
export async function POST(req: Request): Promise<Response> {
  const secret = env().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Tidak ditemukan." } }, { status: 404 });
  const given = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Tidak diizinkan." } }, { status: 401 });
  return NextResponse.json({ data: await runTrainingDailyJob() }, { headers: { "Cache-Control": "no-store" } });
}
