import { readBody, route } from "@/server/http";
import { setCommercialStatus } from "@/server/services/letters/commercial";
export const POST = route<{ id: string }>(async ({ req, actor, params }) => setCommercialStatus(actor, params.id, await readBody(req)));
