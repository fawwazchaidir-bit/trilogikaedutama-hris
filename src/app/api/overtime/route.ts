import { created, queryObject, readBody, route } from "@/server/http";
import { listOvertime, submitOvertime } from "@/server/services/overtime";

export const GET = route(async ({ req, actor }) => listOvertime(actor, queryObject(req)));

export const POST = route(async ({ req, actor }) => created(await submitOvertime(actor, await readBody(req))));
