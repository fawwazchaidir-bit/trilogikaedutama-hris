import { readBody, route } from "@/server/http";
import { updateSchedule } from "@/server/services/training/operations";
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => updateSchedule(actor, params.id, await readBody(req)));
