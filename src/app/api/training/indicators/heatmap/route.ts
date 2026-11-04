import { queryObject, route } from "@/server/http";
import { getTeamHeatmap } from "@/server/services/training/indicator-compute";
export const GET = route(async ({ req, actor }) => getTeamHeatmap(actor, queryObject(req)));
