import { created, queryObject, readBody, route } from "@/server/http";
import { createDivision } from "@/server/services/employees";
import { listDivisions } from "@/server/services/employees";

export const GET = route(async ({ req, actor }) => listDivisions(actor, { includeInactive: queryObject(req).all === "1" }));

export const POST = route(async ({ req, actor }) => created(await createDivision(actor, await readBody(req))));
