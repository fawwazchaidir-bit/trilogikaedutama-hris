import { created, readBody, route } from "@/server/http";

import { addChecklistItem, listChecklist } from "@/server/services/training/work";
export const GET = route<{ id: string }>(async ({ actor, params }) => listChecklist(actor, params.id));
export const POST = route<{ id: string }>(async ({ req, actor, params }) => created(await addChecklistItem(actor, params.id, await readBody(req))));
