import { queryObject, route } from "@/server/http";
import { listAllParticipants } from "@/server/services/training/operations";
export const GET = route(async ({ req, actor }) => listAllParticipants(actor, queryObject(req)));
