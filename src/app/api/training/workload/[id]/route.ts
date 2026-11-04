import { readBody, route } from "@/server/http";
import { updateWorkloadTask } from "@/server/services/training/indicator-data";
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => { await updateWorkloadTask(actor, params.id, await readBody(req)); return { ok: true }; });
