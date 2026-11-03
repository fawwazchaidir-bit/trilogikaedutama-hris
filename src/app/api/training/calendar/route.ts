import { queryObject, route } from "@/server/http";
import { listCalendar } from "@/server/services/training/operations";
export const GET = route(async ({ req, actor }) => listCalendar(actor, queryObject(req)));
