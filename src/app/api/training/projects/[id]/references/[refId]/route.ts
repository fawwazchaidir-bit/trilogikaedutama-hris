import { route } from "@/server/http";
import { removeExternalRef } from "@/server/services/training/operations";
export const DELETE = route<{ id: string; refId: string }>(async ({ actor, params }) => { await removeExternalRef(actor, params.id, params.refId); return null; });
