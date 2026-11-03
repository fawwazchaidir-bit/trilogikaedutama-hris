import { created, queryObject, readBody, route } from "@/server/http";

import { listTemplates, saveTemplate } from "@/server/services/training/work";
export const GET = route(async ({ req, actor }) => listTemplates(actor, { includeInactive: queryObject(req).all === "1" }));
export const POST = route(async ({ req, actor }) => created(await saveTemplate(actor, null, await readBody(req))));
