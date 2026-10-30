import { readBody, route } from "@/server/http";
import { updateSchedule } from "@/server/services/schedules";

export const PUT = route<{ id: string }>(async ({ req, actor, params }) => updateSchedule(actor, params.id, await readBody(req)));
