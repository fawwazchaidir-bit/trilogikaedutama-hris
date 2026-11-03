import { readBody, route } from "@/server/http";
import { voidReceipt } from "@/server/services/assignments";

/** Batalkan bukti penerimaan (Super Admin). */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => { await voidReceipt(actor, params.id, await readBody(req)); return { ok: true }; });
