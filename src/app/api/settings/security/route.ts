import { readBody, route } from "@/server/http";
import { updateSecurityPolicy } from "@/server/services/settings";

export const PUT = route(async ({ req, actor }) => { await updateSecurityPolicy(actor, await readBody(req)); return { ok: true }; });
