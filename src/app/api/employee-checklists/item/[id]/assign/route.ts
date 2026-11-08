import { readBody, route } from "@/server/http";
import { assignChecklistItem } from "@/server/services/employee-checklists";

/** Tunjuk penanggung jawab dan/atau tenggat sebuah butir `{ assigneeId: uuid|null, dueDate?: iso|null }`. HR. */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => { await assignChecklistItem(actor, params.id, await readBody(req)); return { ok: true }; });
