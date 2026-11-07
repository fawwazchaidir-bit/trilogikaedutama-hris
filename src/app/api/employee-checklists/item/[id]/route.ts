import { readBody, route } from "@/server/http";
import { setChecklistItem } from "@/server/services/employee-checklists";

/** Ubah satu butir `{ status: TODO | DONE | NOT_APPLICABLE, note? }` — "Tidak berlaku" wajib beralasan; siapa & kapan tercatat. */
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => { await setChecklistItem(actor, params.id, await readBody(req)); return { ok: true }; });
