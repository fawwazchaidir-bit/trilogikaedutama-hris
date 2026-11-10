import { queryObject, route } from "@/server/http";
import { exportRegisterCsv } from "@/server/services/letters/register";
/** Ekspor CSV register surat (kolom mengikuti Register Excel). */
export const GET = route(async ({ req, actor }) => {
  const csv = await exportRegisterCsv(actor, queryObject(req));
  return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="register-surat.csv"', "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
});
