import { readBody, route } from "@/server/http";
import { enableTwoFactor } from "@/server/services/two-factor";

export const POST = route(async ({ req, actor }) => enableTwoFactor(actor, await readBody(req)), { allowMustChange: true });
