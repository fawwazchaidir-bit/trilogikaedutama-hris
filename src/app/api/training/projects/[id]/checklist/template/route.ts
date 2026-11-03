import { readBody, route } from "@/server/http";
import { applyChecklistTemplate } from "@/server/services/training/work";
export const POST = route<{ id: string }>(async ({ req, actor, params }) => applyChecklistTemplate(actor, params.id, await readBody(req)));
