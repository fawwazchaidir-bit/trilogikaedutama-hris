import { created, queryObject, readBody, route } from "@/server/http";
import { createSettlement, listSettlements } from "@/server/services/final-settlements";
import type { SettlementStatusValue } from "@/lib/final-settlement";

/** Daftar penyelesaian akhir `?status=` (payroll:view). */
export const GET = route(async ({ req, actor }) => listSettlements(actor, { status: queryObject(req).status as SettlementStatusValue | undefined }));
/** Buat penyelesaian akhir `{ employeeId, lastWorkDate?, basis?, leaveDivisor?, note? }` dengan usulan sistem (payroll:prepare); 409 bila sudah ada yang berlaku. */
export const POST = route(async ({ req, actor }) => created(await createSettlement(actor, await readBody(req))));
