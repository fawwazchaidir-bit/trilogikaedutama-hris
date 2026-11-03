import { readBody, route } from "@/server/http";
import { closeProject } from "@/server/services/training/projects";
export const POST = route<{ id: string }>(async ({ req, actor, params }) => closeProject(actor, params.id, await readBody(req)));
