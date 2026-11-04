import { created, readBody, route } from "@/server/http";
import { subscribePush } from "@/server/services/push";
export const POST = route(async ({ req, actor }) => created(await subscribePush(actor, await readBody(req))));
