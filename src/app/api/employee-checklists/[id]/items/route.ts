import { created, readBody, route } from "@/server/http";
import { addChecklistItem } from "@/server/services/employee-checklists";

/** Tambah butir khusus `{ title, hint?, required? }` pada checklist yang sedang berjalan. */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => { await addChecklistItem(actor, params.id, await readBody(req)); return created({ ok: true }); });
