import { readBody, route } from "@/server/http";
import { getSettingsDto } from "@/server/services/settings";
import { updateCompany } from "@/server/services/settings";

export const GET = route(async ({ actor }) => getSettingsDto(actor));

export const PUT = route(async ({ req, actor }) => { await updateCompany(actor, await readBody(req)); return { ok: true }; });
