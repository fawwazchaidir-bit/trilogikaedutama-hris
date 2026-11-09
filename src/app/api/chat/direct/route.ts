import { readBody, route } from "@/server/http";
import { getOrCreateDirect } from "@/server/services/chat/rooms";
export const POST = route(async ({ req, actor }) => getOrCreateDirect(actor, await readBody(req)));
