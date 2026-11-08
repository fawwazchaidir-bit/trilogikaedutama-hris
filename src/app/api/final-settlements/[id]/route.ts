import { readBody, route } from "@/server/http";
import { getSettlement, updateSettlement } from "@/server/services/final-settlements";

/** Detail + baris + peringatan terkini (payroll:view). */
export const GET = route<{ id: string }>(async ({ actor, params }) => getSettlement(actor, params.id));
/** Ubah `{ lastWorkDate?, basis?, leaveDivisor?, note? }` saat Draf; usulan sistem dihitung ulang, baris manual tetap. */
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => updateSettlement(actor, params.id, await readBody(req)));
