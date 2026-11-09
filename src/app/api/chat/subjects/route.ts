import { readBody, route } from "@/server/http";
import { getOrCreateSubjectRoom } from "@/server/services/chat/rooms";
export const POST = route(async ({ req, actor }) => getOrCreateSubjectRoom(actor, await readBody(req)));
