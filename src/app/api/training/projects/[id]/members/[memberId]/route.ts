import { readBody, route } from "@/server/http";
import { endMember, updateMember } from "@/server/services/training/projects";
export const PATCH = route<{ id: string; memberId: string }>(async ({ req, actor, params }) => { await updateMember(actor, params.id, params.memberId, await readBody(req)); return null; });
export const DELETE = route<{ id: string; memberId: string }>(async ({ actor, params }) => endMember(actor, params.id, params.memberId));
