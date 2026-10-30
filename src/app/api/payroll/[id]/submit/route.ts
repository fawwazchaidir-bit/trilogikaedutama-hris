import { route } from "@/server/http";
import { submitRun } from "@/server/services/payroll";

export const POST = route<{ id: string }>(async ({ actor, params }) => { const r = await submitRun(actor, params.id); return r ?? { ok: true }; });
