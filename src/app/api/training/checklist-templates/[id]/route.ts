import { readBody, route } from "@/server/http";
import { saveTemplate } from "@/server/services/training/work";
export const PUT = route<{ id: string }>(async ({ req, actor, params }) => saveTemplate(actor, params.id, await readBody(req)));
