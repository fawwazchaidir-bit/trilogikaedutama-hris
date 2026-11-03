import { queryObject, route } from "@/server/http";
import { projectReportRows } from "@/server/services/training/insights";
export const GET = route(async ({ req, actor }) => projectReportRows(actor, queryObject(req)));
