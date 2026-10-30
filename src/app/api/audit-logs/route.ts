import { queryObject, route } from "@/server/http";
import { listAuditLogs } from "@/server/services/audit-log";

export const GET = route(async ({ req, actor }) => listAuditLogs(actor, queryObject(req)));
