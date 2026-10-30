import { readBody, route } from "@/server/http";
import { cancelLeave } from "@/server/services/leave";

export const POST = route<{ id: string }>(async ({ req, actor, params }) => cancelLeave(actor, params.id, await readBody(req)));
