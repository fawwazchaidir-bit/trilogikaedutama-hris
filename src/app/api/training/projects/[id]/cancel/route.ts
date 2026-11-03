import { readBody, route } from "@/server/http";
import { cancelProject } from "@/server/services/training/projects";
export const POST = route<{ id: string }>(async ({ req, actor, params }) => cancelProject(actor, params.id, await readBody(req)));
