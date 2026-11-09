import { created, queryObject, readBody, route } from "@/server/http";
import { listMessages, sendMessage } from "@/server/services/chat/messages";
export const GET = route<{ id: string }>(async ({ req, actor, params }) => listMessages(actor, params.id, queryObject(req)));
export const POST = route<{ id: string }>(async ({ req, actor, params }) => created(await sendMessage(actor, params.id, await readBody(req))));
