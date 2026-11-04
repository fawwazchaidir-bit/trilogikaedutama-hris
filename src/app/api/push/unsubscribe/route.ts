import { readBody, route } from "@/server/http";
import { unsubscribePush } from "@/server/services/push";
export const POST = route(async ({ req, actor }) => { await unsubscribePush(actor, await readBody(req)); return { ok: true }; });
