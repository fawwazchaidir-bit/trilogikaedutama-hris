import { readBody, route } from "@/server/http";
import { updateStatutoryConfig } from "@/server/services/settings";

export const PUT = route(async ({ req, actor }) => { await updateStatutoryConfig(actor, await readBody(req)); return { ok: true }; });
