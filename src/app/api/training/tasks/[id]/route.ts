import { readBody, route } from "@/server/http";
import { getTask, updateTask } from "@/server/services/training/work";
export const GET = route<{ id: string }>(async ({ actor, params }) => getTask(actor, params.id));
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => { await updateTask(actor, params.id, await readBody(req)); return getTask(actor, params.id); });
