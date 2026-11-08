import { readBody, route } from "@/server/http";
import { returnSettlement } from "@/server/services/final-settlements";

/** Pimpinan mengembalikan ke Draf `{ note }` (catatan wajib). */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => returnSettlement(actor, params.id, await readBody(req)));
