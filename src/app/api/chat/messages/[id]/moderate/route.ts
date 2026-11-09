import { readBody, route } from "@/server/http";
import { moderateMessage } from "@/server/services/chat/admin";
export const POST = route<{ id: string }>(async ({ req, actor, params }) => { await moderateMessage(actor, params.id, await readBody(req)); return { ok: true }; });
