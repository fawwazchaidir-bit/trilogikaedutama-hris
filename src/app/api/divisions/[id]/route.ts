import { readBody, route } from "@/server/http";
import { updateDivision } from "@/server/services/employees";

export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => { await updateDivision(actor, params.id, await readBody(req)); return { ok: true }; });
