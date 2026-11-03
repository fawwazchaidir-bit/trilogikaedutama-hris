import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { runContractReminders } from "@/server/services/documents";

/**
 * Pemicu pengingat kontrak kerja (H-3 bulan, H-1 bulan, H-14 hari → notifikasi ke pimpinan) untuk penjadwal eksternal:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://hris.example.com/api/internal/contract-reminders
 * Nonaktif (404) bila CRON_SECRET tidak diatur. Idempoten. Bukan endpoint browser — tidak memakai cookie sesi.
 */
export async function POST(req: Request): Promise<Response> {
  const secret = env().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Tidak ditemukan." } }, { status: 404 });
  const given = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Tidak diizinkan." } }, { status: 401 });
  return NextResponse.json({ data: await runContractReminders() }, { headers: { "Cache-Control": "no-store" } });
}
