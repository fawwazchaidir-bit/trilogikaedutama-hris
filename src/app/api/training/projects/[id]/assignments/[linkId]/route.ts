import { route } from "@/server/http";
import { unlinkAssignment } from "@/server/services/training/operations";
export const DELETE = route<{ id: string; linkId: string }>(async ({ actor, params }) => { await unlinkAssignment(actor, params.id, params.linkId); return null; });
