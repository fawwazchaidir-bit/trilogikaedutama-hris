import { created, readBody, route } from "@/server/http";
import { addMilestone, listMilestones } from "@/server/services/training/indicator-data";
export const GET = route<{ id: string }>(async ({ actor, params }) => listMilestones(actor, params.id));
export const POST = route<{ id: string }>(async ({ req, actor, params }) => created(await addMilestone(actor, params.id, await readBody(req))));
