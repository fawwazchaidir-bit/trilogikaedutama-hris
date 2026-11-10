import { queryObject, route } from "@/server/http";
import { funnelDashboard } from "@/server/services/letters/register";
export const GET = route(async ({ req, actor }) => funnelDashboard(actor, queryObject(req)));
