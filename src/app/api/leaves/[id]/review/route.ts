import { readBody, route } from "@/server/http";
import { reviewLeave } from "@/server/services/leave";

export const POST = route<{ id: string }>(async ({ req, actor, params }) => reviewLeave(actor, params.id, await readBody(req)));
