import { route } from "@/server/http";
import { removePushDevice } from "@/server/services/push";
export const DELETE = route<{ id: string }>(async ({ actor, params }) => { await removePushDevice(actor, params.id); return { ok: true }; });
