import { created, readBody, route } from "@/server/http";

import { addMember, listMembers } from "@/server/services/training/projects";
export const GET = route<{ id: string }>(async ({ actor, params }) => listMembers(actor, params.id));
export const POST = route<{ id: string }>(async ({ req, actor, params }) => { await addMember(actor, params.id, await readBody(req)); return created(await listMembers(actor, params.id)); });
