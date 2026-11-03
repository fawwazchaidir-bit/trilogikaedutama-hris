import { created, readBody, route } from "@/server/http";

import { assignInstructor, listProjectInstructors } from "@/server/services/training/operations";
export const GET = route<{ id: string }>(async ({ actor, params }) => listProjectInstructors(actor, params.id));
export const POST = route<{ id: string }>(async ({ req, actor, params }) => created(await assignInstructor(actor, params.id, await readBody(req))));
