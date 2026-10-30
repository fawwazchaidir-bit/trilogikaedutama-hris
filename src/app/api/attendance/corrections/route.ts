import { queryObject, route } from "@/server/http";
import { listCorrections } from "@/server/services/attendance";

export const GET = route(async ({ req, actor }) => { const q = queryObject(req); return listCorrections(actor, { employeeId: q.employeeId, date: q.date }); });
