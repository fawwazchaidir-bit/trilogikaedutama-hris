import { created, readBody, route } from "@/server/http";

import { addComment, listComments } from "@/server/services/training/work";
export const GET = route<{ id: string }>(async ({ actor, params }) => listComments(actor, params.id));
export const POST = route<{ id: string }>(async ({ req, actor, params }) => { await addComment(actor, params.id, await readBody(req)); return created(await listComments(actor, params.id)); });
