import { readBody, route } from "@/server/http";
import { setCounterOffset } from "@/server/services/letters/admin";
export const POST = route(async ({ req, actor }) => { await setCounterOffset(actor, await readBody(req)); return { ok: true }; });
