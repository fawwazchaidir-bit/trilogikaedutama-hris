import { readBody, route } from "@/server/http";
import { listAccessRows, revokeAccessLevel, setAccessLevel } from "@/server/services/training/access";
export const GET = route(async ({ actor }) => listAccessRows(actor));
export const POST = route(async ({ req, actor }) => setAccessLevel(actor, await readBody(req)));
export const DELETE = route(async ({ req, actor }) => { await revokeAccessLevel(actor, await readBody(req)); return null; });
