import { route } from "@/server/http";
import { cancelDelegation } from "@/server/services/org";

export const DELETE = route<{ id: string }>(async ({ actor, params }) => { await cancelDelegation(actor, params.id); return { ok: true }; });
