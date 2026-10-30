import { readBody, route } from "@/server/http";
import { updatePayrollRules } from "@/server/services/settings";

export const PUT = route(async ({ req, actor }) => { await updatePayrollRules(actor, await readBody(req)); return { ok: true }; });
