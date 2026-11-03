import { readBody, route } from "@/server/http";
import { changeProjectStatus } from "@/server/services/training/projects";
export const POST = route<{ id: string }>(async ({ req, actor, params }) => changeProjectStatus(actor, params.id, await readBody(req)));
