import { readBody, route } from "@/server/http";
import { markRead } from "@/server/services/chat/messages";
export const POST = route<{ id: string }>(async ({ req, actor, params }) => { await markRead(actor, params.id, await readBody(req)); return { ok: true }; });
