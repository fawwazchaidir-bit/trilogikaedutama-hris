import { readBody, route } from "@/server/http";
import { regenerateRecoveryCodes } from "@/server/services/two-factor";

export const POST = route(async ({ req, actor }) => regenerateRecoveryCodes(actor, await readBody(req)), { allowMustChange: true });
