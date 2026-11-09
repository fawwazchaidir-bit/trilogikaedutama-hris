import { readBody, route } from "@/server/http";
import { deleteMessage, editMessage } from "@/server/services/chat/messages";
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => editMessage(actor, params.id, await readBody(req)));
export const DELETE = route<{ id: string }>(async ({ actor, params }) => { await deleteMessage(actor, params.id); return { ok: true }; });
