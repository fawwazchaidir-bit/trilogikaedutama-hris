import { readBody, route } from "@/server/http";
import { removeReadinessItem, setReadinessStatus } from "@/server/services/training/indicator-data";
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => { await setReadinessStatus(actor, params.id, await readBody(req)); return { ok: true }; });
export const DELETE = route<{ id: string }>(async ({ actor, params }) => { await removeReadinessItem(actor, params.id); return { ok: true }; });
