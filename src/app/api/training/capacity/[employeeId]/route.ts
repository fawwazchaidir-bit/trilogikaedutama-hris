import { readBody, route } from "@/server/http";
import { clearStaffCapacity, upsertStaffCapacity } from "@/server/services/training/indicator-data";
export const PUT = route<{ employeeId: string }>(async ({ req, actor, params }) => { await upsertStaffCapacity(actor, params.employeeId, await readBody(req)); return { ok: true }; });
export const DELETE = route<{ employeeId: string }>(async ({ actor, params }) => { await clearStaffCapacity(actor, params.employeeId); return { ok: true }; });
