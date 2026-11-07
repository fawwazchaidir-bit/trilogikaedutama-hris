import { readBody, route } from "@/server/http";
import { cancelChecklist } from "@/server/services/employee-checklists";

/** Batalkan proses yang dimulai keliru `{ reason }`. */
export const POST = route<{ id: string }>(async ({ req, actor, params }) => { await cancelChecklist(actor, params.id, await readBody(req)); return { ok: true }; });
