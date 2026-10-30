import { created, readBody, route } from "@/server/http";
import { addAdjustment } from "@/server/services/payroll";

export const POST = route<{ id: string }>(async ({ req, actor, params }) => { await addAdjustment(actor, params.id, await readBody(req)); return created({ ok: true }); });
