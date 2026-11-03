import { readBody, route } from "@/server/http";
import { updateProgram } from "@/server/services/training/projects";
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => { await updateProgram(actor, params.id, await readBody(req)); return null; });
