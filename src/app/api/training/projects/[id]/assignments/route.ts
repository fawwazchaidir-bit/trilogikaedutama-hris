import { created, readBody, route } from "@/server/http";

import { linkAssignment, listAssignmentLinks } from "@/server/services/training/operations";
export const GET = route<{ id: string }>(async ({ actor, params }) => listAssignmentLinks(actor, params.id));
export const POST = route<{ id: string }>(async ({ req, actor, params }) => { await linkAssignment(actor, params.id, await readBody(req)); return created(await listAssignmentLinks(actor, params.id)); });
