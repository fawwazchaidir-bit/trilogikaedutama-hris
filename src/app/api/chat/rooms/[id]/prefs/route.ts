import { readBody, route } from "@/server/http";
import { updateRoomPrefs } from "@/server/services/chat/rooms";
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => { await updateRoomPrefs(actor, params.id, await readBody(req)); return { ok: true }; });
