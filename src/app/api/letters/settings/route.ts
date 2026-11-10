import { readBody, route } from "@/server/http";
import { getLetterSettingsDto, updateLetterSettings } from "@/server/services/letters/admin";
export const GET = route(async ({ actor }) => getLetterSettingsDto(actor));
export const PATCH = route(async ({ req, actor }) => { await updateLetterSettings(actor, await readBody(req)); return { ok: true }; });
