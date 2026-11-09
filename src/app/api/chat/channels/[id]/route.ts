import { readBody, route } from "@/server/http";
import { setChannelArchived } from "@/server/services/chat/admin";
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => { await setChannelArchived(actor, params.id, await readBody(req)); return { ok: true }; });
