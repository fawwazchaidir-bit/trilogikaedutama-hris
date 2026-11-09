import { queryObject, route } from "@/server/http";
import { listDirectory } from "@/server/services/chat/rooms";
export const GET = route(async ({ req, actor }) => listDirectory(actor, queryObject(req)));
