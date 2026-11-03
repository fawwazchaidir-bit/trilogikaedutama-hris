import { created, queryObject, readBody, route } from "@/server/http";

import { createProgram, listPrograms } from "@/server/services/training/projects";
export const GET = route(async ({ req, actor }) => listPrograms(actor, { includeInactive: queryObject(req).all === "1" }));
export const POST = route(async ({ req, actor }) => created(await createProgram(actor, await readBody(req))));
