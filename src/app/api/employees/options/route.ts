import { queryObject, route } from "@/server/http";
import { listEmployeeOptions } from "@/server/services/employees";

export const GET = route(async ({ req, actor }) => listEmployeeOptions(actor, { includeInactive: queryObject(req).all === "1" }));
