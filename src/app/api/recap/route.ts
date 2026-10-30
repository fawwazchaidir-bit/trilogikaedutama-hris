import { queryObject, route } from "@/server/http";
import { getRecap } from "@/server/services/recap";

export const GET = route(async ({ req, actor }) => getRecap(actor, queryObject(req)));
