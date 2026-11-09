import { queryObject, route } from "@/server/http";
import { listDirectRoomsForAudit } from "@/server/services/chat/admin";
export const GET = route(async ({ req, actor }) => listDirectRoomsForAudit(actor, queryObject(req)));
