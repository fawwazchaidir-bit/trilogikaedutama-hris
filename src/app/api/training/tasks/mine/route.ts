import { queryObject, route } from "@/server/http";
import { listMyTasks } from "@/server/services/training/work";
export const GET = route(async ({ req, actor }) => listMyTasks(actor, queryObject(req)));
