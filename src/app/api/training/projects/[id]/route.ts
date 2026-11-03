import { readBody, route } from "@/server/http";
import { getProject, updateProject } from "@/server/services/training/projects";
export const GET = route<{ id: string }>(async ({ actor, params }) => getProject(actor, params.id));
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => { await updateProject(actor, params.id, await readBody(req)); return getProject(actor, params.id); });
