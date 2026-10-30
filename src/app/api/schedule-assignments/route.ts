import { created, readBody, route } from "@/server/http";
import { createAssignment } from "@/server/services/schedules";
import { listAssignments } from "@/server/services/schedules";

export const GET = route(async ({ actor }) => listAssignments(actor));

export const POST = route(async ({ req, actor }) => { await createAssignment(actor, await readBody(req)); return created({ ok: true }); });
