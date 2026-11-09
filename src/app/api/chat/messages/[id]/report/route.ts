import { readBody, route } from "@/server/http";
import { reportMessage } from "@/server/services/chat/admin";
export const POST = route<{ id: string }>(async ({ req, actor, params }) => { await reportMessage(actor, params.id, await readBody(req)); return { ok: true }; });
