import { readBody, route } from "@/server/http";
import { completeChecklist } from "@/server/services/employee-checklists";

/** Selesaikan proses; semua butir wajib harus Selesai atau Tidak berlaku. */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => { await completeChecklist(actor, params.id, await readBody(req)); return { ok: true }; });
