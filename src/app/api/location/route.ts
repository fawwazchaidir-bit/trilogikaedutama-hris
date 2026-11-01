import { queryObject, route } from "@/server/http";
import { listLocationChecks } from "@/server/services/location";

export const GET = route(async ({ req, actor }) => listLocationChecks(actor, queryObject(req)));
