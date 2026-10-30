import { route } from "@/server/http";
import { calculateRun } from "@/server/services/payroll";

export const POST = route<{ id: string }>(async ({ actor, params }) => { const r = await calculateRun(actor, params.id); return r ?? { ok: true }; });
