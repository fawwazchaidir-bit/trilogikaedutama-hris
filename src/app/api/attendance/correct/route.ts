import { readBody, route } from "@/server/http";
import { correctAttendance } from "@/server/services/attendance";

export const POST = route(async ({ req, actor }) => correctAttendance(actor, await readBody(req)));
