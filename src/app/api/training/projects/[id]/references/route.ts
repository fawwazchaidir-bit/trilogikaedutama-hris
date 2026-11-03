import { created, readBody, route } from "@/server/http";

import { addExternalRef, listExternalRefs } from "@/server/services/training/operations";
export const GET = route<{ id: string }>(async ({ actor, params }) => listExternalRefs(actor, params.id));
export const POST = route<{ id: string }>(async ({ req, actor, params }) => { await addExternalRef(actor, params.id, await readBody(req)); return created(await listExternalRefs(actor, params.id)); });
