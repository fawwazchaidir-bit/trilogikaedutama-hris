import { created, queryObject, readBody, route } from "@/server/http";
import { createEmployee } from "@/server/services/employees";
import { listEmployees } from "@/server/services/employees";

export const GET = route(async ({ req, actor }) => listEmployees(actor, queryObject(req)));

export const POST = route(async ({ req, actor }) => created(await createEmployee(actor, await readBody(req))));
