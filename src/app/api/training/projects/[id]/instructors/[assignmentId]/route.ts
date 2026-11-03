import { readBody, route } from "@/server/http";
import { removeProjectInstructor, updateProjectInstructor } from "@/server/services/training/operations";
export const PATCH = route<{ id: string; assignmentId: string }>(async ({ req, actor, params }) => { await updateProjectInstructor(actor, params.id, params.assignmentId, await readBody(req)); return null; });
export const DELETE = route<{ id: string; assignmentId: string }>(async ({ actor, params }) => { await removeProjectInstructor(actor, params.id, params.assignmentId); return null; });
