import { queryObject, route } from "@/server/http";
import { getRecapDetail } from "@/server/services/recap";
import { Errors } from "@/server/errors";

export const GET = route(async ({ req, actor }) => { const { employeeId, ...q } = queryObject(req); if (!employeeId) throw Errors.badRequest("employeeId wajib diisi."); return getRecapDetail(actor, employeeId, q); });
