import { readBody, route } from "@/server/http";
import { getIndicatorConfig, saveIndicatorConfig } from "@/server/services/training/indicator-config";
export const GET = route(async ({ actor }) => getIndicatorConfig(actor));
export const PUT = route(async ({ req, actor }) => saveIndicatorConfig(actor, await readBody(req)));
