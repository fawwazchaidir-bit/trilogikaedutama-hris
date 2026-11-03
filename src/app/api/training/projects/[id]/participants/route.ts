import { created, readBody, route } from "@/server/http";

import { addParticipant, listProjectParticipants } from "@/server/services/training/operations";
export const GET = route<{ id: string }>(async ({ actor, params }) => listProjectParticipants(actor, params.id));
export const POST = route<{ id: string }>(async ({ req, actor, params }) => created(await addParticipant(actor, params.id, await readBody(req))));
