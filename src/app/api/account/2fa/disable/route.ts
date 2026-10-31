import { readBody, route } from "@/server/http";
import { disableTwoFactor } from "@/server/services/two-factor";

export const POST = route(async ({ req, actor }) => { await disableTwoFactor(actor, await readBody(req)); return { ok: true }; });
