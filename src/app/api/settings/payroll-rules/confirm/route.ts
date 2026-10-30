import { route } from "@/server/http";
import { confirmPayrollRules } from "@/server/services/settings";

export const POST = route(async ({ actor }) => { await confirmPayrollRules(actor); return { ok: true }; });
