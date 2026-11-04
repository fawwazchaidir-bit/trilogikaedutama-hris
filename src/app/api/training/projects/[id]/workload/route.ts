import { created, readBody, route } from "@/server/http";
import { addWorkloadTask, listWorkloadTasks } from "@/server/services/training/indicator-data";
export const GET = route<{ id: string }>(async ({ actor, params }) => listWorkloadTasks(actor, params.id));
export const POST = route<{ id: string }>(async ({ req, actor, params }) => created(await addWorkloadTask(actor, params.id, await readBody(req))));
