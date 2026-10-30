import { created, queryObject, readBody, route } from "@/server/http";
import { createRun } from "@/server/services/payroll";
import { listRuns } from "@/server/services/payroll";

export const GET = route(async ({ req, actor }) => listRuns(actor, { includeCancelled: queryObject(req).all === "1" }));

export const POST = route(async ({ req, actor }) => created(await createRun(actor, await readBody(req))));
