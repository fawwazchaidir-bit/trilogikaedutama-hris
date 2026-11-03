import { readBody, route } from "@/server/http";
import { deleteChecklistItem, updateChecklistItem } from "@/server/services/training/work";
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => { await updateChecklistItem(actor, params.id, await readBody(req)); return null; });
export const DELETE = route<{ id: string }>(async ({ actor, params }) => { await deleteChecklistItem(actor, params.id); return null; });
