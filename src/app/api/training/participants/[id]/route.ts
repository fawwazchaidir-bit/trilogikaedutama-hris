import { readBody, route } from "@/server/http";
import { updateParticipant } from "@/server/services/training/operations";
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => { await updateParticipant(actor, params.id, await readBody(req)); return null; });
