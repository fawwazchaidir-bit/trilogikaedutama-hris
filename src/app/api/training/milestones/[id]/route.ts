import { readBody, route } from "@/server/http";
import { updateMilestone } from "@/server/services/training/indicator-data";
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => { await updateMilestone(actor, params.id, await readBody(req)); return { ok: true }; });
