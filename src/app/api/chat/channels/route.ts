import { created, readBody, route } from "@/server/http";
import { createChannel, listChannelsAdmin } from "@/server/services/chat/admin";
export const GET = route(async ({ actor }) => listChannelsAdmin(actor));
export const POST = route(async ({ req, actor }) => created(await createChannel(actor, await readBody(req))));
