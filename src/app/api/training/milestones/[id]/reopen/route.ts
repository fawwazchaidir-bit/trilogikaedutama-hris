import { readBody, route } from "@/server/http";
import { reopenMilestone } from "@/server/services/training/indicator-data";
export const POST = route<{ id: string }>(async ({ req, actor, params }) => { await reopenMilestone(actor, params.id, await readBody(req)); return { ok: true }; });
