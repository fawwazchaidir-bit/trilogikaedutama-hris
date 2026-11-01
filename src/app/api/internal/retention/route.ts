import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { purgeExpiredPhotos } from "@/server/services/photo-retention";

/**
 * Pemicu retensi foto absensi (hapus foto lebih tua dari batas) untuk penjadwal eksternal (cron/systemd timer):
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://hris.example.com/api/internal/retention
 * Nonaktif (404) bila CRON_SECRET tidak diatur. Bukan endpoint browser — tidak memakai cookie sesi.
 */
export async function POST(req: Request): Promise<Response> {
  const secret = env().CRON_SECRET;
  if (!secret) return NextResponse.json({ error: { code: "NOT_FOUND", message: "Tidak ditemukan." } }, { status: 404 });
  const given = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  const a = Buffer.from(given), b = Buffer.from(secret);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: { code: "UNAUTHENTICATED", message: "Tidak diizinkan." } }, { status: 401 });
  const r = await purgeExpiredPhotos();
  return NextResponse.json({ data: r }, { headers: { "Cache-Control": "no-store" } });
}
