import { created, queryObject, readBody, route } from "@/server/http";

import { createInstructor, listInstructors } from "@/server/services/training/operations";
export const GET = route(async ({ req, actor }) => { const q = queryObject(req); return listInstructors(actor, { q: q.q, includeInactive: q.all === "1" }); });
export const POST = route(async ({ req, actor }) => created(await createInstructor(actor, await readBody(req))));
