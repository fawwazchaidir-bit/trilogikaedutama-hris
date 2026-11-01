import { readBody, route } from "@/server/http";
import { reviewOvertime } from "@/server/services/overtime";

export const POST = route<{ id: string }>(async ({ req, actor, params }) => reviewOvertime(actor, params.id, await readBody(req)));
