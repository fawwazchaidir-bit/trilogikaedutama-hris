import { route } from "@/server/http";
import { reactivateEmployee } from "@/server/services/employees";

export const POST = route<{ id: string }>(async ({ actor, params }) => { await reactivateEmployee(actor, params.id); return { ok: true }; });
