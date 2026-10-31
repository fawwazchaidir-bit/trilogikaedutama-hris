import { readBody, route } from "@/server/http";
import { beginTwoFactorSetup } from "@/server/services/two-factor";

export const POST = route(async ({ req, actor }) => beginTwoFactorSetup(actor, await readBody(req)), { allowMustChange: true });
