import { readBody, route } from "@/server/http";
import { moveTemplateItem } from "@/server/services/employee-checklist-templates";

export const POST = route<{ id: string }>(async ({ req, actor, params }) => { await moveTemplateItem(actor, params.id, await readBody(req)); return { ok: true }; });
