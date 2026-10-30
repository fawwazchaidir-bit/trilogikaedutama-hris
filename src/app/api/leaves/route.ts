import { created, queryObject, readBody, route } from "@/server/http";
import { listLeaves } from "@/server/services/leave";
import { submitLeave } from "@/server/services/leave";

export const GET = route(async ({ req, actor }) => listLeaves(actor, queryObject(req)));

export const POST = route(async ({ req, actor }) => created(await submitLeave(actor, await readBody(req))));
