import { created, readBody, route } from "@/server/http";

import { createSchedule, listProjectSchedules } from "@/server/services/training/operations";
export const GET = route<{ id: string }>(async ({ actor, params }) => listProjectSchedules(actor, params.id));
export const POST = route<{ id: string }>(async ({ req, actor, params }) => created(await createSchedule(actor, params.id, await readBody(req))));
