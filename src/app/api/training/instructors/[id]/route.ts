import { readBody, route } from "@/server/http";
import { updateInstructor } from "@/server/services/training/operations";
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => { await updateInstructor(actor, params.id, await readBody(req)); return null; });
