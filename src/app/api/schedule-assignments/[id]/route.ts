import { route } from "@/server/http";
import { deleteAssignment } from "@/server/services/schedules";

export const DELETE = route<{ id: string }>(async ({ actor, params }) => { await deleteAssignment(actor, params.id); return { ok: true }; });
