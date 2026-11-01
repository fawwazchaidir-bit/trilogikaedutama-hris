import { readBody, route } from "@/server/http";
import { cancelOvertime } from "@/server/services/overtime";

export const POST = route<{ id: string }>(async ({ req, actor, params }) => cancelOvertime(actor, params.id, await readBody(req)));
