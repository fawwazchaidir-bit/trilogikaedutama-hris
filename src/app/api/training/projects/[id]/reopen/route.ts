import { readBody, route } from "@/server/http";
import { reopenProject } from "@/server/services/training/projects";
export const POST = route<{ id: string }>(async ({ req, actor, params }) => reopenProject(actor, params.id, await readBody(req)));
