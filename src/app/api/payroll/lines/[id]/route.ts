import { route } from "@/server/http";
import { removeAdjustment } from "@/server/services/payroll";

export const DELETE = route<{ id: string }>(async ({ actor, params }) => { await removeAdjustment(actor, params.id); return { ok: true }; });
