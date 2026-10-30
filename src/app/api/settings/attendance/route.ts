import { readBody, route } from "@/server/http";
import { updateAttendancePolicy } from "@/server/services/settings";

export const PUT = route(async ({ req, actor }) => { await updateAttendancePolicy(actor, await readBody(req)); return { ok: true }; });
