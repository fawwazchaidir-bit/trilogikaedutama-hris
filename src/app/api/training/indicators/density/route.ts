import { queryObject, route } from "@/server/http";
import { getClassDensity } from "@/server/services/training/indicator-compute";
export const GET = route(async ({ req, actor }) => getClassDensity(actor, queryObject(req)));
