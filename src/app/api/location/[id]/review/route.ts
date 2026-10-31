import { readBody, route } from "@/server/http";
import { reviewLocationCheck } from "@/server/services/location";

export const POST = route<{ id: string }>(async ({ req, actor, params }) => { await reviewLocationCheck(actor, params.id, await readBody(req)); return { ok: true }; });
