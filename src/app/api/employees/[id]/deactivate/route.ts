import { readBody, route } from "@/server/http";
import { deactivateEmployee } from "@/server/services/employees";

export const POST = route<{ id: string }>(async ({ req, actor, params }) => { await deactivateEmployee(actor, params.id, await readBody(req)); return { ok: true }; });
