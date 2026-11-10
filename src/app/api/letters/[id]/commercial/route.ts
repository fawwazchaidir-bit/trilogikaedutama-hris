import { readBody, route } from "@/server/http";
import { getCommercial, updateCommercial } from "@/server/services/letters/commercial";
export const GET = route<{ id: string }>(async ({ actor, params }) => getCommercial(actor, params.id));
export const PATCH = route<{ id: string }>(async ({ req, actor, params }) => updateCommercial(actor, params.id, await readBody(req)));
